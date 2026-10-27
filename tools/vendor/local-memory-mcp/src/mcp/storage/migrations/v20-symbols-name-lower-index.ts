import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 20,
	name: "symbols-name-lower-index",
	up: (db) => {
		// Issue #63 (TASK-226): case-insensitive prefix-search index on symbol
		// names (autocomplete, e.g. `getUser*`).
		//
		// idx_symbols_name_lower ON codebase_symbols(LOWER(name), repo, kind)
		// lets a prefix query on a BINARY-collated `name` column be served by an
		// index walk. The existing plain indexes (idx_cs_name, idx_cs_repo_name)
		// can NOT serve a prefix scan of a lowercased name — LIKE/range against
		// `name` with default BINARY collation never range-scans (verified on
		// SQLite 3.53: `name LIKE 'getu%'` covering-scans idx_cs_name), and
		// `LOWER(name) LIKE 'getu%'` full-scans because the LIKE optimization
		// requires a plain column (not an expression) on the left-hand side.
		// This expression index makes `LOWER(name)` itself range-scanable.
		//
		// Consumption contract (see CodebaseSymbolEntity.searchByPrefix):
		// the prefix must be expressed as an exclusive range on the lowercased
		// name —
		//   WHERE LOWER(name) >= lower(?prefix)
		//     AND LOWER(name) <  lower(?prefix) || X'...'   -- prefix + U+FFFF
		// — NOT as `LOWER(name) LIKE 'prefix%'`, which full-scans. EXPLAIN
		// QUERY PLAN on the range form reports `USING INDEX
		// idx_symbols_name_lower`; the trailing repo/kind columns additionally
		// cover repo-scoped prefix filters.
		//
		// DEVIATION from issue #63: the issue also proposed
		//   idx_symbols_parent ON codebase_symbols(repo, parent_name, kind)
		// but codebase_symbols has NO `parent_name` column — parent/child
		// relations use `parent_symbol_id`, which is already indexed by
		// idx_cs_parent (v01) and covered in composite form by
		// idx_cs_repo_exported_parent (v17). An index on a non-existent column
		// would fail to create, so that part of the proposal is deliberately
		// NOT implemented.
		//
		// Idempotent by construction (IF NOT EXISTS) — safe on fresh DBs (v1
		// creates codebase_symbols) and on upgrade; the runner wraps each up()
		// in a transaction, so a crash mid-migration rolls back cleanly.
		db.exec("CREATE INDEX IF NOT EXISTS idx_symbols_name_lower ON codebase_symbols(LOWER(name), repo, kind)");
		logger.info("[Migration] Added idx_symbols_name_lower (LOWER(name), repo, kind)");
	}
};
