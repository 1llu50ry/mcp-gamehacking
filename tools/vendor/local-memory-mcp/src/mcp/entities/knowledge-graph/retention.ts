import { BaseEntity } from "../../storage/base";
import { KG_PRUNE_WINDOW_CHUNK } from "../../utils/constants";

/** Retention-only SQL kept separate from KG CRUD/query orchestration. */
export class KnowledgeGraphRetentionEntity extends BaseEntity {
	/**
	 * Delete observations created before the cutoff whose PARENT DOCUMENT no
	 * longer exists (audit F1). No orphan sweep — that is a separate pass.
	 *
	 * **Why the parent check is not optional.** The observation text is the ONLY
	 * path from a document to its graph: every read resolves entity names via
	 * `getEntityNamesByObservation(observationText(domain, title), repo)`. So an
	 * age-only prune does not "clean up stale annotations" — it severs live
	 * documents from their own graph, permanently, because nothing re-creates
	 * the row: `queue_jobs` is already `done` for that entity and the startup
	 * backfill skips it (its vector is fresh). Measured on a real database
	 * running the age-only prune: 287/710 memories, 611/691 tasks and 297/297
	 * standards had been severed and returned `kg:{entities:[],relations:[]}`
	 * forever, while their edges stayed on disk.
	 *
	 * Two things ARE genuinely collectable and both are covered here:
	 *
	 *   1. **Contract-format rows whose parent row is gone** — `Mentioned in
	 *      {domain}: {title}` with no matching memory / task / standard /
	 *      codebase_file. The delete tools already remove these
	 *      (`deleteObservationsAndOrphans`), so this clause is the safety net
	 *      for rows missed by a crash, a pre-contract write, or a rename.
	 *   2. **Inline-format rows for entities with no contract anchor** — the
	 *      relation writers emit free-form texts (`"call relation: A → B"`,
	 *      `"depends_on relation: X → Y"`) that do NOT go through
	 *      `observationText()`, so no deleter can ever match them. On the same
	 *      database 18,275 such rows (41% of the table) were unreachable by
	 *      every cleanup path; 938 entity/repo pairs existed ONLY through them,
	 *      which is what kept their entities alive against the orphan sweep.
	 *
	 * Standards are matched by title WITHOUT a repo filter, mirroring
	 * `fetchKgContext`'s `repo ?? ""` call for the standard domain (standards
	 * may be global).
	 *
	 * **Windowed + yielding.** The eligible set is a tiny fraction of the table
	 * (measured ~204 of 369k rows), so a single `DELETE` with these correlated
	 * `NOT EXISTS` predicates is one long synchronous full-table scan — it froze
	 * the event loop ~41s on a real deployment and let the maintenance sweep's
	 * `withExclusiveWrite` proper-lockfile go stale. `deleteWindowed` bounds each
	 * unit to `KG_PRUNE_WINDOW_CHUNK` rowids and yields between windows.
	 *
	 * @param cutoff - ISO timestamp; only rows older than this are considered.
	 * @param chunkSize - Rowids examined per window/transaction.
	 * @returns Number of rows deleted.
	 */
	async deleteStaleObservations(cutoff: string, chunkSize = KG_PRUNE_WINDOW_CHUNK): Promise<number> {
		return await this.deleteWindowed(
			"observations",
			`_row.created_at < ?
			   AND (
			       -- 1. contract-format, parent document gone
			       (
			         _row.observation LIKE 'Mentioned in %'
			         AND NOT (
			              (_row.observation LIKE 'Mentioned in memory: %'
			                AND EXISTS (SELECT 1 FROM memories m
			                             WHERE m.repo = _row.repo
			                               AND 'Mentioned in memory: ' || m.title = _row.observation))
			           OR (_row.observation LIKE 'Mentioned in task: %'
			                AND EXISTS (SELECT 1 FROM tasks t
			                             WHERE t.repo = _row.repo
			                               AND 'Mentioned in task: ' || t.title = _row.observation))
			           OR (_row.observation LIKE 'Mentioned in standard: %'
			                AND EXISTS (SELECT 1 FROM coding_standards s
			                             WHERE 'Mentioned in standard: ' || s.title = _row.observation))
			           OR (_row.observation LIKE 'Mentioned in codebase: %'
			                AND EXISTS (SELECT 1 FROM derived.codebase_files f
			                             WHERE f.repo = _row.repo
			                               AND 'Mentioned in codebase: ' || f.file_path = _row.observation))
			         )
			       )
			       -- 2. inline-format row for an entity with no contract anchor
			       OR (
			         _row.observation NOT LIKE 'Mentioned in %'
			         AND NOT EXISTS (SELECT 1 FROM observations anchor
			                          WHERE anchor.entity_name = _row.entity_name
			                            AND anchor.repo = _row.repo
			                            AND anchor.observation LIKE 'Mentioned in %')
			       )
			     )`,
			[cutoff],
			chunkSize
		);
	}

