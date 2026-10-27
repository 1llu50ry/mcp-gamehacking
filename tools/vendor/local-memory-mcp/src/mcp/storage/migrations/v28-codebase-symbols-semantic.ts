import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 28,
	name: "codebase-symbols-semantic",
	up: (db) => {
		// Issue #89 (TASK-015, semantic-graph epic P1): extend codebase_symbols
		// with an OPTIONAL semantic-signature enrichment layer driven by the
		// TypeScript compiler API. The tree-sitter structural `signature` is the
		// primary indexer and is NEVER overwritten — these three columns carry
		// type-inferred signatures (return/param/property types) as a separate,
		// enrichment-only channel that degrades gracefully when no tsconfig or
		// TS deps are available.
		//
		// Exactly three nullable columns are added:
		//   - semantic_signature:  type-inferred signature inferred by the enricher
		//                          (e.g. `(id: number) => Promise<User>`). Null when
		//                          enrichment skipped/unavailable or inference failed.
		//   - semantic_source:     provenance of semantic_signature — "typescript-compiler"
		//                          when inferred via the TS compiler API, "adapter" for a
		//                          thin adapter fallback. Null when no semantic signature.
		//   - semantic_updated_at: ISO timestamp of the last successful enrichment pass
		//                          (used for incremental invalidation). Null until enriched.
		//
		// All three are plain TEXT with NO index and NO CHECK constraint. The
		// structural `signature` column keeps its contract untouched, so every
		// caller that round-trips `signature` (TRACE / SEARCH / FILE / FTS) is
		// unaffected. Semantic fields are surfaced OPT-IN (the `includeSemantic`
		// flag on codebase-read) and are additive on the symbol JSON envelope, so
		// existing clients are never broken.
		//
		// Idempotency mirrors the v27 column pattern: PRAGMA table_info guards
		// each ALTER TABLE ADD COLUMN, so re-running after a crash mid-migration
		// is a no-op. The migration runner wraps up() in a transaction, so a
		// crash rolls back cleanly.
		const symCols = db.prepare("PRAGMA table_info(codebase_symbols)").all() as Array<{ name: string }>;
		const existing = new Set(symCols.map((col) => col.name));
		const columns: Array<[string, string]> = [
			["semantic_signature", "semantic_signature TEXT"],
			["semantic_source", "semantic_source TEXT"],
			["semantic_updated_at", "semantic_updated_at TEXT"]
		];
		for (const [name, ddl] of columns) {
			if (!existing.has(name)) {
				db.prepare(`ALTER TABLE codebase_symbols ADD COLUMN ${ddl}`).run();
			}
		}
		logger.info("[Migration] Extended codebase_symbols with semantic-signature columns (issue #89)");
	}
};
