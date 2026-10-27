/**
 * Write mutual exclusion for the SQLite store.
 *
 * OPT-PERF-09: SQLite already provides single-writer mutual exclusion via
 * BEGIN IMMEDIATE transactions (base.ts) + busy_timeout (sqlite.ts). A
 * full proper-lockfile acquire/release (fs ops) per write call — serialized
 * through an intra-process promise chain — was redundant overhead on every
 * write path.
 *
 * Mutual exclusion is now split in two:
 *
 *   - `withLock()`  → FAST path. Runs the body inline with NO proper-lockfile
 *     and NO promise chain. Every individual mutation is an atomic BEGIN
 *     IMMEDIATE transaction; better-sqlite3 is synchronous, so a transaction
 *     can never span an await and concurrent calls cannot interleave
 *     mid-transaction. SQLite's own single-writer protocol + busy_timeout
 *     excludes concurrent writers (same process or cross-process).
 *
 *   - `withExclusiveLock()` → PROPER-LOCKFILE path. Kept for genuinely
 *     cross-process COMPOUND mutations: multi-transaction sequences (a body
 *     of several `db.transaction(...).immediate()` calls) that must not
 *     interleave with another process's sequence. Examples: the maintenance
 *     sweep, codebase indexing writer, and task→memory archival.
 */
import lockfile from "proper-lockfile";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";

const LOCK_STALE_MS = 30_000; // consider lock stale after 30s (handles crashed processes)
const LOCK_RETRY_DELAY_MS = 200;
const LOCK_RETRY_COUNT = 250; // 250 * 200ms = 50s max wait
/**
 * Extra whole-acquire retries after a recoverable failure (FIX-025). A single
 * retry absorbs the transient "stale threshold" / vanished-lockfile races; a
 * second consecutive failure is surfaced as an actionable error instead of an
 * uncaught crash.
 */
const LOCK_ACQUIRE_RETRIES = 1;

/**
 * Whether a lock error is a RECOVERABLE acquisition/refresh failure that a
 * release-and-retry can clear, as opposed to a genuine programming error.
 *
 * Covers the exact signatures seen in `daemon.log` (FIX-025):
 *   - `Unable to update lock within the stale threshold` (heartbeat lost the
 *     race after an event-loop stall → `ECOMPROMISED`),
 *   - `ENOENT … memory.db.lock` (the lockfile vanished under `utimes`),
 *   - `ECOMPROMISED` / `ELOCKED` codes proper-lockfile assigns directly.
 */
export function isRecoverableLockError(error: unknown): boolean {
	if (error === null || typeof error !== "object") return false;
	const err = error as { code?: unknown; message?: unknown };
	const code = typeof err.code === "string" ? err.code : "";
	const message = typeof err.message === "string" ? err.message : "";
	// proper-lockfile's own codes are unambiguous.
	if (code === "ECOMPROMISED" || code === "ELOCKED") return true;
	// The heartbeat lost the race after an event-loop stall.
	if (/stale threshold/i.test(message)) return true;
	// A vanished lockfile surfaces as ENOENT/utime on a `*.lock` path — require
	// a lock-related token so an unrelated ENOENT is NOT swallowed.
	if ((code === "ENOENT" || /ENOENT/i.test(message)) && /\.lock|lockfile|utime/i.test(message)) return true;
	return false;
}

export class WriteLock {
	private lockTarget: string;
	private locked = false;
	/**
	 * Set when proper-lockfile reports the held lock as COMPROMISED — another
	 * process treated it as stale (its mtime aged past `stale`) and took it
	 * over while we still believed we held it. proper-lockfile's default
	 * `onCompromised` THROWS, which becomes an uncaught exception that kills
	 * the process (FEAT-DAEMON-001 / "Unable to update lock within the stale
	 * threshold"). We instead record the loss so `release()` skips the now
	 * foreign lock and the exclusive section completes normally.
	 */
	private compromised = false;
	/**
	 * Intra-process acquisition queue for the EXCLUSIVE path: resolves when
	 * the previous withExclusiveLock section (acquire → fn → release) fully
	 * completes. Serializes concurrent non-reentrant acquisitions so only one
	 * holder proceeds (TASK-064). proper-lockfile is not reentrant and two
	 * racing acquisitions would otherwise burn the full 50s retry window and
	 * throw ELOCKED.
	 */
	private tail: Promise<unknown> = Promise.resolve();

	constructor(dbPath: string) {
		// Lock file is placed next to the DB
		this.lockTarget = dbPath;
		// proper-lockfile requires the target file to exist
		if (!fs.existsSync(dbPath)) {
			fs.mkdirSync(path.dirname(dbPath), { recursive: true });
			fs.writeFileSync(dbPath, "");
		}
	}

