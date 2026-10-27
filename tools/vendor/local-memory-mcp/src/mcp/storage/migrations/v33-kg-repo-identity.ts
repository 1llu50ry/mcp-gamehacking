import { logger } from "../../utils/logger";
import type { Migration } from "./index";

/**
 * Rebuild the legacy global-name KG into repository-scoped identities.
 *
 * Historical rows are expanded to every `(name, repo)` scope proven by an
 * entity, observation, or relation. The original entity supplies type,
 * description, and timestamps; each scoped source supplies owner/repo. The
 * migration runs inside MigrationManager's transaction, so any copy/FK/index
 * failure restores the complete pre-v33 schema and data.
 *
 * Rollback after deployment requires restoring the pre-migration DB backup:
 * collapsing duplicate names back to a global PK is inherently lossy. Operators
 * should stop all writers and create a SQLite backup before first v33 startup.
 */
export const migration: Migration = {
	version: 33,
	name: "kg-repo-identity",
	up: (db) => {
		const pk = db.prepare("PRAGMA table_info(entities)").all() as Array<{ name: string; pk: number }>;
		if (pk.some((column) => column.name === "repo" && column.pk === 2)) {
			logger.debug("[Migration] Repository-scoped KG identity already present, skipping rebuild");
			return;
		}

		db.exec(`
			DROP TRIGGER IF EXISTS entity_names_fts_ai;
			DROP TRIGGER IF EXISTS entity_names_fts_au;
			DROP TRIGGER IF EXISTS entity_names_fts_ad;
			DROP TABLE IF EXISTS entity_names_fts;
			DROP TRIGGER IF EXISTS trg_kg_degrees_ai;
			DROP TRIGGER IF EXISTS trg_kg_degrees_ad;

			CREATE TEMP TABLE kg_entity_scopes (
				name TEXT NOT NULL,
				repo TEXT NOT NULL,
				owner TEXT NOT NULL,
				PRIMARY KEY (name, repo)
			) WITHOUT ROWID;

			INSERT OR IGNORE INTO kg_entity_scopes (name, repo, owner)
			SELECT name, repo, MIN(owner) FROM entities GROUP BY name, repo;
			INSERT OR IGNORE INTO kg_entity_scopes (name, repo, owner)
			SELECT entity_name, repo, MIN(owner) FROM observations GROUP BY entity_name, repo;
			INSERT OR IGNORE INTO kg_entity_scopes (name, repo, owner)
			SELECT from_entity, repo, MIN(owner) FROM relations GROUP BY from_entity, repo;
			INSERT OR IGNORE INTO kg_entity_scopes (name, repo, owner)
			SELECT to_entity, repo, MIN(owner) FROM relations GROUP BY to_entity, repo;

			CREATE TABLE entities_v33 (
				name TEXT NOT NULL,
				type TEXT NOT NULL DEFAULT 'unknown',
				description TEXT,
				repo TEXT NOT NULL DEFAULT '',
				owner TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (name, repo)
			);

			INSERT INTO entities_v33 (name, type, description, repo, owner, created_at, updated_at)
			SELECT s.name, COALESCE(e.type, 'unknown'), e.description, s.repo, s.owner,
			       COALESCE(e.created_at, CURRENT_TIMESTAMP), COALESCE(e.updated_at, CURRENT_TIMESTAMP)
			FROM kg_entity_scopes s LEFT JOIN entities e ON e.name = s.name;

			CREATE TABLE relations_v33 (
				from_entity TEXT NOT NULL,
				to_entity TEXT NOT NULL,
				relation_type TEXT NOT NULL,
				repo TEXT NOT NULL DEFAULT '',
				owner TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				confidence REAL NOT NULL DEFAULT 1.0,
				PRIMARY KEY (from_entity, to_entity, relation_type, repo),
				FOREIGN KEY (from_entity, repo) REFERENCES entities_v33(name, repo) ON DELETE CASCADE,
				FOREIGN KEY (to_entity, repo) REFERENCES entities_v33(name, repo) ON DELETE CASCADE
			);
			INSERT INTO relations_v33 SELECT from_entity, to_entity, relation_type, repo, owner, created_at, confidence FROM relations;

			CREATE TABLE observations_v33 (
				id TEXT PRIMARY KEY,
				entity_name TEXT NOT NULL,
				observation TEXT NOT NULL,
				repo TEXT NOT NULL DEFAULT '',
				owner TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				FOREIGN KEY (entity_name, repo) REFERENCES entities_v33(name, repo) ON DELETE CASCADE
			);
			INSERT INTO observations_v33 SELECT id, entity_name, observation, repo, owner, created_at FROM observations;

			DROP TABLE observations;
			DROP TABLE relations;
			DROP TABLE entities;
			ALTER TABLE entities_v33 RENAME TO entities;
			ALTER TABLE relations_v33 RENAME TO relations;
			ALTER TABLE observations_v33 RENAME TO observations;
			DROP TABLE kg_entity_scopes;

			CREATE INDEX idx_entities_type ON entities(type);
			CREATE INDEX idx_entities_repo ON entities(repo);
			CREATE INDEX idx_relations_to ON relations(to_entity);
			CREATE INDEX idx_relations_repo ON relations(repo);
			CREATE INDEX idx_relations_repo_from_to ON relations(repo, from_entity, to_entity);
			CREATE INDEX idx_relations_repo_to ON relations(repo, to_entity);
			CREATE INDEX idx_relations_created_at ON relations(created_at);
			CREATE INDEX idx_observations_entity ON observations(entity_name);
			CREATE INDEX idx_observations_repo ON observations(repo);
			CREATE INDEX idx_observations_created_at ON observations(created_at);
			CREATE INDEX idx_observations_observation ON observations(observation);
			CREATE UNIQUE INDEX idx_observations_dedup ON observations(entity_name, observation, repo);

			CREATE VIRTUAL TABLE entity_names_fts USING fts5(name, repo UNINDEXED, tokenize='unicode61');
			CREATE TRIGGER entity_names_fts_ai AFTER INSERT ON entities BEGIN
				INSERT INTO entity_names_fts(rowid, name, repo) VALUES (new.rowid, new.name, new.repo);
			END;
			CREATE TRIGGER entity_names_fts_au AFTER UPDATE ON entities BEGIN
				DELETE FROM entity_names_fts WHERE rowid = old.rowid;
				INSERT INTO entity_names_fts(rowid, name, repo) VALUES (new.rowid, new.name, new.repo);
			END;
			CREATE TRIGGER entity_names_fts_ad AFTER DELETE ON entities BEGIN
				DELETE FROM entity_names_fts WHERE rowid = old.rowid;
			END;
			INSERT INTO entity_names_fts(rowid, name, repo) SELECT rowid, name, repo FROM entities;

			DELETE FROM kg_degrees;
			INSERT INTO kg_degrees (repo, node, degree)
			SELECT repo, from_entity, COUNT(*) FROM relations GROUP BY repo, from_entity;
			INSERT INTO kg_degrees (repo, node, degree)
			SELECT repo, to_entity, COUNT(*) FROM relations GROUP BY repo, to_entity
			ON CONFLICT(repo, node) DO UPDATE SET degree = kg_degrees.degree + excluded.degree;
			CREATE TRIGGER trg_kg_degrees_ai AFTER INSERT ON relations BEGIN
				INSERT INTO kg_degrees (repo, node, degree) VALUES (NEW.repo, NEW.from_entity, 1)
				ON CONFLICT(repo, node) DO UPDATE SET degree = kg_degrees.degree + 1;
				INSERT INTO kg_degrees (repo, node, degree) VALUES (NEW.repo, NEW.to_entity, 1)
				ON CONFLICT(repo, node) DO UPDATE SET degree = kg_degrees.degree + 1;
			END;
			CREATE TRIGGER trg_kg_degrees_ad AFTER DELETE ON relations BEGIN
				UPDATE kg_degrees SET degree = degree - 1 WHERE repo = OLD.repo AND node = OLD.from_entity AND degree > 0;
				UPDATE kg_degrees SET degree = degree - 1 WHERE repo = OLD.repo AND node = OLD.to_entity AND degree > 0;
				DELETE FROM kg_degrees WHERE repo = OLD.repo AND (node = OLD.from_entity OR node = OLD.to_entity) AND degree = 0;
			END;
		`);

		logger.info("[Migration] Rebuilt knowledge graph with repository-scoped entity and relation identities");
	}
};
