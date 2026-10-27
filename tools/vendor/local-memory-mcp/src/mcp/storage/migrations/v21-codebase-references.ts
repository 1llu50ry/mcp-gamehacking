import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 21,
	name: "codebase-references",
	up: (db) => {
		// Issue #64 (TASK-236): index call sites so `trace_symbol` can return the
		// callers that reference a definition, sourced from the parse pipeline
		// (visitors emit call/instantiation/import references) instead of the
		// lossy in-memory doc_comment/signature substring scan.
		//
		// The table is a denormalized edge table keyed by CALLER FILE — not by
		// an FK to codebase_symbols/codebase_files — so reference rows are
		// replaced wholesale per file on re-parse (`deleteReferencesByFile` +
		// bulk insert within the same batch transaction as the symbols).
		// Persistence mirrors the codebase_symbols pattern: UUID `id`, `repo`
		// scoping, `kind` taxonomy ('call' | 'instantiation' | 'import'), and
		// `caller_line`/`caller_name` for the call site. There is intentionally
		// NO FK to codebase_files: a file's references must be removable
		// independently (a def is never required to pre-exist the caller), and
		// FK cascade bookkeeping buys nothing here since both sides are deleted
		// in the same indexing transaction.
		//
		// Two indexes serve the read + write workloads:
		// - idx_refs_repo_symbol (repo, symbol_name) — traceSymbol looks up
		//   all callers of an exact symbol in a repo.
		// - idx_refs_repo_file (repo, caller_file) — the writer deletes refs by
		//   caller file on re-parse/cleanup without a full scan.
		//
		// Idempotent by construction (CREATE TABLE IF NOT EXISTS /
		// CREATE INDEX IF NOT EXISTS) — safe on fresh DBs and on upgrade; the
		// runner wraps each up() in a transaction, so a crash mid-migration
		// rolls back cleanly.
		db.exec(`
			CREATE TABLE IF NOT EXISTS codebase_references (
				id TEXT PRIMARY KEY,
				repo TEXT NOT NULL,
				symbol_name TEXT NOT NULL,
				caller_file TEXT NOT NULL,
				caller_line INTEGER,
				caller_name TEXT,
				kind TEXT NOT NULL,
				created_at TEXT
			)
		`);
		db.exec("CREATE INDEX IF NOT EXISTS idx_refs_repo_symbol ON codebase_references(repo, symbol_name)");
		db.exec("CREATE INDEX IF NOT EXISTS idx_refs_repo_file ON codebase_references(repo, caller_file)");
		logger.info("[Migration] Added codebase_references table + (repo,symbol_name)/(repo,caller_file) indexes");
	}
};
