/**
 * better-sqlite3 SQLite lock-contention classification (TASK-457 / TASK-554
 * split out of `worker.ts`).
 *
 * better-sqlite3 surfaces SQLite lock contention as a SqliteError with a
 * string `code`: 'SQLITE_BUSY' (busy_timeout expired while waiting for a
 * writer), 'SQLITE_BUSY_SNAPSHOT' (a read-then-write transaction hit a
 * concurrent commit — thrown immediately, busy_timeout-immune), or
 * 'SQLITE_BUSY_RECOVERY' (extended 261 — another process is mid-recovery,
 * also transient). All three mean another process holds the SQLite write
 * lock, NOT that the current job failed, so they are TRANSIENT: never count
 * as a job attempt, never poison a job, never abort the worker cycle as a
 * fatal error. Mirrors the isSqliteError pattern in entities/task/validation.ts.
 */

export function isBusyError(err: unknown): boolean {
	if (err && typeof err === "object" && "code" in err) {
		const code = (err as { code?: unknown }).code;
		return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code === "SQLITE_BUSY_RECOVERY";
	}
	return false;
}
