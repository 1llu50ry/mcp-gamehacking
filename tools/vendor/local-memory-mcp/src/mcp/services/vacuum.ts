import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { SQLiteStore } from "../storage/sqlite";
import { logger } from "../utils/logger";
import { VACUUM_DISK_HEADROOM_MULTIPLIER, VACUUM_INCREMENTAL_MAX_PAGES } from "../utils/constants";

/**
 * Space reclamation for the SQLite store (TASK-033 incremental auto_vacuum,
 * TASK-034 safe guarded VACUUM).
 *
 * Background: the pruning passes (pruneActionLog / pruneObservations /
 * pruneRelations) DELETE rows, which frees pages into SQLite's freelist but
 * never shrinks the file while `auto_vacuum = 0` (NONE) — freed pages are
 * reused by later writes, so a database that has passed its peak working set
 * keeps its high-water-mark size (measured: 4.93 GiB file, 25.18% freelist
 * ≈ 1.24 GiB reclaimable). Reclaiming that space needs one of:
 *
 *   1. `PRAGMA incremental_vacuum(N)` — cheap, bounded, requires
 *      `auto_vacuum = INCREMENTAL` (2). Safe to run inside the maintenance
 *      sweep. See `incrementalVacuum`.
 *   2. A full `VACUUM` — rewrites the entire DB into a temp file, needs a full
 *      write lock AND ~2x the DB size in free disk. Too heavy for startup;
 *      exposed for a deliberate/operator-triggered path. See
 *      `ensureIncrementalAutoVacuum`.
 *
 * SQLite semantics (critical — do not get this wrong):
 *   - `PRAGMA auto_vacuum` can only change to a DIFFERENT mode on a DB with no
 *     tables, OR it takes effect only after a full `VACUUM`. So converting an
 *     existing DB is `PRAGMA auto_vacuum = INCREMENTAL;` followed by `VACUUM;`.
 *     Values: 0 = NONE, 1 = FULL, 2 = INCREMENTAL.
 *   - In-memory DBs (`:memory:`, used by tests) have no file to reclaim and
 *     `auto_vacuum` is meaningless — every entry point here skips them.
 */

export interface VacuumState {
	/** Total pages in the database file (`PRAGMA page_count`). */
	pageCount: number;
	/** Page size in bytes (`PRAGMA page_size`). */
	pageSize: number;
	/** Free pages on the freelist (`PRAGMA freelist_count`). */
	freelistCount: number;
	/** auto_vacuum mode: 0 = NONE, 1 = FULL, 2 = INCREMENTAL. */
	autoVacuum: number;
	/** Bytes reclaimable from the freelist (freelistCount * pageSize). */
	freelistBytes: number;
}

export interface EnsureAutoVacuumResult {
	/** True when the conversion (`auto_vacuum=INCREMENTAL` + `VACUUM`) ran. */
	changed: boolean;
	/** True when the conversion was deliberately not attempted. */
	skipped: boolean;
	/** Machine-readable reason when skipped (`in_memory`, `insufficient_disk`, `error`, …). */
	reason?: string;
}

export interface IncrementalVacuumResult {
	/** Freelist pages reclaimed by this call (0 when not in INCREMENTAL mode). */
	reclaimedPages: number;
}

const MEMORY_DB_PATH = ":memory:";

/**
 * Extra free-disk margin required on top of the 2x-DB-size headroom before a
 * full `VACUUM` runs, so a nearly-full disk is not driven to zero (VACUUM also
 * writes a WAL and does an atomic rename). Not env-tunable: it is a safety
 * floor, not a tuning knob.
 */
const VACUUM_DISK_MARGIN_BYTES = 16 * 1024 * 1024;

/** Read a scalar PRAGMA (single-column result) as a number; 0 when absent. */
function readPragmaNumber(db: Database.Database, pragma: string): number {
	const rows = db.pragma(pragma) as Array<Record<string, number | string>>;
	const first = rows[0];
	if (!first) return 0;
	const value = Object.values(first)[0];
	const num = typeof value === "number" ? value : Number(value);
	return Number.isFinite(num) ? num : 0;
}

/**
 * Read the space-reclamation-relevant PRAGMA state of the store.
 *
 * Pure read (no writes, no locking) — safe to call anywhere.
 */
export function getVacuumState(store: SQLiteStore): VacuumState {
	const pageCount = readPragmaNumber(store.db, "page_count");
	const pageSize = readPragmaNumber(store.db, "page_size");
	const freelistCount = readPragmaNumber(store.db, "freelist_count");
	const autoVacuum = readPragmaNumber(store.db, "auto_vacuum");

	return {
		pageCount,
		pageSize,
		freelistCount,
		autoVacuum,
		freelistBytes: freelistCount * pageSize
	};
}

/**
 * Available free bytes on the filesystem containing `dirPath`.
 *
 * Uses `fs.statfsSync` (Node 18.15+). On ANY failure (old Node without statfs,
 * ENOENT, EACCES, a network/overlay FS that does not support statfs) returns
 * `Number.MAX_SAFE_INTEGER` so a missing statfs never blocks a reclamation
 * attempt — degrade OPEN, not closed: the guard exists to avoid a full-disk
 * failure, and a missing probe means we cannot prove the disk is full.
 */
