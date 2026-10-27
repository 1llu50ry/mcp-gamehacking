/**
 * Embedding-worker job pipeline — the claim→embed→extract→complete per-job
 * steps (TASK-430 split out of `worker.ts`).
 *
 * Pure store/vector functions — no worker instance state — so the batch
 * runner (`EmbeddingWorker.runOnce`) can delegate each step here while the
 * worker keeps lifecycle, polling, and observability.
 */
import type { SQLiteStore } from "../storage/sqlite";
import type { RealVectorStore } from "../storage/vectors";
import { currentEmbeddingModelVersion } from "../storage/embedding-model";
import {
	saveCodebaseRelations,
	saveExtractions,
	saveStandardRelations,
	saveTaskRelations
} from "../tools/kg-archivist";
import { codebaseEntityId, codebaseEntityParts } from "./enqueue";
import { embedPayloadContentHash } from "./content-hash";
import type { EmbeddingJobPayload, QueueJobKind, QueueJobRow } from "./types";

/**
 * Parse a claimed job's payload. Unparseable payloads are completed as
 * no-ops by the caller, matching the pre-batch behavior.
 */
export function parsePayload(job: QueueJobRow): EmbeddingJobPayload | null {
	try {
		const parsed = JSON.parse(job.payload) as EmbeddingJobPayload;
		if (!parsed || typeof parsed.text !== "string" || parsed.text.length === 0) return null;
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Batch entity-existence check (OPT-PERF-03). One IN(...) DB read per
 * entity kind present in the claimed batch replaces the per-job
 * getById/getTaskById round-trips (K=32 reads → ≤3 reads). Returns a
 * per-kind Set of entity ids that still exist; soft-deleted (canceled)
 * tasks are excluded exactly as the per-job check did — a stale pending
 * job can never re-embed the vector or re-run KG extraction for a deleted
 * task (TASK-042 / MEM-427).
 */
export function loadExistingEntityIds(
	store: SQLiteStore,
	items: ReadonlyArray<{ job: QueueJobRow }>
): Map<QueueJobKind, Set<string>> {
	const idsByKind = new Map<QueueJobKind, string[]>();
	for (const { job } of items) {
		const ids = idsByKind.get(job.entity_kind);
		if (ids) {
			ids.push(job.entity_id);
		} else {
			idsByKind.set(job.entity_kind, [job.entity_id]);
		}
	}

	const existing = new Map<QueueJobKind, Set<string>>();
	for (const [kind, ids] of idsByKind) {
		if (kind === "memory") {
			existing.set(kind, new Set(store.memories.getByIds(ids).map((m) => m.id)));
		} else if (kind === "standard") {
			existing.set(kind, new Set(store.standards.getByIds(ids).map((s) => s.id)));
		} else if (kind === "codebase_symbol") {
			// Codebase jobs are keyed by the stable `<repo>::<file_path>`
			// entity id (TASK-293). Existence = the indexed file row still
			// exists; a deleted/stale-cleaned file completes the job as a
			// no-op exactly like a soft-deleted task. One IN(...) read per
			// (repo) group keeps the OPT-PERF-03 batch-read pattern.
			const pathsByRepo = new Map<string, string[]>();
			for (const id of ids) {
				const { repo, filePath } = codebaseEntityParts(id);
				const paths = pathsByRepo.get(repo) ?? [];
				paths.push(filePath);
				pathsByRepo.set(repo, paths);
			}
			const existingIds = new Set<string>();
			for (const [repo, paths] of pathsByRepo) {
				const livePaths = new Set(store.codebaseFiles.getFilesByPaths(repo, paths).map((f) => f.file_path));
				for (const p of paths) {
					if (livePaths.has(p)) existingIds.add(codebaseEntityId(repo, p));
				}
			}
			existing.set(kind, existingIds);
		} else {
			// Soft-deleted tasks (status = 'canceled') are treated as
			// non-existent: the job is completed as a no-op (TASK-042).
			existing.set(
				kind,
				new Set(
					store.tasks
						.getTasksByIds(ids)
						.filter((t) => t.status !== "canceled")
						.map((t) => t.id)
				)
			);
		}
	}
	return existing;
}

/**
 * KG extraction first (idempotent — unique observation index + OR IGNORE),
 * then the vector write. If the process crashes after the vector write but
 * before `complete`, the lease expires and the job is reprocessed; the
 * KG side is a no-op duplicate, and the vector is overwritten with the
 * same snapshot — no data duplication.
 */
export async function applyJob(
	store: SQLiteStore,
	vectors: RealVectorStore,
	job: QueueJobRow,
	payload: EmbeddingJobPayload,
	vector: number[]
): Promise<void> {
	const owner = payload.owner ?? "";
	const repo = payload.repo ?? "";
	const kgContent = payload.content ?? payload.text;
	const title = payload.title ?? "";

	if (job.entity_kind === "memory") {
		await saveExtractions(kgContent, title, owner, repo, store, "memory");
	} else if (job.entity_kind === "standard") {
		await saveExtractions(kgContent, title, owner, repo, store, "standard");
		await saveStandardRelations(
			{
				id: job.entity_id,
				title,
				content: kgContent,
				context: payload.context ?? "general",
				stack: payload.stack ?? [],
				parent_id: payload.parentId ?? null,
				owner,
				repo: repo || null
			},
			store
		);
	} else if (job.entity_kind === "codebase_symbol") {
		// Codebase KG population (TASK-293): compromise extraction over the
		// file's symbol lines (payload content), then the codebase relation
		// writer mirrors saveStandardRelations — it re-reads the file's
		// symbols + reference edges from codebase_symbols/codebase_references
		// (the latest committed state; the payload snapshot gates dedup).
		// `owner` is threaded from the index caller through the queue payload
		// (FIX-OWNER-CODEBASE): codebase_symbols has no owner column, but the
		// KG rows written here DO carry one, so it must come from the payload
		// rather than being hardcoded to "".
		await saveExtractions(kgContent, title, owner, repo, store, "codebase");
		await saveCodebaseRelations({ filePath: title, owner, repo }, store);
	} else {
		await saveExtractions(kgContent, title, owner, repo, store, "task");
		await saveTaskRelations(kgContent, title, owner, repo, store, {
			parentId: payload.parentId ?? null,
			decisionRefs: payload.decisionRefs
		});
	}

	writeVector(store, job.entity_kind, job.entity_id, vector, payload);
}

export function writeVector(
	store: SQLiteStore,
	kind: QueueJobKind,
	id: string,
	vector: number[],
	payload: EmbeddingJobPayload
): void {
	// PERF-003: stamp the vector row with the SAME embed/KG content hash the
	// enqueue path computed plus the current model version, so the startup
	// backfill can decide idempotently whether a re-embed is needed. The hash
	// is derived from the queue payload (the exact snapshot the worker
	// embedded), making it directly comparable to a later backfill hash.
	const meta = {
		contentHash: embedPayloadContentHash(payload),
		modelVersion: currentEmbeddingModelVersion()
	};
	if (kind === "memory") {
		store.memoryVectors.upsertVectorEmbedding(id, vector, meta);
	} else if (kind === "standard") {
		store.standards.upsertVectorEmbedding(id, vector, meta);
	} else if (kind === "task") {
		store.tasks.upsertTaskVectorEmbedding(id, vector, meta);
	} else {
		// codebase_symbol — intentionally NO-OP (TASK-293): symbols keep
		// their OWN vector lifecycle. No production path persists symbol
		// vectors (the dead codebase_symbol_vectors table was dropped in
		// migration v35 — TASK-042), and RealVectorStore.search returns no
		// candidates for codebase_symbol, so writing here would be a double
		// vector with no consumer. The pre-TASK-293 else-branch would have
		// written task_vectors keyed by a symbol id — the exact pollution this
		// guard prevents. runOnce skips ONNX inference for codebase jobs
		// entirely and passes a placeholder vector that is discarded here
		// (TASK-338).
	}
}
