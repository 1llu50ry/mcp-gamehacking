import { logger } from "../utils/logger";
import { KnowledgeGraphEntity } from "../entities/knowledge-graph";
import {
	TABLE_MEMORIES,
	TABLE_ACTION_LOG,
	TTL_MS_PER_DAY,
	ACTION_LOG_MAX_ROWS,
	KG_OBSERVATION_RETENTION_DAYS,
	KG_RELATION_RETENTION_DAYS,
	KG_RELATION_PRUNE_MAX_ROWS,
	KG_RELATION_PRUNE_CHUNK,
	KG_RELATION_PRUNE_REMAINING_UNKNOWN
} from "../utils/constants";
import { MEMORY_STATUS_ACTIVE, MEMORY_STATUS_ARCHIVED } from "../types";

export interface PruneActionLogResult {
	/** Rows deleted by the age-based retention (older than retentionDays). */
	deletedByAge: number;
	/** Rows deleted by the row-count cap (oldest rows beyond maxRows). */
	deletedByCap: number;
	/** Total rows deleted (deletedByAge + deletedByCap). */
	deleted: number;
}

export interface PruneObservationsResult {
	/** Number of observations rows deleted */
	deleted: number;
}

export interface PruneRelationsResult {
	/** Relation rows deleted this run (bounded by maxRows). */
	deleted: number;
	/** Entity rows removed by the follow-up orphan sweep. */
	orphanEntitiesDeleted: number;
	/**
	 * Eligible rows still remaining after this run. `0` means the sweep drained
	 * every eligible row (nothing left to prune). A POSITIVE value is an exact
	 * count, only computed when the run did NOT hit the cap (i.e. the tail was
	 * reached), so it is cheap. `KG_RELATION_PRUNE_REMAINING_UNKNOWN` (-1) is
	 * reported when the run hit the cap: a backlog provably remains, so the
	 * expensive correlated count is skipped (TASK-041). Test `!== 0` for
	 * "is there more work?".
	 */
	remaining: number;
}

export interface SoulMaintenanceOptions {
	/** Immunity tags — memories with these tags won't decay */
	immunizedTags?: string[];
	/** Days of inactivity before decay starts (default: 7) */
	decayAfterDays?: number;
	/** How much importance drops per decay cycle (default: 0.5) */
	decayRate?: number;
	/** Minimum importance before archiving (default: 1) */
	archiveThreshold?: number;
}

export interface DecayResult {
	/** Number of memories that had importance reduced */
	decayed: number;
	/** Number of memories archived due to dropping below archiveThreshold */
	archived: number;
	/** Number of memories skipped due to immunized tags */
	immunizedSkipped: number;
}

/**
 * Apply biological-style memory decay to active memories.
 *
 * 1. Queries active memories unused for >decayAfterDays
 * 2. Skips memories with immunized tags
 * 3. Decreases importance by decayRate (floored, min 1)
 * 4. Archives memories with importance below archiveThreshold
 *
 * Uses parameterised SQL throughout for safety.
 *
 * @param db - The SQLite store's raw database handle (db.db from SQLiteStore)
 * @param options - Tuning parameters for the decay process
 * @returns Counts of decayed, archived, and immunized-skipped memories
 */
