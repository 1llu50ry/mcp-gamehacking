import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { saveTaskRelations } from "../tools/kg-archivist";
import { logger } from "../utils/logger";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import type { Task } from "../types";

// ---------------------------------------------------------------------------
// saveTaskRelations — FK integrity (TASK-065 / MEM-473)
//
// depends_on/extends/related_to relations reference entities extracted
// on-the-fly from ANOTHER document (the parent/similar standard). Those
// endpoint entities can be orphan-swept while the child still points at the
// parent, so every relation insert MUST resolve-or-upsert BOTH endpoints
// first (KnowledgeGraphEntity.ensureRelation) or the relations FK
// (from_entity/to_entity → entities(name), PRAGMA foreign_keys=ON) throws
// `FOREIGN KEY constraint failed` — swallowed into a warn flood. Canceled
// parents are skipped entirely (their entities were already swept).
// ---------------------------------------------------------------------------

describe("KG Archivist — saveTaskRelations FK integrity (TASK-065)", () => {
	let db: SQLiteStore;

	const REPO = "kg-fk-test";
	const PARENT_TITLE = "[PARENT] Gold Standard Compliance (Aesthetics & Icons)";
	const PARENT_DESCRIPTION = "Enforces quality standards and implementation details for the Icons theme";
	const CHILD_TITLE = "Payroll Module";
	const CHILD_DESCRIPTION = "Payroll Module implementation aligned with quality standards and Icons";
	// Deterministic endpoints (verified against extractEntities): the parent
	// document extracts "Icons theme", the child extracts "Payroll Module
	// implementation" — the exact "missing TO endpoint" pair from the RCA.
	const PARENT_ENTITY = "Icons theme";
	const CHILD_ENTITY = "Payroll Module implementation";

	function makeTask(overrides: Partial<Task> = {}): Task {
		const now = new Date().toISOString();
		return {
			id: randomUUID(),
			owner: "test",
			repo: REPO,
			task_code: `KG-${randomUUID().slice(0, 6)}`,
			phase: "implementation",
			title: "test task",
			description: null,
			status: "backlog",
			priority: 3,
			agent: "test",
			role: "backend",
			doc_path: null,
			created_at: now,
			updated_at: now,
			in_progress_at: null,
			finished_at: null,
			canceled_at: null,
			est_tokens: 0,
			commit_id: null,
			changed_files: [],
			tags: [],
			suggested_skills: [],
			metadata: {},
			parent_id: null,
			depends_on: null,
			...overrides
		};
	}

	function getDependsOn(from: string, to: string): Record<string, unknown> | undefined {
		return db.db
			.prepare("SELECT * FROM relations WHERE from_entity = ? AND to_entity = ? AND relation_type = 'depends_on'")
			.get(from, to) as Record<string, unknown> | undefined;
	}

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("sweep-parents repro: re-upserts swept endpoint entities and re-inserts depends_on with no FK failure and no warn", async () => {
		const parent = makeTask({ title: PARENT_TITLE, description: PARENT_DESCRIPTION, status: "completed" });
		const child = makeTask({
			title: CHILD_TITLE,
			description: CHILD_DESCRIPTION,
			status: "pending",
			parent_id: parent.id
		});
		db.tasks.insertTask(parent);
		db.tasks.insertTask(child);

		// First pass: ensureRelation upserts BOTH endpoints and inserts the edge.
		await saveTaskRelations(CHILD_DESCRIPTION, CHILD_TITLE, "test", REPO, db, { parentId: parent.id });
		expect(db.knowledgeGraph.getEntityByName(PARENT_ENTITY, REPO)).toBeDefined();
		expect(getDependsOn(CHILD_ENTITY, PARENT_ENTITY)).toBeDefined();

		// Simulate the orphan sweep of the parent document's entities
		// (deleteEntity cascades the depends_on edge away — the exact
		// post-sweep state that used to flood FK warnings on reprocess).
		db.knowledgeGraph.deleteEntity(PARENT_ENTITY, REPO);
		expect(db.knowledgeGraph.getEntityByName(PARENT_ENTITY, REPO)).toBeUndefined();
		expect(getDependsOn(CHILD_ENTITY, PARENT_ENTITY)).toBeUndefined();

		// Reprocessing the child after the sweep: ensureRelation must upsert
		// the swept endpoint and re-insert the edge — no FK failure, no warn.
		const warnSpy = vi.spyOn(logger, "warn");
		await saveTaskRelations(CHILD_DESCRIPTION, CHILD_TITLE, "test", REPO, db, { parentId: parent.id });

		expect(db.knowledgeGraph.getEntityByName(PARENT_ENTITY, REPO)).toBeDefined();
		expect(getDependsOn(CHILD_ENTITY, PARENT_ENTITY)).toBeDefined();
		const fkWarns = warnSpy.mock.calls.filter((call) => String(call[0]).includes("Failed to save depends_on relation"));
		expect(fkWarns).toHaveLength(0);
	});

	it("skips canceled parents — no depends_on relations are attempted", async () => {
		const parent = makeTask({
			title: PARENT_TITLE,
			description: PARENT_DESCRIPTION,
			status: "canceled",
			canceled_at: new Date().toISOString()
		});
		const child = makeTask({
			title: CHILD_TITLE,
			description: CHILD_DESCRIPTION,
			status: "pending",
			parent_id: parent.id
		});
		db.tasks.insertTask(parent);
		db.tasks.insertTask(child);

		await saveTaskRelations(CHILD_DESCRIPTION, CHILD_TITLE, "test", REPO, db, { parentId: parent.id });

		// No depends_on edges and no entity resurrected from the canceled
		// parent's content (its entities were already swept).
		const dependsOn = db.db
			.prepare("SELECT COUNT(*) as cnt FROM relations WHERE relation_type = 'depends_on'")
			.get() as { cnt: number };
		expect(dependsOn.cnt).toBe(0);
		expect(db.knowledgeGraph.getEntityByName(PARENT_ENTITY, REPO)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// ensureRelation atomicity (TASK-072)
//
// ensureRelation wraps the 2 endpoint upserts + the relation insert in a
// single BEGIN IMMEDIATE transaction (base.ts `transaction()` is immediate
// per TASK-064 / MEM-475). These tests pin that contract: a failure anywhere
// rolls back EVERYTHING (no half-written endpoint entities), and a nested
// call inside an outer transaction commits atomically via savepoints
// (better-sqlite3 reentrancy). Without the transaction wrapper the endpoint
// upserts would autocommit and survive the failed relation insert — the
// exact regression the rollback test guards against (TASK-078 finding).
// ---------------------------------------------------------------------------

describe("KnowledgeGraphEntity — ensureRelation atomicity (TASK-072)", () => {
	let db: SQLiteStore;

	const REPO = "kg-atomicity-test";

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("rolls back both endpoint upserts when the relation insert throws", () => {
		const now = new Date().toISOString();

		// Simulate a mid-transaction failure: the relation insert throws after
		// the two endpoint upserts already ran inside the transaction.
		const upsertRelationSpy = vi.spyOn(db.knowledgeGraph, "upsertRelation").mockImplementation(() => {
			throw new Error("boom");
		});

		expect(() =>
			db.knowledgeGraph.ensureRelation({
				from_entity: "A",
				from_type: "concept",
				to_entity: "B",
				to_type: "concept",
				relation_type: "related_to",
				repo: REPO,
				owner: "test",
				created_at: now
			})
		).toThrow("boom");

		// The failure came from the relation insert (last step of ensureRelation).
		expect(upsertRelationSpy).toHaveBeenCalledTimes(1);

		// Rollback proof: neither endpoint survives the failed relation insert.
		// Without the BEGIN IMMEDIATE wrapper these would have autocommitted.
		expect(db.knowledgeGraph.getEntityByName("A", REPO)).toBeUndefined();
		expect(db.knowledgeGraph.getEntityByName("B", REPO)).toBeUndefined();
	});

	it("nested inside an outer transaction, ensureRelation commits atomically via savepoints", () => {
		const now = new Date().toISOString();

		// Outer BEGIN IMMEDIATE; each nested ensureRelation runs inside a
		// SAVEPOINT and releases it on success, so every write commits together
		// when the outer transaction commits.
		db.db
			.transaction(() => {
				db.knowledgeGraph.ensureRelation({
					from_entity: "A",
					from_type: "concept",
					to_entity: "B",
					to_type: "concept",
					relation_type: "related_to",
					repo: REPO,
					owner: "test",
					created_at: now
				});
				db.knowledgeGraph.ensureRelation({
					from_entity: "C",
					from_type: "concept",
					to_entity: "D",
					to_type: "concept",
					relation_type: "related_to",
					repo: REPO,
					owner: "test",
					created_at: now
				});
			})
			.immediate();

		// Both endpoint pairs and both edges committed atomically.
		expect(db.knowledgeGraph.getEntityByName("A", REPO)).toBeDefined();
		expect(db.knowledgeGraph.getEntityByName("B", REPO)).toBeDefined();
		expect(db.knowledgeGraph.getEntityByName("C", REPO)).toBeDefined();
		expect(db.knowledgeGraph.getEntityByName("D", REPO)).toBeDefined();
		expect(db.knowledgeGraph.listRelations(REPO)).toHaveLength(2);
	});
});
