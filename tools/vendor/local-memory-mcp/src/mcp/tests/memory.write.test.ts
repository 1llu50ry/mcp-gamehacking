import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP Local Memory - memory-write (Create, Update, Acknowledge, Error)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "memory-write-test";

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

	// ─── CREATE single ───────────────────────────────────────────────────

	it("should CREATE a single memory via memory-write with type/title/content/importance", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Create Test",
				content: "This memory was created via memory-write CREATE mode.",
				importance: 4,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		expect(res.structuredContent.success).toBe(true);
		expect(res.structuredContent.id).toBeTruthy();
		expect(res.structuredContent.code).toBeTruthy();
		expect(res.structuredContent.type).toBe("code_fact");
		expect(res.structuredContent.title).toBe("Create Test");
		expect(getPrimaryTextContent(res)).toContain("Stored");

		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored).not.toBeNull();
		expect(stored!.title).toBe("Create Test");
		expect(stored!.content).toBe("This memory was created via memory-write CREATE mode.");
	});

	it("should CREATE a memory with explicit scope", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "decision",
				title: "Scoped Memory",
				content: "This memory has an explicit folder and language scope.",
				importance: 3,
				scope: { owner: "test", repo: REPO, folder: "src/auth", language: "typescript" },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored!.scope.folder).toBe("src/auth");
		expect(stored!.scope.language).toBe("typescript");
	});

	it("should CREATE with last_used_at = NULL and only stamp it via the acknowledge usage path", async () => {
		// Preserved behavior (MEM-586 / TASK-129 — INTENTIONAL): MemoryEntity.buildInsert
		// hardcodes last_used_at = NULL, so a newly created memory counts as "never
		// explicitly used" until an explicit usage path (acknowledge used / recall)
		// stamps it. Reads/searches never touch it (memory.read.ts).
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Usage Timestamp Semantics",
				content: "A memory is not marked used at creation; only acknowledge/recall stamp last_used_at.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const stored = db.memories.getById(res.structuredContent.id);
		expect(stored).not.toBeNull();
		expect(stored!.last_used_at).toBeNull();

		// acknowledge("used") → incrementRecallCount stamps last_used_at = now
		await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: stored!.id,
				acknowledge: "used",
				owner: "test",
				repo: REPO
			}
		});

		const afterAck = db.memories.getById(stored!.id);
		expect(afterAck!.last_used_at).not.toBeNull();
		expect(afterAck!.recall_count).toBe(1);
	});

	// ─── UPDATE single ───────────────────────────────────────────────────

	it("should UPDATE a single memory via memory-write with id + fields", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Original Title",
				content: "Original content that will be updated.",
				importance: 2,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const updateRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryId,
				title: "Updated Title",
				content: "Updated content after modification.",
				importance: 5,
				owner: "test",
				repo: REPO
			}
		});

		expect(updateRes.structuredContent.success).toBe(true);
		expect(updateRes.structuredContent.updatedFields).toContain("title");
		expect(updateRes.structuredContent.updatedFields).toContain("content");
		expect(updateRes.structuredContent.updatedFields).toContain("importance");
		expect(getPrimaryTextContent(updateRes)).toContain("Updated");

		const stored = db.memories.getById(memoryId);
		expect(stored!.title).toBe("Updated Title");
		expect(stored!.content).toBe("Updated content after modification.");
		expect(stored!.importance).toBe(5);
	});

	it("should UPDATE a memory by code (non-UUID passed as id)", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "pattern",
				title: "Code Update Target",
				content: "Memory to be updated by its code.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryCode = createRes.structuredContent.code;

		const updateRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryCode,
				title: "Updated By Code",
				owner: "test",
				repo: REPO
			}
		});

		expect(updateRes.structuredContent.success).toBe(true);

		const stored = db.memories.getById(createRes.structuredContent.id);
		expect(stored!.title).toBe("Updated By Code");
	});

	// ─── ACKNOWLEDGE ─────────────────────────────────────────────────────

	it("should ACKNOWLEDGE a memory as 'used' and increment recall_count", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Ack Used Test",
				content: "Memory that will be acknowledged as used.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const ackRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryId,
				acknowledge: "used",
				owner: "test",
				repo: REPO
			}
		});

		expect(ackRes.structuredContent.success).toBe(true);
		expect(ackRes.structuredContent.status).toBe("used");
		expect(getPrimaryTextContent(ackRes)).toContain("Acknowledged");

		const stored = db.memories.getById(memoryId);
		expect(stored!.recall_count).toBe(1);
	});

	it("should ACKNOWLEDGE a memory as 'irrelevant' without incrementing recall_count", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "decision",
				title: "Ack Irrelevant Test",
				content: "Memory acknowledged as irrelevant.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const ackRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryId,
				acknowledge: "irrelevant",
				owner: "test",
				repo: REPO
			}
		});

		expect(ackRes.structuredContent.status).toBe("irrelevant");

		const stored = db.memories.getById(memoryId);
		expect(stored!.recall_count).toBe(0);
	});

	it("should ACKNOWLEDGE a memory as 'contradictory'", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "mistake",
				title: "Ack Contradictory Test",
				content: "Memory acknowledged as contradictory.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const ackRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryId,
				acknowledge: "contradictory",
				owner: "test",
				repo: REPO
			}
		});

		expect(ackRes.structuredContent.status).toBe("contradictory");
	});

	it("should reject ACKNOWLEDGE with invalid status value", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Invalid Ack",
				content: "Testing invalid acknowledge value.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memoryId,
				acknowledge: "invalid_status",
				owner: "test",
				repo: REPO
			}
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain("acknowledge");
	});

	// ─── Error cases ─────────────────────────────────────────────────────

	it("should reject CREATE with metadata-like title", async () => {
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "[agent: test | 2026-01-01] Metadata in Title",
				content: "Title contains metadata patterns which should be rejected.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain("Title appears to contain metadata");
	});

	it("should reject UPDATE for non-existent memory", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		const res = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: fakeId,
				title: "No Op",
				owner: "test",
				repo: REPO
			}
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain("Memory not found");
	});

	it("should infer operation correctly: content→CREATE, id+fields→UPDATE, id+acknowledge→ACKNOWLEDGE", async () => {
		// CREATE (content present, no id)
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Inference Test",
				content: "Testing auto-inference for CREATE operation.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		expect(createRes.structuredContent.success).toBe(true);
		const memId = createRes.structuredContent.id;

		// UPDATE (id present without acknowledge)
		const updateRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memId,
				title: "Inference Updated",
				owner: "test",
				repo: REPO
			}
		});
		expect(updateRes.structuredContent.updatedFields).toContain("title");

		// ACKNOWLEDGE (id + acknowledge)
		const ackRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				id: memId,
				acknowledge: "used",
				owner: "test",
				repo: REPO
			}
		});
		expect(ackRes.structuredContent.status).toBe("used");
	});
});
