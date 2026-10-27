import { TABLE_MEMORY_SUMMARY } from "../../utils/constants";
import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 3,
	name: "fix-memory-summary-pk",
	up: (db) => {
		// Check if memory_summary already has composite PK (owner, repo)
		const cols = db.prepare(`PRAGMA table_info(${TABLE_MEMORY_SUMMARY})`).all() as Array<{
			name: string;
			pk: number;
		}>;
		const ownerPk = cols.find((c) => c.name === "owner" && c.pk > 0);

		// Only rebuild if both owner and repo are not part of PK
		if (!ownerPk) {
			// Create new table with correct composite PK
			db.exec(`
					CREATE TABLE memory_summary_v3 (
						repo TEXT NOT NULL,
						owner TEXT NOT NULL DEFAULT '',
						summary TEXT NOT NULL,
						updated_at TEXT NOT NULL,
						PRIMARY KEY (owner, repo)
					)
				`);

			// Copy existing data (handle potential owner = '' from old schema)
			db.prepare(
				`
					INSERT INTO memory_summary_v3 (repo, owner, summary, updated_at)
					SELECT repo, owner, summary, updated_at FROM ${TABLE_MEMORY_SUMMARY}
				`
			).run();

			// Swap tables
			db.exec(`DROP TABLE ${TABLE_MEMORY_SUMMARY}`);
			db.exec(`ALTER TABLE memory_summary_v3 RENAME TO ${TABLE_MEMORY_SUMMARY}`);

			logger.info("[Migration] Rebuilt memory_summary with composite PRIMARY KEY (owner, repo)");
		} else {
			logger.debug("[Migration] memory_summary already has composite PK, skipping");
		}
	}
};
