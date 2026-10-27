/**
 * Enqueue + startup-backfill logic for the embedding/KG outbox (TASK-074).
 *
 * Split out of `outbox.ts` so the outbox stays under the 500-line rule and
 * each file owns one concern:
 *   - `enqueue.ts` — snapshot payload builders, synchronous SELECT-dedup +
 *     conditional-LWW-upsert enqueue (returns boolean: `false` = deduped
 *     no-op, `true` = inserted/upserted) used by tool handlers inside
 *     `withWrite`, and the read-then-write startup backfill.
 *   - `outbox.ts` — the `Outbox` worker-facing lifecycle (claim/complete/fail/
 *     reconcile/purge/count), delegating enqueue + backfill back here.
 *   - `payloads.ts` — the pure snapshot payload builders (TASK-430 split).
 *
 * All methods are synchronous (better-sqlite3) and cheap — enqueue performs a
 * SELECT dedup check (content_hash comparison) then a conditional LWW upsert,
 * both inside the caller's write transaction, keeping write-lock hold time at
 * ~µs instead of the 150-500ms ONNX + compromise work it replaces.
 *
 * Write-lock policy (TASK-064 / MEM-475): worker/backfill writes stay OUTSIDE
 * the proper-lockfile write lock by design. The read-then-write backfill runs
 * inside a BEGIN IMMEDIATE transaction so it grabs the SQLite write lock
 * upfront instead of failing with SQLITE_BUSY_SNAPSHOT.
 */
import { randomUUID } from "crypto";
import { SQLiteStore } from "../storage/sqlite";
import { logger } from "../utils/logger";
import { EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE, TABLE_MEMORIES, TABLE_TASKS } from "../utils/constants";
import {
	MemoryEntry,
	Task,
	CodingStandardEntry,
	CodebaseSymbolInsert,
	CodebaseReferenceInsert,
	MEMORY_STATUS_ACTIVE,
	TASK_STATUS_CANCELED
} from "../types";
import { embedPayloadContentHash } from "./content-hash";
import { currentEmbeddingModelVersion } from "../storage/embedding-model";
import { EmbeddingJobInput, EmbeddingJobPayload, QueueCounts, QueueJobStatus, QueueJobRow } from "./types";
import {
	memoryJobPayload,
	standardJobPayload,
	taskJobPayload,
	codebaseEntityId,
	codebaseSymbolJobPayload
} from "./payloads";

// Re-export the pure payload builders for backward compatibility (outbox /
// index barrels and tests import them from this module path).
export {
	memoryJobPayload,
	standardJobPayload,
	taskJobPayload,
	codebaseEntityId,
	codebaseEntityParts,
	codebaseSymbolJobPayload
} from "./payloads";

/** Convenience wrapper used by the indexing writer (TASK-293). */
export function enqueueCodebaseSymbols(
	store: SQLiteStore,
	repo: string,
	filePath: string,
	symbols: CodebaseSymbolInsert[],
	refs?: CodebaseReferenceInsert[],
	owner = ""
): boolean {
	return enqueueEmbeddingJob(store, {
		kind: "codebase_symbol",
		id: codebaseEntityId(repo, filePath),
		repo,
		owner,
		payload: codebaseSymbolJobPayload({ repo, filePath, symbols, refs, owner })
	});
}

// ---------------------------------------------------------------------------
// Enqueue (SELECT-dedup + conditional LWW upsert — used by tool handlers
// inside withWrite; returns false when deduped, true when inserted/upserted)
// ---------------------------------------------------------------------------

const ENQUEUE_SQL = `
  INSERT INTO queue_jobs (id, entity_kind, entity_id, entity_repo, payload, content_hash, status, attempts, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
    payload = excluded.payload,
    content_hash = excluded.content_hash,
    status = 'pending',
    attempts = 0,
    lease_until = NULL,
    locked_by = NULL,
    backoff_until = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at
`;

