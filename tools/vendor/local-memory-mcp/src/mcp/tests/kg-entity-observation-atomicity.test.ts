import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveExtractions, saveTaskRelations } from "../tools/kg-archivist";
import { logger } from "../utils/logger";
import { createTestStore, SQLiteStore } from "../storage/sqlite";

// ---------------------------------------------------------------------------
// Entity+observation pair atomicity (TASK-073)
//
// saveExtractions/saveStandardRelations write each entity AND its observation
// through KnowledgeGraphEntity.ensureObservation, which wraps the pair in a
// single BEGIN IMMEDIATE transaction (base.ts `transaction()` is immediate per
// TASK-064 / MEM-475). The observations.entity_name → entities(name) FK used
// to be written as two autocommit statements: a concurrent orphan-sweep
// (deleteOrphanEntities) could delete the fresh entity between the upsert and
// the observation insert and fail the FK. These tests pin the contract:
// (1) a failed observation insert rolls back the entity upsert (no
// half-written pair), and (2) a real orphan sweep from a SECOND connection is
// blocked by the write lock — it cannot delete the endpoint between the upsert
// and the observation insert.
// ---------------------------------------------------------------------------

describe("KG Archivist — entity+observation pair atomicity (TASK-073)", () => {
	let db: SQLiteStore;

	const REPO = "kg-obs-atomicity-test";

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("rolls back the entity upsert when the observation insert throws (pair is atomic)", () => {
		const now = new Date().toISOString();

		// Simulate a mid-pair failure: the observation insert throws after the
		// entity upsert already ran inside the transaction.
		vi.spyOn(db.knowledgeGraph, "insertObservation").mockImplementation(() => {
			throw new Error("boom");
		});

		expect(() =>
			db.knowledgeGraph.ensureObservation({
				id: randomUUID(),
				name: "A",
				type: "concept",
				description: null,
				observation: "Mentioned in memory: X",
				repo: REPO,
				owner: "test",
				created_at: now
			})
		).toThrow("boom");

		// Rollback proof: the entity must NOT survive the failed observation
		// insert. Without the BEGIN IMMEDIATE wrapper the upsert would have
		// autocommitted and left an orphaned entity (referenced by neither an
		// observation nor a relation) — the exact regression this guards.
		expect(db.knowledgeGraph.getEntityByName("A", REPO)).toBeUndefined();
	});

	it("an orphan sweep from a second connection cannot delete an endpoint between its upsert and observation insert", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-obs-sweep-"));
		const dbPath = path.join(tempDir, "test.db");
		const fileDb = await SQLiteStore.create(dbPath);

		// Second raw connection simulating the dashboard-worker orphan sweep.
		// Fail fast (100ms) so the test never waits the full 5s busy timeout.
		const sweeper = new Database(dbPath);
		sweeper.pragma("busy_timeout = 100");
		sweeper.pragma("foreign_keys = ON");

		const sweepOrphans = (): void => {
			sweeper.exec(`DELETE FROM entities WHERE name NOT IN (
				SELECT DISTINCT entity_name FROM observations
				UNION
				SELECT DISTINCT from_entity FROM relations
				UNION
				SELECT DISTINCT to_entity FROM relations
			)`);
		};

		try {
			let sweepBlocked = false;
			const upsertSpy = vi.spyOn(fileDb.knowledgeGraph, "upsertEntity").mockImplementation((params) => {
				// Restore the real implementation and run the real upsert —
				// still INSIDE the BEGIN IMMEDIATE transaction started by
				// ensureObservation (base.ts `transaction()` is immediate).
				upsertSpy.mockRestore();
				fileDb.knowledgeGraph.upsertEntity(params);

				// Attempt the orphan sweep on the OTHER connection immediately
				// after the upsert. With the fix the write lock is held, so the
				// sweep gets SQLITE_BUSY and cannot delete the fresh entity.
				// (Without the fix the upsert would have autocommitted, the
				// sweep would delete the orphan entity, and the observation
				// insert would fail the FK — the regression this test guards.)
				try {
					sweepOrphans();
				} catch {
					sweepBlocked = true;
				}
			});

			const warnSpy = vi.spyOn(logger, "warn");
			await saveExtractions("Alice worked on the project", "Test Memory", "owner", REPO, fileDb);

			// The sweep was blocked by the immediate write lock — it never ran
			// between the upsert and the observation insert.
			expect(sweepBlocked).toBe(true);

			// No FK failure, no warn.
			const fkWarns = warnSpy.mock.calls.filter((call) => String(call[0]).includes("Failed to save extraction"));
			expect(fkWarns).toHaveLength(0);

			// Both the entity and its observation were persisted atomically.
			expect(fileDb.knowledgeGraph.getEntityByName("Alice", REPO)).toBeDefined();
			const observations = fileDb.db
				.prepare("SELECT entity_name FROM observations WHERE entity_name = 'Alice'")
				.all() as Array<{ entity_name: string }>;
			expect(observations.length).toBeGreaterThan(0);
		} finally {
			sweeper.close();
			fileDb.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("saveExtractions does not throw when another connection holds the write lock (TASK-175 boundary guard)", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-batch-busy-"));
		const dbPath = path.join(tempDir, "test.db");
		const fileDb = await SQLiteStore.create(dbPath);

		// Fail fast: lower the store connection's busy_timeout so the blocked
		// BEGIN IMMEDIATE throws SQLITE_BUSY after ~100ms, not the default 5s
		// (sqlite.ts sets busy_timeout = 5000).
		fileDb.db.pragma("busy_timeout = 100");

		// Second raw connection holds the write lock (BEGIN IMMEDIATE) for the
		// whole test — simulating a cross-process dashboard-worker orphan sweep
		// or repo delete (TASK-175 regression: the whole-batch refactor moved
		// the per-pair catches INSIDE the transaction, so the single BEGIN
		// IMMEDIATE boundary itself must be guarded).
		const lockHolder = new Database(dbPath);
		lockHolder.pragma("busy_timeout = 100");
		lockHolder.pragma("foreign_keys = ON");
		lockHolder.exec("BEGIN IMMEDIATE");

		try {
			const warnSpy = vi.spyOn(logger, "warn");

			// The batch's BEGIN IMMEDIATE hits SQLITE_BUSY after 100ms; the
			// boundary guard catches it, so saveExtractions resolves without
			// throwing (extract.ts contract: "Failures are logged at warn
			// level but never thrown"). Without the guard this rejects and
			// poisons the embedding worker cycle (outbox fail → backoff).
			await expect(
				saveExtractions("Alice and Bob worked on the project", "Test Memory", "owner", REPO, fileDb)
			).resolves.toBeUndefined();

			// Exactly one batch-level warn with repo + count diagnostics.
			const batchWarns = warnSpy.mock.calls.filter((call) =>
				String(call[0]).includes("Failed to save extraction batch")
			);
			expect(batchWarns).toHaveLength(1);

			// Whole-document atomicity: nothing landed after the boundary
			// rollback (IMMEDIATE lock held by the other connection).
			const entities = fileDb.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
			expect(entities.cnt).toBe(0);
			const observations = fileDb.db.prepare("SELECT COUNT(*) as cnt FROM observations").get() as {
				cnt: number;
			};
			expect(observations.cnt).toBe(0);
		} finally {
			lockHolder.exec("ROLLBACK");
			lockHolder.close();
			fileDb.close();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	// -----------------------------------------------------------------------
	// inspired_by / co_mentioned now flow through ensureRelation (TASK-073)
	// -----------------------------------------------------------------------

	it("writes inspired_by relations to a decision entity (type 'decision') via ensureRelation", async () => {
		await saveTaskRelations(
			"Payroll Module implementation aligned with quality standards and Icons",
			"Payroll Module",
			"test",
			REPO,
			db,
			{ decisionRefs: ["ADR-006"] }
		);

		// The decision entity is upserted by ensureRelation with type "decision".
		const decision = db.knowledgeGraph.getEntityByName("ADR-006", REPO);
		expect(decision).toBeDefined();
		expect(decision?.type).toBe("decision");

		// inspired_by edges point at the decision and their source endpoints exist.
		const rels = db.db
			.prepare("SELECT from_entity, to_entity FROM relations WHERE relation_type = 'inspired_by'")
			.all() as Array<{ from_entity: string; to_entity: string }>;
		expect(rels.length).toBeGreaterThan(0);
		for (const rel of rels) {
			expect(rel.to_entity).toBe("ADR-006");
			expect(db.knowledgeGraph.getEntityByName(rel.from_entity, REPO)).toBeDefined();
		}
	});

	it("writes co_mentioned relations whose endpoints all exist", async () => {
		await saveExtractions("Alice and Bob deployed the system to Seattle", "Test Memory", "owner", REPO, db);

		const rels = db.db
			.prepare("SELECT from_entity, to_entity FROM relations WHERE relation_type = 'co_mentioned'")
			.all() as Array<{ from_entity: string; to_entity: string }>;
		expect(rels.length).toBeGreaterThan(0);
		for (const rel of rels) {
			expect(db.knowledgeGraph.getEntityByName(rel.from_entity, REPO)).toBeDefined();
			expect(db.knowledgeGraph.getEntityByName(rel.to_entity, REPO)).toBeDefined();
		}
	});
});
