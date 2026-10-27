import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP Local Memory - memory-delete (Single & Bulk)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "memory-delete-test";

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

	// ─── Single delete by id ─────────────────────────────────────────────

	it("should soft-delete a single memory by id via memory-delete", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Delete By Id",
				content: "This memory will be deleted by its ID.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryId = createRes.structuredContent.id;

		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				id: memoryId,
				owner: "test",
				repo: REPO
			}
		});

		expect(delRes.structuredContent.success).toBe(true);
		expect(delRes.structuredContent.deletedCount).toBe(1);
		expect(getPrimaryTextContent(delRes)).toContain("Deleted 1 memory");

		// Should be soft-deleted (archived)
		const stored = db.memories.getById(memoryId);
		expect(stored!.status).toBe("archived");
	});

	// ─── Single delete by code ───────────────────────────────────────────

	it("should soft-delete a single memory by code via memory-delete", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Delete By Code",
				content: "This memory will be deleted by its code.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const memoryCode = createRes.structuredContent.code;

		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				code: memoryCode,
				owner: "test",
				repo: REPO
			}
		});

		expect(delRes.structuredContent.deletedCount).toBe(1);

		const stored = db.memories.getByCode(memoryCode, "test", REPO);
		expect(stored!.status).toBe("archived");
	});

	// ─── Bulk delete by ids[] ────────────────────────────────────────────

	it("should soft-delete multiple memories by ids[] via memory-delete", async () => {
		const m1 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Delete A",
				content: "First memory to be bulk deleted by ID array.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const m2 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "mistake",
				title: "Bulk Delete B",
				content: "Second memory is about database indexing strategy for bulk operations.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const ids = [m1.structuredContent.id, m2.structuredContent.id];
		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				ids,
				owner: "test",
				repo: REPO
			}
		});

		expect(delRes.structuredContent.success).toBe(true);
		expect(delRes.structuredContent.deletedCount).toBe(2);
		expect(getPrimaryTextContent(delRes)).toContain("Deleted 2 memories");

		const m1Stored = db.memories.getById(m1.structuredContent.id);
		const m2Stored = db.memories.getById(m2.structuredContent.id);
		expect(m1Stored!.status).toBe("archived");
		expect(m2Stored!.status).toBe("archived");
	});

	// ─── Bulk delete by codes[] ──────────────────────────────────────────

	it("should soft-delete multiple memories by codes[] via memory-delete", async () => {
		const m1 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Code Delete A",
				content: "First memory to be deleted by code array.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const m2 = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "pattern",
				title: "Bulk Code Delete B",
				content: "Second memory describes authentication token refresh flow.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});

		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				codes: [m1.structuredContent.code, m2.structuredContent.code],
				owner: "test",
				repo: REPO
			}
		});

		expect(delRes.structuredContent.deletedCount).toBe(2);
	});

	// ─── Error cases ─────────────────────────────────────────────────────

	// Unified not-found policy (OPT-CODE-04): single target → throw (fail
	// loud); bulk → skip + report partial execution. The transport converts the
	// thrown error into the canonical isError envelope (OPT-CODE-01).
	it("should surface isError envelope when deleting a non-existent single memory", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		const res = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				id: fakeId,
				owner: "test",
				repo: REPO
			}
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain("Memory not found");
	});

	it("should skip + report a missing memory in a bulk delete (partial execution)", async () => {
		const createRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Bulk Partial Surviving",
				content: "This memory survives the partial bulk delete.",
				importance: 3,
				scope: { owner: "test", repo: REPO },
				agent: "test-agent",
				model: "test-model"
			}
		});
		const realId = createRes.structuredContent.id;
		const fakeId = "00000000-0000-0000-0000-000000000000";

		const delRes = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				ids: [realId, fakeId],
				owner: "test",
				repo: REPO
			}
		});

		expect(delRes.isError).toBe(true);
		expect(delRes.structuredContent).toMatchObject({ schema: "tool-error", code: "PARTIAL_FAILURE" });
		expect(delRes.structuredContent.success).toBe(true);
		expect(delRes.structuredContent.deletedCount).toBe(1);
		expect(delRes.structuredContent.skippedCount).toBe(1);
		expect(delRes.structuredContent.totalAttempted).toBe(2);
		expect(delRes.structuredContent.errors[0].error).toContain("Memory not found");

		// The existing memory was archived; the phantom id changed nothing.
		const stored = db.memories.getById(realId);
		expect(stored!.status).toBe("archived");
	});

	it("should surface isError envelope when no identifier provided", async () => {
		const res = await router("tools/call", {
			name: "memory-delete",
			arguments: {
				owner: "test",
				repo: REPO
			}
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain("must be provided for deletion");
	});
});