/**
 * Synchronous LWW enqueue. Cheap (~µs) — safe inside the write lock.
 *
 * Content-hash dedup (OPT-FLOW-03): when a `queue_jobs` row already exists for
 * (entity_kind, entity_id) AND its stored `content_hash` matches the incoming
 * payload's embed/KG-relevant hash, the row is left untouched and the enqueue
 * returns `false` — no ONNX inference, no KG extraction, no attempt/backoff
 * reset. This turns tag-only / metadata-only / touch updates (which the worker
 * would otherwise re-embed on byte-identical content) into no-ops. LWW
 * semantics for genuinely-changed content are preserved: any change to a field
 * the worker consumes (text/content/title/parentId/decisionRefs/context/stack)
 * produces a different hash and falls through to the normal LWW upsert.
 *
 * Pre-migration rows (`content_hash` NULL) are never deduped — the first
 * enqueue after v16 computes and stores the hash.
 *
 * Poisoned rows are NEVER deduped: `Outbox.claim()` skips `poison` rows (they
 * are swept by purge TTL, not retried), so a re-enqueue after any update is
 * the only recovery path for a job that failed on this exact content — a touch
 * update must reset it to `pending` even when the hash matches, otherwise the
 * entity stays without a vector until purge + restart.
 *
 * @returns `true` when the job was enqueued/upserted, `false` when deduped.
 */
export function enqueueEmbeddingJob(store: SQLiteStore, input: EmbeddingJobInput): boolean {
	const contentHash = embedPayloadContentHash(input.payload);

	const existing = store.db
		.prepare("SELECT content_hash, status FROM queue_jobs WHERE entity_kind = ? AND entity_id = ?")
		.get(input.kind, input.id) as Pick<QueueJobRow, "content_hash" | "status"> | undefined;

	if (
		existing &&
		existing.content_hash !== null &&
		existing.content_hash === contentHash &&
		existing.status !== "poison"
	) {
		logger.debug("[EmbeddingQueue] dedup: embed/KG content unchanged — skip re-enqueue (OPT-FLOW-03)", {
			kind: input.kind,
			id: input.id,
			status: existing.status
		});
		return false;
	}

	const now = new Date().toISOString();
	store.db
		.prepare(ENQUEUE_SQL)
		.run(randomUUID(), input.kind, input.id, input.repo ?? "", JSON.stringify(input.payload), contentHash, now, now);
	return true;
}

/**
 * Backfill enqueue: INSERT when the (entity_kind, entity_id) row is absent,
 * and REVIVE a terminal `done` row to `pending` with the fresh payload +
 * content_hash. Never touches a live or poisoned row.
 *
 * The caller (`backfillMissingVectors`) only passes inputs for which
 * `needsReembed` returned true, so EVERY row reaching this function genuinely
 * needs (re-)embedding. Semantics:
 *   - row absent               → INSERT a fresh `pending` row.
 *   - row `done` (terminal)    → revive to `pending`, attempts=0, lease/backoff/
 *                                last_error cleared, payload + content_hash
 *                                replaced by the current snapshot.
 *   - row `pending`/`claimed`  → UNTOUCHED: a live job keeps its attempts /
 *                                backoff_until / last_error (TASK-068 S1 /
 *                                TASK-069), so a restart never defeats the
 *                                exponential retry backoff of an FK-poisoned
 *                                job.
 *   - row `poison`             → UNTOUCHED: poison recovery is the purge TTL +
 *                                the write path's LWW reset, never the backfill.
 *
 * Why the `done` revival exists (PERF-FIX-001): `Outbox.complete()` marks a
 * drained row `done` instead of deleting it, and the UNIQUE
 * `(entity_kind, entity_id)` index made the old `ON CONFLICT DO NOTHING` treat
 * that terminal row as a conflict — silently DROPPING a required re-enqueue
 * (model-version bump / content change) for up to `EMBEDDING_QUEUE_DONE_TTL_MS`
 * (6h). Purging before the backfill does NOT fix this on its own: a version
 * bump inside the 6h window would still be dropped. The
 * `WHERE queue_jobs.status = 'done'` guard is what scopes the reset to
 * terminal rows only.
 *
 * Single statement (INSERT … ON CONFLICT DO UPDATE … WHERE) — SNAPSHOT-immune
 * and cheap, so the backfill's chunked BEGIN IMMEDIATE transactions keep their
 * per-chunk write-lock hold at milliseconds.
 */
