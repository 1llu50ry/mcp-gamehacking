import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 6,
	name: "codebase-symbol-vectors",
	up: (db) => {
		db.exec(`
				CREATE TABLE IF NOT EXISTS codebase_symbol_vectors (
					symbol_id TEXT NOT NULL REFERENCES codebase_symbols(id) ON DELETE CASCADE,
					vector TEXT NOT NULL,
					updated_at TEXT NOT NULL DEFAULT (datetime('now')),
					PRIMARY KEY (symbol_id)
				);
			`);
		logger.info("[Migration] Added codebase_symbol_vectors table");
	}
};
