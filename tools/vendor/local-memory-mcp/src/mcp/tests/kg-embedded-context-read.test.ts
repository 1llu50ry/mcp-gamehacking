import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { handleTaskRead } from "../tools/task.read";
import { handleStandardRead } from "../tools/standard.read";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import type { VectorStore } from "../types/vector";
import type { Task } from "../types";
import { makeMockVectorStore } from "./kg-archivist.shared";

// ---------------------------------------------------------------------------
// Embedded KG context: task-read responses
// ---------------------------------------------------------------------------

describe("KG Archivist — embedded KG context in task-read", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	const TASK_REPO = "kg-context-task-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = makeMockVectorStore();
	});

	afterEach(() => {
		db.close();
	});

	it("includes kg when task title/description references known entities", async () => {
		// Pre-populate entities that a task might reference
		const now = new Date().toISOString();
		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("AuthModule", "concept", "Authentication module", TASK_REPO, "test", now, now);

		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("PostgreSQL", "concept", "Database system", TASK_REPO, "test", now, now);

		// Create a task whose title contains entity names
		const taskId = randomUUID();
		db.tasks.insertTask({
			id: taskId,
			task_code: "KG-TASK-001",
			phase: "Testing",
			title: "Refactor AuthModule for PostgreSQL compatibility",
			description: "Update the AuthModule to use PostgreSQL",
			status: "pending",
			priority: 3,
			owner: "test",
			repo: TASK_REPO,
			est_tokens: 0,
			commit_id: null,
			changed_files: [],
			suggested_skills: [],
			parent_id: null,
			depends_on: null,
			tags: [],
			metadata: {},
			doc_path: "",
			agent: "test",
			role: "tester",
			model: "test",
			created_at: now,
			updated_at: now,
			in_progress_at: null,
			finished_at: null,
			canceled_at: null,
			hit_count: 0,
			comments_count: 0,
			last_used_at: null,
			coordination: {
				active_claim_count: 0,
				active_claim_agent: null,
				active_claim_role: null,
				active_claim_claimed_at: null,
				pending_handoff_count: 0,
				pending_handoff_id: null,
				pending_handoff_summary: null,
				pending_handoff_to_agent: null,
				pending_handoff_created_at: null
			}
		} as Task & {
			coordination: Record<string, unknown>;
			task_code: string;
			comments_count: number;
			last_used_at: string | null;
			hit_count: number;
		});

		const readResult = await handleTaskRead(
			{ task_code: "KG-TASK-001", owner: "test", repo: TASK_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toEqual(expect.arrayContaining(["AuthModule", "PostgreSQL"]));
	});

	it("returns empty kg when no entities match task text", async () => {
		const now = new Date().toISOString();
		// Entity exists but its name is not referenced in the task
		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("UnrelatedEntity", "concept", null, TASK_REPO, "test", now, now);

		const taskId = randomUUID();
		db.tasks.insertTask({
			id: taskId,
			task_code: "KG-TASK-002",
			phase: "Testing",
			title: "Simple task with no entity references",
			description: "No entity names appear in this text",
			status: "pending",
			priority: 3,
			owner: "test",
			repo: TASK_REPO,
			est_tokens: 0,
			commit_id: null,
			changed_files: [],
			suggested_skills: [],
			parent_id: null,
			depends_on: null,
			tags: [],
			metadata: {},
			doc_path: "",
			agent: "test",
			role: "tester",
			model: "test",
			created_at: now,
			updated_at: now,
			in_progress_at: null,
			finished_at: null,
			canceled_at: null,
			hit_count: 0,
			comments_count: 0,
			last_used_at: null,
			coordination: {
				active_claim_count: 0,
				active_claim_agent: null,
				active_claim_role: null,
				active_claim_claimed_at: null,
				pending_handoff_count: 0,
				pending_handoff_id: null,
				pending_handoff_summary: null,
				pending_handoff_to_agent: null,
				pending_handoff_created_at: null
			}
		} as Task & {
			coordination: Record<string, unknown>;
			task_code: string;
			comments_count: number;
			last_used_at: string | null;
			hit_count: number;
		});

		const readResult = await handleTaskRead(
			{ task_code: "KG-TASK-002", owner: "test", repo: TASK_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		if (data.kg) {
			const kgContext = data.kg as { entities: Array<unknown>; relations: Array<unknown> };
			expect(kgContext.entities).toHaveLength(0);
			expect(kgContext.relations).toHaveLength(0);
		}
	});
});

// ---------------------------------------------------------------------------
// Embedded KG context: standard-read responses
// ---------------------------------------------------------------------------

describe("KG Archivist — embedded KG context in standard-read", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	const STD_REPO = "kg-context-standard-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = makeMockVectorStore();
	});

	afterEach(() => {
		db.close();
	});

	it("includes kg when standard has associated entities via observation", async () => {
		const now = new Date().toISOString();

		// Insert a coding standard
		db.standards.insert({
			id: randomUUID(),
			code: "TEST-STD-001",
			title: "API Authentication Standard",
			content: "All API endpoints must use JWT tokens.",
			parent_id: null,
			context: "security",
			version: "1.0",
			language: null,
			stack: ["laravel"],
			is_global: false,
			owner: "test",
			repo: STD_REPO,
			tags: ["auth", "api"],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});

		// Insert entities and observations with the pattern that fetchKgContext expects
		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("JWT", "concept", "JSON Web Token", STD_REPO, "test", now, now);

		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("OAuth2", "concept", "OAuth 2.0 protocol", STD_REPO, "test", now, now);

		// Create observations linking entities to the standard
		db.db
			.prepare(
				`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(randomUUID(), "JWT", "Mentioned in standard: API Authentication Standard", STD_REPO, "test", now);

		db.db
			.prepare(
				`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(randomUUID(), "OAuth2", "Mentioned in standard: API Authentication Standard", STD_REPO, "test", now);

		const readResult = await handleStandardRead(
			{ code: "TEST-STD-001", owner: "test", repo: STD_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }>; relations: Array<unknown> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toEqual(expect.arrayContaining(["JWT", "OAuth2"]));
		// Observations are stored — no relations are created without explicit relation insertion
		expect(kgContext.relations).toBeDefined();
	});

	it("returns empty kg for standards without entity observations", async () => {
		const now = new Date().toISOString();

		// Standard with no corresponding observation records
		db.standards.insert({
			id: randomUUID(),
			code: "TEST-STD-002",
			title: "Unrelated Style Guide",
			content: "Use tabs for indentation.",
			parent_id: null,
			context: "style",
			version: "1.0",
			language: "typescript",
			stack: [],
			is_global: true,
			owner: "test",
			repo: null,
			tags: ["style"],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});

		// Entities exist in DB but have no observation linking to this standard
		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("Tabs", "concept", null, STD_REPO, "test", now, now);

		const readResult = await handleStandardRead(
			{ code: "TEST-STD-002", owner: "test", repo: STD_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		if (data.kg) {
			const kgContext = data.kg as { entities: Array<unknown>; relations: Array<unknown> };
			expect(kgContext.entities).toHaveLength(0);
			expect(kgContext.relations).toHaveLength(0);
		}
	});

	it("includes aggregated kg in standard bulk detail by ids", async () => {
		const now = new Date().toISOString();

		// Two standards
		db.standards.insert({
			id: "std-bulk-1",
			code: "STD-B1",
			title: "Std Bulk A",
			content: "Content A",
			parent_id: null,
			context: "test",
			version: "1.0",
			language: null,
			stack: [],
			is_global: false,
			owner: "test",
			repo: STD_REPO,
			tags: [],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});
		db.standards.insert({
			id: "std-bulk-2",
			code: "STD-B2",
			title: "Std Bulk B",
			content: "Content B",
			parent_id: null,
			context: "test",
			version: "1.0",
			language: null,
			stack: [],
			is_global: false,
			owner: "test",
			repo: STD_REPO,
			tags: [],
			metadata: {},
			created_at: now,
			updated_at: now,
			hit_count: 0,
			last_used_at: null,
			agent: "test",
			model: "test"
		});

		// One entity linked to both standards
		db.db
			.prepare(
				`INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run("SharedEntity", "concept", null, STD_REPO, "test", now, now);

		db.db
			.prepare(
				`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(randomUUID(), "SharedEntity", "Mentioned in standard: Std Bulk A", STD_REPO, "test", now);
		db.db
			.prepare(
				`INSERT INTO observations (id, entity_name, observation, repo, owner, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(randomUUID(), "SharedEntity", "Mentioned in standard: Std Bulk B", STD_REPO, "test", now);

		const readResult = await handleStandardRead(
			{ ids: ["std-bulk-1", "std-bulk-2"], owner: "test", repo: STD_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toContain("SharedEntity");
	});
});
