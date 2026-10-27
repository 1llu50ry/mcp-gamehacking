import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 30,
	name: "exploration-observations",
	up: (db) => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS exploration_observations (
				id TEXT PRIMARY KEY,
				owner TEXT NOT NULL,
				repo TEXT NOT NULL,
				subject TEXT NOT NULL,
				fact TEXT NOT NULL,
				confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
				task_id TEXT,
				agent TEXT,
				identity_hash TEXT NOT NULL,
				freshness TEXT NOT NULL DEFAULT 'valid' CHECK (freshness IN ('valid', 'stale', 'unverifiable')),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				UNIQUE (owner, repo, identity_hash)
			);
			CREATE TABLE IF NOT EXISTS exploration_evidence (
				id TEXT PRIMARY KEY,
				observation_id TEXT NOT NULL REFERENCES exploration_observations(id) ON DELETE CASCADE,
				file_path TEXT NOT NULL,
				symbol_id TEXT,
				start_line INTEGER,
				end_line INTEGER,
				created_at TEXT NOT NULL,
				UNIQUE (observation_id, file_path, symbol_id, start_line, end_line)
			);
			CREATE INDEX IF NOT EXISTS idx_exploration_obs_scope_subject
				ON exploration_observations(owner, repo, subject);
			CREATE INDEX IF NOT EXISTS idx_exploration_obs_scope_task
				ON exploration_observations(owner, repo, task_id);
			CREATE INDEX IF NOT EXISTS idx_exploration_obs_scope_confidence
				ON exploration_observations(owner, repo, confidence DESC);
			CREATE INDEX IF NOT EXISTS idx_exploration_evidence_file
				ON exploration_evidence(file_path, observation_id);
			CREATE INDEX IF NOT EXISTS idx_exploration_evidence_symbol
				ON exploration_evidence(symbol_id, observation_id);
		`);
		logger.info("[Migration] Added structured exploration observations and normalized evidence");
	}
};
