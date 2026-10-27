import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 17,
	name: "symbols-repo-exported-parent-index",
	up: (db) => {
		// Issue #78 (TASK-223): serve CodebaseSymbolEntity.getTopLevelExportsByRepo
		//   WHERE repo = ? AND exported = 1 AND parent_symbol_id IS NULL
		//   ORDER BY file_path, start_line LIMIT ?
		// The existing single-column indexes (idx_cs_repo_name, idx_cs_parent, …)
		// each cover one predicate; the composite (repo, exported,
		// parent_symbol_id) lets SQLite satisfy all three equality/NULL filters
		// with a single index walk instead of an OR-joined scan/sort.
		//
		// Idempotent by construction (IF NOT EXISTS) — safe on fresh DBs (v1
		// creates codebase_symbols) and on upgrade; the runner wraps each up()
		// in a transaction, so a crash mid-migration rolls back cleanly.
		db.exec(
			"CREATE INDEX IF NOT EXISTS idx_cs_repo_exported_parent ON codebase_symbols(repo, exported, parent_symbol_id)"
		);
		logger.info("[Migration] Added idx_cs_repo_exported_parent (repo, exported, parent_symbol_id)");
	}
};
