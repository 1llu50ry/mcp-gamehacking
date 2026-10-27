import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";
import { createTestStore } from "../storage/sqlite";

/**
 * Regression net for migration v39 "observations-index-consolidation" (PERF-007).
 *
 * `idx_observations_entity (entity_name)` duplicates the LEFTMOST column of the
 * UNIQUE `idx_observations_dedup (entity_name, observation, repo)` created in
 * v33. Every `entity_name = ?` predicate — including the COVERING `SELECT 1` /
 * `SELECT DISTINCT entity_name` shapes used by the orphan-entity sweep and the
 * relation-prune probe — is served by the composite, so the single-column index
 * is pure write amplification and dead disk (measured 12.2 MB on the real DB).
 *
 * These tests pin the post-v39 index set, that every observations consumer
 * stays index-served (no full scan), and that the production reads still return
 * the correct rows.
 */
describe("migration v39 observations index consolidation", () => {
	const KEPT = [
		"idx_observations_dedup",
		"idx_observations_observation",
		"idx_observations_repo",
		"idx_observations_created_at"
	];
	const DROPPED = "idx_observations_entity";

	function freshDb(label: string): { db: Database.Database; tempDir: string } {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lmcp-v39-${label}-`));
		const db = new Database(path.join(tempDir, "obs.db"));
		db.pragma("foreign_keys = ON");
		new MigrationManager(db).migrate();
		return { db, tempDir };
	}

	function indexNames(db: Database.Database): string[] {
		return (db.prepare("PRAGMA index_list(observations)").all() as { name: string }[]).map((i) => i.name);
	}

	function plan(db: Database.Database, sql: string): string {
		return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(" | ");
	}

	it("fresh DB migrates to latest SCHEMA_VERSION with the consolidated index set", () => {
		const { db, tempDir } = freshDb("fresh");

		const applied = (
			db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as { version: number }[]
		).map((r) => r.version);
		expect(applied.at(-1)).toBe(SCHEMA_VERSION);
		expect(applied).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));

		const names = indexNames(db);
		for (const name of KEPT) expect(names).toContain(name);
		expect(names).not.toContain(DROPPED);
		// The unique dedup composite still leads with entity_name — that is the
		// whole justification for the drop.
		const dedupSql = (
			db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_observations_dedup'").get() as {
				sql: string;
			}
		).sql;
		expect(dedupSql).toContain("observations(entity_name, observation, repo)");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("every observations consumer stays index-served (no full scan) after the drop", () => {
		const { db, tempDir } = freshDb("plans");

		// getObservationsByName: entity_name + repo (dashboard detail).
		const byName = plan(db, "SELECT * FROM observations WHERE entity_name = 'x' AND repo = 'r'");
		expect(byName).toContain("idx_observations_dedup");
		expect(byName).not.toContain("SCAN observations");

		// entity_name-only shapes (covering): orphan-entity sweep / prune probes.
		const entityOnly = plan(db, "SELECT 1 FROM observations WHERE entity_name = 'x' AND repo = 'r'");
		expect(entityOnly).toContain("idx_observations_dedup");
		expect(entityOnly).not.toContain("SCAN observations");
		const distinctEntity = plan(db, "SELECT DISTINCT entity_name FROM observations WHERE entity_name = 'x'");
		expect(distinctEntity).toContain("idx_observations_dedup");
		expect(distinctEntity).not.toContain("SCAN observations");

		// by-observation lookup: observation (+ repo).
		const byObservation = plan(
			db,
			"SELECT DISTINCT entity_name FROM observations WHERE observation = 'o' AND repo = 'r'"
		);
		expect(byObservation).toContain("idx_observations_observation");
		expect(byObservation).not.toContain("SCAN observations");

		// deleteRepoEntities: repo-only.
		const repoOnly = plan(db, "SELECT * FROM observations WHERE repo = 'r'");
		expect(repoOnly).toContain("idx_observations_repo");
		expect(repoOnly).not.toContain("SCAN observations");

		// age prune: created_at.
		const age = plan(db, "SELECT 1 FROM observations WHERE created_at < '2020-01-01' LIMIT 1");
		expect(age).toContain("idx_observations_created_at");
		expect(age).not.toContain("SCAN observations");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("re-applying v39 is idempotent (no-op, does not throw)", () => {
		const { db, tempDir } = freshDb("idempotent");

		// Simulate a crash mid-migration: wipe the v39 record so the runner
		// re-runs it. DROP INDEX IF EXISTS must make the statement a no-op.
		db.prepare("DELETE FROM _schema_version WHERE version = 39").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 39").get() as { c: number };
		expect(count.c).toBe(1);

		const names = indexNames(db);
		expect(names).not.toContain(DROPPED);
		for (const name of KEPT) expect(names).toContain(name);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("representative reads (getEntityNamesByObservation / getObservationsByName) still return correct rows", async () => {
		const store = await createTestStore();
		const REPO = "v39-read-test";
		const now = new Date().toISOString();

		store.knowledgeGraph.upsertEntity({
			name: "A",
			type: "concept",
			description: null,
			repo: REPO,
			owner: "test",
			created_at: now,
			updated_at: now
		});
		store.knowledgeGraph.insertObservation({
			id: "obs-1",
			entity_name: "A",
			observation: "Mentioned in memory: Title",
			repo: REPO,
			owner: "test",
			created_at: now
		});

		// The store DB is the migrated one: the redundant index is absent.
		const names = (store.db.prepare("PRAGMA index_list(observations)").all() as { name: string }[]).map((i) => i.name);
		expect(names).not.toContain("idx_observations_entity");

		// Both observations read paths resolve the same rows as before the drop.
		expect(store.knowledgeGraph.getEntityNamesByObservation("Mentioned in memory: Title", REPO)).toEqual(["A"]);
		const rows = store.knowledgeGraph.getObservationsByName("A", REPO);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.observation).toBe("Mentioned in memory: Title");

		// Repo isolation: another repo sees nothing.
		expect(store.knowledgeGraph.getEntityNamesByObservation("Mentioned in memory: Title", "other-repo")).toEqual([]);

		store.close();
	});
});
