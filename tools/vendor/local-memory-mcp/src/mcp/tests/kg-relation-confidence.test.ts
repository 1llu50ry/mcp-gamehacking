import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { saveExtractions, saveTaskRelations, saveCodebaseRelations } from "../tools/kg-archivist";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import type { Task } from "../types";

// ---------------------------------------------------------------------------
// Relation confidence ([KGCONF-1] / TASK-325, migration v24)
//
// Every relations row carries a REAL confidence label (NOT NULL DEFAULT 1.0)
// chosen at insert time by the WRITER (the relations table has no source
// column — the writer IS the provenance). Mapping documented in the v24
// migration: NLP auto-extraction (saveExtractions co_mentioned) 0.55,
// structured semantic writers (saveTaskRelations depends_on/inspired_by,
// saveStandardRelations extends/related_to) 0.8, parser-deterministic
// codebase edges (saveCodebaseRelations) 0.9, explicit/manual + default 1.0.
// INSERT OR IGNORE is first-write-wins: a re-insert of an existing edge is a
// no-op, so the FIRST writer's confidence sticks.
// ---------------------------------------------------------------------------

describe("KnowledgeGraphEntity — relation confidence (TASK-325)", () => {
	let db: SQLiteStore;

	const REPO = "kg-conf-test";

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("persists explicit confidence and defaults omitted inserts to 1.0", () => {
		const now = new Date().toISOString();

		db.knowledgeGraph.upsertEntity({
			name: "A",
			type: "concept",
			description: null,
			repo: REPO,
			owner: "test",
			created_at: now,
			updated_at: now
		});
		db.knowledgeGraph.upsertEntity({
			name: "B",
			type: "concept",
			description: null,
			repo: REPO,
			owner: "test",
			created_at: now,
			updated_at: now
		});

		// Explicit confidence round-trips through the row reader.
		db.knowledgeGraph.upsertRelation({
			from_entity: "A",
			to_entity: "B",
			relation_type: "related_to",
			repo: REPO,
			owner: "test",
			created_at: now,
			confidence: 0.8
		});
		// Omitted confidence → the entity-level default 1.0 (backward compat).
		db.knowledgeGraph.upsertRelation({
			from_entity: "B",
			to_entity: "A",
			relation_type: "related_to",
			repo: REPO,
			owner: "test",
			created_at: now
		});

		const rows = db.knowledgeGraph.getRelationsByName("A", REPO);
		expect(rows).toHaveLength(2);
		const aToB = rows.find((r) => r.from_entity === "A" && r.to_entity === "B");
		expect(aToB?.confidence).toBe(0.8);
		const bToA = rows.find((r) => r.from_entity === "B" && r.to_entity === "A");
		expect(bToA?.confidence).toBe(1);
	});

	it("INSERT OR IGNORE keeps the FIRST writer's confidence (first-write wins)", () => {
		const now = new Date().toISOString();

		// Auto-extraction grade first (0.55), then an explicit-grade retry
		// (1.0) of the SAME edge — the OR IGNORE PK collision means the row
		// (and its 0.55) survives untouched.
		db.knowledgeGraph.ensureRelation({
			from_entity: "X",
			from_type: "concept",
			to_entity: "Y",
			to_type: "concept",
			relation_type: "co_mentioned",
			repo: REPO,
			owner: "test",
			created_at: now,
			confidence: 0.55
		});
		db.knowledgeGraph.ensureRelation({
			from_entity: "X",
			from_type: "concept",
			to_entity: "Y",
			to_type: "concept",
			relation_type: "co_mentioned",
			repo: REPO,
			owner: "test",
			created_at: now,
			confidence: 1.0
		});

		const row = db.db
			.prepare(
				"SELECT confidence FROM relations WHERE from_entity = 'X' AND to_entity = 'Y' AND relation_type = 'co_mentioned'"
			)
			.get() as { confidence: number };
		expect(row.confidence).toBe(0.55);

		// Exactly one row — the duplicate was ignored, not updated.
		const count = db.db
			.prepare(
				"SELECT COUNT(*) AS c FROM relations WHERE from_entity = 'X' AND to_entity = 'Y' AND relation_type = 'co_mentioned'"
			)
			.get() as { c: number };
		expect(count.c).toBe(1);
	});

	it("ensureRelation passes confidence through to the insert", () => {
		const now = new Date().toISOString();

		db.knowledgeGraph.ensureRelation({
			from_entity: "A",
			from_type: "concept",
			to_entity: "B",
			to_type: "concept",
			relation_type: "extends",
			repo: REPO,
			owner: "test",
			created_at: now,
			confidence: 0.8
		});

		const row = db.db
			.prepare(
				"SELECT confidence FROM relations WHERE from_entity = 'A' AND to_entity = 'B' AND relation_type = 'extends'"
			)
			.get() as { confidence: number };
		expect(row.confidence).toBe(0.8);
	});

	it("graph edge reads (listGraphEdges / listGraphEdgesForSubset) expose confidence", () => {
		const now = new Date().toISOString();
		for (const name of ["A", "B", "C"]) {
			db.knowledgeGraph.upsertEntity({
				name,
				type: "concept",
				description: null,
				repo: REPO,
				owner: "test",
				created_at: now,
				updated_at: now
			});
		}
		db.knowledgeGraph.upsertRelation({
			from_entity: "A",
			to_entity: "B",
			relation_type: "related_to",
			repo: REPO,
			owner: "test",
			created_at: now,
			confidence: 0.7
		});
		db.knowledgeGraph.upsertRelation({
			from_entity: "A",
			to_entity: "C",
			relation_type: "co_mentioned",
			repo: REPO,
			owner: "test",
			created_at: now,
			confidence: 0.55
		});

		const edges = db.knowledgeGraph.listGraphEdges(REPO);
		expect(edges).toHaveLength(2);
		const ab = edges.find((e) => e.source === "A" && e.target === "B");
		expect(ab?.confidence).toBe(0.7);
		const ac = edges.find((e) => e.source === "A" && e.target === "C");
		expect(ac?.confidence).toBe(0.55);

		const subset = db.knowledgeGraph.listGraphEdgesForSubset(REPO, ["A", "B"]);
		expect(subset).toHaveLength(1);
		expect(subset[0].confidence).toBe(0.7);
	});

	it("saveExtractions writes co_mentioned edges at the auto-extraction confidence 0.55", async () => {
		await saveExtractions("Alice and Bob worked on the project", "Memory 1", "test", REPO, db);

		const row = db.db.prepare("SELECT confidence FROM relations WHERE relation_type = 'co_mentioned'").get() as
			| { confidence: number }
			| undefined;
		expect(row).toBeDefined();
		expect(row!.confidence).toBe(0.55);
	});

	it("saveTaskRelations writes depends_on edges at the semantic confidence 0.8", async () => {
		const now = new Date().toISOString();
		const parent = {
			id: randomUUID(),
			owner: "test",
			repo: REPO,
			task_code: `KG-PARENT-${randomUUID().slice(0, 6)}`,
			phase: "implementation",
			title: "[PARENT] Gold Standard Compliance (Aesthetics & Icons)",
			description: "Enforces quality standards and implementation details for the Icons theme",
			status: "completed",
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
			depends_on: null
		} satisfies Task;
		const child = {
			...parent,
			id: randomUUID(),
			task_code: `KG-CHILD-${randomUUID().slice(0, 6)}`,
			title: "Payroll Module",
			description: "Payroll Module implementation aligned with quality standards and Icons",
			status: "pending",
			parent_id: parent.id
		} satisfies Task;
		db.tasks.insertTask(parent);
		db.tasks.insertTask(child);

		await saveTaskRelations(child.description!, child.title, "test", REPO, db, { parentId: parent.id });

		// Deterministic endpoints (same corpus as the FK-integrity describe):
		// child "Payroll Module implementation" → parent "Icons theme".
		const row = db.db.prepare("SELECT confidence FROM relations WHERE relation_type = 'depends_on'").get() as
			| { confidence: number }
			| undefined;
		expect(row).toBeDefined();
		expect(row!.confidence).toBe(0.8);
	});

	it("saveCodebaseRelations writes reference edges at the codebase confidence 0.9", async () => {
		const filePath = "src/order.ts";
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: filePath, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols([{ repo: REPO, file_path: filePath, name: "OrderService", kind: "class" }]);
		db.codebaseReferences.bulkUpsertReferences(REPO, [
			{
				repo: REPO,
				symbol_name: "computeTotal",
				caller_file: filePath,
				caller_line: 5,
				caller_name: "OrderService",
				kind: "call"
			}
		]);

		await saveCodebaseRelations({ filePath, owner: "test", repo: REPO }, db);

		const row = db.db.prepare("SELECT confidence FROM relations WHERE relation_type = 'call'").get() as
			| { confidence: number }
			| undefined;
		expect(row).toBeDefined();
		expect(row!.confidence).toBe(0.9);
	});
});
