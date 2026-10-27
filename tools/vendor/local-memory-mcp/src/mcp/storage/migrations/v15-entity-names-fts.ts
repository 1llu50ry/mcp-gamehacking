import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 15,
	name: "entity-names-fts",
	up: (db) => {
		// ──────────────────────────────────────────────
		// OPT-PERF-04: replace the unbounded `INSTR(?, name) > 0` scan over
		// EVERY entity row (task KG-context enrichment, getEntityNamesByText
		// — ran on every task-read) with an FTS5 token index over
		// entities.name. The read path now tokenizes the search text and
		// issues an index-served MATCH lookup instead of a full-table scan.
		//
		// STANDALONE FTS5 (no content=): `repo` is declared UNINDEXED so it
		// can be filtered by equality (`WHERE repo = ? AND ... MATCH ?`)
		// while `name` stays full-text indexed. Unlike the memories_fts /
		// coding_standards_fts external-content tables (v10/v4), the FTS5
		// special 'delete' command is NOT supported for tables with
		// UNINDEXED columns — the sync triggers therefore use plain
		// `DELETE FROM ... WHERE rowid = old.rowid` + re-INSERT for UPDATE,
		// and the table keeps its own copy of name+repo.
		//
		// Sync strategy mirrors the v10/v4 FTS pattern: AFTER INSERT syncs,
		// AFTER UPDATE deletes + recreates, AFTER DELETE removes. Every
		// write path (entity methods, dashboard raw inserts, orphan
		// sweeps) lands on the entities table, so the triggers keep the
		// index consistent without touching any call site. DELETE is
		// cascade-safe: the _ad trigger fires per deleted entity row regardless
		// of the delete's origin. Migration v33 later widens identity to
		// `(name, repo)` and recreates this FTS table and its triggers.
		//
		// Matching semantics (documented in getEntityNamesByText): FTS5
		// unicode61 tokenization matches NAME TOKENS against search-text
		// TOKENS (any-token overlap), replacing the old contiguous
		// substring (INSTR) rule. Single-token entity names — the common
		// case ("JWT", "KG", "SQLiteStore") — behave identically when the
		// name appears as a token in task text; multi-token names are
		// matched by ANY token overlap (more permissive). Both paths are
		// bounded by KG_MAX_CONTEXT_ENTITIES, so worst case an extra
		// loosely-related entity appears within the cap — acceptable for
		// best-effort context enrichment.
		//
		// ROLLBACK: DROP TRIGGER IF EXISTS entity_names_fts_ai;
		//   DROP TRIGGER IF EXISTS entity_names_fts_au;
		//   DROP TRIGGER IF EXISTS entity_names_fts_ad;
		//   DROP TABLE IF EXISTS entity_names_fts;
		// getEntityNamesByText falls back to a LIMIT-bounded INSTR scan
		// when the index is absent. Restore later by re-running this
		// migration or `INSERT INTO entity_names_fts(entity_names_fts)
		// VALUES('rebuild')`.
		// ──────────────────────────────────────────────
		const ftsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_names_fts'").get();
		if (ftsExists) {
			logger.debug("[Migration] entity_names_fts already exists, skipping");
			return;
		}

		db.exec(`
				CREATE VIRTUAL TABLE entity_names_fts USING fts5(
					name, repo UNINDEXED,
					tokenize='unicode61'
				);

				CREATE TRIGGER entity_names_fts_ai AFTER INSERT ON entities BEGIN
					INSERT INTO entity_names_fts(rowid, name, repo) VALUES (new.rowid, new.name, new.repo);
				END;

				CREATE TRIGGER entity_names_fts_au AFTER UPDATE ON entities BEGIN
					DELETE FROM entity_names_fts WHERE rowid = old.rowid;
					INSERT INTO entity_names_fts(rowid, name, repo) VALUES (new.rowid, new.name, new.repo);
				END;

				CREATE TRIGGER entity_names_fts_ad AFTER DELETE ON entities BEGIN
					DELETE FROM entity_names_fts WHERE rowid = old.rowid;
				END;
			`);

		// Single-statement backfill of pre-existing rows — atomic with the
		// table+triggers because the migration runner wraps up() in a
		// transaction (a crash mid-migration rolls back and re-runs; the
		// ftsExists guard keeps it idempotent). A backfill failure MUST
		// propagate: swallowing it here would commit a PARTIAL index (the
		// runner's transaction still records the migration as applied),
		// silently degrading reads to partial matches with no INSTR
		// fallback. With the throw, the whole transaction rolls back and
		// the migration re-runs on next startup (self-healing).
		const count = db
			.prepare("INSERT INTO entity_names_fts(rowid, name, repo) SELECT rowid, name, repo FROM entities")
			.run();
		logger.info(`[Migration] Backfilled ${count.changes} entity name(s) into FTS5 index`);
	}
};
