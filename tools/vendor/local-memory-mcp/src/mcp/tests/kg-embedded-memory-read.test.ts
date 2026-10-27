import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleMemoryWrite } from "../tools/memory.write";
import { handleMemoryRead } from "../tools/memory.read";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import type { VectorStore } from "../types/vector";
import { makeMockVectorStore, drainOutbox } from "./kg-archivist.shared";

describe("KG Archivist — embedded KG context in memory-read", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	const KG_REPO = "kg-context-memory-test";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = makeMockVectorStore();
	});

	afterEach(() => {
		db.close();
	});

	it("includes kg when reading a memory by id", async () => {
		// Store a memory with entity-rich content (triggers auto-extraction)
		const writeResult = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Context Memory Alpha",
				content: "Alice deployed the system to Seattle for Acme Corp",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Context Memory Alpha",
						content: "Alice deployed the system to Seattle for Acme Corp",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		const memoryId = (writeResult.structuredContent as { results: Array<{ id: string }> }).results[0].id;

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		// Read it back in detail mode
		const readResult = await handleMemoryRead({ id: memoryId, owner: "test", repo: KG_REPO, json: true }, db, vectors);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<unknown>; relations: Array<unknown> };
		expect(kgContext.entities.length).toBeGreaterThan(0);
		expect(kgContext.relations.length).toBeGreaterThan(0);
		// Entities should include extracted names
		const entityNames = (kgContext.entities as Array<{ name: string }>).map((e) => e.name);
		expect(entityNames).toEqual(expect.arrayContaining(["Alice", "Seattle", "Acme Corp"]));
	});

	it("includes kg when reading a memory by code", async () => {
		const writeResult = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Context By Code",
				content: "Bob and Charlie worked on the database schema",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Context By Code",
						content: "Bob and Charlie worked on the database schema",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		const memoryCode = (writeResult.structuredContent as { results: Array<{ code: string }> }).results[0].code;

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		const readResult = await handleMemoryRead(
			{ code: memoryCode, owner: "test", repo: KG_REPO, json: true },
			db,
			vectors
		);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toEqual(expect.arrayContaining(["Bob", "Charlie"]));
	});

	it("includes aggregated kg in bulk detail by ids", async () => {
		const m1 = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Bulk KG A",
				content: "Alice deployed the system to Seattle for Acme Corp",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Bulk KG A",
						content: "Alice deployed the system to Seattle for Acme Corp",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);
		const m2 = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Bulk KG B",
				content: "Bob and Charlie worked on the database schema",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Bulk KG B",
						content: "Bob and Charlie worked on the database schema",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		const ids = [
			(m1.structuredContent as { results: Array<{ id: string }> }).results[0].id,
			(m2.structuredContent as { results: Array<{ id: string }> }).results[0].id
		];

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		const readResult = await handleMemoryRead({ ids, owner: "test", repo: KG_REPO, json: true }, db, vectors);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		// Should include entities from both memories
		expect(entityNames).toEqual(expect.arrayContaining(["Alice", "Bob", "Seattle", "Acme Corp"]));
	});

	it("includes aggregated kg in bulk detail by codes", async () => {
		const m1 = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Bulk Code KG A",
				content: "Charlie deployed the system to London",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Bulk Code KG A",
						content: "Charlie deployed the system to London",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);
		const m2 = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Bulk Code KG B",
				content: "Diana deployed the office in London",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Bulk Code KG B",
						content: "Diana deployed the office in London",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		const codes = [
			(m1.structuredContent as { results: Array<{ code: string }> }).results[0].code,
			(m2.structuredContent as { results: Array<{ code: string }> }).results[0].code
		];

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		const readResult = await handleMemoryRead({ codes, owner: "test", repo: KG_REPO, json: true }, db, vectors);

		const data = readResult.structuredContent as Record<string, unknown>;
		expect(data.kg).toBeDefined();
		const kgContext = data.kg as { entities: Array<{ name: string }> };
		const entityNames = kgContext.entities.map((e: { name: string }) => e.name);
		expect(entityNames).toEqual(expect.arrayContaining(["Charlie", "Diana", "London"]));
	});

	it("returns empty kg when memory has no associated entities", async () => {
		// Store memory with stopword-only content that won't extract entities
		const writeResult = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Boring Contextless",
				content: "the and of in to a this is just stopwords here now",
				importance: 3,
				scope: { owner: "test", repo: KG_REPO },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Boring Contextless",
						content: "the and of in to a this is just stopwords here now",
						importance: 3,
						scope: { owner: "test", repo: KG_REPO },
						agent: "test",
						role: "tester",
						model: "test"
					}
				],
				json: true
			},
			db,
			vectors
		);

		const memoryId = (writeResult.structuredContent as { results: Array<{ id: string }> }).results[0].id;

		const readResult = await handleMemoryRead({ id: memoryId, owner: "test", repo: KG_REPO, json: true }, db, vectors);

		const data = readResult.structuredContent as Record<string, unknown>;
		// kg should either be absent or have empty arrays
		if (data.kg) {
			const kgContext = data.kg as { entities: Array<unknown>; relations: Array<unknown> };
			expect(kgContext.entities).toHaveLength(0);
			expect(kgContext.relations).toHaveLength(0);
		}
	});
});
