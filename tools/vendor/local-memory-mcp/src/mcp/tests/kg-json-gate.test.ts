/**
 * Unit tests for the KG-payload gating fixes (audit F3 / F4).
 *
 * F3 — the KG context lookup is the dominant cost of a read, yet `kg` only
 *      ever ships inside `structuredContent`. Every read tool must therefore
 *      skip the lookup entirely when `json` is false.
 * F4 — `standard-read` hardcoded `includeJson: true` in list + search mode, so
 *      the `json` flag it already accepted was silently ignored there while
 *      detail mode honoured it.
 *
 * Strategy: real in-memory store, real handlers. The KG fetch is observed via
 * a spy on the entity-name resolver — the single choke point every context
 * fetcher goes through — so the assertion is "the lookup did not happen",
 * not merely "the payload was absent".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { handleMemoryRead } from "../tools/memory.read";
import { handleStandardRead } from "../tools/standard-read";
import { handleTaskRead } from "../tools/task-read";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { observationText } from "../tools/kg-archivist";
import type { VectorStore } from "../types/vector";
import type { CodingStandardEntry, MemoryEntry, Task } from "../types";
import { makeMockVectorStore } from "./kg-archivist.shared";

const OWNER = "test";
const REPO = "kg-json-gate-test";
const NOW = new Date().toISOString();

function seedGraph(db: SQLiteStore, observation: string): void {
	db.knowledgeGraph.ensureObservation({
		id: randomUUID(),
		name: "AuthModule",
		type: "concept",
		description: null,
		observation,
		repo: REPO,
		owner: OWNER,
		created_at: NOW
	});
	db.knowledgeGraph.ensureRelation({
		from_entity: "AuthModule",
		from_type: "concept",
		to_entity: "PostgreSQL",
		to_type: "concept",
		relation_type: "depends_on",
		repo: REPO,
		owner: OWNER,
		created_at: NOW
	});
}

function makeMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: randomUUID(),
		type: "code_fact",
		title: "AuthModule uses PostgreSQL",
		content: "The AuthModule persists sessions in PostgreSQL.",
		importance: 3,
		agent: "test",
		role: "backend",
		model: "test",
		scope: { owner: OWNER, repo: REPO },
		created_at: NOW,
		updated_at: NOW,
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: null,
		supersedes: null,
		status: "active",
		tags: [],
		metadata: {},
		is_global: false,
		...overrides
	};
}

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: randomUUID(),
		owner: OWNER,
		repo: REPO,
		task_code: "GATE-1",
		phase: "build",
		title: "AuthModule migration",
		description: "Move AuthModule sessions to PostgreSQL.",
		status: "backlog",
		priority: 3,
		agent: "test",
		role: "backend",
		doc_path: null,
		created_at: NOW,
		updated_at: NOW,
		in_progress_at: null,
		finished_at: null,
		canceled_at: null,
		est_tokens: 0,
		tags: [],
		suggested_skills: [],
		commit_id: null,
		changed_files: [],
		metadata: {},
		parent_id: null,
		depends_on: null,
		...overrides
	};
}

function makeStandard(overrides: Partial<CodingStandardEntry> = {}): CodingStandardEntry {
	return {
		id: randomUUID(),
		code: `CS-${randomUUID().slice(0, 6)}`,
		title: "AuthModule standard",
		content: "AuthModule must use PostgreSQL sessions.",
		parent_id: null,
		context: "backend",
		version: "1",
		language: "typescript",
		stack: [],
		is_global: false,
		owner: OWNER,
		repo: REPO,
		tags: ["auth"],
		metadata: {},
		created_at: NOW,
		updated_at: NOW,
		hit_count: 0,
		last_used_at: null,
		agent: "test",
		model: "test",
		...overrides
	};
}

describe("KG audit F3 — the KG lookup is skipped when json is false", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = makeMockVectorStore();
	});
	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("memory-read SEARCH: resolver untouched in text mode, called in json mode", async () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		seedGraph(db, observationText("memory", memory.title));
		const spy = vi.spyOn(db.knowledgeGraph, "getEntityNamesByObservations");

		const text = await handleMemoryRead({ owner: OWNER, repo: REPO, query: "AuthModule" }, db, vectors);
		expect(spy).not.toHaveBeenCalled();
		expect(text.structuredContent).toBeUndefined();

		const json = await handleMemoryRead({ owner: OWNER, repo: REPO, query: "AuthModule", json: true }, db, vectors);
		expect(spy).toHaveBeenCalled();
		expect(json.content?.[0]).toMatchObject({ type: "text" });
		expect((json.content?.[0] as { text: string }).text.length).toBeGreaterThan(0);
		expect(json.structuredContent).toMatchObject({ schema: "memory-read", mode: "search" });
		expect((json.structuredContent as Record<string, unknown>).kg).toBeDefined();
	});

	it("memory-read RECAP: resolver untouched in text mode", async () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		seedGraph(db, observationText("memory", memory.title));
		const spy = vi.spyOn(db.knowledgeGraph, "getEntityNamesByObservations");

		await handleMemoryRead({ owner: OWNER, repo: REPO }, db, vectors);

		expect(spy).not.toHaveBeenCalled();
	});

	it("memory-read DETAIL: resolver untouched in text mode, called in json mode", async () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		seedGraph(db, observationText("memory", memory.title));
		const spy = vi.spyOn(db.knowledgeGraph, "getEntityNamesByObservation");

		await handleMemoryRead({ owner: OWNER, repo: REPO, id: memory.id }, db, vectors);
		expect(spy).not.toHaveBeenCalled();

		const json = await handleMemoryRead({ owner: OWNER, repo: REPO, id: memory.id, json: true }, db, vectors);
		expect(spy).toHaveBeenCalled();
		expect(json.structuredContent).toMatchObject({ schema: "memory-read", mode: "detail", memory: { id: memory.id } });
	});

	it("task-read LIST: resolver untouched in text mode, called in json mode", async () => {
		db.tasks.insertTask(makeTask());
		const spy = vi.spyOn(db.knowledgeGraph, "getEntityNamesByText");

		await handleTaskRead({ owner: OWNER, repo: REPO }, db, vectors);
		expect(spy).not.toHaveBeenCalled();

		const json = await handleTaskRead({ owner: OWNER, repo: REPO, json: true }, db, vectors);
		expect(spy).toHaveBeenCalled();
		expect(json.content?.[0]).toMatchObject({ type: "text" });
		expect((json.content?.[0] as { text: string }).text.length).toBeGreaterThan(0);
		expect(json.structuredContent).toMatchObject({ schema: "task-read/list", mode: "list" });
	});

	it("task-read DETAIL: resolver untouched in text mode", async () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		const spy = vi.spyOn(db.knowledgeGraph, "getEntityNamesByText");

		const text = await handleTaskRead({ owner: OWNER, repo: REPO, id: task.id }, db, vectors);
		expect(spy).not.toHaveBeenCalled();
		expect(text.structuredContent).toBeUndefined();

		const json = await handleTaskRead({ owner: OWNER, repo: REPO, id: task.id, json: true }, db, vectors);
		expect(json.content?.[0]).toMatchObject({ type: "text" });
		expect((json.content?.[0] as { text: string }).text.length).toBeGreaterThan(0);
		expect(json.structuredContent).toMatchObject({ schema: "task-read/detail", mode: "detail", id: task.id });
	});
});

describe("KG audit F4 — standard-read honours the json flag in every mode", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = makeMockVectorStore();
		db.standards.insert(makeStandard());
	});
	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("LIST mode: no structuredContent without json, present with json", async () => {
		const text = await handleStandardRead({ owner: OWNER, repo: REPO }, db, vectors);
		expect(text.structuredContent).toBeUndefined();

		const json = await handleStandardRead({ owner: OWNER, repo: REPO, json: true }, db, vectors);
		expect(json.content?.[0]).toMatchObject({ type: "text" });
		expect((json.content?.[0] as { text: string }).text.length).toBeGreaterThan(0);
		expect(json.structuredContent).toMatchObject({ schema: "standard-read", mode: "list" });
	});

	it("SEARCH mode: no structuredContent without json, present with json", async () => {
		const text = await handleStandardRead({ owner: OWNER, repo: REPO, query: "AuthModule" }, db, vectors);
		expect(text.structuredContent).toBeUndefined();

		const json = await handleStandardRead({ owner: OWNER, repo: REPO, query: "AuthModule", json: true }, db, vectors);
		expect(json.structuredContent).toMatchObject({ schema: "standard-read", mode: "search" });
	});

	it("LIST mode: the KG resolver is not called in text mode", async () => {
		const spy = vi.spyOn(db.knowledgeGraph, "getEntityNamesByObservations");

		await handleStandardRead({ owner: OWNER, repo: REPO }, db, vectors);

		expect(spy).not.toHaveBeenCalled();
	});

	it("text mode still returns the human-readable summary", async () => {
		const text = await handleStandardRead({ owner: OWNER, repo: REPO }, db, vectors);

		const first = text.content?.[0];
		expect(first?.type).toBe("text");
		expect(first && "text" in first ? first.text : "").toContain("AuthModule standard");
	});
});
