import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v29 "kg-relations-index-rebalance" (audit F2/F9).
 *
 * v29 does three things to the `relations` table and nothing else:
 *   ADD  idx_relations_repo_to    (repo, to_entity)  — the `to`-branch of the
 *        UNION-rewritten `getRelationsFor`; without it the planner cannot serve
 *        both directions and falls back to scanning every edge in the repo.
 *   ADD  idx_relations_created_at (created_at)       — the age predicate of the
 *        `pruneRelations` retention sweep; without it a no-work run pays a full
 *        table scan.
 *   DROP idx_relations_type  — zero query consumers (`deleteRelation` matches
 *        the full composite PK, served by sqlite_autoindex_relations_1).
 *   DROP idx_relations_from  — redundant: `from_entity` is the PK's leftmost
 *        column.
 *
 * At v29 `idx_relations_to` was deliberately KEPT: `getRelationsByName`
 * (dashboard entity detail) then filtered `to_entity` with NO repo predicate,
 * so the (repo, to_entity) composite could not serve it. Migration v36
 * (relations-index-consolidation, TASK-040) removes that repo-less shape and
 * drops BOTH `idx_relations_to` and `idx_relations_repo` as redundant, so this
 * suite now pins the post-v36 index set: the two dropped single-column
 * indexes are GONE while the composites survive and keep every repo-scoped
 * query index-served.
 *
 * These tests pin the applied-DB contract, the plan consequences that justify
 * each change, and idempotent re-application after a simulated crash.
 */
