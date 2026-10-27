import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 27,
	name: "codebase-references-import-metadata",
	up: (db) => {
		// Issue #83 (TASK-009, semantic-graph epic P0): extend codebase_references
		// with import metadata so 'import' edges can map a LOCAL BINDING back to
		// its canonical exported symbol and file. This builds on the v26 type-
		// reference foundation (#82) — the same row shape now carries enough
		// information to resolve aliased imports at query time (ADR-002:
		// name-based resolution, no LSP / type checker at parse time).
		//
		// Exactly four nullable TEXT columns are added:
		//   - local_name:       the LOCAL binding name in the importing file
		//                       (`import { User as DomainUser }` → 'DomainUser').
		//                       For default imports the binding is the imported
		//                       identifier (`import Foo from './foo'` → 'Foo').
		//   - imported_name:    the EXPORTED name as written in the module
		//                       (`import { User as DomainUser }` → 'User';
		//                       `import Foo from './foo'` → 'default';
		//                       `import * as ns from './m'` → '*');
		//                       NULL for side-effect imports.
		//   - module_specifier: the raw source as written in the import statement
		//                       (`'@/domain/user'`, `'./user'`) — never resolved.
		//   - import_kind:      'default' | 'named' | 'namespace' | 'side-effect'
		//                       | NULL (NULL = non-import reference kinds).
		//
		// The pre-existing `symbol_name` column keeps its contract for 'import'
		// rows (the imported name — ADR-002 name-based model), so callers that
		// aggregate `symbol_name` across kinds (dead-code hotspots, TRACE
		// reference lookup, KG codebase domain) are unaffected. `local_name`
		// disambiguates the LOCAL alias (`DomainUser` vs canonical `User`).
		//
		// `target_file` / `target_symbol_id` (v23) are populated at PARSE time
		// by the visitor when the module specifier resolves to an indexed file
		// and the imported name maps to a same-file exported symbol; both stay
		// null for unresolved imports (the acceptance criteria require
		// ambiguous/unresolved imports to remain visible with null targets —
		// the rows are never dropped).
		//
		// All four columns are plain TEXT with NO index and NO CHECK constraint,
		// mirroring the v23/v26 stance: TRACE reads by (repo, symbol_name) via
		// the existing idx_refs_repo_symbol index, and the import metadata is a
		// query-time filter, not a referential gate (the DB stays flat — the
		// typed unions live in the code).
		//
		// Idempotency mirrors the v13/v23/v26 column pattern: PRAGMA table_info
		// guards each ALTER TABLE ADD COLUMN, so re-running after a crash
		// mid-migration is a no-op. The migration runner wraps up() in a
		// transaction, so a crash rolls back cleanly.
		const refCols = db.prepare("PRAGMA table_info(codebase_references)").all() as Array<{ name: string }>;
		const existing = new Set(refCols.map((col) => col.name));
		const columns: Array<[string, string]> = [
			["local_name", "local_name TEXT"],
			["imported_name", "imported_name TEXT"],
			["module_specifier", "module_specifier TEXT"],
			["import_kind", "import_kind TEXT"]
		];
		for (const [name, ddl] of columns) {
			if (!existing.has(name)) {
				db.prepare(`ALTER TABLE codebase_references ADD COLUMN ${ddl}`).run();
			}
		}
		logger.info("[Migration] Extended codebase_references with import metadata columns (issue #83)");
	}
};
