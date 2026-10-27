import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleMemoryWrite } from "../tools/memory.write";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import type { VectorStore } from "../types/vector";
import { makeMockVectorStore, drainOutbox } from "./kg-archivist.shared";

describe("KG Archivist — integration with handleMemoryWrite", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = makeMockVectorStore();
	});

	afterEach(() => {
		db.close();
	});

	it("automatically extracts entities when storing a memory", async () => {
		await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Team Update",
				content: "Alice and Bob deployed the system to Seattle",
				importance: 3,
				scope: { owner: "test", repo: "test-repo" },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Team Update",
						content: "Alice and Bob deployed the system to Seattle",
						importance: 3,
						scope: { owner: "test", repo: "test-repo" },
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

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		// Entities should have been extracted from the content
		const entities = db.db.prepare("SELECT name, type FROM entities").all() as Array<{
			name: string;
			type: string;
		}>;

		expect(entities.length).toBeGreaterThan(0);
		const names = entities.map((e) => e.name);
		expect(names).toEqual(expect.arrayContaining(["Alice", "Bob", "Seattle"]));
	});

	it("creates observation records for each extracted entity", async () => {
		await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Team Update",
				content: "Alice deployed the system to Seattle",
				importance: 3,
				scope: { owner: "test", repo: "test-repo" },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Team Update",
						content: "Alice deployed the system to Seattle",
						importance: 3,
						scope: { owner: "test", repo: "test-repo" },
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

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		const observations = db.db.prepare("SELECT entity_name, observation FROM observations").all() as Array<{
			entity_name: string;
			observation: string;
		}>;

		expect(observations.length).toBeGreaterThan(0);
		for (const obs of observations) {
			expect(obs.observation).toBe("Mentioned in memory: Team Update");
		}
	});

	it("extracts entities from each memory in a bulk store", async () => {
		await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Multiple Memories",
				content: "Bulk memory storage with entities", // top-level is optional in bulk, but must be >=10 if present
				importance: 3,
				scope: { owner: "test", repo: "test-repo" },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Personnel",
						content: "Alice and Bob joined the team",
						importance: 3,
						scope: { owner: "test", repo: "test-repo" },
						agent: "test",
						role: "tester",
						model: "test"
					},
					{
						type: "code_fact",
						title: "Location",
						content: "Seattle office is now open",
						importance: 3,
						scope: { owner: "test", repo: "test-repo" },
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

		// KG extraction is async (outbox worker, TASK-013) — drain it first.
		await drainOutbox(db);

		const entities = db.db.prepare("SELECT name FROM entities").all() as Array<{ name: string }>;
		const names = entities.map((e) => e.name);

		expect(names).toEqual(expect.arrayContaining(["Alice", "Bob", "Seattle"]));
	});

	it("does not block the memory store operation when extraction produces no entities", async () => {
		const result = await handleMemoryWrite(
			{
				type: "code_fact",
				title: "Boring",
				content: "the and of in to a",
				importance: 3,
				scope: { owner: "test", repo: "test-repo" },
				agent: "test",
				role: "tester",
				model: "test",
				memories: [
					{
						type: "code_fact",
						title: "Boring",
						content: "the and of in to a",
						importance: 3,
						scope: { owner: "test", repo: "test-repo" },
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

		// Memory store itself should succeed
		expect(result.isError).toBeFalsy();

		// Drain the outbox — stopword-only content still extracts nothing.
		await drainOutbox(db);

		// No entities should have been extracted
		const entities = db.db.prepare("SELECT COUNT(*) as cnt FROM entities").get() as { cnt: number };
		expect(entities.cnt).toBe(0);
	});
});
