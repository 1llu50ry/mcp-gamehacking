import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent } from "../utils/mcp-response";

describe("MCP Local Memory - Detail Tools (memory-read, standard-read, task-read)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: Record<string, unknown>) => Promise<any>;

	const REPO = "detail-test-repo";

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

	it("should fetch memory details by ID via memory-read", async () => {
		// 1. Create a memory
		const storeRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Test Memory",
				content: "This is a test memory content for detail check.",
				importance: 3,
				agent: "TestAgent",
				model: "test-model",
				scope: { owner: "test", repo: REPO }
			}
		});
		const memoryId = storeRes.structuredContent.id;

		// 2. Fetch it via memory-read (detail mode: id present)
		const detailRes = await router("tools/call", {
			name: "memory-read",
			arguments: { id: memoryId, owner: "test", repo: REPO }
		});

		const memory = detailRes.structuredContent.memory;
		expect(memory.id).toBe(memoryId);
		expect(memory.title).toBe("Test Memory");
		expect(memory.content).toBe("This is a test memory content for detail check.");
	});

	it("should fetch task details by ID via task-read", async () => {
		// 1. Create a task
		const createRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-101",
				phase: "test",
				title: "Test Task",
				description: "Task description for detail check.",
				status: "pending",
				priority: 3
			}
		});
		const taskId = createRes.structuredContent.id;

		// 2. Fetch it via task-read by ID
		const detailRes = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", id: taskId }
		});

		expect(detailRes.structuredContent.id).toBe(taskId);
		expect(detailRes.structuredContent.task_code).toBe("TASK-101");
		expect(detailRes.structuredContent.title).toBe("Test Task");
	});

	it("should fetch coding standard details by ID via standard-read", async () => {
		const storeRes = await router("tools/call", {
			name: "standard-write",
			arguments: {
				owner: "test",
				name: "TS Error Standard",
				content: "Use typed errors and structured logging for server boundaries.",
				language: "typescript",
				stack: ["node", "typescript"],
				tags: ["backend", "errors"],
				metadata: { source: "detail-test" },
				repo: REPO,
				is_global: false
			}
		});
		const standardId = storeRes.structuredContent.standard.id;

		const detailRes = await router("tools/call", {
			name: "standard-read",
			arguments: { id: standardId, owner: "test", repo: REPO }
		});

		expect(detailRes.structuredContent.standard.id).toBe(standardId);
		expect(detailRes.structuredContent.standard.title).toBe("TS Error Standard");
		expect(detailRes.structuredContent.standard.content).toContain("typed errors");

		// hit_count is not incremented on read (standard-read does not bump hit_count)
	});

	it("should fetch task details by task_code via task-read", async () => {
		// 1. Create a task
		const createRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-102",
				phase: "test",
				title: "Test Task 102",
				description: "Task description for code check.",
				status: "pending",
				priority: 3
			}
		});
		const taskId = createRes.structuredContent.id;

		// 2. Fetch it via task-read by task_code
		const detailRes = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", task_code: "TASK-102" }
		});

		expect(detailRes.structuredContent.id).toBe(taskId);
		expect(detailRes.structuredContent.task_code).toBe("TASK-102");
		expect(detailRes.structuredContent.title).toBe("Test Task 102");
	});

	it("should return isError envelope if memory not found", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		const res = await router("tools/call", {
			name: "memory-read",
			arguments: { id: fakeId, owner: "test", repo: REPO }
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain(`Memory not found: ${fakeId}`);
	});

	it("should return isError envelope if task not found", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		const res = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", id: fakeId }
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain(`Task not found: ${fakeId}`);

		const res2 = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", task_code: "NON-EXISTENT" }
		});
		expect(res2.isError).toBe(true);
		expect(getPrimaryTextContent(res2)).toContain(`Task not found: NON-EXISTENT (owner="test", repo="${REPO}")`);
	});

	it("should return isError envelope if coding standard not found", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		const res = await router("tools/call", {
			name: "standard-read",
			arguments: { id: fakeId, owner: "test", repo: REPO }
		});
		expect(res.isError).toBe(true);
		expect(getPrimaryTextContent(res)).toContain(`Coding standard not found: ${fakeId}`);
	});

	it("should fetch memory details by code passed as id", async () => {
		const storeRes = await router("tools/call", {
			name: "memory-write",
			arguments: {
				type: "code_fact",
				title: "Test Memory By Code",
				content: "Memory accessible via code as id param.",
				importance: 3,
				agent: "TestAgent",
				model: "test-model",
				scope: { owner: "test", repo: REPO }
			}
		});
		const memoryId = storeRes.structuredContent.id;
		const memoryCode = storeRes.structuredContent.code;

		// A code routed through `id` must resolve via getByCode with EXACTLY one
		// query — the UUID-shape branch (OPT-FLOW-01) must not also hit getById.
		const getByCodeSpy = vi.spyOn(db.memories, "getByCode");
		const getByIdSpy = vi.spyOn(db.memories, "getById");

		const detailRes = await router("tools/call", {
			name: "memory-read",
			arguments: { id: memoryCode, owner: "test", repo: REPO }
		});

		expect(detailRes.structuredContent.memory.id).toBe(memoryId);
		expect(detailRes.structuredContent.memory.code).toBe(memoryCode);
		expect(detailRes.structuredContent.memory.title).toBe("Test Memory By Code");
		expect(getByCodeSpy).toHaveBeenCalledTimes(1);
		expect(getByCodeSpy).toHaveBeenCalledWith(memoryCode, "test", REPO);
		expect(getByIdSpy).not.toHaveBeenCalled();

		getByCodeSpy.mockRestore();
		getByIdSpy.mockRestore();
	});

	it("should fetch standard details by code passed as id", async () => {
		const storeRes = await router("tools/call", {
			name: "standard-write",
			arguments: {
				owner: "test",
				name: "Code As Id Standard",
				content: "Standard accessible via code as id param.",
				language: "typescript",
				stack: ["node"],
				tags: ["test"],
				metadata: { source: "detail-test-code-as-id" },
				repo: REPO,
				is_global: false
			}
		});
		const standardCode = storeRes.structuredContent.standard.code;
		const standardId = storeRes.structuredContent.standard.id;

		const detailRes = await router("tools/call", {
			name: "standard-read",
			arguments: { id: standardCode, owner: "test", repo: REPO }
		});

		expect(detailRes.structuredContent.standard.id).toBe(standardId);
		expect(detailRes.structuredContent.standard.code).toBe(standardCode);
		expect(detailRes.structuredContent.standard.title).toBe("Code As Id Standard");
	});

	it("should fetch task details by task_code passed as id", async () => {
		const createRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-CODE-AS-ID",
				phase: "test",
				title: "Task By Code As Id",
				description: "Task accessible via task_code as id param.",
				status: "pending",
				priority: 3
			}
		});
		const taskId = createRes.structuredContent.id;

		const detailRes = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", id: "TASK-CODE-AS-ID" }
		});

		expect(detailRes.structuredContent.id).toBe(taskId);
		expect(detailRes.structuredContent.task_code).toBe("TASK-CODE-AS-ID");
		expect(detailRes.structuredContent.title).toBe("Task By Code As Id");
	});
});
