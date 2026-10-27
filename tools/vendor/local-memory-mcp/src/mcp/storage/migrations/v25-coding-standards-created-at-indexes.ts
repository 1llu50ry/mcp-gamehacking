import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 25,
	name: "coding-standards-created-at-indexes",
	up: (db) => {
		// TASK-406: GET /api/standards?repo=…&pageSize=25 was 2288ms. The
		// dashboard list runs
		//   WHERE (repo = ? OR is_global = 1) ORDER BY created_at DESC LIMIT ?
		// plus a COUNT(*) of the same filter. The pre-existing single-column
		// indexes (idx_coding_standards_repo, idx_coding_standards_is_global)
		// each cover one OR branch, but neither covers created_at, so SQLite
		// ran a temp b-tree sort over every matching row per page request
		// (`USE TEMP B-TREE FOR ORDER BY`).
		//
		// These composites mirror the memories table's
		// idx_memories_repo_created_at (v01) pattern: the leading equality
		// column lets the OR-optimization walk each branch in created_at order
		// and drops the per-request full sort. The COUNT(*) path gets the same
		// index-scoped walk (no table scan).
		//
		// Idempotent by construction (IF NOT EXISTS) — safe on fresh DBs (v1
		// creates coding_standards) and on upgrade; the runner wraps each up()
		// in a transaction, so a crash mid-migration rolls back cleanly.
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_coding_standards_repo_created_at
				ON coding_standards(repo, created_at DESC);
			CREATE INDEX IF NOT EXISTS idx_coding_standards_is_global_created_at
				ON coding_standards(is_global, created_at DESC);
		`);
		logger.info(
			"[Migration] Added idx_coding_standards_repo_created_at (repo, created_at DESC) + idx_coding_standards_is_global_created_at (is_global, created_at DESC)"
		);
	}
};
