import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 38,
	name: "bug-reports",
	up: (db) => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS bug_reports (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				fingerprint TEXT NOT NULL,
				source TEXT NOT NULL,
				severity TEXT NOT NULL DEFAULT 'error',
				message TEXT NOT NULL,
				stack TEXT,
				context TEXT,
				runtime TEXT,
				count INTEGER NOT NULL DEFAULT 1,
				first_seen_at TEXT NOT NULL,
				last_seen_at TEXT NOT NULL,
				resolved_at TEXT
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_bug_reports_fingerprint ON bug_reports(fingerprint);
			CREATE INDEX IF NOT EXISTS idx_bug_reports_last_seen ON bug_reports(last_seen_at);
			CREATE INDEX IF NOT EXISTS idx_bug_reports_source ON bug_reports(source);
			CREATE INDEX IF NOT EXISTS idx_bug_reports_resolved ON bug_reports(resolved_at);
		`);
		logger.info("[Migration] Added local bug-report capture table");
	}
};