export function applyDecay(
	db: { prepare: (sql: string) => import("better-sqlite3").Statement },
	options?: SoulMaintenanceOptions
): DecayResult {
	const { immunizedTags = [], decayAfterDays = 7, decayRate = 0.5, archiveThreshold = 1 } = options ?? {};

	const now = new Date().toISOString();
	const cutoff = new Date(Date.now() - decayAfterDays * TTL_MS_PER_DAY).toISOString();

	// Step 1: Find active memories that haven't been used recently
	const rows = db
		.prepare(
			`SELECT id, importance, tags FROM ${TABLE_MEMORIES}
       WHERE status = '${MEMORY_STATUS_ACTIVE}'
         AND (last_used_at IS NULL OR last_used_at < ?)`
		)
		.all(cutoff) as Array<{ id: string; importance: number; tags: string | null }>;

	if (rows.length === 0) {
		logger.debug("[SoulMaintenance] No memories eligible for decay");
		return { decayed: 0, archived: 0, immunizedSkipped: 0 };
	}

	let decayed = 0;
	let archivedCount = 0;
	let immunizedSkipped = 0;

	const toDecay: Array<{ id: string; newImportance: number }> = [];
	const toArchive: string[] = [];

	for (const row of rows) {
		let tags: string[] = [];
		if (row.tags) {
			try {
				tags = JSON.parse(row.tags);
			} catch {
				tags = [];
			}
		}

		// Step 2: Skip immunized memories
		if (immunizedTags.length > 0 && tags.some((t) => immunizedTags.includes(t))) {
			immunizedSkipped++;
			continue;
		}

		// Step 3: Decrease importance by decayRate (floored, min 1)
		const newImportance = Math.max(1, Math.floor(row.importance - decayRate));
		toDecay.push({ id: row.id, newImportance });

		// Step 4: Flag for archiving if below threshold
		if (newImportance < archiveThreshold) {
			toArchive.push(row.id);
		}
	}

	// Batch-decay by importance
	if (toDecay.length > 0) {
		const updateStmt = db.prepare(`UPDATE ${TABLE_MEMORIES} SET importance = ?, updated_at = ? WHERE id = ?`);
		for (const item of toDecay) {
			updateStmt.run(item.newImportance, now, item.id);
		}
		decayed = toDecay.length;
	}

	// Archive memories below threshold
	if (toArchive.length > 0) {
		const placeholders = toArchive.map(() => "?").join(",");
		const archiveResult = db
			.prepare(
				`UPDATE ${TABLE_MEMORIES} SET status = '${MEMORY_STATUS_ARCHIVED}', updated_at = ? WHERE id IN (${placeholders})`
			)
			.run(now, ...toArchive);
		archivedCount = archiveResult.changes;
	}

	if (decayed > 0 || archivedCount > 0 || immunizedSkipped > 0) {
		logger.info("[SoulMaintenance] Decay cycle complete", {
			decayed,
			archived: archivedCount,
			immunizedSkipped
		});
	}

	return { decayed, archived: archivedCount, immunizedSkipped };
}

/**
 * Prune action_log rows beyond the retention policy (OPT-PERF-05).
 *
 * Action logs accumulate rapidly (one row per mutating MCP call) and serve no
 * purpose beyond recent diagnostics. Stale entries waste disk space and slow
 * down queries. Two bounded-retention passes run:
 *
 *   1. Age-based: delete entries older than `retentionDays` (default 30).
 *   2. Row-count cap: keep only the NEWEST `maxRows` entries, deleting the
 *      oldest tail beyond the cap — bounds the table even when the remaining
 *      rows are all recent (no unbounded growth).
 *
 * Both run inside the existing periodic soul-maintenance sweep; this function
 * creates no job of its own.
 *
 * @param db - The SQLite store's raw database handle (db.db from SQLiteStore)
 * @param retentionDays - Entries older than this many days are deleted (default: 30)
 * @param maxRows - Max action_log rows retained (default: ACTION_LOG_MAX_ROWS)
 * @returns Per-pass and total rows deleted
 */
