/**
 * Embedding-worker job-lifecycle outcome counters (TASK-554 split out of
 * `worker.ts`).
 *
 * The three `processed` / `failed` / `poisoned` counters track jobs across
 * worker cycles (never reset by `getStats`, so they are monotonic per worker
 * instance). TASK-457 discipline is encoded at the CALL SITES in `batch.ts`,
 * not here: a transient SQLITE_BUSY defers the outbox write and returns
 * `false` from {@link recordNoOpComplete}, so lock contention never inflates
 * `failed`.
 *
 * `poisoned` mirrors what `Outbox.fail` persisted (attempts >= threshold →
 * status 'poison'); it is incremented only when the fail write actually ran.
 */

/**
 * Monotonic per-cycle job counters + last-cycle observability. Also carries
 * the last-cycle `lastRunAt`/`lastBatchSize` snapshot the stats endpoint
 * surfaces.
 */
export interface WorkerCounters {
	processed: number;
	failed: number;
	poisoned: number;
	lastBatchSize: number;
	lastRunAt: string | null;
}

export function createWorkerCounters(): WorkerCounters {
	return {
		processed: 0,
		failed: 0,
		poisoned: 0,
		lastBatchSize: 0,
		lastRunAt: null
	};
}

/**
 * Record a no-op complete that actually ran. A deferred (BUSY) complete leaves
 * the row claimed and self-healing and MUST NOT inflate `failed` — the
 * TASK-457-F2 guard, mirroring the per-job BUSY path which skips the counter
 * entirely.
 *
 * @returns `true` when the write ran to completion, `false` when deferred.
 */
export function recordNoOpComplete(counters: WorkerCounters, completed: boolean): boolean {
	if (completed) {
		counters.failed++;
	}
	return completed;
}
