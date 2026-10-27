import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

describe("migration v33 KG repository identity", () => {
	it("allows the same entity and relation identities in different repositories", () => {
		const db = new Database(":memory:");
		db.pragma("foreign_keys = ON");
		new MigrationManager(db).migrate();

		expect(SCHEMA_VERSION).toBe(40);
		const now = new Date().toISOString();
		const insertEntity = db.prepare(
			"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)"
		);
		for (const repo of ["repo-a", "repo-b"]) {
			insertEntity.run("Shared", "concept", repo, "owner", now, now);
			insertEntity.run("Target", "concept", repo, "owner", now, now);
			db.prepare(
				"INSERT INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)"
			).run("Shared", "Target", "uses", repo, "owner", now, 1);
		}

		expect(db.prepare("SELECT COUNT(*) AS count FROM entities WHERE name = 'Shared'").get()).toEqual({ count: 2 });
		expect(db.prepare("SELECT COUNT(*) AS count FROM relations WHERE relation_type = 'uses'").get()).toEqual({
			count: 2
		});

		db.prepare("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)").run(
			"repo-b-observation",
			"Shared",
			"Mentioned in memory: Shared",
			"repo-b",
			"owner",
			now
		);
		db.prepare("DELETE FROM entities WHERE name = ? AND repo = ?").run("Shared", "repo-a");
		expect(db.prepare("SELECT COUNT(*) AS count FROM entities WHERE name = 'Shared'").get()).toEqual({ count: 1 });
		expect(db.prepare("SELECT COUNT(*) AS count FROM relations WHERE repo = 'repo-a'").get()).toEqual({ count: 0 });
		expect(db.prepare("SELECT COUNT(*) AS count FROM relations WHERE repo = 'repo-b'").get()).toEqual({ count: 1 });
		expect(db.prepare("SELECT COUNT(*) AS count FROM observations WHERE repo = 'repo-b'").get()).toEqual({ count: 1 });
		expect(db.prepare("SELECT COUNT(*) AS count FROM entity_names_fts WHERE repo = 'repo-b'").get()).toEqual({
			count: 2
		});
		db.prepare("UPDATE entities SET type = ? WHERE name = ? AND repo = ?").run("service", "Shared", "repo-b");
		expect(db.prepare("SELECT name FROM entity_names_fts WHERE repo = 'repo-b' AND name = 'Shared'").get()).toEqual({
			name: "Shared"
		});
		expect(db.prepare("SELECT degree FROM kg_degrees WHERE repo = 'repo-b' AND node = 'Shared'").get()).toEqual({
			degree: 1
		});
		expect(db.pragma("foreign_key_check")).toEqual([]);
		db.close();
	});

	it("rolls the entire rebuild back when historical graph data cannot satisfy the new foreign keys", () => {
		const db = new Database(":memory:");
		db.pragma("foreign_keys = ON");
		new MigrationManager(db).migrate();
		db.prepare("DELETE FROM _schema_version WHERE version = 33").run();
		db.exec(
			"DROP TRIGGER IF EXISTS entity_names_fts_ai; DROP TRIGGER IF EXISTS entity_names_fts_au; DROP TRIGGER IF EXISTS entity_names_fts_ad; DROP TABLE entity_names_fts;"
		);
		db.exec("DROP TRIGGER IF EXISTS trg_kg_degrees_ai; DROP TRIGGER IF EXISTS trg_kg_degrees_ad;");
		db.exec("DROP TABLE observations; DROP TABLE relations; DROP TABLE entities;");
		db.exec(`
			CREATE TABLE entities (name TEXT PRIMARY KEY, type TEXT NOT NULL, description TEXT, repo TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE TABLE relations (from_entity TEXT NOT NULL, to_entity TEXT NOT NULL, relation_type TEXT NOT NULL, repo TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, confidence REAL, PRIMARY KEY(from_entity,to_entity,relation_type));
			CREATE TABLE observations (id TEXT PRIMARY KEY, entity_name TEXT NOT NULL, observation TEXT NOT NULL, repo TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL);
		`);
		const now = new Date().toISOString();
		db.prepare("INSERT INTO entities VALUES (?, ?, NULL, ?, ?, ?, ?)").run(
			"Known",
			"concept",
			"repo-a",
			"owner",
			now,
			now
		);
		db.prepare("INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?, NULL)").run(
			"Known",
			"Known",
			"invalid",
			"repo-a",
			"owner",
			now
		);

		// A malformed legacy NULL confidence violates the rebuilt table. The v33
		// migration must fail and roll the entire schema replacement back.
		expect(() => new MigrationManager(db).migrate()).toThrow();
		expect(db.prepare("SELECT name FROM entities").all()).toEqual([{ name: "Known" }]);
		expect(db.prepare("SELECT COUNT(*) AS count FROM _schema_version WHERE version = 33").get()).toEqual({ count: 0 });
		db.close();
	});

	it("backfills one entity row per repository referenced by historical observations and relations", () => {
		const db = new Database(":memory:");
		db.pragma("foreign_keys = ON");
		new MigrationManager(db).migrate();
		const now = new Date().toISOString();

		// Recreate the pre-v33 collision state, then rerun v33.
		db.prepare("DELETE FROM _schema_version WHERE version = 33").run();
		db.exec(
			"DROP TRIGGER IF EXISTS entity_names_fts_ai; DROP TRIGGER IF EXISTS entity_names_fts_au; DROP TRIGGER IF EXISTS entity_names_fts_ad; DROP TABLE entity_names_fts;"
		);
		db.exec("DROP TRIGGER IF EXISTS trg_kg_degrees_ai; DROP TRIGGER IF EXISTS trg_kg_degrees_ad;");
		db.exec("DROP TABLE observations; DROP TABLE relations; DROP TABLE entities;");
		db.exec(`
			CREATE TABLE entities (name TEXT PRIMARY KEY, type TEXT NOT NULL, description TEXT, repo TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
			CREATE TABLE relations (from_entity TEXT NOT NULL, to_entity TEXT NOT NULL, relation_type TEXT NOT NULL, repo TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1.0, PRIMARY KEY(from_entity,to_entity,relation_type));
			CREATE TABLE observations (id TEXT PRIMARY KEY, entity_name TEXT NOT NULL, observation TEXT NOT NULL, repo TEXT NOT NULL, owner TEXT NOT NULL, created_at TEXT NOT NULL);
		`);
		db.prepare("INSERT INTO entities VALUES (?, ?, NULL, ?, ?, ?, ?)").run(
			"Shared",
			"concept",
			"repo-a",
			"owner-a",
			now,
			now
		);
		db.prepare("INSERT INTO entities VALUES (?, ?, NULL, ?, ?, ?, ?)").run(
			"Target",
			"concept",
			"repo-a",
			"owner-a",
			now,
			now
		);
		db.prepare("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?)").run(
			"obs-b",
			"Shared",
			"Mentioned in memory: B",
			"repo-b",
			"owner-b",
			now
		);
		db.prepare("INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?, ?)").run(
			"Shared",
			"Target",
			"uses",
			"repo-b",
			"owner-b",
			now,
			0.8
		);

		new MigrationManager(db).migrate();
		const rows = db.prepare("SELECT name, repo FROM entities ORDER BY name, repo").all();
		expect(rows).toEqual([
			{ name: "Shared", repo: "repo-a" },
			{ name: "Shared", repo: "repo-b" },
			{ name: "Target", repo: "repo-a" },
			{ name: "Target", repo: "repo-b" }
		]);
		expect(db.pragma("foreign_key_check")).toEqual([]);
		expect(db.prepare("SELECT COUNT(*) AS count FROM entity_names_fts").get()).toEqual({ count: 4 });
		db.close();
	});
});