export function pruneActionLog(
	db: { prepare: (sql: string) => import("better-sqlite3").Statement },
	retentionDays = 30,
	maxRows = ACTION_LOG_MAX_ROWS
): PruneActionLogResult {
	const cutoff = new Date(Date.now() - retentionDays * TTL_MS_PER_DAY).toISOString();

	// 1. Age-based retention (existing behavior)
	const ageResult = db.prepare(`DELETE FROM ${TABLE_ACTION_LOG} WHERE created_at < ?`).run(cutoff);
	const deletedByAge = ageResult.changes;

	// 2. Row-count cap: delete everything older than the maxRows-th newest row
	//    in one PK-indexed statement. When the table is under the cap the
	//    subquery yields NULL and `id <= NULL` matches nothing.
	let deletedByCap = 0;
	if (maxRows > 0) {
		const capResult = db
			.prepare(
				`DELETE FROM ${TABLE_ACTION_LOG}
				 WHERE id <= (SELECT id FROM ${TABLE_ACTION_LOG} ORDER BY id DESC LIMIT 1 OFFSET ?)`
			)
			.run(maxRows);
		deletedByCap = capResult.changes;
	}

	if (deletedByAge + deletedByCap > 0) {
		logger.info("[SoulMaintenance] Pruned action_log entries", {
			deletedByAge,
			deletedByCap,
			cutoff
		});
	}

	return { deletedByAge, deletedByCap, deleted: deletedByAge + deletedByCap };
}

/**
 * Delete observations whose PARENT DOCUMENT is gone, or which no cleanup path
 * can ever reach (audit F1).
 *
 * **This replaces an age-only prune that was silently destroying live data.**
 * The previous implementation deleted every observation older than
 * `retentionDays` regardless of whether its parent memory/task/standard/file
 * still existed. Since the observation text is the ONLY link from a document to
 * its graph (`getEntityNamesByObservation`), and nothing re-creates the row
 * afterwards (`queue_jobs` is already `done`, and the startup backfill skips
 * entities whose vector is fresh), the effect was permanent: measured on a real
 * database, 287/710 memories, 611/691 tasks and 297/297 standards had lost
 * their entire KG context and returned `kg:{entities:[],relations:[]}` forever,
 * while their edges kept consuming disk.
 *
 * The parent-aware version deletes only what is genuinely collectable —
 * contract-format rows whose parent row is gone, plus inline-format rows
 * (`"call relation: A → B"`) for entities with no contract-format anchor, which
 * no deleter can match because they bypass `observationText()`. On the same
 * database the age-only prune would have deleted 42,838 rows; this deletes
 * 7,437 and preserves 35,401 live document↔graph links.
 *
 * @param knowledgeGraph - The KnowledgeGraphEntity (sole encapsulation point
 *   for raw SQL against the KG tables)
 * @param retentionDays - Only rows older than this are considered (default: 7)
 * @returns Number of rows deleted
 */
export async function pruneObservations(
	knowledgeGraph: KnowledgeGraphEntity,
	retentionDays = KG_OBSERVATION_RETENTION_DAYS
): Promise<PruneObservationsResult> {
	const cutoff = new Date(Date.now() - retentionDays * TTL_MS_PER_DAY).toISOString();

	const deleted = await knowledgeGraph.deleteStaleObservations(cutoff);

	if (deleted > 0) {
		logger.info("[SoulMaintenance] Pruned orphaned observations", {
			deleted,
			cutoff,
			retentionDays
		});
	}

	return { deleted };
}

