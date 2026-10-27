import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { McpResponse } from "../utils/mcp-response";

vi.setConfig({ testTimeout: 30000 });

describe("MCP Local Memory - Consolidated Task Tools E2E (write lifecycle)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (method: string, params: unknown) => Promise<McpResponse>;

	const REPO = "workflow-test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const rawRouter = createRouter(db, vectors);
		router = async (method, params) => {
			const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown> | undefined;
			if (method === "tools/call" && args) {
				args.json = true;
			}
			return rawRouter(method, params as any) as any;
		};
	});

	it("should follow the complete task management lifecycle: Plan -> Execute -> Verify", async () => {
		// ---- 1. INITIAL CHECK ----
		const initialRes = await router("resources/read", {
			uri: `repository://${REPO}/tasks`
		});
		const initialTasks = JSON.parse((initialRes.content as any)[0].text);
		expect(initialTasks.length).toBe(0);

		// ---- 2. PLANNING PHASE ----
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-001",
				phase: "research",
				title: "Research Architecture",
				description: "Analyze the current system architecture and propose changes",
				status: "pending",
				priority: 5,
				est_tokens: 120
			}
		});
		const taskAId = db.tasks.getTasksByRepo("test", REPO)[0].id;

		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-002",
				phase: "implementation",
				title: "Implement Core Logic",
				description: "Write the core implementation based on research",
				status: "backlog",
				depends_on: taskAId,
				priority: 4,
				est_tokens: 240
			}
		});
		const taskB = db.tasks.getTaskByCode("test", REPO, "TASK-002");
		expect(taskB).toBeDefined();
		const taskBId = taskB!.id;

		// Verify both are pending
		const plannedRes = await router("resources/read", { uri: `repository://${REPO}/tasks` });
		const plannedTasks = JSON.parse((plannedRes.content as any)[0].text);
		expect(plannedTasks.length).toBe(2);

		// Verify task-read tool works (list all statuses)
		const listToolRes = await router("tools/call", {
			name: "task-read",
			arguments: { repo: REPO, owner: "test", status: "all" }
		});
		const listToolTasks = (listToolRes.structuredContent as { tasks: { rows: unknown[][] } }).tasks;
		expect(listToolTasks.rows.length).toBe(2);

		// ---- 3. EXECUTION PHASE ----
		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: taskAId,
				status: "in_progress",
				comment: "Started architecture review",
				agent: "Agent A",
				role: "backend",
				model: "gpt-5.4",
				est_tokens: 180
			}
		});

		const inProgressRes = await router("resources/read", { uri: `repository://${REPO}/tasks` });
		const inProgressTasks = JSON.parse((inProgressRes.content as any)[0].text);
		expect(inProgressTasks.find((t: { id: string; status: string }) => t.id === taskAId).status).toBe("in_progress");

		// ---- 4. VALIDATION PHASE (Task A) ----
		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: taskAId,
				status: "completed",
				comment: "Architecture review finished and documented",
				agent: "Agent A",
				role: "backend",
				model: "gpt-5.4",
				est_tokens: 180
			}
		});

		const afterARes = await router("resources/read", { uri: `repository://${REPO}/tasks` });
		const afterATasks = JSON.parse((afterARes.content as any)[0].text);
		expect(afterATasks.length).toBe(1);
		expect(afterATasks[0].id).toBe(taskBId);

		// ---- 5. RESUME WORKFLOW (Task B) ----
		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: taskBId,
				status: "in_progress",
				comment: "Implementation started after dependency was cleared",
				agent: "Agent B",
				role: "frontend",
				model: "gpt-5.4-mini",
				est_tokens: 320
			}
		});

		const finalCheckRes = await router("resources/read", { uri: `repository://${REPO}/tasks` });
		const finalCheckTasks = JSON.parse((finalCheckRes.content as any)[0].text);
		expect(finalCheckTasks[0].status).toBe("in_progress");

		const updatedTask = db.tasks.getTaskById(taskBId);
		expect(updatedTask).not.toBeNull();
		expect(updatedTask!.comments).toBeDefined();
		expect(updatedTask!.comments).toHaveLength(1);
		expect(updatedTask!.comments![0].comment).toContain("Implementation started");
		expect(updatedTask!.comments![0].agent).toBe("Agent B");
		expect(updatedTask!.comments![0].model).toBe("gpt-5.4-mini");
		expect(updatedTask!.comments![0].previous_status).toBe("backlog");
		expect(updatedTask!.comments![0].next_status).toBe("in_progress");
	});

	it("records a deterministic auto-comment when status changes without a comment (FIX-022)", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-003",
				phase: "implementation",
				title: "Comment enforcement",
				description: "Task used to verify status change comment enforcement",
				status: "pending",
				priority: 3,
				est_tokens: 90
			}
		});

		const taskId = db.tasks.getTaskByCode("test", REPO, "TASK-003")?.id;
		expect(taskId).toBeDefined();

		// FIX-022: a status change with no comment NO LONGER bounces — it
		// succeeds and records a deterministic auto-comment so the audit trail
		// stays inspectable.
		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: taskId,
				status: "in_progress",
				agent: "TestAgent",
				role: "testing",
				est_tokens: 50
			}
		});
		expect(res.isError).toBe(false);

		const updated = db.tasks.getTaskById(taskId!);
		expect(updated?.status).toBe("in_progress");

		const comments = db.taskComments.getTaskCommentsByTaskId(taskId!);
		expect(comments.length).toBe(1);
		expect(comments[0].comment).toMatch(/^Status: pending -> in_progress \(TestAgent, .+\)$/);
		expect(comments[0].comment.trim()).not.toBe("");
		expect(comments[0].next_status).toBe("in_progress");
	});

	it("allows task-write without est_tokens", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-003A",
				phase: "implementation",
				title: "Create without token estimate",
				description: "Should still be accepted during planning",
				status: "pending",
				priority: 3
			}
		});

		const task = db.tasks.getTaskByCode("test", REPO, "TASK-003A");
		expect(task).toBeDefined();
		expect(task?.est_tokens).toBe(0);
	});

	it("allows completing task without est_tokens", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-003B",
				phase: "implementation",
				title: "Completion without token estimate",
				description: "Used to verify est_tokens is optional on completion",
				status: "backlog",
				priority: 3
			}
		});

		const taskId = db.tasks.getTaskByCode("test", REPO, "TASK-003B")?.id;
		expect(taskId).toBeDefined();

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: taskId,
				status: "in_progress",
				comment: "Starting work",
				agent: "Agent E",
				role: "backend"
			}
		});

		// Should succeed — est_tokens is now optional on completion
		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: taskId,
				status: "completed",
				comment: "Finished work without token estimate",
				agent: "Agent E",
				role: "backend"
			}
		});

		const completed = db.tasks.getTaskById(taskId!);
		expect(completed?.status).toBe("completed");
	});

	it("stores standalone comments without mutating description", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-004",
				phase: "implementation",
				title: "Standalone comments",
				description: "Original description",
				status: "pending",
				priority: 3,
				est_tokens: 90,
				agent: "Seeder",
				role: "user"
			}
		});

		const taskId = db.tasks.getTaskByCode("test", REPO, "TASK-004")?.id;
		expect(taskId).toBeDefined();

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: taskId,
				comment: "Investigated root cause and prepared next steps",
				agent: "Agent C",
				role: "security",
				model: "gpt-5.4",
				est_tokens: 75
			}
		});

		const task = db.tasks.getTaskById(taskId!);
		expect(task).not.toBeNull();
		expect(task!.description).toBe("Original description");
		expect(task!.comments).toBeDefined();
		expect(task!.comments).toHaveLength(1);
		expect(task!.comments![0].previous_status).toBeNull();
		expect(task!.comments![0].next_status).toBeNull();
	});

	it("should auto-generate task_code when not provided in single write", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				phase: "implementation",
				title: "Auto-generated Code Task",
				description: "Task created without explicit task_code",
				status: "pending",
				priority: 3
			}
		});

		const data = res.structuredContent as Record<string, unknown>;
		expect(data.task_code).toBe("TASK-001");

		const task = db.tasks.getTaskByCode("test", REPO, "TASK-001");
		expect(task).toBeDefined();
		expect(task?.title).toBe("Auto-generated Code Task");

		// Second auto-generated task should increment
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				phase: "research",
				title: "Second Auto Task",
				description: "Should get TASK-002",
				status: "backlog",
				priority: 2
			}
		});

		const task2 = db.tasks.getTaskByCode("test", REPO, "TASK-002");
		expect(task2).toBeDefined();
		expect(task2?.title).toBe("Second Auto Task");
	});

	it("auto-populates timestamps from status so agents do not need to send them manually", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "TASK-005",
				phase: "implementation",
				title: "Auto timestamp on create",
				description: "Created as backlog then moved to in progress",
				status: "backlog",
				priority: 3,
				est_tokens: 110
			}
		});

		const createdTask = db.tasks.getTaskByCode("test", REPO, "TASK-005");
		expect(createdTask?.in_progress_at).toBeNull();
		expect(createdTask?.finished_at).toBeNull();

		expect(createdTask).toBeDefined();
		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: createdTask!.id,
				status: "in_progress",
				comment: "Starting work",
				agent: "Agent D",
				role: "backend"
			}
		});

		const inProgressTask = db.tasks.getTaskById(createdTask!.id);
		expect(inProgressTask).not.toBeNull();
		expect(inProgressTask!.in_progress_at).toBeTruthy();

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: createdTask!.id,
				status: "completed",
				comment: "Done without providing timestamps manually",
				agent: "Agent D",
				role: "backend",
				est_tokens: 210
			}
		});

		const completedTask = db.tasks.getTaskById(createdTask!.id);
		expect(completedTask).not.toBeNull();
		expect(completedTask!.in_progress_at).toBeTruthy();
		expect(completedTask!.finished_at).toBeTruthy();
	});
});
