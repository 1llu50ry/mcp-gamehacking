import { logger } from "../../utils/logger";
import type { Migration } from "./index";

/**
 * v36 — relations index consolidation (TASK-040).
 *
 * The `relations` table carried six indexes; two are redundant and this
 * migration drops them. Both are `DROP INDEX` statements — metadata-only and
 * instant, with no table rebuild. Freed pages return to the freelist and are
 * reclaimed by any later `VACUUM`.
 *
 * ── DROP `idx_relations_repo (repo)` — LIKELY REDUNDANT ──────────────────
 *
 * `(repo)` is the leftmost prefix of BOTH `idx_relations_repo_to
 * (repo, to_entity)` and `idx_relations_repo_from_to (repo, from_entity,
 * to_entity)`, so any `repo = ?` predicate can be served by either composite.
 * On a 200k-row scratch DB, after dropping it all four consumers —
 * `getRelationsByName`, `countRelations`, `deleteRepoEntities`, and the
 * `listGraphEdges` outer scan — replan to the composite indexes (or a
 * MULTI-INDEX OR) with NO table scan. ~172 MB.
 *
 * ── DROP `idx_relations_to (to_entity)` — REDUNDANT POST-v33 ─────────────
 *
 * No production query performs a repo-less to-only lookup anymore:
 * `getRelationsByName` is always repo-scoped (v33 made `repo` part of the KG
 * identity and the dashboard query filters on it), and KGController 400s
 * without a repo. v29 kept this index solely for the repo-less
 * `getRelationsByName`; that shape no longer exists. Remaining repo-less
 * shapes fall back to the PK autoindex (`sqlite_autoindex_relations_1`,
 * whose leading column is `from_entity`) or `idx_relations_repo_to`. ~229 MB.
 *
 * ── KEPT ─────────────────────────────────────────────────────────────────
 *
 * `sqlite_autoindex_relations_1` (PK `(from_entity, to_entity, relation_type,
 * repo)` — required, cannot be dropped), `idx_relations_repo_from_to`,
 * `idx_relations_repo_to`, `idx_relations_created_at` (the `pruneRelations`
 * retention sweep).
 *
 * Idempotent: `DROP INDEX IF EXISTS` on both statements, so re-running after a
 * crash mid-migration is a no-op.
 */
export const migration: Migration = {
	version: 36,
	name: "relations-index-consolidation",
	up: (db) => {
		// Redundant: `repo` is the leftmost prefix of idx_relations_repo_to and
		// idx_relations_repo_from_to.
		db.exec("DROP INDEX IF EXISTS idx_relations_repo");
		// Redundant post-v33: no repo-less to-only lookup remains; the PK
		// autoindex / idx_relations_repo_to cover the residual shapes.
		db.exec("DROP INDEX IF EXISTS idx_relations_to");
		logger.info(
			"[Migration] Dropped redundant idx_relations_repo (composite-prefix) and idx_relations_to (repo-less lookup removed by v33)"
		);
	}
};
