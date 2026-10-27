import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v24 "relations-confidence" ([KGCONF-1] /
 * TASK-325).
 *
 * v24 adds EXACTLY ONE display-only column to the relations table —
 * `confidence REAL NOT NULL DEFAULT 1.0` — with NO index, NO filter/scan
 * consumers, and the SQLite ADD COLUMN default backfilling every existing row
 * to 1.0 at migration time (pre-v24 edges read explicit-grade). These tests
 * pin the applied-DB contracts: a fresh migrate lands on the latest
 * SCHEMA_VERSION with the column present (REAL, NOT NULL, default 1.0), the
 * relations PK + existing v01 indexes are preserved and NO new index is
 * created, re-applying v24 (idempotent retry, simulating a crash mid-
 * migration) is a no-op that does not throw, and the DEFAULT applies to rows
 * inserted without the column while explicit values round-trip.
 */
describe("migration v24 relations confidence", () => {
	it("fresh DB migrates to latest SCHEMA_VERSION with relations.confidence REAL NOT NULL DEFAULT 1.0 and no new index", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-conf-v24-"));
		const dbPath = path.join(tempDir, "conf.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// Migration record tracked per-version (new-style _schema_version).
		const applied = db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as {
			version: number;
		}[];
		expect(applied.at(-1)?.version).toBe(SCHEMA_VERSION);
		expect(applied.map((r) => r.version)).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));

		// Confidence column: REAL, NOT NULL, DEFAULT 1.0 — exactly one.
		const cols = db.prepare("PRAGMA table_info(relations)").all() as {
			name: string;
			type: string;
			notnull: number;
			dflt_value: string | null;
		}[];
		const confidence = cols.filter((c) => c.name === "confidence");
		expect(confidence).toHaveLength(1);
		expect(confidence[0].type).toBe("REAL");
		expect(confidence[0].notnull).toBe(1);
		expect(confidence[0].dflt_value).toBe("1.0");

		// PK + every v01 relation column preserved.
		const colNames = cols.map((c) => c.name).sort();
		expect(colNames).toEqual([
			"confidence",
			"created_at",
			"from_entity",
			"owner",
			"relation_type",
			"repo",
			"to_entity"
		]);
		const pk = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'relations'").get() as {
			sql: string;
		};
		expect(pk.sql).toContain("PRIMARY KEY (from_entity, to_entity, relation_type, repo)");

		// NO confidence index is added. PRAGMA index_list (repo pattern — see
		// migrations.standards.test.ts) lists the named CREATE INDEX entries
		// plus the implicit PK autoindex (sqlite_autoindex_relations_1,
		// origin='pk') and the v12/v29 composites, so exact-set equality would
		// be a stale snapshot. Assert containment: (1) the relations indexes are
		// a superset of the expected set that survives v29's rebalance, and
		// (2) NO index name references confidence — still fails if v24 ever
		// adds one.
		//
		// v29 DROPs idx_relations_from (PK-prefix redundant) and
		// idx_relations_type (zero query consumers), so they are deliberately
		// absent from this list — see v29-kg-relations-index-rebalance.
		// v36 (relations-index-consolidation) further DROPs idx_relations_repo
		// (a prefix of the composites) and idx_relations_to (repo-less lookup
		// removed by v33), so they are absent too.
		const indexes = db.prepare("PRAGMA index_list(relations)").all() as { name: string }[];
		const indexNames = indexes.map((i) => i.name);
		const preExistingIndexes = ["idx_relations_repo_from_to", "idx_relations_repo_to", "idx_relations_created_at"];
		expect(preExistingIndexes.every((name) => indexNames.includes(name))).toBe(true);
		expect(indexNames).not.toContain("idx_relations_repo");
		expect(indexNames).not.toContain("idx_relations_to");
		expect(indexNames.some((name) => name.includes("confidence"))).toBe(false);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("re-applying v24 is idempotent (no-op, does not throw)", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-conf-v24-re-"));
		const dbPath = path.join(tempDir, "conf.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// Simulate a crash mid-migration: wipe the v24 record so the runner
		// re-runs it on the next startup. The PRAGMA table_info guard must make
		// the ALTER TABLE ADD COLUMN a no-op here and must not throw.
		db.prepare("DELETE FROM _schema_version WHERE version = 24").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 24").get() as { c: number };
		expect(count.c).toBe(1);

		// Column still present exactly once.
		const cols = db.prepare("PRAGMA table_info(relations)").all() as { name: string }[];
		expect(cols.filter((c) => c.name === "confidence").length).toBe(1);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("DEFAULT 1.0 applies to rows without the column while explicit values round-trip", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-conf-v24-default-"));
		const dbPath = path.join(tempDir, "conf.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		const now = new Date().toISOString();
		db.prepare(
			"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES ('A', 'concept', NULL, 'repo-a', '', ?, ?)"
		).run(now, now);
		db.prepare(
			"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES ('B', 'concept', NULL, 'repo-a', '', ?, ?)"
		).run(now, now);

		// Legacy-style INSERT (v01 column set, no confidence) → reads 1.0
		// (the same default that backfilled pre-v24 rows at migration time).
		db.prepare(
			"INSERT INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at) VALUES ('A', 'B', 'related_to', 'repo-a', '', ?)"
		).run(now);
		const legacy = db
			.prepare(
				"SELECT confidence FROM relations WHERE from_entity = 'A' AND to_entity = 'B' AND relation_type = 'related_to'"
			)
			.get() as { confidence: number };
		expect(legacy.confidence).toBe(1);

		// v24-style INSERT with an explicit confidence → exact round-trip.
		db.prepare(
			"INSERT INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at, confidence) VALUES ('B', 'A', 'co_mentioned', 'repo-a', '', ?, ?)"
		).run(now, 0.55);
		const explicit = db
			.prepare(
				"SELECT confidence FROM relations WHERE from_entity = 'B' AND to_entity = 'A' AND relation_type = 'co_mentioned'"
			)
			.get() as { confidence: number };
		expect(explicit.confidence).toBe(0.55);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