	/**
	 * Run a write synchronously WITHOUT acquiring a proper-lockfile.
	 *
	 * This is the default write path (SQLiteStore.withWrite / tool router /
	 * dashboard services). Mutual exclusion is provided by SQLite's BEGIN
	 * IMMEDIATE + busy_timeout (base.ts / sqlite.ts) — every mutation is an
	 * atomic synchronous transaction, so there is nothing for a file lock to
	 * add on a single-transaction write.
	 *
	 * Reentrant by construction: there is no lock state to re-enter; nested
	 * withWrite calls just run their bodies inline.
	 */
	async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
		return await fn();
	}

	/**
	 * Run a COMPOUND write sequence under the proper-lockfile.
	 *
	 * Reserves this for genuinely cross-process compound mutations — a body
	 * that performs MULTIPLE BEGIN IMMEDIATE transactions which must not
	 * interleave with another process's same-class sequence (maintenance
	 * sweep, indexing writer batches, task→memory archival). Each such
	 * section pays one acquire/release pair.
	 *
	 * Reentrant: if this process already holds the exclusive lock, the inner
	 * call runs directly — the outer withExclusiveLock keeps it held until it
	 * resolves (proper-lockfile is NOT reentrant).
	 *
	 * Concurrent-safe (TASK-064 / MEM-475): racing acquisitions are serialized
	 * through the `tail` promise chain so exactly one proceeds.
	 */
	async withExclusiveLock<T>(fn: () => Promise<T> | T): Promise<T> {
		if (this.locked) {
			// We already hold the exclusive lock — run inline.
			return await fn();
		}

		const run = async (): Promise<T> => {
			await this.acquire();
			try {
				return await fn();
			} finally {
				await this.release();
			}
		};

		const result = this.tail.then(run);
		// Keep the chain alive on errors so a failed section never wedges
		// subsequent callers; the caller still observes the rejection via
		// `result`.
		this.tail = result.then(
			() => undefined,
			() => undefined
		);
		return result;
	}

	/**
	 * Acquire the exclusive proper-lockfile. Waits up to 50s for other
	 * processes to release.
	 *
	 * Robustness (FIX-025): acquisition/refresh failures that proper-lockfile
	 * reports (`Unable to update lock within the stale threshold`,
	 * `ECOMPROMISED`, `ENOENT` on the vanished lockfile) are CAUGHT, not
	 * thrown into the event loop. A recoverable failure is retried ONCE after
	 * a clean release; a second failure raises an actionable error naming the
	 * lock path and the recovery, so the caller fails a single request/task
	 * instead of the process dying with an uncaught exception.
	 */
	async acquire(): Promise<void> {
		let lastError: unknown;
		for (let attempt = 0; attempt <= LOCK_ACQUIRE_RETRIES; attempt++) {
			try {
				await lockfile.lock(this.lockTarget, {
					stale: LOCK_STALE_MS,
					retries: {
						retries: LOCK_RETRY_COUNT,
						minTimeout: LOCK_RETRY_DELAY_MS,
						maxTimeout: LOCK_RETRY_DELAY_MS
					},
					realpath: false,
					// A held lock can be compromised when the heartbeat cannot refresh it
					// in time — e.g. a long synchronous better-sqlite3 statement inside
					// `withExclusiveLock` blocks the event loop past the 15s heartbeat /
					// 30s stale window, another process legitimately steals the stale
					// lock, and our next `stat` sees a foreign mtime. proper-lockfile's
					// DEFAULT onCompromised THROWS ("Unable to update lock within the
					// stale threshold"), which escapes as an uncaught exception and kills
					// the process. We instead record the loss: the section completes and
					// `release()` skips unlocking a lock we no longer own.
					onCompromised: (error: Error) => {
						this.compromised = true;
						this.locked = false;
						logger.warn("[WriteLock] Exclusive lock compromised — another process took over", {
							lock: this.lockTarget,
							error: error.message
						});
					}
				});
				this.locked = true;
				this.compromised = false;
				return;
			} catch (error) {
				lastError = error;
				// Reset our belief before retrying so the next acquire starts clean.
				this.locked = false;
				this.compromised = false;
				if (attempt < LOCK_ACQUIRE_RETRIES && isRecoverableLockError(error)) {
					logger.warn("[WriteLock] exclusive lock acquire failed — retrying once", {
						lock: this.lockTarget,
						attempt: attempt + 1,
						error: error instanceof Error ? error.message : String(error)
					});
					// Best-effort cleanup of any half-acquired lockfile so the
					// retry does not immediately re-read the same stale state.
					try {
						await lockfile.unlock(this.lockTarget, { realpath: false });
					} catch {
						/* best effort */
					}
					continue;
				}
				break;
			}
		}

		throw new Error(
			`Failed to acquire exclusive write lock at ${this.lockTarget} after ${
				LOCK_ACQUIRE_RETRIES + 1
			} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}. ` +
				"Another process may hold the lock, or a stale lockfile could not be refreshed. " +
				"Retry the operation; if it persists, stop the other local-memory-mcp process or delete the stale " +
				`lockfile (${this.lockTarget}.lock).`
		);
	}

	/**
	 * Release the exclusive proper-lockfile.
	 *
	 * If the lock was compromised while held (see {@link acquire}) another
	 * process now owns it, so we must NOT unlock it — that would delete a lock
	 * we do not hold. Skipping is the correct, race-safe outcome.
	 */
	async release(): Promise<void> {
		if (!this.locked) return;
		const compromised = this.compromised;
		this.locked = false;
		this.compromised = false;
		if (compromised) return;
		try {
			await lockfile.unlock(this.lockTarget, { realpath: false });
		} catch {
			// Ignore unlock errors (lock may have already expired)
		}
	}

	/**
	 * Check if a lock file exists (another process may be writing).
	 */
	isLocked(): boolean {
		return lockfile.checkSync(this.lockTarget, { realpath: false });
	}
}