	/**
	 * Count relation rows eligible for pruning: older than `cutoff` and with
	 * NEITHER endpoint referenced by any observation (audit F1). Used for
	 * observability — the prune itself selects and deletes in bounded chunks.
	 *
	 * **Expensive.** The two `NOT EXISTS` probes are correlated against
	 * `observations` per candidate row, so this is a full-table scan with
	 * per-row subqueries (~105s on a 7.4M-row `relations` table) — it dwarfs
	 * the bounded delete it observes. TASK-041 therefore calls it ONLY at the
	 * tail of a prune run (when the delete did NOT hit its cap and so proved
	 * the eligible set was drained); a capped run reports a sentinel instead
	 * (see `KG_RELATION_PRUNE_REMAINING_UNKNOWN`). Callers that need "is there
	 * more to prune?" should prefer that tail check over this count.
	 */
	countPrunableRelations(cutoff: string): number {
		return (
			this.get<{ cnt: number }>(
				`SELECT COUNT(*) AS cnt FROM relations r
				 WHERE r.created_at < ?
				   AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.entity_name = r.from_entity AND o.repo = r.repo)
				   AND NOT EXISTS (SELECT 1 FROM observations o2 WHERE o2.entity_name = r.to_entity AND o2.repo = r.repo)`,
				[cutoff]
			)?.cnt ?? 0
		);
	}

	/**
	 * Delete relations that no read path can ever reach again (audit F1).
	 *
	 * Eligibility — BOTH must hold:
	 *   - `created_at < cutoff` (age guard, so a freshly written edge is never
	 *     racing the sweep), and
	 *   - NEITHER endpoint appears in `observations` in the SAME repo. Entity
	 *     identity is `(name, repo)` since migration v33, so observations in a
	 *     different repository cannot make this edge reachable.
	 *
	 * **Bounded by construction.** Every `DELETE` fires the v22 `kg_degrees`
	 * triggers (2 UPDATEs + 1 conditional DELETE per row), so throughput is
	 * ~18k rows/s. Measured on a 392,445-row backlog: an unbounded sweep took
	 * 189s with multi-second write-lock bursts. This implementation therefore:
	 *   - deletes at most `maxRows` per call (default 50,000 ≈ 2.7s), converging
	 *     over successive maintenance runs rather than in one startup, and
	 *   - commits every `chunkSize` rows (default 2,000) in its own
	 *     `BEGIN IMMEDIATE`, capping worst-case lock hold at ~250ms so a
	 *     sibling writer is never starved past `busy_timeout`.
	 *
	 * End-to-end verified on a copy of a real 536 MB database: 392,445 edges +
	 * 4,937 now-orphaned entities removed, `VACUUM` reclaimed 536 MB → 368 MB
	 * (31%), `PRAGMA integrity_check` = ok, `PRAGMA foreign_key_check` = 0
	 * violations.
	 *
	 * **Async only to yield between chunks.** The sweep is otherwise pure
	 * synchronous better-sqlite3 work, but a 500k-row cap (TASK-041) would hold
	 * the Node.js event loop for ~28s in one shot, starving the MCP server and
	 * letting `proper-lockfile`'s 15s heartbeat go stale (stale=30s) while the
	 * whole sweep holds `withExclusiveWrite`. Yielding between chunks keeps the
	 * server responsive and the exclusive lock refreshed without changing the
	 * cap/chunk/tail semantics.
	 *
	 * @param cutoff - ISO timestamp; only edges older than this are eligible.
	 * @param maxRows - Hard cap on rows deleted this call. `0` = no-op.
	 * @param chunkSize - Rows per transaction (write-lock hold bound).
	 * @returns Number of relation rows deleted.
	 */
	async deleteUnreachableRelations(cutoff: string, maxRows: number, chunkSize: number): Promise<number> {
		if (maxRows <= 0) return 0;

		// Cheap terminal gate: if NO edge is even age-eligible, skip the sweep
		// entirely. `idx_relations_created_at` (migration v29) makes this a
		// single index probe (<1ms) instead of paying the correlated NOT EXISTS
		// scan just to learn there is nothing to do.
		if (
			this.get<{ present: number }>("SELECT 1 AS present FROM relations WHERE created_at < ? LIMIT 1", [cutoff]) ===
			undefined
		) {
			return 0;
		}

		const batch = Math.max(1, Math.min(chunkSize, maxRows));

		// Single cached statement (no dynamic placeholder list): the bounded
		// sub-SELECT picks the next `batch` eligible rowids and the DELETE
		// consumes them in the same statement, so one `BEGIN IMMEDIATE` covers
		// exactly one chunk. `idx_relations_created_at` turns the outer scan
		// into an index range seek, so a run with nothing left to prune costs
		// ~0ms instead of a full-table scan (measured 2844ms → 0ms on a
		// 895k-row table).
		const deleteChunkSql = `DELETE FROM relations WHERE rowid IN (
			   SELECT r.rowid FROM relations r
			   WHERE r.created_at < ?
			     AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.entity_name = r.from_entity AND o.repo = r.repo)
			     AND NOT EXISTS (SELECT 1 FROM observations o2 WHERE o2.entity_name = r.to_entity AND o2.repo = r.repo)
			   LIMIT ?
			 )`;

		let deleted = 0;
		while (deleted < maxRows) {
			const want = Math.min(batch, maxRows - deleted);
			const removed = this.transaction(() => this.run(deleteChunkSql, [cutoff, want]).changes);
			if (removed === 0) break;
			deleted += removed;
			// Yield to the event loop between chunks so the MCP server stays
			// responsive and the exclusive write lock (proper-lockfile) can refresh
			// its 15s heartbeat — a 500k-row sweep is otherwise a ~28s main-thread freeze.
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
		return deleted;
	}
}
