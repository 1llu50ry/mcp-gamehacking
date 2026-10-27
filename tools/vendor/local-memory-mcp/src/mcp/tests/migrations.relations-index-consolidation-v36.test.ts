import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";
import { createTestStore } from "../storage/sqlite";

/**
 * Regression net for migration v36 "relations-index-consolidation" (TASK-040).
 *
 * The `relations` table carried six indexes; two are redundant and v36 drops
 * them:
 *   DROP idx_relations_repo (repo)        — a leftmost prefix of BOTH
 *        idx_relations_repo_to (repo, to_entity) and idx_relations_repo_from_to
 *        (repo, from_entity, to_entity); every repo-scoped query is served by
 *        a composite.
 *   DROP idx_relations_to   (to_entity)   — no production query performs a
 *        repo-less to-only lookup after v33 made `repo` part of the KG
 *        identity; residual shapes fall back to the PK autoindex or
 *        idx_relations_repo_to.
 *
 * KEPT: sqlite_autoindex_relations_1 (PK, cannot drop), idx_relations_repo_from_to,
 * idx_relations_repo_to, idx_relations_created_at.
 *
 * These tests pin the post-v36 index set, that repo-scoped queries stay
 * index-served (no full scan), and that the production relation reads still
 * return the correct rows.
 */
