import type { SQLiteStore } from "../storage/sqlite";
import { logger } from "../utils/logger";
import { chunksOf } from "../utils/chunk";
import {
	COLD_ARCHIVE_RETENTION_DAYS,
	COLD_ARCHIVE_OFFLOAD_MAX_ROWS,
	COLD_ARCHIVE_BATCH_SIZE,
	TTL_MS_PER_DAY
} from "../utils/constants";

/** Tuning/overrides for {@link offloadArchivedMemories}. */
export interface ColdArchiveOffloadOptions {
	/** Age guard in days (default: COLD_ARCHIVE_RETENTION_DAYS). */
	retentionDays?: number;
	/** Per-run row cap (default: COLD_ARCHIVE_OFFLOAD_MAX_ROWS). `0` disables. */
	maxRows?: number;
	/** Rows per cold-store transaction (default: COLD_ARCHIVE_BATCH_SIZE). */
	batchSize?: number;
	/** Injectable clock for deterministic tests. */
	now?: Date;
}

/** Outcome of one cold-tier offload pass. */
export interface ColdArchiveOffloadResult {
	/** Archived rows selected this run. */
	candidates: number;
	/** Rows written to the cold store (before verification). */
	copied: number;
	/** Rows deleted from the hot store (0 when verification failed/skipped). */
	deleted: number;
	/**
	 * Candidates retained in the hot store because a concurrent writer changed
	 * them (status and/or `updated_at`) between selection and deletion
	 * (TASK-049). `deleted + preserved === candidates` on a completed pass.
	 */
	preserved: number;
	/** True when the pass did not complete (disabled or verification failure). */
	skipped: boolean;
	/** Machine-readable reason when skipped (`disabled`, `verification_failed`, `error`). */
	reason?: string;
}

/**
 * Offload long-archived memories from the hot store into the cold tier
 * (TASK-036 / DB-shrink L3).
 *
 * Flow (copy → verify → delete, so a failure never loses data):
 *   1. Select archived rows whose `updated_at <= now - retentionDays`, oldest
 *      first, bounded by `maxRows`.
 *   2. Copy them into the cold store in `batchSize`-row transactions
 *      (`INSERT OR REPLACE`, so a retried pass is idempotent).
 *   3. Verify every selected id is present in the cold store.
 *   4. Only then delete the hot rows via `deleteArchivedIfUnchanged`, guarded
 *      per row by `status='archived' AND updated_at = ?` so a candidate a
 *      concurrent writer modified or unarchived between steps 1 and 4 is
 *      preserved rather than lost (TASK-049). The delete cascades to
 *      `memory_vectors`, `memory_tags`, and the `memories_fts` shadow table
 *      (FK ON DELETE CASCADE + the FTS delete trigger) — no separate vector
 *      prune is required.
 *
 * Returns counts (`deleted + preserved === candidates` on a completed pass);
 * never deletes unless the copy is fully verified.
 */
export function offloadArchivedMemories(
	store: SQLiteStore,
	options: ColdArchiveOffloadOptions = {}
): ColdArchiveOffloadResult {
	const retentionDays = options.retentionDays ?? COLD_ARCHIVE_RETENTION_DAYS;
	const maxRows = Math.max(0, Math.floor(options.maxRows ?? COLD_ARCHIVE_OFFLOAD_MAX_ROWS));
	const batchSize = Math.max(1, Math.floor(options.batchSize ?? COLD_ARCHIVE_BATCH_SIZE));
	const now = options.now ?? new Date();

	if (maxRows === 0) {
		return { candidates: 0, copied: 0, deleted: 0, preserved: 0, skipped: true, reason: "disabled" };
	}

	const cutoff = new Date(now.getTime() - retentionDays * TTL_MS_PER_DAY).toISOString();
	const rows = store.memoryArchives.selectArchivedForOffload(cutoff, maxRows);
	if (rows.length === 0) {
		return { candidates: 0, copied: 0, deleted: 0, preserved: 0, skipped: false };
	}

	const cold = store.coldArchive;
	const offloadedAt = now.toISOString();
	const ids = rows.map((row) => row.id);

	let copied = 0;
	for (const chunk of chunksOf(rows, batchSize)) {
		copied += cold.insertMemories(chunk, offloadedAt);
	}

	const verified = cold.countByIds(ids);
	if (verified !== ids.length) {
		logger.warn("[ColdArchive] Verification failed — hot rows retained", {
			candidates: ids.length,
			copied,
			verified
		});
		return { candidates: ids.length, copied, deleted: 0, preserved: 0, skipped: true, reason: "verification_failed" };
	}

	// Delete each candidate only while it is still the archived revision that
	// was copied. A row a concurrent writer touched (updated/unarchived) no
	// longer matches `status='archived' AND updated_at`, so it is preserved in
	// the hot store instead of being lost (TASK-049).
	const deleted = store.memoryArchives.deleteArchivedIfUnchanged(rows);
	const preserved = ids.length - deleted;

	logger.info("[ColdArchive] Offloaded archived memories to cold tier", {
		candidates: ids.length,
		copied,
		deleted,
		preserved,
		retentionDays,
		cutoff
	});

	return { candidates: ids.length, copied, deleted, preserved, skipped: false };
}

/**
 * Never-throw gate around {@link offloadArchivedMemories} for the maintenance
 * sweep. Returns `null` when disabled so a caller can distinguish "did not run"
 * from a completed pass; any failure is logged and reported as
 * `{ skipped: true, reason: "error" }` so a bad cold store can never take down
 * startup.
 *
 * @param store - The hot SQLiteStore.
 * @param enabled - The resolved `COLD_ARCHIVE_ENABLED` flag.
 * @returns The offload result, or `null` when the gate is disabled.
 */
export function runColdArchiveOffload(store: SQLiteStore, enabled: boolean): ColdArchiveOffloadResult | null {
	if (!enabled) return null;
	try {
		return offloadArchivedMemories(store);
	} catch (err) {
		logger.warn("[ColdArchive] Offload failed — skipping this run", { error: String(err) });
		return { candidates: 0, copied: 0, deleted: 0, preserved: 0, skipped: true, reason: "error" };
	}
}
