import { logger } from "../../utils/logger";
import type { Migration } from "./index";

/**
 * v29 — KG relation index rebalance (audit F2 / F9).
 *
 * ── ADD `idx_relations_repo_to (repo, to_entity)` ────────────────────────
 *
 * `getRelationsFor` (the KG-context enrichment lookup on EVERY memory / task
 * / standard read) needs both directions of the adjacency list served by an
 * index. `idx_relations_repo_from_to` (v12) covers `(repo, from_entity)`;
 * nothing covered `(repo, to_entity)`, so the query's `OR` predicate could
 * not be satisfied by any single index and the planner fell back to
 * `SEARCH relations USING INDEX idx_relations_repo (repo=?)` — a full scan of
 * every edge in the repo on every read.
 *
 * This index is one HALF of the fix; the other half is the UNION rewrite in
 * `getRelationsFor`. Neither works alone — measured on a real 1.29M-edge DB
 * (largest repo scope: 490k edges in-repo, 50-name enrichment, median of 5):
 *
 * ```
 *   OR predicate  + no new index    982 ms   9,415 rows
 *   OR predicate  + this index     1065 ms   9,415 rows   <- index alone: no gain
 *   UNION rewrite + this index      126 ms   9,415 rows   <- 7.8x, identical rows
 * ```
 *
 * A single `OR` cannot consume two indexes, so the planner ignores the new
 * index until the query is split into two UNION'd branches.
 *
 * Cost on that database: 42.7 MB, ~5s one-time build. Net storage change for
 * this migration is NEGATIVE (see below).
 *
 * ── DROP `idx_relations_type (relation_type)` ────────────────────────────
 *
 * Serves zero queries. The only SQL touching `relation_type` in a predicate
 * is `deleteRelation`, which matches the full composite primary key
 * `(from_entity, to_entity, relation_type)` and is therefore served by
 * `sqlite_autoindex_relations_1`. Verified by dropping it and re-running
 * `EXPLAIN QUERY PLAN` for all 9 relation queries from a fresh connection:
 * NO plan changed. 28.4 MB reclaimed.
 *
 * ── DROP `idx_relations_from (from_entity)` ──────────────────────────────
 *
 * Redundant. `from_entity` is the leftmost column of the composite primary
 * key, so `sqlite_autoindex_relations_1` already serves every `from_entity`
 * lookup. Verified the same way — after dropping it, the one query that used
 * it (`getRelationsByName`, dashboard entity detail) simply switches to the
 * autoindex and keeps its MULTI-INDEX OR plan:
 *
 * ```
 *   before drop:  MULTI-INDEX OR / idx_relations_from   + idx_relations_to   24.0 ms
 *   after  drop:  MULTI-INDEX OR / autoindex_relations_1 + idx_relations_to   30.5 ms
 * ```
 *
 * 35.8 MB reclaimed for +6 ms on one non-hot dashboard query.
 *
 * ── `idx_relations_to` is deliberately KEPT ──────────────────────────────
 *
 * It looks redundant next to the new `(repo, to_entity)` index but is NOT:
 * `getRelationsByName` queries `to_entity` WITHOUT a repo filter, so the
 * composite index (repo first) cannot serve it. Dropping it collapses that
 * query to a full table scan — measured 30.5 ms → 2325.0 ms (76x worse) on
 * the same hub entity. Left in place.
 *
 * ── ADD `idx_relations_created_at (created_at)` ──────────────────────────
 *
 * Required by the new `pruneRelations` retention sweep (audit F1), which
 * selects `WHERE created_at < ? AND <both endpoints unobserved>`. Without it
 * the planner does `SCAN relations` and pays the correlated NOT EXISTS probes
 * for every row — including on the common case where NOTHING is eligible:
 *
 * ```
 *   terminal run (0 eligible, 895k-row table)   without index: 2844 ms
 *                                                  with index:    0 ms
 * ```
 *
 * A retention pass that costs 3 seconds of pure waste on every maintenance
 * cycle would not survive contact with a real deployment. 40.9 MB.
 *
 * ── Net effect ──────────────────────────────────────────────────────────
 *
 * `relations` indexes: +42.7 MB (repo_to) + 40.9 MB (created_at) − 64.2 MB
 * (dropped) = **+19.4 MB**, against 395,215 unreachable edges the retention
 * sweep now reclaims on the same database (536 MB → 368 MB after `VACUUM`).
 * `DROP INDEX` is instant and metadata-only; freed space returns to the
 * freelist and is reclaimed by any later `VACUUM`.
 *
 * Idempotent: `IF NOT EXISTS` / `IF EXISTS` on every statement.
 */
export const migration: Migration = {
	version: 29,
	name: "kg-relations-index-rebalance",
	up: (db) => {
		db.exec("CREATE INDEX IF NOT EXISTS idx_relations_repo_to ON relations(repo, to_entity)");
		logger.info("[Migration] Added idx_relations_repo_to (repo, to_entity) — serves getRelationsFor's to-branch");

		db.exec("CREATE INDEX IF NOT EXISTS idx_relations_created_at ON relations(created_at)");
		logger.info("[Migration] Added idx_relations_created_at — serves the pruneRelations retention sweep");

		// Unused: no query filters on relation_type alone (deleteRelation hits
		// the full composite PK).
		db.exec("DROP INDEX IF EXISTS idx_relations_type");
		// Redundant: from_entity is the PK's leftmost column.
		db.exec("DROP INDEX IF EXISTS idx_relations_from");
		logger.info(
			"[Migration] Dropped idx_relations_type (unused) and idx_relations_from (PK-prefix redundant); idx_relations_to KEPT — it serves the repo-less getRelationsByName lookup"
		);
	}
};
