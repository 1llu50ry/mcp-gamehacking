import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 31,
	name: "observation-freshness",
	up: (db) => {
		const symbolColumns = new Set(
			(db.prepare("PRAGMA table_info(codebase_symbols)").all() as Array<{ name: string }>).map(({ name }) => name)
		);
		if (!symbolColumns.has("source_fingerprint")) {
			db.exec("ALTER TABLE codebase_symbols ADD COLUMN source_fingerprint TEXT");
		}
		const columns = new Set(
			(db.prepare("PRAGMA table_info(exploration_evidence)").all() as Array<{ name: string }>).map(({ name }) => name)
		);
		for (const [name, definition] of [
			["file_checksum", "TEXT"],
			["symbol_fingerprint", "TEXT"],
			["indexed_at", "TEXT"],
			["commit_sha", "TEXT"]
		] as const) {
			if (!columns.has(name)) db.exec(`ALTER TABLE exploration_evidence ADD COLUMN ${name} ${definition}`);
		}
		const observationColumns = new Set(
			(db.prepare("PRAGMA table_info(exploration_observations)").all() as Array<{ name: string }>).map(
				({ name }) => name
			)
		);
		if (!observationColumns.has("stale_reason")) {
			db.exec("ALTER TABLE exploration_observations ADD COLUMN stale_reason TEXT");
		}
		if (!observationColumns.has("last_verified_at")) {
			db.exec("ALTER TABLE exploration_observations ADD COLUMN last_verified_at TEXT");
		}
		if (!observationColumns.has("superseded_by")) {
			db.exec(
				"ALTER TABLE exploration_observations ADD COLUMN superseded_by TEXT REFERENCES exploration_observations(id)"
			);
		}
		db.exec(`
			CREATE INDEX IF NOT EXISTS idx_exploration_obs_scope_freshness
				ON exploration_observations(owner, repo, freshness, confidence DESC);
		`);
		logger.info("[Migration] Added exploration evidence fingerprints and freshness lifecycle metadata");
	}
};
