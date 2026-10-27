/**
 * SQLite-backed outbox for embedding/KG jobs (TASK-013 / MEM-368).
 *
 * This file keeps only the worker-facing `Outbox` lifecycle (claim/complete/
 * fail/reconcile/purge/count). The synchronous enqueue helpers, snapshot
 * payload builders, and the startup backfill live in `./enqueue` (TASK-074) so
 * this file stays under the 500-line rule — `Outbox` delegates `enqueue` and
 * `backfillMissingVectors` there.
 *
 * All methods are synchronous (better-sqlite3) and cheap. Concurrency model
 * (two processes — MCP server + dashboard — share the DB):
 * - Claim is one atomic UPDATE ... WHERE id IN (SELECT ... LIMIT K): SQLite's
 *   single-writer serialization guarantees no two workers claim the same row.
 * - A claimed row carries a unique batch token (`locked_by`); the worker
 *   selects its own batch by that token.
 * - Complete/fail are conditional on `status = 'claimed'` AND the batch token
 *   (`locked_by`): if the row was re-enqueued (LWW upsert reset it to
 *   `pending`) or re-claimed by another worker after lease expiry (different
 *   token), the transition no-ops and the newer snapshot / owning worker
 *   survives. fail() increments attempts in a single atomic UPDATE, so a
 *   stale-lease worker can never double-increment or prematurely poison a
 *   job it no longer owns.
 * - Lease expiry + startup reconcile + backfill cover crashes; purge sweeps
 *   finished rows.
 *
 * Write-lock policy (TASK-064 / MEM-475): worker writes stay OUTSIDE the
 * proper-lockfile write lock by design. claim/complete/fail are single
 * conditional UPDATE statements (SNAPSHOT-immune) and wait at most
 * busy_timeout=5000 for a transient SQLite writer; the read-then-write
 * backfill runs inside a BEGIN IMMEDIATE transaction (enqueue.ts) so it grabs
 * the SQLite write lock upfront instead of failing with SQLITE_BUSY_SNAPSHOT.
 */
import type Database from "better-sqlite3";
import { SQLiteStore } from "../storage/sqlite";
import {
	enqueueEmbeddingJob,
	countByStatus as countQueueByStatus,
	backfillMissingVectors as runBackfillMissingVectors
} from "./enqueue";
import { EmbeddingJobInput, QueueCounts, QueueJobListOptions, QueueJobRow } from "./types";

// Re-export the enqueue helpers for backward compatibility (index.ts and tools
// import them from the embedding-queue barrel; tests import them from outbox).
export { enqueueEmbeddingJob, enqueueMemory, enqueueStandard, enqueueTask, enqueueCodebaseSymbols } from "./enqueue";

// ---------------------------------------------------------------------------
// Outbox — claim/complete/fail/reconcile/purge/count (worker-facing)
// ---------------------------------------------------------------------------

export class Outbox {
	private batchCounter = 0;

	constructor(private readonly store: SQLiteStore) {}

	get db(): Database.Database {
		return this.store.db;
	}

	/**
	 * Synchronous LWW enqueue (single upsert). Returns `false` when the job was
	 * deduped (OPT-FLOW-03): an existing `queue_jobs` row for the same entity
	 * already carries an identical embed/KG `content_hash`, so the row is left
	 * untouched — no redundant ONNX inference or KG extraction is queued.
	 */
	enqueue(input: EmbeddingJobInput): boolean {
		return enqueueEmbeddingJob(this.store, input);
	}