describe("migration v36 relations index consolidation", () => {
	const KEPT = ["idx_relations_repo_from_to", "idx_relations_repo_to", "idx_relations_created_at"];
	const DROPPED = ["idx_relations_repo", "idx_relations_to"];

	function freshDb(label: string): { db: Database.Database; tempDir: string } {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lmcp-v36-${label}-`));
		const db = new Database(path.join(tempDir, "rel.db"));
		db.pragma("foreign_keys = ON");
		new MigrationManager(db).migrate();
		return { db, tempDir };
	}

	function indexNames(db: Database.Database): string[] {
		return (db.prepare("PRAGMA index_list(relations)").all() as { name: string }[]).map((i) => i.name);
	}

	function plan(db: Database.Database, sql: string): string {
		return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(" | ");
	}

	it("fresh DB migrates to latest SCHEMA_VERSION with exactly the consolidated index set", () => {
		const { db, tempDir } = freshDb("fresh");

		const applied = (
			db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as { version: number }[]
		).map((r) => r.version);
		expect(applied.at(-1)).toBe(SCHEMA_VERSION);
		expect(applied).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));

		const names = indexNames(db);
		// The 3 kept named indexes + the PK autoindex, nothing else.
		expect(new Set(names)).toEqual(new Set([...KEPT, "sqlite_autoindex_relations_1"]));
		// Redundant single-column indexes are gone.
		for (const name of DROPPED) expect(names).not.toContain(name);
		// The kept composites index the exact columns claimed.
		const sql = (name: string) =>
			(db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as { sql: string }).sql;
		expect(sql("idx_relations_repo_from_to")).toContain("relations(repo, from_entity, to_entity)");
		expect(sql("idx_relations_repo_to")).toContain("relations(repo, to_entity)");
		expect(sql("idx_relations_created_at")).toContain("relations(created_at)");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("repo-scoped production queries stay index-served (no full scan) after the drops", () => {
		const { db, tempDir } = freshDb("plans");

		// getRelationsByName (dashboard detail): repo-scoped from/to OR.
		const byName = plan(
			db,
			"SELECT * FROM relations WHERE repo = 'r' AND (from_entity = 'x' OR to_entity = 'x') ORDER BY relation_type"
		);
		expect(byName).toContain("idx_relations_repo_to");
		expect(byName).not.toContain("SCAN relations");

		// countRelations: repo-only aggregate — served by a covering composite.
		const count = plan(db, "SELECT COUNT(*) AS cnt FROM relations WHERE repo = 'r'");
		expect(count).toContain("idx_relations_repo_to");
		expect(count).not.toContain("SCAN relations");

		// listGraphEdges outer relation scan: repo-scoped.
		const edges = plan(
			db,
			"SELECT r.from_entity, r.to_entity, r.relation_type, r.confidence FROM relations r WHERE r.repo = 'r' ORDER BY r.from_entity, r.to_entity LIMIT 10"
		);
		expect(edges).toContain("idx_relations_repo_from_to");
		expect(edges).not.toContain("SCAN relations");

		// getRelationsFor branches: each direction served by its own composite.
		const fromBranch = plan(db, "SELECT from_entity FROM relations WHERE repo = 'r' AND from_entity IN ('a','b')");
		expect(fromBranch).toContain("idx_relations_repo_from_to");
		expect(fromBranch).not.toContain("SCAN relations");
		const toBranch = plan(db, "SELECT to_entity FROM relations WHERE repo = 'r' AND to_entity IN ('a','b')");
		expect(toBranch).toContain("idx_relations_repo_to");
		expect(toBranch).not.toContain("SCAN relations");

		// deleteRelation: full composite PK → PK autoindex.
		const del = plan(
			db,
			"SELECT * FROM relations WHERE from_entity = 'a' AND to_entity = 'b' AND relation_type = 'call'"
		);
		expect(del).toContain("sqlite_autoindex_relations_1");
		expect(del).not.toContain("SCAN relations");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("re-applying v36 is idempotent (no-op, does not throw)", () => {
		const { db, tempDir } = freshDb("idempotent");

		// Simulate a crash mid-migration: wipe the v36 record so the runner
		// re-runs it. DROP INDEX IF EXISTS must make both statements no-ops.
		db.prepare("DELETE FROM _schema_version WHERE version = 36").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 36").get() as { c: number };
		expect(count.c).toBe(1);

		const names = indexNames(db);
		for (const name of DROPPED) expect(names).not.toContain(name);
		for (const name of KEPT) expect(names).toContain(name);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("representative repo-scoped reads (getRelationsByName / getRelationsFor) still return correct rows", async () => {
		const store = await createTestStore();
		const REPO = "v36-read-test";
		const now = new Date().toISOString();

		for (const name of ["A", "B", "C"]) {
			store.knowledgeGraph.upsertEntity({
				name,
				type: "concept",
				description: null,
				repo: REPO,
				owner: "test",
				created_at: now,
				updated_at: now
			});
		}
		store.knowledgeGraph.upsertRelation({
			from_entity: "A",
			to_entity: "B",
			relation_type: "related_to",
			repo: REPO,
			owner: "test",
			created_at: now,
			confidence: 0.8
		});
		store.knowledgeGraph.upsertRelation({
			from_entity: "C",
			to_entity: "A",
			relation_type: "uses",
			repo: REPO,
			owner: "test",
			created_at: now,
			confidence: 0.9
		});

		// The store DB is the migrated one: the redundant indexes are absent.
		const names = (store.db.prepare("PRAGMA index_list(relations)").all() as { name: string }[]).map((i) => i.name);
		expect(names).not.toContain("idx_relations_repo");
		expect(names).not.toContain("idx_relations_to");

		// getRelationsByName: both directions touching "A".
		const byName = store.knowledgeGraph.getRelationsByName("A", REPO);
		expect(byName).toHaveLength(2);
		expect(byName.map((r) => `${r.from_entity}->${r.to_entity}`).sort()).toEqual(["A->B", "C->A"]);

		// getRelationsFor (unbounded, limit 0): both branches of the UNION.
		const forA = store.knowledgeGraph.getRelationsFor(["A"], REPO, 0);
		expect(forA.map((r) => `${r.from}->${r.to}`).sort()).toEqual(["A->B", "C->A"]);

		// Repo isolation: another repo sees nothing.
		expect(store.knowledgeGraph.getRelationsByName("A", "other-repo")).toHaveLength(0);

		store.close();
	});
});