export function enqueueIfAbsent(store: SQLiteStore, input: EmbeddingJobInput): boolean {
	const now = new Date().toISOString();
	const result = store.db
		.prepare(
			`INSERT INTO queue_jobs (id, entity_kind, entity_id, entity_repo, payload, content_hash, status, attempts, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
			ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
				payload = excluded.payload,
				content_hash = excluded.content_hash,
				status = 'pending',
				attempts = 0,
				lease_until = NULL,
				locked_by = NULL,
				backoff_until = NULL,
				last_error = NULL,
				updated_at = excluded.updated_at
			WHERE queue_jobs.status = 'done'`
		)
		.run(
			randomUUID(),
			input.kind,
			input.id,
			input.repo ?? "",
			JSON.stringify(input.payload),
			embedPayloadContentHash(input.payload),
			now,
			now
		);
	return result.changes > 0;
}

/** Convenience wrappers used by the write handlers. */
export function enqueueMemory(store: SQLiteStore, memory: MemoryEntry): void {
	enqueueEmbeddingJob(store, {
		kind: "memory",
		id: memory.id,
		repo: memory.scope.repo,
		owner: memory.scope.owner,
		payload: memoryJobPayload({
			title: memory.title,
			content: memory.content,
			owner: memory.scope.owner,
			repo: memory.scope.repo,
			updatedAt: memory.updated_at
		})
	});
}

export function enqueueStandard(store: SQLiteStore, standard: CodingStandardEntry): void {
	enqueueEmbeddingJob(store, {
		kind: "standard",
		id: standard.id,
		repo: standard.repo ?? "",
		owner: standard.owner,
		payload: standardJobPayload(standard)
	});
}

export function enqueueTask(store: SQLiteStore, task: Task): void {
	enqueueEmbeddingJob(store, {
		kind: "task",
		id: task.id,
		repo: task.repo,
		owner: task.owner,
		payload: taskJobPayload(task)
	});
}

/** Queue depth by status (shared by the worker observability + backfill gate). */
export function countByStatus(store: SQLiteStore): QueueCounts {
	const rows = store.db.prepare("SELECT status, COUNT(*) AS c FROM queue_jobs GROUP BY status").all() as {
		status: QueueJobStatus;
		c: number;
	}[];
	const counts: QueueCounts = { pending: 0, claimed: 0, done: 0, poison: 0, total: 0 };
	for (const row of rows) {
		if (row.status in counts) counts[row.status] = row.c;
		counts.total += row.c;
	}
	return counts;
}