	/**
	 * Atomically claim up to `max` eligible jobs (pending, or claimed with an
	 * expired lease) and return them. The claim is a single UPDATE statement —
	 * SQLite serializes writers, so concurrent workers (MCP server + dashboard)
	 * never claim the same row. Rows are tagged with a unique batch token and
	 * read back by that token.
	 */
	claim(max: number, leaseMs: number): QueueJobRow[] {
		if (max <= 0) return [];
		const now = new Date().toISOString();
		const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
		const batchId = `${process.pid}-${this.batchCounter++}-${Date.now().toString(36)}`;

		const result = this.store.db
			.prepare(
				`UPDATE queue_jobs
       SET status = 'claimed', lease_until = ?, locked_by = ?, updated_at = ?
       WHERE id IN (
         SELECT id FROM queue_jobs
         WHERE (status = 'pending' AND (backoff_until IS NULL OR backoff_until <= ?))
            OR (status = 'claimed' AND lease_until IS NOT NULL AND lease_until < ?)
         ORDER BY created_at ASC
         LIMIT ?
       )`
			)
			.run(leaseUntil, batchId, now, now, now, max);

		if (result.changes === 0) return [];
		return this.store.db
			.prepare("SELECT * FROM queue_jobs WHERE locked_by = ? ORDER BY created_at ASC")
			.all(batchId) as QueueJobRow[];
	}

	/**
	 * Conditional completion: only succeeds while the row is still `claimed`
	 * by THIS worker's batch token (`locked_by`). If a newer enqueue reset the
	 * row to `pending` (LWW), or the lease expired and another worker
	 * re-claimed it (different token), this no-ops and the newer snapshot is
	 * processed next.
	 */
	complete(id: string, lockedBy: string): boolean {
		const result = this.store.db
			.prepare(
				"UPDATE queue_jobs SET status = 'done', updated_at = ?, last_error = NULL WHERE id = ? AND status = 'claimed' AND locked_by = ?"
			)
			.run(new Date().toISOString(), id, lockedBy);
		return result.changes > 0;
	}

	/**
	 * Release a claim back to `pending` WITHOUT touching attempts/backoff
	 * (TASK-457). Used when transient SQLite lock contention (SQLITE_BUSY /
	 * SQLITE_BUSY_SNAPSHOT) interrupts a job mid-processing: the job must be
	 * retried with its attempt/backoff state intact — a lock contention is not
	 * a job failure and must never move the job toward poison. Same conditional
	 * guard as complete()/fail() (`status = 'claimed' AND locked_by = ?`): if
	 * the row was re-enqueued (LWW) or re-claimed after lease expiry, this
	 * no-ops. Single conditional UPDATE — SNAPSHOT-immune like complete/fail.
	 */
	release(id: string, lockedBy: string): boolean {
		const result = this.store.db
			.prepare(
				"UPDATE queue_jobs SET status = 'pending', lease_until = NULL, locked_by = NULL, updated_at = ? WHERE id = ? AND status = 'claimed' AND locked_by = ?"
			)
			.run(new Date().toISOString(), id, lockedBy);
		return result.changes > 0;
	}

	/**
	 * Conditional failure: increments attempts; poisons at `poisonThreshold`,
	 * otherwise re-queues with exponential backoff (base * 2^(attempt-1),
	 * capped at `backoffMaxMs`). No-ops if the row was re-enqueued or
	 * re-claimed meanwhile (guarded by `status = 'claimed' AND locked_by = ?`),
	 * so an expired-lease worker can neither poison nor double-increment a job
	 * that another worker re-claimed.
	 *
	 * The attempts increment is a single atomic UPDATE (`attempts = attempts + 1`
	 * — SQLite serializes writers, so no two workers can increment the same
	 * row). The guarded read before it exists ONLY to compute the exponential
	 * backoff window: SQLite's SET clause sees pre-update values and has no
	 * pow(), so the offset cannot be computed inside the UPDATE itself. The
	 * poison/backoff branch is applied inside that same conditional statement
	 * (status + backoff_until bound per branch); if the row is no longer ours
	 * by the time the UPDATE runs, it matches zero rows and nothing changes.
	 */
	fail(
		id: string,
		lockedBy: string,
		error: string,
		poisonThreshold: number,
		backoffBaseMs: number,
		backoffMaxMs: number
	): void {
		const now = new Date().toISOString();
		const message = String(error).slice(0, 500);

		const row = this.store.db
			.prepare("SELECT attempts FROM queue_jobs WHERE id = ? AND status = 'claimed' AND locked_by = ?")
			.get(id, lockedBy) as { attempts: number } | undefined;
		if (!row) return; // not our claim — no-op

		const nextAttempts = (row.attempts ?? 0) + 1;
		const poison = nextAttempts >= poisonThreshold;
		const backoffUntil = poison
			? null
			: new Date(Date.now() + Math.min(backoffBaseMs * 2 ** (nextAttempts - 1), backoffMaxMs)).toISOString();

		this.store.db
			.prepare(
				`UPDATE queue_jobs
       SET attempts = attempts + 1,
           status = ?,
           last_error = ?,
           lease_until = NULL,
           locked_by = NULL,
           backoff_until = ?,
           updated_at = ?
       WHERE id = ? AND status = 'claimed' AND locked_by = ?`
			)
			.run(poison ? "poison" : "pending", message, backoffUntil, now, id, lockedBy);
	}

