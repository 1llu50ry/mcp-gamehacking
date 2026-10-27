import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 32,
	name: "reuse-telemetry-aggregates",
	up: (db) => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS reuse_telemetry_hourly (
				owner TEXT NOT NULL,
				repo TEXT NOT NULL,
				bucket TEXT NOT NULL,
				metric TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT '',
				count INTEGER NOT NULL DEFAULT 0,
				value REAL NOT NULL DEFAULT 0,
				PRIMARY KEY (owner, repo, bucket, metric, source)
			);
			CREATE INDEX IF NOT EXISTS idx_reuse_telemetry_bucket
				ON reuse_telemetry_hourly(bucket);
			CREATE INDEX IF NOT EXISTS idx_reuse_telemetry_scope_bucket
				ON reuse_telemetry_hourly(owner, repo, bucket);
		`);
		logger.info("[Migration] Added bounded hourly context-reuse telemetry aggregates");
	}
};
