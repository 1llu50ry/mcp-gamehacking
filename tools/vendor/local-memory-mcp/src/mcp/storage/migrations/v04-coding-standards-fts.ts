import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 4,
	name: "coding-standards-fts",
	up: (db) => {
		const ftsExists = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='coding_standards_fts'")
			.get();
		if (ftsExists) {
			logger.debug("[Migration] coding_standards_fts already exists, skipping");
			return;
		}

		db.exec(`
				CREATE VIRTUAL TABLE coding_standards_fts USING fts5(
					title, content, context, stack, tags,
					content='coding_standards',
					content_rowid='rowid'
				);

				CREATE TRIGGER coding_standards_ai AFTER INSERT ON coding_standards BEGIN
					INSERT INTO coding_standards_fts(rowid, title, content, context, stack, tags)
					VALUES (new.rowid, new.title, new.content, new.context, new.stack, new.tags);
				END;

				CREATE TRIGGER coding_standards_ad AFTER DELETE ON coding_standards BEGIN
					INSERT INTO coding_standards_fts(coding_standards_fts, rowid, title, content, context, stack, tags)
					VALUES('delete', old.rowid, old.title, old.content, old.context, old.stack, old.tags);
				END;

				CREATE TRIGGER coding_standards_au AFTER UPDATE ON coding_standards BEGIN
					INSERT INTO coding_standards_fts(coding_standards_fts, rowid, title, content, context, stack, tags)
					VALUES('delete', old.rowid, old.title, old.content, old.context, old.stack, old.tags);
					INSERT INTO coding_standards_fts(rowid, title, content, context, stack, tags)
					VALUES (new.rowid, new.title, new.content, new.context, new.stack, new.tags);
				END;
			`);

		// Backfill existing standards into FTS5
		try {
			const count = db
				.prepare(
					"INSERT INTO coding_standards_fts(rowid, title, content, context, stack, tags) SELECT rowid, title, content, context, stack, tags FROM coding_standards"
				)
				.run();
			logger.info(`[Migration] Backfilled ${count.changes} coding standards into FTS5 index`);
		} catch (err) {
			logger.warn("[Migration] FTS5 backfill may have partially failed", { error: String(err) });
		}
	}
};