/**
 * Startup backfill: enqueue an entity for (re-)embedding when its vector is
 * MISSING, or its stored `content_hash` no longer matches the entity's current
 * embed/KG payload, or its stored `model_version` differs from the current
 * embedding model (PERF-003).
 *
 * Idempotency (PERF-003): the pre-fix predicate (`vector.updated_at <
 * entity.updated_at`) treated ANY metadata-only `updated_at` bump — e.g. the
 * soul-maintenance importance decay that rewrites `importance`/`updated_at` on
 * thousands of memories — as staleness, so every restart re-embedded the whole
 * corpus. The re-embed decision is now made SOLELY by comparing the vector's
 * stored `content_hash` + `model_version` against the entity's CURRENT payload:
 * a metadata-only bump leaves the payload hash unchanged, so nothing is
 * enqueued. After the first pass every vector carries a matching hash +
 * version, so subsequent restarts enqueue ~0.
 *
 * Candidate selection (bounded): the SQL only narrows by entity STATUS and
 * `LIMIT cap`; the EXACT re-embed decision is then made in JS by rebuilding the
 * SAME payload the enqueue path builds and comparing `content_hash` +
 * `model_version`. The entity `updated_at` is NOT consulted at all (neither as
 * a decision nor as a candidate filter): a metadata-only `updated_at` bump
 * (soul-maintenance importance decay) leaves the payload hash unchanged, so it
 * can never cause an enqueue and the mass-re-embed regression cannot recur.
 * Genuine content changes are enqueued by the write path at change time; the
 * backfill is the crash-recovery safety net that catches missing/incomplete
 * provenance and model-version drift. Computing hashes for up to `cap`
 * candidates per phase is cheap (no ONNX); the expensive work only happens for
 * rows that genuinely need it.
 *
 * Backpressure (TASK-068 S1 / TASK-069) is preserved verbatim:
 * - Gated: when pending + claimed already reach `minPendingClaimed`
 *   (default EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE = 500), backfill returns 0
 *   immediately — a deep backlog is NOT double-refilled at restart; the
 *   worker drains the jobs it already has.
 * - Insert-or-revive-terminal: rows ABSENT from queue_jobs are inserted
 *   fresh; a terminal `done` row is revived to `pending` with the current
 *   snapshot (PERF-FIX-001 — `Outbox.complete()` keeps drained rows, and the
 *   old conflict check dropped a genuinely-required re-enqueue while that row
 *   lived out its 6h `EMBEDDING_QUEUE_DONE_TTL_MS`). Live rows
 *   (pending/claimed/backoff) and `poison` rows are NEVER touched, so their
 *   attempts/backoff_until survive. This preserves exponential retry backoff
 *   for FK-poisoned jobs instead of resetting them to retry immediately (the
 *   pre-fix CPU multiplier).
 *
 * Runs in chunked BEGIN IMMEDIATE transactions (TASK-064 / MEM-475 +
 * TASK-457): the read-then-write sequence grabs the SQLite write lock upfront
 * instead of failing with SQLITE_BUSY_SNAPSHOT under concurrent writers, and
 * each transaction commits at most BACKFILL_TXN_CHUNK rows so a large
 * backfill never holds the SQLite write lock long enough to starve sibling
 * writers past busy_timeout (see the implementation note below).
 */
