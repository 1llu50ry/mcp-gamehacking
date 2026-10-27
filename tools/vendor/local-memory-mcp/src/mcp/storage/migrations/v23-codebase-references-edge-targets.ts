import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 23,
	name: "codebase-references-edge-targets",
	up: (db) => {
		// Phase 1.1 (TASK-299, decision 2026-08-09): extend codebase_references
		// (v21) into a generalized EDGE table instead of creating a new one.
		// Two edge families now share the table:
		//   1. Call-site edges (existing) — call | instantiation | import, located
		//      by caller_file/caller_line/caller_name inside the CALLER file.
		//   2. Heritage edges (Wave 1) — extends | implements, same row shape:
		//      symbol_name = the referenced base/interface name, caller_file =
		//      the file declaring the derived type, caller_line = the class
		//      declaration line.
		//
		// Exactly two nullable columns are added (minimal set — the `kind`
		// column stays the single enum-driven taxonomy, extended by the TS
		// union; no edge_kind, no scope_line/scope_col — caller_line already
		// locates the edge site):
		// - target_file: file path of the referenced (target) symbol when
		//   resolvable at parse time (cross-file import/heritage edges).
		// - target_symbol_id: codebase_symbols(id) when resolvable.
		//
		// target_symbol_id is deliberately a plain TEXT pointer with NO FK
		// constraint, mirroring v21's no-FK stance: reference rows are replaced
		// wholesale per caller file, symbols are deleted independently (a
		// caller/derived row is never required to pre-exist its target), and
		// ADR-002 name-based resolution (no LSP) makes the id a best-effort
		// pointer, not a referential guarantee.
		//
		// No (repo, kind) index is added: no current read filters by kind
		// (TRACE uses the existing (repo, symbol_name) index). If a Wave 1
		// traversal or KG population (TASK-293) introduces kind-filtered
		// queries, it ships as its own small additive migration.
		//
		// Idempotency mirrors the v13 branch-column pattern: PRAGMA table_info
		// guards each ALTER TABLE ADD COLUMN, so re-running after a crash
		// mid-migration is a no-op. The migration runner wraps up() in a
		// transaction, so a crash rolls back cleanly.
		const refCols = db.prepare("PRAGMA table_info(codebase_references)").all() as Array<{ name: string }>;
		if (!refCols.some((col) => col.name === "target_file")) {
			db.prepare("ALTER TABLE codebase_references ADD COLUMN target_file TEXT").run();
		}
		if (!refCols.some((col) => col.name === "target_symbol_id")) {
			db.prepare("ALTER TABLE codebase_references ADD COLUMN target_symbol_id TEXT").run();
		}
		logger.info("[Migration] Extended codebase_references with target_file/target_symbol_id (edge targets, Phase 1.1)");
	}
};
