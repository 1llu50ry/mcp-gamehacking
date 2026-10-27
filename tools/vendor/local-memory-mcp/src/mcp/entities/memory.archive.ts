import { BaseEntity } from "../storage/base";
import { BULK_UPDATE_CHUNK_SIZE, TABLE_MEMORIES } from "../utils/constants";
import { chunksOf } from "../utils/chunk";
import { MemoryRow, MEMORY_STATUS_ACTIVE, MEMORY_STATUS_ARCHIVED } from "../types";

/** Minimal identity + revision key of an archived offload candidate. */
export type ArchivedOffloadKey = Pick<MemoryRow, "id" | "updated_at">;

export class MemoryArchiveEntity extends BaseEntity {
	bulkDeleteMemories(ids: string[]): number {
		if (ids.length === 0) return 0;

		return this.transaction(() => {
			let count = 0;
			for (const chunk of chunksOf(ids, BULK_UPDATE_CHUNK_SIZE)) {
				const result = this.run(`DELETE FROM ${TABLE_MEMORIES} WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk);
				count += result.changes;
			}
			return count;
		});
	}

	/**
	 * Delete archived memories only while each row is still the exact archived
	 * revision that was copied to the cold tier.
	 *
	 * Every delete is guarded by `status = 'archived' AND updated_at = ?` so a
	 * row that a concurrent writer updated, unarchived, or re-archived (any of
	 * which bumps `updated_at`) between offload selection and deletion matches
	 * nothing and is preserved in the hot store — preventing the permanent loss
	 * of concurrent updates (TASK-049). Chunked and transactional, mirroring
	 * {@link bulkDeleteMemories}.
	 *
	 * @param pairs - Candidate `{ id, updated_at }` keys captured at selection.
	 * @returns Number of hot rows actually deleted (unchanged candidates only).
	 */
	deleteArchivedIfUnchanged(pairs: ReadonlyArray<ArchivedOffloadKey>): number {
		if (pairs.length === 0) return 0;

		return this.transaction(() => {
			let count = 0;
			for (const chunk of chunksOf(pairs, BULK_UPDATE_CHUNK_SIZE)) {
				for (const { id, updated_at } of chunk) {
					const result = this.run(
						`DELETE FROM ${TABLE_MEMORIES} WHERE id = ? AND status = '${MEMORY_STATUS_ARCHIVED}' AND updated_at = ?`,
						[id, updated_at]
					);
					count += result.changes;
				}
			}
			return count;
		});
	}

	archiveExpiredMemories(force: boolean = false): number {
		if (process.env.ENABLE_AUTO_ARCHIVE !== "true" && !force) return 0;
		const now = new Date().toISOString();
		const result = this.run(
			`UPDATE ${TABLE_MEMORIES} SET status = '${MEMORY_STATUS_ARCHIVED}', updated_at = ? WHERE expires_at IS NOT NULL AND expires_at <= ? AND status = '${MEMORY_STATUS_ACTIVE}'`,
			[now, now]
		);
		return result.changes;
	}

	archiveLowScoreMemories(force: boolean = false): number {
		if (process.env.ENABLE_AUTO_ARCHIVE !== "true" && !force) return 0;
		const result = this.run(
			`UPDATE ${TABLE_MEMORIES} SET status = '${MEMORY_STATUS_ARCHIVED}', updated_at = ? WHERE status = '${MEMORY_STATUS_ACTIVE}' AND (
				(julianday('now') - julianday(COALESCE(last_used_at, created_at)) > 90 AND importance < 3)
				OR (hit_count > 10 AND recall_count = 0)
			)`,
			[new Date().toISOString()]
		);
		return result.changes;
	}

	/**
	 * Select archived memories eligible for cold-tier offload, oldest first.
	 *
	 * Age-gated on `updated_at` (the timestamp set when the row was archived)
	 * so only rows that have sat archived for the retention window are
	 * candidates; `updated_at ASC` drains the oldest backlog first. Bounded by
	 * `limit` (the caller's per-run cap).
	 *
	 * @param cutoff - ISO timestamp; rows with `updated_at <= cutoff` qualify.
	 * @param limit - Maximum rows to return (per-run cap).
	 * @returns Raw memory rows ready to copy into the cold store.
	 */
	selectArchivedForOffload(cutoff: string, limit: number): MemoryRow[] {
		if (limit <= 0) return [];
		return this.all<MemoryRow>(
			`SELECT * FROM ${TABLE_MEMORIES} WHERE status = '${MEMORY_STATUS_ARCHIVED}' AND updated_at <= ? ORDER BY updated_at ASC LIMIT ?`,
			[cutoff, limit]
		);
	}
}
