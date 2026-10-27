import { SQLiteStore } from "../storage/sqlite";
import { logger } from "../utils/logger";
import {
	applyDecay,
	pruneActionLog,
	pruneObservations,
	pruneRelations,
	type SoulMaintenanceOptions,
	type DecayResult
} from "./soul-maintenance";
import { getVacuumState, incrementalVacuum, shouldVacuum } from "./vacuum";
import { runColdArchiveOffload } from "./cold-archive";
import {
	TABLE_MEMORY_SUMMARY,
	TTL_MS_PER_DAY,
	ACTION_LOG_MAX_ROWS,
	COLD_ARCHIVE_ENABLED,
	VACUUM_INCREMENTAL_MAX_PAGES,
	VACUUM_FREELIST_RATIO_THRESHOLD
} from "../utils/constants";

export interface MaintenanceResult {
	decay: DecayResult;
	expiredArchived: number;
	lowScoreArchived: number;
	skipped: boolean;
	prunedActionLogRows: number;
	prunedObservationsRows: number;
	/** Unreachable relation rows reclaimed this run (audit F1). */
	prunedRelationRows: number;
	/** Entity rows removed by the orphan sweep that follows the relation prune. */
	prunedOrphanEntityRows: number;
	/**
	 * Eligible relation rows still pending. `0` means the sweep drained the
	 * tail; a positive value is an exact remaining count (computed only when
	 * the run did NOT hit the per-run cap); `KG_RELATION_PRUNE_REMAINING_UNKNOWN`
	 * (-1) means the cap was hit and a backlog provably remains (TASK-041 —
	 * the exact count is skipped because the correlated scan would dominate the
	 * bounded delete). Test `!== 0` for "more work remains".
	 */
	prunableRelationsRemaining: number;
	/** Freelist pages reclaimed by the bounded incremental vacuum this run (TASK-033). */
	incrementalVacuumPages: number;
	/** Long-archived rows offloaded to the cold tier this run (TASK-036). */
	coldArchivedOffloaded: number;
	totalArchived: number;
}

const MAINTENANCE_OWNER = "__soul__";
const MAINTENANCE_REPO = "__maintenance__";
const MAINTENANCE_INTERVAL_MS = TTL_MS_PER_DAY; // 24 hours

/**
 * Check whether maintenance has already run within the configured interval.
 * Stores last-run timestamp in the `memory_summary` table using a sentinel key.
 */
function wasMaintenanceRunRecent(db: SQLiteStore): boolean {
	try {
		const row = db.db
			.prepare(`SELECT updated_at FROM ${TABLE_MEMORY_SUMMARY} WHERE owner = ? AND repo = ?`)
			.get(MAINTENANCE_OWNER, MAINTENANCE_REPO) as { updated_at: string } | undefined;

		if (!row?.updated_at) return false;

		const lastRun = new Date(row.updated_at).getTime();
		return Date.now() - lastRun < MAINTENANCE_INTERVAL_MS;
	} catch (err) {
		logger.warn("[MaintenanceJob] Failed to check last maintenance time", { error: String(err) });
		return false;
	}
}

/**
 * Record the current timestamp as the last maintenance run time.
 */
function recordMaintenanceRun(db: SQLiteStore): void {
	const now = new Date().toISOString();
	try {
		db.db
			.prepare(
				`INSERT INTO ${TABLE_MEMORY_SUMMARY} (owner, repo, summary, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner, repo) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`
			)
			.run(MAINTENANCE_OWNER, MAINTENANCE_REPO, now, now);
	} catch (err) {
		logger.warn("[MaintenanceJob] Failed to record maintenance run time", { error: String(err) });
	}
}

/**
 * Run startup maintenance: memory decay, expired archiving, and low-score archiving.
 *
 * On subsequent startups, checks if maintenance ran in the last 24 hours.
 * If it did, the job is skipped to avoid redundant work.
 *
 * @param db - The SQLiteStore instance
 * @param decayOptions - Optional decay tuning parameters
 * @returns Results of all maintenance operations
 */