export function backfillMissingVectors(
	store: SQLiteStore,
	cap: number,
	minPendingClaimed = EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE
): number {
	if (cap <= 0) return 0;

	const counts = countByStatus(store);
	if (counts.pending + counts.claimed >= minPendingClaimed) {
		logger.info("[EmbeddingQueue] backfill gated by queue depth", {
			pending: counts.pending,
			claimed: counts.claimed,
			gate: minPendingClaimed
		});
		return 0;
	}

	const currentVersion = currentEmbeddingModelVersion();

	/**
	 * PERF-003 re-embed decision. `vectorPresent` false (no row) always
	 * re-embeds; otherwise the stored `model_version` must equal the current
	 * one AND the stored `content_hash` must equal the freshly-computed hash of
	 * the entity's current payload. A NULL stored hash (pre-PERF-003 row) is
	 * "unknown" and re-embeds exactly once to stamp it.
	 */
	const needsReembed = (
		vectorPresent: boolean,
		storedHash: string | null,
		storedModelVersion: number | null,
		payload: EmbeddingJobPayload
	): boolean => {
		if (!vectorPresent) return true;
		if (storedModelVersion !== currentVersion) return true;
		return storedHash === null || storedHash !== embedPayloadContentHash(payload);
	};

	let enqueued = 0;

	// Chunked backfill write transactions (TASK-457): the old single
	// BEGIN IMMEDIATE held the SQLite write lock for the WHOLE cap (up to
	// EMBEDDING_QUEUE_BACKFILL_CAP=2000 upserts under one transaction) — on a
	// CPU-loaded multi-process boot that starved sibling writers (dashboard /
	// another per-client MCP server / the codebase indexer) past
	// busy_timeout=5000 ("database is locked"). Now each immediate transaction
	// writes at most BACKFILL_TXN_CHUNK rows, so the per-transaction write-lock
	// hold drops from seconds to milliseconds. The candidate SELECTs run
	// OUTSIDE any write transaction (plain reads hold no write lock), and each
	// chunked INSERT is a single `INSERT ... ON CONFLICT DO NOTHING`
	// (enqueueIfAbsent) — SNAPSHOT-immune — so the reads-before-writes split
	// cannot hit SQLITE_BUSY_SNAPSHOT.
	const BACKFILL_TXN_CHUNK = 200;
	const enqueueInChunks = (inputs: EmbeddingJobInput[]): number => {
		let inserted = 0;
		for (let i = 0; i < inputs.length; i += BACKFILL_TXN_CHUNK) {
			const slice = inputs.slice(i, i + BACKFILL_TXN_CHUNK);
			store.db
				.transaction(() => {
					for (const input of slice) {
						if (enqueueIfAbsent(store, input)) inserted++;
					}
				})
				.immediate();
		}
		return inserted;
	};

	// Phase 1 — memories (up to `cap` candidates).
	{
		const memories = store.db
			.prepare(
				`SELECT m.id, m.repo, m.owner, m.title, m.content, m.updated_at,
					mv.memory_id AS vector_id, mv.content_hash AS stored_hash, mv.model_version AS stored_version
             FROM ${TABLE_MEMORIES} m LEFT JOIN derived.memory_vectors mv ON mv.memory_id = m.id
             WHERE m.status = '${MEMORY_STATUS_ACTIVE}'
             ORDER BY (mv.memory_id IS NULL) DESC,
				(mv.content_hash IS NULL OR mv.model_version IS NULL OR mv.model_version <> ?) DESC,
				m.updated_at DESC
             LIMIT ?`
			)
			.all(currentVersion, cap) as Array<{
			id: string;
			repo: string;
			owner: string;
			title: string | null;
			content: string;
			updated_at: string;
			vector_id: string | null;
			stored_hash: string | null;
			stored_version: number | null;
		}>;

		const inputs: EmbeddingJobInput[] = [];
		for (const m of memories) {
			const payload = memoryJobPayload({
				title: m.title,
				content: m.content,
				owner: m.owner,
				repo: m.repo,
				updatedAt: m.updated_at
			});
			if (!needsReembed(m.vector_id !== null, m.stored_hash, m.stored_version, payload)) continue;
			inputs.push({ kind: "memory", id: m.id, repo: m.repo, owner: m.owner, payload });
		}
		enqueued += enqueueInChunks(inputs);
	}

	// Phase 2 — standards fill the remaining budget (cap - enqueued limit).
	if (enqueued < cap) {
		const standards = store.db
			.prepare(
				`SELECT s.id, s.repo, s.owner, s.title, s.content, s.context, s.version, s.language,
					s.stack, s.tags, s.metadata, s.parent_id, s.updated_at,
					sv.standard_id AS vector_id, sv.content_hash AS stored_hash, sv.model_version AS stored_version
             FROM coding_standards s LEFT JOIN derived.standard_vectors sv ON sv.standard_id = s.id
             ORDER BY (sv.standard_id IS NULL) DESC,
				(sv.content_hash IS NULL OR sv.model_version IS NULL OR sv.model_version <> ?) DESC,
				s.updated_at DESC
             LIMIT ?`
			)
			.all(currentVersion, cap - enqueued) as Array<{
			id: string;
			repo: string | null;
			owner: string;
			title: string;
			content: string;
			context: string;
			version: string | null;
			language: string | null;
			stack: string | null;
			tags: string | null;
			metadata: string | null;
			parent_id: string | null;
			updated_at: string;
			vector_id: string | null;
			stored_hash: string | null;
			stored_version: number | null;
		}>;

		const inputs: EmbeddingJobInput[] = [];
		for (const s of standards) {
			// Rebuild the SAME entry shape the enqueue path sees so
			// `standardJobPayload`/`buildStandardVectorText` hash identically.
			const standard: CodingStandardEntry = {
				id: s.id,
				code: undefined,
				title: s.title,
				content: s.content,
				parent_id: s.parent_id,
				context: s.context,
				version: s.version ?? "",
				language: s.language ?? null,
				stack: parseStringArray(s.stack),
				is_global: false,
				owner: s.owner,
				repo: s.repo,
				tags: parseStringArray(s.tags),
				metadata: safeJson(s.metadata),
				created_at: s.updated_at,
				updated_at: s.updated_at,
				hit_count: 0,
				last_used_at: null,
				agent: "backfill",
				model: "backfill"
			};
			const payload = standardJobPayload(standard);
			if (!needsReembed(s.vector_id !== null, s.stored_hash, s.stored_version, payload)) continue;
			inputs.push({ kind: "standard", id: s.id, repo: s.repo ?? "", owner: s.owner, payload });
		}
		enqueued += enqueueInChunks(inputs);
	}

	// Phase 3 — tasks fill the remaining budget (cap - enqueued limit).
	if (enqueued < cap) {
		const tasks = store.db
			.prepare(
				`SELECT t.id, t.repo, t.owner, t.phase, t.title, t.description, t.parent_id, t.metadata, t.updated_at,
					tv.task_id AS vector_id, tv.content_hash AS stored_hash, tv.model_version AS stored_version
             FROM ${TABLE_TASKS} t LEFT JOIN derived.task_vectors tv ON tv.task_id = t.id
              WHERE t.status != '${TASK_STATUS_CANCELED}'
              ORDER BY (tv.task_id IS NULL) DESC,
				(tv.content_hash IS NULL OR tv.model_version IS NULL OR tv.model_version <> ?) DESC,
				t.updated_at DESC
             LIMIT ?`
			)
			.all(currentVersion, cap - enqueued) as Array<{
			id: string;
			repo: string;
			owner: string;
			phase: string;
			title: string;
			description: string | null;
			parent_id: string | null;
			metadata: string | null;
			updated_at: string;
			vector_id: string | null;
			stored_hash: string | null;
			stored_version: number | null;
		}>;

		const inputs: EmbeddingJobInput[] = [];
		for (const t of tasks) {
			const task: Task = {
				id: t.id,
				owner: t.owner,
				repo: t.repo,
				task_code: "",
				phase: t.phase,
				title: t.title,
				description: t.description,
				status: "backlog",
				priority: 3,
				agent: "backfill",
				role: "backfill",
				doc_path: null,
				created_at: t.updated_at,
				updated_at: t.updated_at,
				in_progress_at: null,
				finished_at: null,
				canceled_at: null,
				est_tokens: 0,
				tags: [],
				suggested_skills: [],
				commit_id: null,
				changed_files: [],
				metadata: safeJson(t.metadata),
				parent_id: t.parent_id,
				depends_on: null
			};
			const payload = taskJobPayload(task);
			if (!needsReembed(t.vector_id !== null, t.stored_hash, t.stored_version, payload)) continue;
			inputs.push({ kind: "task", id: t.id, repo: t.repo, owner: t.owner, payload });
		}
		enqueued += enqueueInChunks(inputs);
	}

	return enqueued;
}

function parseStringArray(value: string | null): string[] {
	try {
		const parsed = value ? (JSON.parse(value) as unknown) : [];
		return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

function safeJson(value: string | null): Record<string, unknown> {
	try {
		const parsed = value ? (JSON.parse(value) as unknown) : {};
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}
