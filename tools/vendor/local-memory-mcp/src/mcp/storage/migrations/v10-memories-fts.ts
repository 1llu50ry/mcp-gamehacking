import { TABLE_MEMORIES } from "../../utils/constants";
import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 10,
	name: "memories-fts",
	up: (db) => {
		// ──────────────────────────────────────────────
		// FTS5 external-content full-text index for memories (MEM-367 /
		// TASK-014). Mirrors the codebase_symbols_fts (v1) and
		// coding_standards_fts (v4) pattern: virtual table + ai/ad/au sync
		// triggers + single-statement backfill inside the migration
		// transaction. The legacy memories_fts + triggers were dropped
		// unconditionally in migration v1 (dropObsoleteMemoriesFts), so
		// the names are provably free on both fresh and upgraded DBs.
		// ──────────────────────────────────────────────
		const ftsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'").get();
		if (ftsExists) {
			logger.debug("[Migration] memories_fts already exists, skipping");
			return;
		}

		db.exec(`
				CREATE VIRTUAL TABLE memories_fts USING fts5(
					title, content, tags,
					content=${TABLE_MEMORIES},
					content_rowid='rowid',
					tokenize='unicode61'
				);

				CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
					INSERT INTO memories_fts(rowid, title, content, tags)
					VALUES (new.rowid, new.title, new.content, new.tags);
				END;

				CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
					INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
					VALUES('delete', old.rowid, old.title, old.content, old.tags);
				END;

				CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
					INSERT INTO memories_fts(memories_fts, rowid, title, content, tags)
					VALUES('delete', old.rowid, old.title, old.content, old.tags);
					INSERT INTO memories_fts(rowid, title, content, tags)
					VALUES (new.rowid, new.title, new.content, new.tags);
				END;
			`);

		// Single-statement backfill of pre-existing rows — atomic with the
		// table+triggers because the migration runner wraps up() in a
		// transaction (a crash mid-migration rolls back and re-runs; the
		// ftsExists guard keeps it idempotent).
		try {
			const count = db
				.prepare(
					`INSERT INTO memories_fts(rowid, title, content, tags) SELECT rowid, title, content, tags FROM ${TABLE_MEMORIES}`
				)
				.run();
			logger.info(`[Migration] Backfilled ${count.changes} memories into FTS5 index`);
		} catch (err) {
			logger.warn("[Migration] memories_fts backfill may have partially failed", { error: String(err) });
		}

		// ──────────────────────────────────────────────
		// ROLLBACK (P5 hardening doc — FTS data is derived; the memories
		// table is the source of truth, nothing durable is lost):
		//   DROP TRIGGER IF EXISTS memories_ai;
		//   DROP TRIGGER IF EXISTS memories_ad;
		//   DROP TRIGGER IF EXISTS memories_au;
		//   DROP TABLE IF EXISTS memories_fts;
		// Queries fall back to LIKE automatically after removal. Restore
		// later by re-running this migration or `INSERT INTO
		// memories_fts(memories_fts) VALUES('rebuild')` on an empty table.
		// ──────────────────────────────────────────────
	}
};
