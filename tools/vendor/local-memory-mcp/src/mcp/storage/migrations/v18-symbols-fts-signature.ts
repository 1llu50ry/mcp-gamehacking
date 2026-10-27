import { logger } from "../../utils/logger";
import type { Migration } from "./index";

/**
 * v18 — rebuild `codebase_symbols_fts` with the `signature` column
 * (GitHub #79 / TASK-227).
 *
 * PROBLEM: the v1 FTS5 table indexes only `name` + `doc_comment`; signatures
 * (e.g. `fn foo(x: u32) -> bool`) are not searchable.
 *
 * FTS5 cannot add a column to an existing content-backed virtual table (no
 * ALTER support), so the index must be rebuilt. Strategy (validated against
 * SQLite 3.53):
 *
 *   1. Drop the v1 ai/ad/au triggers first — they reference the old FTS table,
 *      so dropping the table while they exist would leave dangling triggers.
 *   2. Create `codebase_symbols_fts_v2` (name, doc_comment, signature,
 *      content='codebase_symbols', content_rowid='rowid') and backfill it from
 *      the content table. No triggers are created against the v2 name yet.
 *   3. Drop the old `codebase_symbols_fts` (safe for external-content tables:
 *      dropping the FTS index never touches content rows) and RENAME v2 into
 *      its place. The `content=` reference is stored as a plain table-name
 *      string, so it still resolves to `codebase_symbols` after the rename.
 *   4. Recreate the ai/ad/au triggers AFTER the rename, targeting the final
 *      name. SQLite does NOT reliably rewrite FTS5 trigger bodies when the
 *      FTS table is renamed, so triggers created against the pre-rename name
 *      would be left pointing at the dropped `_v2` table.
 *
 * The runner wraps `up()` in a transaction, so a crash mid-migration rolls
 * back atomically; every statement is guarded by `DROP ... IF EXISTS`, making
 * the migration re-runnable against a fresh DB, a v1..v17 upgrade, or a
 * crash-retry re-run.
 */
export const migration: Migration = {
	version: 18,
	name: "symbols-fts-signature",
	up: (db) => {
		db.exec(`
			DROP TRIGGER IF EXISTS codebase_symbols_ai;
			DROP TRIGGER IF EXISTS codebase_symbols_ad;
			DROP TRIGGER IF EXISTS codebase_symbols_au;
			DROP TABLE IF EXISTS codebase_symbols_fts_v2;

			CREATE VIRTUAL TABLE codebase_symbols_fts_v2 USING fts5(
				name, doc_comment, signature,
				content='codebase_symbols', content_rowid='rowid'
			);
		`);

		const backfilled = db
			.prepare(
				"INSERT INTO codebase_symbols_fts_v2(rowid, name, doc_comment, signature) SELECT rowid, name, doc_comment, signature FROM codebase_symbols"
			)
			.run();

		db.exec(`
			DROP TABLE IF EXISTS codebase_symbols_fts;
			ALTER TABLE codebase_symbols_fts_v2 RENAME TO codebase_symbols_fts;

			CREATE TRIGGER codebase_symbols_ai AFTER INSERT ON codebase_symbols BEGIN
				INSERT INTO codebase_symbols_fts(rowid, name, doc_comment, signature)
				VALUES (new.rowid, new.name, new.doc_comment, new.signature);
			END;

			CREATE TRIGGER codebase_symbols_ad AFTER DELETE ON codebase_symbols BEGIN
				INSERT INTO codebase_symbols_fts(codebase_symbols_fts, rowid, name, doc_comment, signature)
				VALUES('delete', old.rowid, old.name, old.doc_comment, old.signature);
			END;

			CREATE TRIGGER codebase_symbols_au AFTER UPDATE ON codebase_symbols BEGIN
				INSERT INTO codebase_symbols_fts(codebase_symbols_fts, rowid, name, doc_comment, signature)
				VALUES('delete', old.rowid, old.name, old.doc_comment, old.signature);
				INSERT INTO codebase_symbols_fts(rowid, name, doc_comment, signature)
				VALUES (new.rowid, new.name, new.doc_comment, new.signature);
			END;
		`);

		logger.info(
			`[Migration] Rebuilt codebase_symbols_fts with signature column, backfilled ${backfilled.changes} rows`
		);
	}
};
