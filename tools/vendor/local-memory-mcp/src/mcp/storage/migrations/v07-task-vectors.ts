import { TABLE_TASKS } from "../../utils/constants";
import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 7,
	name: "task-vectors",
	up: (db) => {
		db.exec(`
				CREATE TABLE IF NOT EXISTS task_vectors (
					task_id TEXT PRIMARY KEY,
					vector TEXT NOT NULL,
					updated_at TEXT NOT NULL DEFAULT (datetime('now')),
					FOREIGN KEY (task_id) REFERENCES ${TABLE_TASKS}(id) ON DELETE CASCADE
				);
			`);
		logger.info("[Migration] Added task_vectors table");
	}
};
