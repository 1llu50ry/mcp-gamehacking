/**
 * Claimed-batch drain: the per-cycle processing pipeline (TASK-554 split out
 * of `worker.ts` `runOnce`).
 *
 * Phases, preserved exactly from the pre-split implementation:
 * - Phase 1 — parse payloads in memory (no DB reads). Unparseable jobs are
 *   completed as no-ops, matching the pre-batch behavior.
 * - Phase 2 — batch entity-existence check (OPT-PERF-03): one IN(...) read per
 *   entity kind for the whole claimed batch instead of one getById/getTaskById
 *   per job (~32 reads → ~3 reads). A job whose entity no longer exists is
 *   completed as a no-op exactly as before.
 * - Phase 3 — split the batch: only memory/standard/task jobs consume an ONNX
 *   embedding. codebase_symbol jobs are KG-only — writeVector is a deliberate
 *   NO-OP for them (TASK-293) and no symbol vector store exists (the dead
 *   codebase_symbol_vectors table was dropped in migration v35, TASK-042), so
 *   batch-embedding them would burn 150-500ms of CPU per file for a vector
 *   that is immediately discarded (TASK-338 / code-review F1). Embed only the
 *   embed-needed subset and hand codebase jobs a placeholder vector that
 *   applyJob's writeVector branch never persists.
 *
 * Per-job BUSY discipline (TASK-457): each outbox write (no-op completes,
 * release, fail, success complete) is routed through {@link runOutboxWrite} so
 * a transient SQLITE_BUSY defers the write (lease-expiry self-heals) instead
 * of killing the cycle — and never counts as a job attempt or a `failed`
 * increment.
 *
 * Pure function over the worker's collaborators (outbox, store, vectors,
 * counters, latency series) — no worker instance state — so it can live in its
 * own sub-500-LOC module while `EmbeddingWorker` keeps lifecycle + scheduling.
 */