/**
 * Prune relation rows that no read path can reach again (audit F1).
 *
 * `observations` was pruned but `relations` never was, and entity names resolve
 * exclusively through `observations` — so an edge whose endpoints have no
 * observation is permanently invisible to every reader while still occupying
 * disk AND still pinning its endpoint entities against `deleteOrphanEntities`
 * (which keeps any name referenced by a relation). That is why `relations` grew
 * to 77% of total DB size at ~70k edges/day on a real deployment with no
 * mechanism to ever shrink.
 *
 * Eligibility requires BOTH an age guard and same-repository unreachability;
 * migration v33 makes `(name, repo)` the entity identity.
 *
 * Bounded per run (`maxRows`) and per transaction (`chunkSize`) so a large
 * backlog converges across maintenance cycles instead of blocking one startup
 * and starving sibling writers. Followed by ONE global orphan-entity sweep,
 * which is where the space actually comes back: entities kept alive only by
 * now-deleted edges become collectable.
 *
 * Observability (TASK-041): the exact remaining backlog is only counted when
 * this run did NOT hit `maxRows` (the tail). When the cap was hit the count is
 * skipped and `remaining` is reported as
 * `KG_RELATION_PRUNE_REMAINING_UNKNOWN` (-1) — the correlated
 * `countPrunableRelations` scan is ~105s on a 7.4M-row table and would
 * dominate the bounded delete it is meant to observe. The default per-run cap
 * was raised to 500,000 (KG_RELATION_PRUNE_MAX_ROWS) so the accumulated
 * backlog drains in days rather than months.
 *
 * Verified end-to-end on a copy of a real 536 MB database: 392,445 edges +
 * 4,937 entities removed, `VACUUM` reclaimed 536 → 368 MB (31%), integrity
 * check ok, 0 foreign-key violations.
 *
 * **Async only because the underlying bounded delete yields between chunks.**
 * A 500k-row cap (KG_RELATION_PRUNE_MAX_ROWS) would otherwise hold the Node.js
 * event loop for ~28s; `deleteUnreachableRelations` now awaits a `setImmediate`
 * between chunks so the MCP server stays responsive and `proper-lockfile`'s
 * 15s heartbeat can refresh while `withExclusiveWrite` is held. All other
 * semantics (cap/chunk/tail/sentinel) are unchanged.
 *
 * @param knowledgeGraph - The KnowledgeGraphEntity
 * @param retentionDays - Age guard in days (default: KG_RELATION_RETENTION_DAYS)
 * @param maxRows - Hard cap on relation rows deleted this run
 * @param chunkSize - Rows per transaction (write-lock hold bound)
 * @returns Relations deleted, entities swept, and the remaining backlog (exact
 *   when the run drained the tail, else KG_RELATION_PRUNE_REMAINING_UNKNOWN)
 */
export async function pruneRelations(
	knowledgeGraph: KnowledgeGraphEntity,
	retentionDays = KG_RELATION_RETENTION_DAYS,
	maxRows = KG_RELATION_PRUNE_MAX_ROWS,
	chunkSize = KG_RELATION_PRUNE_CHUNK
): Promise<PruneRelationsResult> {
	const cutoff = new Date(Date.now() - retentionDays * TTL_MS_PER_DAY).toISOString();

	const deleted = await knowledgeGraph.deleteUnreachableRelations(cutoff, maxRows, chunkSize);
	if (deleted === 0) return { deleted: 0, orphanEntitiesDeleted: 0, remaining: 0 };

	// The edges are gone; their endpoint entities may now be orphans. This is
	// the pass that actually reclaims the space.
	const orphanEntitiesDeleted = await knowledgeGraph.deleteOrphanEntities();

	// TASK-041: only pay for the correlated remaining-count at the tail.
	// `deleteUnreachableRelations` stops early ONLY when a chunk deletes 0 rows
	// (it exhausts the eligible set), so `deleted < maxRows` proves the sweep
	// reached the tail and the count is bounded and exact. When `deleted`
	// EQUALS the cap the delete stopped because it ran out of budget, not work:
	// a backlog provably remains, and running the ~105s correlated scan just to
	// learn a number we already know is positive would dwarf the delete itself.
	// Report the sentinel instead (test `remaining !== 0` for "more work").
	const hitCap = deleted >= maxRows;
	const remaining = hitCap ? KG_RELATION_PRUNE_REMAINING_UNKNOWN : knowledgeGraph.countPrunableRelations(cutoff);

	logger.info("[SoulMaintenance] Pruned unreachable relations", {
		deleted,
		orphanEntitiesDeleted,
		remaining,
		cutoff,
		retentionDays,
		truncated: remaining !== 0
	});

	return { deleted, orphanEntitiesDeleted, remaining };
}
