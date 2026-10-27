import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 26,
	name: "codebase-references-role",
	up: (db) => {
		// Issue #82 (TASK-008, semantic-graph epic P0): extend codebase_references
		// (v21) with a `role` column so type-only dependency edges (kind='type')
		// can distinguish HOW a symbol is used as a type: parameter / return /
		// property / field / alias / generic / constraint / union / intersection.
		//
		// The `kind` column remains the single enum-driven taxonomy — it gains
		// the 'type' value (extended by the TS union in codebase-reference.ts
		// + language-visitor.ts). `role` is a NEW nullable column holding the
		// per-edge relation role for 'type' kinds; it is NULL for all legacy
		// kinds (call/instantiation/import/extends/implements) and for type
		// edges whose role was not determinable at parse time.
		//
		// Exactly one nullable column is added:
		// - role: relation role for 'type' edges ('parameter' | 'return' |
		//   'property' | 'field' | 'alias' | 'generic' | 'constraint' | 'union'
		//   | 'intersection'), else NULL.
		//
		// role is a plain TEXT with NO index and NO CHECK constraint, mirroring
		// v23's target_file/target_symbol_id stance: TRACE/aggregation reads by
		// (repo, symbol_name) via the existing idx_refs_repo_symbol index, and
		// the role value is a query-time filter, not a referential/enum gate
		// (the DB stays flat — the typed union lives in the code).
		//
		// Idempotency mirrors the v13/v23 column pattern: PRAGMA table_info
		// guards the ALTER TABLE ADD COLUMN, so re-running after a crash
		// mid-migration is a no-op. The migration runner wraps up() in a
		// transaction, so a crash rolls back cleanly.
		const refCols = db.prepare("PRAGMA table_info(codebase_references)").all() as Array<{ name: string }>;
		if (!refCols.some((col) => col.name === "role")) {
			db.prepare("ALTER TABLE codebase_references ADD COLUMN role TEXT").run();
		}
		logger.info("[Migration] Extended codebase_references with role column (type-reference edges, issue #82)");
	}
};