describe("migration v29 KG relations index rebalance", () => {
	function freshDb(label: string): { db: Database.Database; tempDir: string } {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lmcp-v29-${label}-`));
		const db = new Database(path.join(tempDir, "rel.db"));
		db.pragma("foreign_keys = ON");
		new MigrationManager(db).migrate();
		return { db, tempDir };
	}

	function indexNames(db: Database.Database): string[] {
		return (db.prepare("PRAGMA index_list(relations)").all() as { name: string }[]).map((i) => i.name);
	}

	function plan(db: Database.Database, sql: string, params: unknown[] = []): string {
		return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as [])) as { detail: string }[])
			.map((r) => r.detail)
			.join(" | ");
	}

	it("fresh DB migrates to latest SCHEMA_VERSION with the rebalanced index set", () => {
		const { db, tempDir } = freshDb("fresh");

		const applied = (
			db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as { version: number }[]
		).map((r) => r.version);
		expect(applied.at(-1)).toBe(SCHEMA_VERSION);
		expect(applied).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));

		const names = indexNames(db);
		// Added by v29.
		expect(names).toContain("idx_relations_repo_to");
		expect(names).toContain("idx_relations_created_at");
		// Dropped by v29.
		expect(names).not.toContain("idx_relations_type");
		expect(names).not.toContain("idx_relations_from");
		// Dropped by v36 (relations-index-consolidation): idx_relations_to was
		// v29-kept for the repo-less getRelationsByName, but that shape is gone
		// post-v33; idx_relations_repo is a prefix of the two composites.
		expect(names).not.toContain("idx_relations_to");
		expect(names).not.toContain("idx_relations_repo");
		// Kept — serve every repo-scoped relation query.
		expect(names).toContain("idx_relations_repo_from_to");
		expect(names).toContain("idx_relations_repo_to");
		expect(names).toContain("idx_relations_created_at");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("indexes the exact columns claimed", () => {
		const { db, tempDir } = freshDb("cols");

		const sql = (name: string) =>
			(db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(name) as { sql: string }).sql;

		expect(sql("idx_relations_repo_to")).toContain("relations(repo, to_entity)");
		expect(sql("idx_relations_created_at")).toContain("relations(created_at)");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("each getRelationsFor branch is served by its own composite index (the point of the migration)", () => {
		const { db, tempDir } = freshDb("plan-union");

		// The production projection includes `confidence`, which is in neither
		// composite, so the planner must choose the index that matches the
		// PREDICATE rather than a covering scan.
		const cols = "from_entity, to_entity, relation_type, confidence";

		const fromBranch = plan(db, `SELECT ${cols} FROM relations WHERE repo = 'r' AND from_entity IN ('a','b')`);
		expect(fromBranch).toContain("idx_relations_repo_from_to");
		expect(fromBranch).not.toContain("SCAN relations");

		// This is the branch v29 exists for: before the migration there was NO
		// (repo, to_entity) index, so this predicate could only be served by the
		// repo-wide idx_relations_repo.
		const toBranch = plan(db, `SELECT ${cols} FROM relations WHERE repo = 'r' AND to_entity IN ('a','b')`);
		expect(toBranch).toContain("idx_relations_repo_to");
		expect(toBranch).not.toContain("SCAN relations");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("the pre-fix OR predicate is exactly what the UNION avoids (documents the regression)", () => {
		const { db, tempDir } = freshDb("plan-or");

		const detail = plan(
			db,
			`SELECT from_entity, to_entity, relation_type FROM relations
			 WHERE (from_entity IN ('a','b') OR to_entity IN ('a','b')) AND repo = 'r'`
		);

		// A single OR cannot consume two indexes, so even WITH both composites
		// present the planner degrades to a repo-wide scan on ONE composite.
		// This is why the index alone was not enough and the query had to be
		// rewritten. Post-v36 the repo-wide scan is served by
		// idx_relations_repo_to (idx_relations_repo is gone) — still a full
		// scan of the repo's edges, which is exactly the regression the UNION
		// rewrite avoids.
		expect(detail).toContain("idx_relations_repo_to");
		expect(detail).not.toContain("idx_relations_repo_from_to");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("the pruneRelations age predicate is index-served, not a table scan", () => {
		const { db, tempDir } = freshDb("plan-prune");

		const detail = plan(db, "SELECT rowid FROM relations WHERE created_at < '2026-01-01' LIMIT 10");

		expect(detail).toContain("idx_relations_created_at");
		expect(detail).not.toContain("SCAN relations");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("the production getRelationsByName (repo-scoped) stays index-served after v36 drops idx_relations_to/idx_relations_repo", () => {
		const { db, tempDir } = freshDb("plan-byname");

		// Production shape (dashboard-queries.ts getRelationsByName): repo-scoped
		// from/to OR. v33 made `repo` part of the KG identity, so this is the
		// ONLY shape that ships — the old repo-less variant no longer exists.
		const detail = plan(
			db,
			"SELECT * FROM relations WHERE repo = 'r' AND (from_entity = 'x' OR to_entity = 'x') ORDER BY relation_type"
		);

		// Served by the (repo, to_entity) composite — a repo-scoped seek, not a
		// full-table scan.
		expect(detail).toContain("idx_relations_repo_to");
		expect(detail).not.toContain("SCAN relations");

		// The repo-less shape (which v29 kept idx_relations_to for) is no longer
		// a production query; dropping idx_relations_to collapses it to a full
		// scan, acceptable precisely because nothing ships it. Pinning the scan
		// documents the trade-off and guards against reintroduction.
		const repoLess = plan(
			db,
			"SELECT * FROM relations WHERE from_entity = 'x' OR to_entity = 'x' ORDER BY relation_type"
		);
		expect(repoLess).toContain("SCAN relations");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("dropping idx_relations_type does not regress deleteRelation (composite PK serves it)", () => {
		const { db, tempDir } = freshDb("plan-delrel");

		const detail = plan(
			db,
			"SELECT * FROM relations WHERE from_entity = 'a' AND to_entity = 'b' AND relation_type = 'call'"
		);

		expect(detail).toContain("sqlite_autoindex_relations_1");
		expect(detail).not.toContain("SCAN relations");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("re-applying v29 is idempotent (no-op, does not throw)", () => {
		const { db, tempDir } = freshDb("idempotent");

		// Simulate a crash mid-migration: wipe the v29 record so the runner
		// re-runs it. CREATE ... IF NOT EXISTS / DROP ... IF EXISTS must make
		// every statement a no-op.
		db.prepare("DELETE FROM _schema_version WHERE version = 29").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 29").get() as { c: number };
		expect(count.c).toBe(1);

		const names = indexNames(db);
		expect(names.filter((n) => n === "idx_relations_repo_to")).toHaveLength(1);
		expect(names.filter((n) => n === "idx_relations_created_at")).toHaveLength(1);
		expect(names).not.toContain("idx_relations_type");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("leaves the relations table shape untouched (index-only migration)", () => {
		const { db, tempDir } = freshDb("shape");

		const cols = (db.prepare("PRAGMA table_info(relations)").all() as { name: string }[]).map((c) => c.name).sort();
		expect(cols).toEqual(["confidence", "created_at", "from_entity", "owner", "relation_type", "repo", "to_entity"]);

		const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='relations'").get() as {
			sql: string;
		};
		expect(table.sql).toContain("PRIMARY KEY (from_entity, to_entity, relation_type, repo)");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
