import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent, McpResponse } from "../utils/mcp-response";

function getTextContent(result: McpResponse) {
	return getPrimaryTextContent(result) || (result.structuredContent as { text?: string })?.text || "";
}

describe("MCP Local Memory - Consolidated Task Tools Bulk Operations (create / list / validation)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (
		method: string,
		params: Record<string, unknown> | undefined,
		signal?: AbortSignal,
		onProgress?: (progress: number, total?: number) => void
	) => Promise<McpResponse>;

	const REPO = "bulk-test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const originalRouter = createRouter(db, vectors);
		router = async (method, params) => {
			try {
				return (await originalRouter(method, params)) as any;
			} catch (err: any) {
				return {
					isError: true,
					content: [{ type: "text", text: err?.message || String(err) }]
				} as McpResponse;
			}
		};
	});

	it("should create multiple tasks in one call", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{
						task_code: "BULK-001",
						title: "First Bulk Task",
						description: "Description 1",
						phase: "research",
						status: "pending",
						priority: 1,
						est_tokens: 50
					},
					{
						task_code: "BULK-002",
						title: "Second Bulk Task",
						description: "Description 2",
						phase: "implementation",
						status: "pending",
						priority: 2,
						est_tokens: 75
					}
				]
			}
		});

		expect(res.isError).toBe(false);
		expect(getTextContent(res)).toContain(`Created 2 tasks in "${REPO}`);

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		expect(tasks.length).toBe(2);
		expect(tasks.find((t) => t.task_code === "BULK-001")).toBeDefined();
		expect(tasks.find((t) => t.task_code === "BULK-002")).toBeDefined();
	});

	it("should auto-generate task_codes for bulk tasks without task_code", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{
						title: "Auto Bulk 1",
						description: "First auto-generated bulk task",
						phase: "research",
						status: "pending",
						priority: 3
					},
					{
						title: "Auto Bulk 2",
						description: "Second auto-generated bulk task",
						phase: "implementation",
						status: "backlog",
						priority: 2
					}
				]
			}
		});

		expect(res.isError).toBe(false);

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		expect(tasks.length).toBe(2);

		const task1 = tasks.find((t) => t.task_code === "TASK-001");
		const task2 = tasks.find((t) => t.task_code === "TASK-002");
		expect(task1).toBeDefined();
		expect(task2).toBeDefined();
		expect(task1?.title).toBe("Auto Bulk 1");
		expect(task2?.title).toBe("Auto Bulk 2");
	});

	it("should allow bulk create without est_tokens", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{
						task_code: "BULK-NO-TOKENS",
						title: "Bulk task without estimate",
						description: "Accepted during planning",
						phase: "research",
						status: "pending"
					}
				]
			}
		});

		expect(res.isError).toBe(false);
		const task = db.tasks.getTaskByCode("test", REPO, "BULK-NO-TOKENS");
		expect(task?.est_tokens).toBe(0);
	});

	it("should enforce default limit of 5 and support pagination", async () => {
		// Create 20 tasks
		const manyTasks = Array.from({ length: 20 }, (_, i) => ({
			task_code: `LIMIT-${i.toString().padStart(3, "0")}`,
			title: `Task ${i}`,
			description: `Description ${i}`,
			phase: "research",
			status: "backlog",
			est_tokens: 20 + i
		}));

		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: manyTasks
			}
		});

		// Test default limit (15)
		const defaultRes = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", json: true }
		});
		const defaultTasks = (defaultRes.structuredContent as any).tasks;
		expect(defaultTasks.rows.length).toBe(5); // Default limit is 5

		// Test explicit limit
		const limitRes = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", limit: 10, json: true }
		});
		const limitedTasks = (limitRes.structuredContent as any).tasks;
		expect(limitedTasks.rows.length).toBe(10);

		// Test offset (last page)
		const offsetRes = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", limit: 15, offset: 15, json: true }
		});
		const offsetTasks = (offsetRes.structuredContent as any).tasks;
		expect(offsetTasks.rows.length).toBe(5); // 20 total - 15 offset = 5 remaining
	});

	it("should summarize filtered task counts with pending and in-progress context", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{
						task_code: "SUM-001",
						title: "Completed task",
						description: "Already finished",
						phase: "implementation",
						status: "backlog",
						est_tokens: 20
					},
					{
						task_code: "SUM-002",
						title: "Pending task",
						description: "Waiting to start",
						phase: "implementation",
						status: "pending",
						est_tokens: 20
					},
					{
						task_code: "SUM-003",
						title: "In progress task",
						description: "Currently active",
						phase: "implementation",
						status: "pending",
						est_tokens: 20
					}
				]
			}
		});

		const completedId = db.tasks.getTaskByCode("test", REPO, "SUM-001")?.id;
		const inProgressId = db.tasks.getTaskByCode("test", REPO, "SUM-003")?.id;

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: completedId,
				status: "in_progress",
				comment: "Starting completion path",
				agent: "Test Agent",
				role: "tester",
				est_tokens: 25
			}
		});

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: completedId,
				status: "completed",
				comment: "Finished work",
				agent: "Test Agent",
				role: "tester",
				est_tokens: 30
			}
		});

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: inProgressId,
				status: "in_progress",
				comment: "Work started",
				agent: "Test Agent",
				role: "tester",
				est_tokens: 25
			}
		});

		const result = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", status: "completed" }
		});

		expect(getTextContent(result)).toContain(`### Results: 1 tasks in repo "${REPO}"`);
		expect(getTextContent(result)).toContain("**Completed (1)**");
		expect(getTextContent(result)).toContain("- SUM-001 [P3] [implementation] Completed task");
		expect(getTextContent(result)).toContain("See task-detail with task_code for details.");
	});

	it("should reject duplicate task_codes in the same request", async () => {
		const result = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{ task_code: "DUP-001", title: "Task 1", description: "D", phase: "p", status: "pending", est_tokens: 10 },
					{ task_code: "DUP-001", title: "Task 2", description: "D", phase: "p", status: "pending", est_tokens: 12 }
				]
			}
		});

		expect(result.isError).toBe(true);
		expect(getTextContent(result)).toContain("Duplicate task_code in request: 'DUP-001'");
	});

	it("should reject duplicate task_codes against existing tasks", async () => {
		// Create first task with code EXISTING-001
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "EXISTING-001",
				title: "Initial",
				description: "D",
				phase: "p",
				status: "pending",
				est_tokens: 25
			}
		});

		// Bulk write with same code — should reject
		const bulkResult = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{
						task_code: "EXISTING-001",
						title: "Duplicate",
						description: "D",
						phase: "p",
						status: "pending",
						est_tokens: 30
					}
				]
			}
		});
		expect(bulkResult.isError).toBe(true);
		expect(getTextContent(bulkResult)).toContain("Task code 'EXISTING-001' already exists");

		// Single write with same code — should also reject
		const singleResult = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "EXISTING-001",
				title: "Duplicate",
				description: "D",
				phase: "p",
				status: "pending",
				est_tokens: 30
			}
		});
		expect(singleResult.isError).toBe(true);
		expect(getTextContent(singleResult)).toContain("Task code 'EXISTING-001' already exists");
	});

	// ─── Partial execution: skip failures, continue with remaining items ───

	it("task-write bulk handles partial failure — continues on individual item errors", async () => {
		const res: any = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				tasks: [
					{ phase: "dev", title: "Partial 1", description: "First partial task.", status: "pending", priority: 2 },
					{ phase: "dev", title: "Partial 2", description: "Second partial task.", status: "pending", priority: 2 },
					// Invalid item (missing required fields): should be skipped
					{ phase: "dev", status: "pending" }
				]
			}
		});
		// Partial failure returns isError with structuredContent containing results
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({ schema: "tool-error", code: "PARTIAL_FAILURE" });
		expect(res.structuredContent.createdCount).toBe(2);
		expect(res.structuredContent.total).toBe(3);
		expect(res.structuredContent.errors).toBeDefined();
		expect(res.structuredContent.errors.length).toBeGreaterThanOrEqual(1);
	});

	it("task-write bulk all succeed — no errors", async () => {
		const res: any = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				json: true,
				tasks: [
					{ phase: "dev", title: "Surviving Task", description: "Should be created.", status: "pending", priority: 2 },
					{
						phase: "dev",
						title: "Also Surviving",
						description: "Should also be created.",
						status: "pending",
						priority: 2
					}
				]
			}
		});
		// Content text confirms success
		expect(getTextContent(res)).toContain("Created 2 tasks");
		// Verify tasks exist in the database
		const allTasks = db.tasks.getTasksByRepo("test", REPO);
		expect(allTasks.length).toBe(2);
	});
});