export async function runStartupMaintenance(
	db: SQLiteStore,
	decayOptions?: SoulMaintenanceOptions
): Promise<MaintenanceResult> {
	// Check if maintenance already ran recently
	if (wasMaintenanceRunRecent(db)) {
		logger.info("[MaintenanceJob] Skipping — maintenance already ran within the last 24 hours");
		return {
			decay: { decayed: 0, archived: 0, immunizedSkipped: 0 },
			expiredArchived: 0,
			lowScoreArchived: 0,
			skipped: true,
			prunedActionLogRows: 0,
			prunedObservationsRows: 0,
			prunedRelationRows: 0,
			prunedOrphanEntityRows: 0,
			prunableRelationsRemaining: 0,
			incrementalVacuumPages: 0,
			coldArchivedOffloaded: 0,
			totalArchived: 0
		};
	}

	logger.info("[MaintenanceJob] Starting startup maintenance sweep");

	// Write-lock invariant (TASK-102): the whole sweep (decay, archiving,
	// pruning, run-record) is a compound, multi-transaction mutation and must
	// serialize with cross-process writers via the exclusive file lock
	// (OPT-PERF-09: routed through withExclusiveWrite). All sweep steps are
	// synchronous SQL work, so lock hold time stays in the ms range; the "ran
	// recently" check above is a pure read and stays outside the lock.
	const result = await db.withExclusiveWrite(async (): Promise<MaintenanceResult> => {
		// 0. Re-ensure the derived database (codebase index + *_vectors) is
		//    attached and its schema + FTS triggers exist (TASK-037). Idempotent
		//    and never-throw, so it also recovers from an interrupted one-time
		//    move without taking down the sweep.
		db.ensureDerivedDb();

		// 1. Apply biological decay
		const decay = applyDecay(db.db, decayOptions);

		// 2. Archive expired memories (force=true since this is explicitly triggered)
		const expiredArchived = db.memoryArchives.archiveExpiredMemories(true);

		// 3. Archive low-score memories (force=true)
		const lowScoreArchived = db.memoryArchives.archiveLowScoreMemories(true);

		// 3.5 Offload long-archived memories to the cold tier (TASK-036).
		//    Copies rows to a separate SQLite DB (no vectors), verifies the
		//    copy, then deletes them from the hot store. Bounded per run and
		//    never throws — a bad cold store must not take down startup.
		const coldOffload = runColdArchiveOffload(db, COLD_ARCHIVE_ENABLED);

		// 4. Prune stale action log entries (30-day retention + row-count cap
		//    keeping the newest ACTION_LOG_MAX_ROWS — OPT-PERF-05)
		const prunedActionLogResult = pruneActionLog(db.db, 30, ACTION_LOG_MAX_ROWS);

		// 5. Prune observations whose parent document is gone (audit F1 — the
		//    previous age-only prune severed live documents from their graph).
		//    Windowed + yielding so the correlated scan never freezes the event
		//    loop past the exclusive lock's heartbeat (TASK-041 follow-up).
		//    Retention window defaults to KG_OBSERVATION_RETENTION_DAYS
		//    (STD-005 rule 4) — not inlined here.
		const prunedObservationsResult = await pruneObservations(db.knowledgeGraph);

		// 6. Prune relations no read path can reach again, then sweep the
		//    entities that only those edges kept alive (audit F1). Bounded per
		//    run and per transaction, so a large backlog converges across
		//    maintenance cycles instead of blocking this startup.
		const prunedRelationsResult = await pruneRelations(db.knowledgeGraph);

		// 7. Reclaim freelist pages freed by the prunes above (TASK-033). Bounded
		//    and cheap, and a no-op unless the DB is already auto_vacuum=INCREMENTAL
		//    — a full VACUUM is deliberately NOT run here (too heavy for startup).
		const incrementalVacuumResult = incrementalVacuum(db, VACUUM_INCREMENTAL_MAX_PAGES);

		// Record the maintenance run
		recordMaintenanceRun(db);

		const totalArchived = (expiredArchived || 0) + (lowScoreArchived || 0) + (decay.archived || 0);

		return {
			decay,
			expiredArchived: expiredArchived || 0,
			lowScoreArchived: lowScoreArchived || 0,
			skipped: false,
			prunedActionLogRows: prunedActionLogResult.deleted,
			prunedObservationsRows: prunedObservationsResult.deleted,
			prunedRelationRows: prunedRelationsResult.deleted,
			prunedOrphanEntityRows: prunedRelationsResult.orphanEntitiesDeleted,
			prunableRelationsRemaining: prunedRelationsResult.remaining,
			incrementalVacuumPages: incrementalVacuumResult.reclaimedPages,
			coldArchivedOffloaded: coldOffload?.deleted ?? 0,
			totalArchived
		};
	});

	logger.info("[MaintenanceJob] Startup maintenance complete", {
		decayed: result.decay.decayed,
		immunizedSkipped: result.decay.immunizedSkipped,
		expiredArchived: result.expiredArchived,
		lowScoreArchived: result.lowScoreArchived,
		decayArchived: result.decay.archived,
		totalArchived: result.totalArchived,
		prunedActionLogRows: result.prunedActionLogRows,
		prunedObservationsRows: result.prunedObservationsRows,
		prunedRelationRows: result.prunedRelationRows,
		prunedOrphanEntityRows: result.prunedOrphanEntityRows,
		prunableRelationsRemaining: result.prunableRelationsRemaining,
		incrementalVacuumPages: result.incrementalVacuumPages,
		coldArchivedOffloaded: result.coldArchivedOffloaded
	});

	// Discoverability without action: a full VACUUM is never automatic (it needs
	// ~2x free disk and a full write lock), so when the freelist is large enough
	// to be worth reclaiming we log a recommendation for an operator to reclaim
	// it. Installed users now have a shipped path: set `VACUUM_ON_STARTUP=true`
	// and restart the MCP server, which runs the guarded conversion
	// (ensureIncrementalAutoVacuum) once at startup (TASK-047); a manual
	// `sqlite3 "<db>" 'VACUUM;'` with the server stopped remains equivalent.
	// Pure read; never triggers a rewrite. TASK-034.
	try {
		const vacuumState = getVacuumState(db);
		if (shouldVacuum(vacuumState, { freelistRatioThreshold: VACUUM_FREELIST_RATIO_THRESHOLD })) {
			logger.info("[MaintenanceJob] VACUUM recommended — large freelist", {
				freelistCount: vacuumState.freelistCount,
				pageCount: vacuumState.pageCount,
				freelistBytes: vacuumState.freelistBytes,
				autoVacuum: vacuumState.autoVacuum,
				hint: `Reclaim freed pages by restarting the server with VACUUM_ON_STARTUP=true, or run a full VACUUM with the server stopped: sqlite3 "${db.getDbPath()}" 'VACUUM;'`
			});
		}
	} catch (err) {
		logger.warn("[MaintenanceJob] Failed to read vacuum state", { error: String(err) });
	}

	return result;
}