	/** Reset expired-lease claims back to pending (crash recovery). */
	reconcileExpiredLeases(): number {
		const result = this.store.db
			.prepare(
				`UPDATE queue_jobs
       SET status = 'pending', lease_until = NULL, locked_by = NULL, updated_at = ?
       WHERE status = 'claimed' AND lease_until IS NOT NULL AND lease_until < ?`
			)
			.run(new Date().toISOString(), new Date().toISOString());
		return result.changes;
	}

	countByStatus(): QueueCounts {
		return countQueueByStatus(this.store);
	}

	/**
	 * Paginated queue view (dashboard queue admin, TASK-296). Pure read — never
	 * touches the proper-lockfile write lock (TASK-102 contract).
	 *
	 * `statuses` is optional: when omitted the full table is returned, newest
	 * first (`created_at DESC`) — the caller (dashboard service) decides the
	 * default filter (`pending` + `poison` for the failed-job view).
	 *
	 * `options.repo` (TASK-360) restricts the window to a single `entity_repo`
	 * (parameterized `entity_repo = ?`); absent → global, back-compat.
	 */
	listJobs(options: QueueJobListOptions): { items: QueueJobRow[]; total: number } {
		const statuses = options.statuses ?? [];
		const clauses: string[] = [];
		const params: string[] = [];
		if (statuses.length > 0) {
			clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
			params.push(...statuses);
		}
		if (options.repo) {
			clauses.push("entity_repo = ?");
			params.push(options.repo);
		}
		const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

		const total = (
			this.store.db.prepare(`SELECT COUNT(*) AS c FROM queue_jobs ${where}`).get(...params) as { c: number }
		).c;
		const items = this.store.db
			.prepare(`SELECT * FROM queue_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
			.all(...params, options.limit, options.offset) as QueueJobRow[];
		return { items, total };
	}

	/**
	 * Admin retry (TASK-296): flips a terminal `poison` (or `done`) row back to
	 * `pending`. Mirrors the `ENQUEUE_SQL` LWW reset semantics exactly —
	 * `attempts = 0`, `last_error`, `backoff_until`, `lease_until`, `locked_by`
	 * all cleared, `updated_at` bumped — WITHOUT touching the stored
	 * `payload`/`content_hash`, so the worker re-processes the SAME snapshot it
	 * failed on.
	 *
	 * Worker-safe by construction: `Outbox.claim()` only ever claims `pending`
	 * (or lease-expired `claimed`) rows, so a row flipped to `pending` here
	 * becomes re-claimable and the worker picks it up on its next poll. The
	 * status guard (`IN ('poison','done')`) is a single atomic UPDATE — a
	 * concurrent worker cannot race it (poison/done rows are never claimed).
	 *
	 * `repo` (TASK-360): optional multi-repo scope — when present the row is
	 * only retried if it ALSO belongs to `entity_repo = repo` (parameterized).
	 * This is defense-in-depth on top of the service-layer repo check: even if
	 * the caller's read raced, the guarded UPDATE can never flip a row from
	 * another repo.
	 *
	 * @returns `true` when the row was flipped, `false` when no poison/done row
	 * with that id (and repo, when supplied) exists.
	 */
	retryJob(id: string, repo?: string): boolean {
		const params: string[] = [new Date().toISOString(), id];
		let repoClause = "";
		if (repo) {
			repoClause = " AND entity_repo = ?";
			params.push(repo);
		}
		const result = this.store.db
			.prepare(
				`UPDATE queue_jobs
       SET status = 'pending',
           attempts = 0,
           lease_until = NULL,
           locked_by = NULL,
           backoff_until = NULL,
           last_error = NULL,
           updated_at = ?
       WHERE id = ? AND status IN ('poison', 'done')${repoClause}`
			)
			.run(...params);
		return result.changes > 0;
	}

	/**
	 * Bulk retry (TASK-296, optional): flips EVERY `poison` row back to
	 * `pending` with the same reset semantics as {@link retryJob}. Rows in
	 * pending/claimed/done are untouched.
	 *
	 * `repo` (TASK-360): optional multi-repo scope — when present ONLY poison
	 * rows with `entity_repo = repo` are flipped (parameterized), so a
	 * repo-scoped retry-all can never mass-reset another repo's poison rows.
	 */
	retryAllPoison(repo?: string): number {
		const params: string[] = [new Date().toISOString()];
		let repoClause = "";
		if (repo) {
			repoClause = " AND entity_repo = ?";
			params.push(repo);
		}
		const result = this.store.db
			.prepare(
				`UPDATE queue_jobs
       SET status = 'pending',
           attempts = 0,
           lease_until = NULL,
           locked_by = NULL,
           backoff_until = NULL,
           last_error = NULL,
           updated_at = ?
       WHERE status = 'poison'${repoClause}`
			)
			.run(...params);
		return result.changes;
	}

	/**
	 * Admin clear (TASK-296): deletes a specific `poison`/`done` row — the
	 * row-level counterpart of the time-based `purge` sweep. Guarded to the
	 * terminal states so a live (`pending`/`claimed`) job can never be
	 * removed out from under a worker.
	 *
	 * `repo` (TASK-360): optional multi-repo scope — the row is only deleted
	 * when it ALSO belongs to `entity_repo = repo` (parameterized). A
	 * repo-scoped clear can never delete another repo's row.
	 *
	 * @returns `true` when the row was deleted, `false` when no poison/done
	 * row with that id (and repo, when supplied) exists.
	 */
	deleteJob(id: string, repo?: string): boolean {
		const params: string[] = [id];
		let repoClause = "";
		if (repo) {
			repoClause = " AND entity_repo = ?";
			params.push(repo);
		}
		const result = this.store.db
			.prepare(`DELETE FROM queue_jobs WHERE id = ? AND status IN ('poison', 'done')${repoClause}`)
			.run(...params);
		return result.changes > 0;
	}

	/** Sweep finished rows: done after `doneTtlMs`, poison after `poisonTtlMs`. */
	purge(doneTtlMs: number, poisonTtlMs: number): { purgedDone: number; purgedPoison: number } {
		const doneBefore = new Date(Date.now() - doneTtlMs).toISOString();
		const poisonBefore = new Date(Date.now() - poisonTtlMs).toISOString();
		const purgedDone = this.store.db
			.prepare("DELETE FROM queue_jobs WHERE status = 'done' AND updated_at < ?")
			.run(doneBefore).changes;
		const purgedPoison = this.store.db
			.prepare("DELETE FROM queue_jobs WHERE status = 'poison' AND updated_at < ?")
			.run(poisonBefore).changes;
		return { purgedDone, purgedPoison };
	}

	/**
	 * Startup backfill — see `enqueue.backfillMissingVectors`. Delegates here
	 * so `Outbox` keeps a single entry point for the worker + observability.
	 */
	backfillMissingVectors(cap: number, minPendingClaimed?: number): number {
		return runBackfillMissingVectors(this.store, cap, minPendingClaimed);
	}
}

/** Convenience: build an Outbox for a store (used by observability endpoints). */
export function outboxFor(store: SQLiteStore): Outbox {
	return new Outbox(store);
}