import type { RealVectorStore } from "../../storage/vectors";
import type { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { Outbox } from "../outbox";
import type { EmbeddingJobPayload, QueueJobKind, QueueJobRow } from "../types";
import {
	applyJob as applyJobToStore,
	loadExistingEntityIds as loadExistingIds,
	parsePayload as parseJobPayload
} from "../worker-jobs";
import type { WorkerCounters } from "./counters";
import { recordNoOpComplete } from "./counters";
import { isBusyError } from "./sqlite-busy";
import { timeEmbedBatch } from "./latency";
import type { DurationSeries } from "../../utils/metrics";

/**
 * Run an outbox write tolerating transient SQLite lock contention
 * (TASK-457). better-sqlite3 SqliteError codes 'SQLITE_BUSY' (busy_timeout
 * expired) and 'SQLITE_BUSY_SNAPSHOT' (read-then-write hit a concurrent
 * commit) mean a sibling process holds the SQLite write lock. The write is
 * skipped — the row stays claimed and self-heals via lease expiry — and
 * NEVER counts as a job attempt or a cycle failure. Non-busy errors are
 * rethrown so the caller's real-failure handling applies unchanged.
 *
 * @returns true when the write ran to completion, false when deferred.
 */
export function runOutboxWrite(fn: () => void, context: string): boolean {
	try {
		fn();
		return true;
	} catch (err) {
		if (isBusyError(err)) {
			logger.warn("[EmbeddingWorker] outbox write deferred (database busy)", {
				context,
				error: String(err)
			});
			return false;
		}
		throw err;
	}
}

/** A claimed job whose payload parsed and whose entity still exists. */
export interface ResolvedJob {
	job: QueueJobRow;
	payload: EmbeddingJobPayload;
}

/** A resolved job paired with the vector to persist (or discard for codebase). */
export interface ApplyItem {
	job: QueueJobRow;
	payload: EmbeddingJobPayload;
	vector: number[];
}

/**
 * Drain one claimed batch through the parse → existence-check → embed →
 * apply → complete pipeline. Returns the number of jobs claimed (0 when the
 * caller claimed nothing). Mutates `counters` (processed/failed/poisoned) and
 * `embedLatency` exactly as the original `EmbeddingWorker.runOnce` did.
 *
 * The caller is responsible for claiming (and for updating lastRunAt/
 * lastBatchSize, which belong to the worker's stats snapshot).
 */
export async function drainClaimedBatch(options: {
	store: SQLiteStore;
	vectors: RealVectorStore;
	outbox: Outbox;
	jobs: QueueJobRow[];
	poisonThreshold: number;
	backoffBaseMs: number;
	backoffMaxMs: number;
	counters: WorkerCounters;
	embedLatency: DurationSeries;
}): Promise<number> {
	const { store, vectors, outbox, jobs, poisonThreshold, backoffBaseMs, backoffMaxMs, counters, embedLatency } =
		options;
	if (jobs.length === 0) return 0;

	// Phase 1 — parse payloads in memory (no DB reads). Unparseable jobs
	// are completed as no-ops, matching the pre-batch behavior.
	const parsed: ResolvedJob[] = [];
	for (const job of jobs) {
		const payload = parseJobPayload(job);
		if (!payload) {
			// Unparseable payload — nothing to enrich. Complete bound to
			// OUR batch token: if the lease expired and another worker
			// re-claimed the row, this no-ops and that worker keeps
			// processing it. Wrapped so a transient SQLITE_BUSY here
			// defers the write (lease-expiry self-heals) instead of
			// killing the whole cycle (TASK-457). The no-op complete
			// counts as a failure ONLY when it actually ran: a deferred
			// (BUSY) complete leaves the row claimed and self-healing,
			// and must not inflate `failed` with lock contention
			// (TASK-457-F2, mirrors the per-job BUSY path which skips it).
			const completedNoOp = runOutboxWrite(() => outbox.complete(job.id, job.locked_by ?? ""), "complete-unparseable");
			recordNoOpComplete(counters, completedNoOp);
			continue;
		}
		parsed.push({ job, payload });
	}

	// Phase 2 — batch entity-existence check (OPT-PERF-03). A job whose
	// entity no longer exists is skipped exactly as before: completed as
	// a no-op (complete() is token-bound, so a re-claimed row no-ops) and
	// counted as failed.
	const resolved: ResolvedJob[] = [];
	if (parsed.length > 0) {
		const existingById = loadExistingIds(store, parsed);
		for (const item of parsed) {
			if (!existingById.get(item.job.entity_kind)?.has(item.job.entity_id)) {
				// Wrapped — a transient SQLITE_BUSY defers the no-op
				// complete (lease-expiry self-heals) instead of killing
				// the cycle (TASK-457). Count as failed ONLY when the
				// complete actually ran — a deferred complete is lock
				// contention, not a job failure, so it must not inflate
				// `failed` (TASK-457-F2, mirrors the per-job BUSY path).
				const completedMissing = runOutboxWrite(
					() => outbox.complete(item.job.id, item.job.locked_by ?? ""),
					"complete-missing-entity"
				);
				recordNoOpComplete(counters, completedMissing);
				continue;
			}
			resolved.push(item);
		}
	}

	if (resolved.length > 0) {
		const embedNeeded = resolved.filter((r) => r.job.entity_kind !== "codebase_symbol");
		const toApply: ApplyItem[] = [];
		if (embedNeeded.length > 0) {
			// Batch embedding latency (OPT-OBS-01): measured in timeEmbedBatch
			// into BOTH the worker's own series (exposed via getStats().
			// embedLatency) and the process metrics registry.
			await timeEmbedBatch(embedLatency, async () => {
				const embedded = await vectors.embed(embedNeeded.map((r) => r.payload.text));
				for (let i = 0; i < embedNeeded.length; i++) {
					toApply.push({ ...embedNeeded[i], vector: embedded[i] });
				}
			});
		}
		for (const item of resolved) {
			if (item.job.entity_kind === "codebase_symbol") {
				// Placeholder — discarded by the writeVector NO-OP.
				toApply.push({ ...item, vector: [] });
			}
		}

		for (const { job, payload, vector } of toApply) {
			try {
				await applyJobToStore(store, vectors, job, payload, vector);
				outbox.complete(job.id, job.locked_by ?? "");
				counters.processed++;
			} catch (err) {
				if (isBusyError(err)) {
					// Transient lock contention (TASK-457): writeVector (or
					// the complete right after it) hit SQLITE_BUSY. This is
					// NOT a job failure — counting it as an attempt would
					// move a healthy job toward poison after just 5 lock-out
					// windows (EMBEDDING_QUEUE_POISON_THRESHOLD). Release the
					// claim (attempts/backoff untouched) so the next cycle
					// retries the same snapshot, and never increment failed.
					logger.warn("[EmbeddingWorker] job deferred (database busy) — requeued", {
						job: job.id,
						error: String(err)
					});
					runOutboxWrite(() => outbox.release(job.id, job.locked_by ?? ""), "release-busy");
					continue;
				}
				counters.failed++;
				// Wrapped so a transient SQLITE_BUSY on fail()'s own
				// SELECT/UPDATE defers the write (the row stays claimed and
				// self-heals via lease expiry) instead of escaping the
				// catch and killing the cycle (TASK-457). Real failures
				// still increment attempts + backoff exactly as before.
				runOutboxWrite(
					() =>
						outbox.fail(
							job.id,
							job.locked_by ?? "",
							err instanceof Error ? err.message : String(err),
							poisonThreshold,
							backoffBaseMs,
							backoffMaxMs
						),
					"fail"
				);
				// poison mirror — ONLY when the fail write actually ran
				// (see fail.ts isPoisonedAt for the exact threshold math).
				counters.poisoned++;
			}
		}
	}

	return jobs.length;
}

// re-exported for doc references (kept out of the barrel to avoid duplicate
// symbol names across the queue package)
export type { QueueJobKind, EmbeddingJobPayload };
