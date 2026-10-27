import { TABLE_HANDOFFS, TABLE_CLAIMS } from "../../utils/constants";
import { logger } from "../../utils/logger";
import type { Migration } from "./index";

/**
 * Composite (owner, repo) indexes for the remaining owner-scoped tables.
 *
 * FIX-OWNER-INDEX: memories/tasks/action_log gained idx_*_owner_repo in v05,
 * but handoffs, claims, task_comments, and coding_standards only carried
 * single-column (repo) indexes. Every read path on these tables filters by
 * `owner = ? AND repo = ?` first (e.g. handoff list/count, claim
 * list/count/active lookups, task_comments getAllTaskCommentsByRepo, and the
 * standards scoped search `((owner = ? AND repo = ?) OR is_global = 1)`), so
 * the missing composite left the query planner scanning by repo alone and
 * filtering owner per row.
 *
 * Column order matches the query shape (owner equality leading, repo second)
 * and mirrors the v05 idx_memories_owner_repo / idx_tasks_owner_repo pattern.
 * coding_standards.repo is nullable (NULL = unscoped row, matched only by the
 * is_global OR branch), so NULL rows naturally index apart — the leading
 * `owner` equality still lets the planner serve the scoped branch via this
 * index.
 *
 * Idempotent by construction (IF NOT EXISTS) — safe on fresh DBs (v1 creates
 * all four tables) and on upgrade; the runner wraps each up() in a
 * transaction, so a crash mid-migration rolls back cleanly. No data rebuild.
 */
export const migration: Migration = {
	version: 34,
	name: "owner-repo-indexes-handoffs-claims-comments-standards",
	up: (db) => {
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_handoffs_owner_repo ON ${TABLE_HANDOFFS}(owner, repo);
			CREATE INDEX IF NOT EXISTS idx_claims_owner_repo ON ${TABLE_CLAIMS}(owner, repo);
			CREATE INDEX IF NOT EXISTS idx_task_comments_owner_repo ON task_comments(owner, repo);
			CREATE INDEX IF NOT EXISTS idx_standards_owner_repo ON coding_standards(owner, repo);
		`);
		logger.info(
			"[Migration] Added composite (owner, repo) indexes for handoffs, claims, task_comments, coding_standards"
		);
	}
};
