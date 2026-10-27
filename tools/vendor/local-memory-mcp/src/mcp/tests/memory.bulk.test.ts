import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { MemoryEntry, VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP Local Memory - Bulk Memory Management", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "bulk-mem-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.json = true;
			}
			return rawRouter(method, params);
		};
	});

	it("should bulk create memories via memory-write", async () => {
		const m1 = {
			type: "code_fact",
			title: "Memory 1 Title",
			content: "Alpha: This is a unique fact about the first component of the system.",
			importance: 3,
			agent: "Agent-A",
			model: "Model-X"
		};
		const m2 = {
			type: "code_fact",
			title: "Memory 2 Title",
			content: "Beta: Completely different technical detail regarding the secondary subsystem architecture.",
			importance: 3,
			agent: "Agent-A",
			model: "Model-X"
		};

		const bulkRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [m1, m2]
			}
		});

		expect(bulkRes.structuredContent.success).toBe(true);
		expect(bulkRes.structuredContent.processed).toBe(2);
		expect(getPrimaryTextContent(bulkRes)).toContain("Processed 2/2");

		const memories = db.memories.getRecentMemories("test", REPO, 10);
		expect(memories.length).toBe(2);
	});

	it("should bulk delete memories via memory-delete", async () => {
		const bulkCreate = await router("tools/call", {
			name: "memory-write",
			arguments: {
				owner: "test",
				repo: REPO,
				memories: [
					{
						type: "code_fact",
						title: "Memory 1 Title",
						content: "Alpha: This is a unique fact about the first component of the system.",
						importance: 3,
						agent: "Agent-A",
						model: "Model-X"
					},
					{
						type: "code_fact",
						title: "Memory 2 Title",
						content: "Beta: Completely different technical detail regarding the secondary subsystem architecture.",
						importance: 3,
						agent: "Agent-A",
						model: "Model-X"
					}
				]
			}
		});

		// Extract IDs from bulk results
		const ids = bulkCreate.structuredContent.results.map((r: { id: string }) => r.id);

		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				ids
			}
		});

		expect(getPrimaryTextContent(delRes)).toContain("Deleted 2 memories from");
		const remaining = db.memories.getRecentMemories("test", REPO, 10);
		expect(remaining.length).toBe(0);
	});
});

// --- TASK-122: bulkUpdateMemories structuredData merge alignment ---
// bulk must behave like the single update() path: structuredData is stored as
// a key inside each row's metadata JSON blob, so a bulk update carrying
// structuredData has to merge it per row (read stored metadata + set key),
// while a bulk update without it leaves structuredData untouched.

function createMemoryForBulk(id: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	const now = new Date().toISOString();
	return {
		id,
		type: "code_fact",
		title: `Bulk Memory ${id}`,
		content: `Bulk memory content for ${id}.`,
		importance: 3,
		agent: "test-agent",
		role: "backend-executor",
		model: "test-model",
		scope: { owner: "test", repo: "bulk-mem-repo" },
		created_at: now,
		updated_at: now,
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

describe("Memory bulk update structuredData merge (TASK-122)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;

	beforeEach(async () => {
		db = await createTestStore();
	});

	it("bulk update WITH structuredData merges into existing metadata per row, matching single update()", () => {
		const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const idB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
		db.memories.insert(createMemoryForBulk(idA, { metadata: { retained: true, tag: "A" } }));
		db.memories.insert(createMemoryForBulk(idB, { metadata: { retained: true, tag: "B" } }));

		const mergedPayload = { decision: "bulk-merge", count: 1 };
		const changed = db.memories.bulkUpdateMemories([idA, idB], { structuredData: mergedPayload });

		expect(changed).toBe(2);

		const rowA = db.memories.getById(idA);
		const rowB = db.memories.getById(idB);
		// Same shape single update() produces: existing metadata preserved,
		// structuredData key set inside the stored metadata blob.
		expect(rowA?.metadata).toEqual({ retained: true, tag: "A" });
		expect(rowA?.structuredData).toEqual(mergedPayload);
		expect(rowB?.metadata).toEqual({ retained: true, tag: "B" });
		expect(rowB?.structuredData).toEqual(mergedPayload);

		// Prove equivalence with the single update path on a fresh row.
		const idC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
		db.memories.insert(createMemoryForBulk(idC, { metadata: { retained: true, tag: "C" } }));
		const singlePayload = { decision: "single-merge", count: 2 };
		db.memories.update(idC, { structuredData: singlePayload });
		const rowC = db.memories.getById(idC);
		expect(rowC?.metadata).toEqual({ retained: true, tag: "C" });
		expect(rowC?.structuredData).toEqual(singlePayload);

		const rawBulk = JSON.parse(
			(db.db.prepare("SELECT metadata FROM memories WHERE id = ?").get(idA) as { metadata: string }).metadata
		) as Record<string, unknown>;
		expect(rawBulk).toEqual({ retained: true, tag: "A", structuredData: mergedPayload });
	});

	it("bulk update WITHOUT structuredData leaves structuredData and metadata unchanged", () => {
		const idA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
		const idB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
		db.memories.insert(
			createMemoryForBulk(idA, { metadata: { retained: true }, structuredData: { keep: "me", n: 1 } })
		);
		db.memories.insert(createMemoryForBulk(idB, { metadata: { retained: true }, structuredData: { keep: "me-too" } }));

		const changed = db.memories.bulkUpdateMemories([idA, idB], { importance: 5 });

		expect(changed).toBe(2);
		const rowA = db.memories.getById(idA);
		const rowB = db.memories.getById(idB);
		expect(rowA?.importance).toBe(5);
		expect(rowA?.metadata).toEqual({ retained: true });
		expect(rowA?.structuredData).toEqual({ keep: "me", n: 1 });
		expect(rowB?.importance).toBe(5);
		expect(rowB?.metadata).toEqual({ retained: true });
		expect(rowB?.structuredData).toEqual({ keep: "me-too" });
	});

	it("existing metadata stays intact after a structuredData-only bulk update (replaces, not deep-merges)", () => {
		const idA = "ffffffff-ffff-4fff-8fff-ffffffffffff";
		const idB = "11111111-1111-4111-8111-111111111111";
		db.memories.insert(createMemoryForBulk(idA, { metadata: { foo: "bar" }, structuredData: { old: "value" } }));
		db.memories.insert(createMemoryForBulk(idB, { metadata: { foo: "bar" }, structuredData: { old: "value" } }));

		const replacement = { new: "value" };
		const changed = db.memories.bulkUpdateMemories([idA, idB], { structuredData: replacement });

		expect(changed).toBe(2);
		const rowA = db.memories.getById(idA);
		const rowB = db.memories.getById(idB);
		// Metadata siblings preserved; structuredData key replaced wholesale —
		// exactly what update() does ({ ...existingMeta, structuredData: v }).
		expect(rowA?.metadata).toEqual({ foo: "bar" });
		expect(rowA?.structuredData).toEqual(replacement);
		expect(rowB?.metadata).toEqual({ foo: "bar" });
		expect(rowB?.structuredData).toEqual(replacement);
	});
});