export function getFreeDiskBytes(dirPath: string): number {
	try {
		const stats = fs.statfsSync(dirPath);
		return stats.bavail * stats.bsize;
	} catch (err) {
		logger.debug("[Vacuum] statfs unavailable; assuming ample free disk", {
			dirPath,
			error: String(err)
		});
		return Number.MAX_SAFE_INTEGER;
	}
}

/**
 * One-time conversion of the store to `auto_vacuum = INCREMENTAL` (2).
 *
 * For an EXISTING database the PRAGMA alone is a silent no-op — it only takes
 * effect after a full `VACUUM`, so this runs `PRAGMA auto_vacuum = INCREMENTAL`
 * then `VACUUM`. That is a whole-DB rewrite: it needs a full write lock and
 * ~2x the DB size in free disk, so it is guarded by a free-disk check and is
 * NEVER called implicitly — only when an operator explicitly opts in via the
 * `VACUUM_ON_STARTUP` env gate (`runStartupVacuum`, TASK-047).
 *
 * Never throws: any failure is logged and returned as `{ skipped: true }` so a
 * caller (e.g. a maintenance/operator job) is never taken down by a failed
 * reclamation.
 */
export function ensureIncrementalAutoVacuum(store: SQLiteStore): EnsureAutoVacuumResult {
	if (store.getDbPath() === MEMORY_DB_PATH) {
		return { changed: false, skipped: true, reason: "in_memory" };
	}

	try {
		const state = getVacuumState(store);
		if (state.autoVacuum === 2) {
			return { changed: false, skipped: false, reason: "already_incremental" };
		}

		const dbBytes = state.pageCount * state.pageSize;
		const required = VACUUM_DISK_HEADROOM_MULTIPLIER * dbBytes + VACUUM_DISK_MARGIN_BYTES;
		const free = getFreeDiskBytes(path.dirname(store.getDbPath()));

		if (free < required) {
			logger.warn("[Vacuum] Skipping auto_vacuum conversion — insufficient free disk", {
				freeBytes: free,
				requiredBytes: required,
				dbBytes
			});
			return { changed: false, skipped: true, reason: "insufficient_disk" };
		}

		store.db.pragma("auto_vacuum = INCREMENTAL");
		store.db.exec("VACUUM");

		logger.info("[Vacuum] Converted database to auto_vacuum = INCREMENTAL", {
			dbBytes,
			freeBytes: free
		});

		return { changed: true, skipped: false };
	} catch (err) {
		logger.warn("[Vacuum] auto_vacuum conversion failed", { error: String(err) });
		return { changed: false, skipped: true, reason: "error" };
	}
}

/**
 * Run the startup space-reclamation pass when the operator opted in.
 *
 * Thin gate over `ensureIncrementalAutoVacuum` so the `VACUUM_ON_STARTUP`
 * decision is a single testable seam: the flag is passed in rather than read
 * from `process.env` here, keeping this function deterministic. Returns `null`
 * when disabled so a caller can distinguish "did not run" from a skip result.
 * Never throws (delegates to the never-throw `ensureIncrementalAutoVacuum`).
 *
 * @param store - The SQLiteStore whose space should be reclaimed.
 * @param enabled - The resolved `VACUUM_ON_STARTUP` flag.
 * @returns The conversion result, or `null` when the gate is disabled.
 */
export function runStartupVacuum(store: SQLiteStore, enabled: boolean): EnsureAutoVacuumResult | null {
	if (!enabled) return null;
	return ensureIncrementalAutoVacuum(store);
}

/**
 * Reclaim up to `maxPages` freelist pages via `PRAGMA incremental_vacuum(N)`.
 *
 * Cheap and bounded — each page is moved to the end of the file and the file is
 * truncated — so it is safe to run inside the periodic maintenance sweep. It is
 * a no-op (returns 0) unless the store is in `auto_vacuum = INCREMENTAL` mode;
 * in particular it does nothing on the `auto_vacuum = 0` databases that
 * motivated this feature until `ensureIncrementalAutoVacuum` has converted them.
 *
 * `maxPages` is clamped to `VACUUM_INCREMENTAL_MAX_PAGES` and floored at 0 so a
 * caller cannot trigger an unbounded rewrite.
 */
export function incrementalVacuum(store: SQLiteStore, maxPages: number): IncrementalVacuumResult {
	const before = getVacuumState(store);
	if (before.autoVacuum !== 2) return { reclaimedPages: 0 };

	const bounded = Math.max(0, Math.min(Math.floor(maxPages), VACUUM_INCREMENTAL_MAX_PAGES));
	if (bounded === 0) return { reclaimedPages: 0 };

	store.db.pragma(`incremental_vacuum(${bounded})`);

	const after = getVacuumState(store);
	const reclaimedPages = Math.max(0, before.freelistCount - after.freelistCount);

	if (reclaimedPages > 0) {
		logger.info("[Vacuum] Incremental vacuum reclaimed freelist pages", {
			requestedPages: bounded,
			reclaimedPages
		});
	}

	return { reclaimedPages };
}

/**
 * Pure predicate: is the freelist large enough (relative to the whole file) to
 * justify a full `VACUUM`?
 *
 * Returns true when `freelistCount / pageCount >= freelistRatioThreshold`.
 * Pure and side-effect free — unit-testable without a database.
 */
export function shouldVacuum(
	state: Pick<VacuumState, "freelistCount" | "pageCount">,
	options: { freelistRatioThreshold: number }
): boolean {
	if (state.pageCount <= 0) return false;
	return state.freelistCount / state.pageCount >= options.freelistRatioThreshold;
}
