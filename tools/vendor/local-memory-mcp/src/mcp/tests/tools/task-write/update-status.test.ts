import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleTaskWrite } from "../../../tools/task.write";
import { createTestStore } from "../../../storage/sqlite";
import { VectorStore } from "../../../types";

// Handler-level (State layer) coverage for FIX-022: a status change with no
// caller comment must succeed and persist a deterministic auto-comment, while
// an explicit comment is honored verbatim. Mirrors
// src/mcp/tools/task-write/update-status.ts per .agents/documents/testing.md §2.1.

describe("task-write status change — auto-derived transition comment (FIX-022)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let mockVectors: VectorStore;
	const REPO = "fix-022-repo";

	beforeEach(async () => {
		db = await createTestStore();
		mockVectors = {
			upsert: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			search: vi.fn().mockResolvedValue([])
		};
	});

	async function createTask(taskCode: string, status: string) {
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: taskCode,
				phase: "test",
				title: "Test Task",
				description: "Test Description",
				status,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
	}

	it("succeeds and records a non-empty auto-comment when no comment is supplied", async () => {
		await createTask("TASK-001", "pending");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		const res = await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "in_progress",
				agent: "Agent-1",
				role: "tester"
			},
			db,
			mockVectors
		);

		expect(res.isError).toBeFalsy();
		expect(db.tasks.getTaskById(task.id)?.status).toBe("in_progress");

		const comments = db.taskComments.getTaskCommentsByTaskId(task.id);
		expect(comments.length).toBe(1);
		expect(comments[0].comment).toMatch(/^Status: pending -> in_progress \(Agent-1, .+\)$/);
		expect(comments[0].comment.trim()).not.toBe("");
		expect(comments[0].previous_status).toBe("pending");
		expect(comments[0].next_status).toBe("in_progress");
	});

	it("treats a whitespace-only comment as absent and derives the default", async () => {
		await createTask("TASK-002", "pending");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "in_progress",
				comment: "   ",
				agent: "Agent-1",
				role: "tester"
			},
			db,
			mockVectors
		);

		const comments = db.taskComments.getTaskCommentsByTaskId(task.id);
		expect(comments.length).toBe(1);
		expect(comments[0].comment).toMatch(/^Status: pending -> in_progress \(Agent-1, .+\)$/);
	});

	it("honors an explicit comment verbatim", async () => {
		await createTask("TASK-003", "pending");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "in_progress",
				comment: "Starting the implementation now",
				agent: "Agent-1",
				role: "tester"
			},
			db,
			mockVectors
		);

		const comments = db.taskComments.getTaskCommentsByTaskId(task.id);
		expect(comments.length).toBe(1);
		expect(comments[0].comment).toBe("Starting the implementation now");
	});

	it("bulk tasks[] status change with no comment records an auto-comment", async () => {
		await createTask("TASK-004", "pending");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		const res = await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				tasks: [{ id: task.id, status: "in_progress", agent: "Agent-2" }]
			},
			db,
			mockVectors
		);

		expect(res.isError).toBeFalsy();
		expect(db.tasks.getTaskById(task.id)?.status).toBe("in_progress");

		const comments = db.taskComments.getTaskCommentsByTaskId(task.id);
		expect(comments.length).toBe(1);
		expect(comments[0].comment).toMatch(/^Status: pending -> in_progress \(Agent-2, .+\)$/);
	});

	it("bulk ids[] status change with no comment records an auto-comment", async () => {
		await createTask("TASK-005", "pending");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		const res = await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				ids: [task.id],
				status: "in_progress",
				agent: "Agent-3"
			},
			db,
			mockVectors
		);

		expect(res.isError).toBeFalsy();
		expect(db.tasks.getTaskById(task.id)?.status).toBe("in_progress");

		const comments = db.taskComments.getTaskCommentsByTaskId(task.id);
		expect(comments.length).toBe(1);
		expect(comments[0].comment).toMatch(/^Status: pending -> in_progress \(Agent-3, .+\)$/);
	});

	it("still rejects a direct backlog -> completed transition, naming the required sequence", async () => {
		await createTask("TASK-006", "backlog");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		await expect(
			handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					id: task.id,
					status: "completed",
					est_tokens: 100,
					agent: "Agent-1",
					role: "tester"
				},
				db,
				mockVectors
			)
		).rejects.toThrow(/Required sequence: backlog -> in_progress -> completed/);

		// No silent state manipulation: the task stays in backlog and no
		// comment is written for the rejected transition.
		expect(db.tasks.getTaskById(task.id)?.status).toBe("backlog");
		expect(db.taskComments.getTaskCommentsByTaskId(task.id).length).toBe(0);
	});
});
