import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 19,
	name: "symbols-file-path-index",
	up: (db) => {
		// Issue #75 (TASK-224): add a plain single-column index on
		// codebase_symbols(file_path) for un-scoped filters, e.g.
		//   WHERE file_path = ?   (no repo predicate)
		// The existing idx_cs_repo_file(repo, file_path) only covers queries
		// scoped to a repo; a bare file_path filter can't use it (the leading
		// repo column makes it unusable), so it would scan every row. This
		// index lets the un-scoped filter walk a single index instead.
		//
		// Idempotent by construction (IF NOT EXISTS) — safe on fresh DBs (v1
		// creates codebase_symbols) and on upgrade; the runner wraps each up()
		// in a transaction, so a crash mid-migration rolls back cleanly.
		db.exec("CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON codebase_symbols(file_path)");
		logger.info("[Migration] Added idx_symbols_file_path (file_path)");
	}
};
