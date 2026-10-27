import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleTaskWrite } from "../tools/task.write";
import { createTestStore } from "../storage/sqlite";
import { VectorStore } from "../types";

describe("Consolidated Task Write — Pending Limit Refined Validation", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let mockVectors: VectorStore;
	const REPO = "test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		mockVectors = {
			upsert: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			search: vi.fn().mockResolvedValue([])
		} as unknown as VectorStore;
	});

	async function createManyPending(count: number) {
		for (let i = 0; i < count; i++) {
			await handleTaskWrite(
				{
					repo: REPO,
					owner: "test",
					task_code: `TASK-${i}`,
					phase: "test",
					title: "Test Task",
					description: "Test Description",
					status: "pending",
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);
		}
	}

	it("should auto-downgrade 12th pending task to backlog", async () => {
		await createManyPending(11);

		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "TASK-12",
				phase: "test",
				title: "12th Task",
				description: "Should be auto-downgraded",
				status: "pending",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		const task = db.tasks.getTaskByCode("test", REPO, "TASK-12");
		expect(task).not.toBeNull();
		expect(task!.status).toBe("backlog");

		const stats = db.taskStats.getTaskStats("test", REPO);
		expect(stats.todo).toBe(11);
	});

	it("should ALLOW moving from backlog to pending even if limit reached", async () => {
		await createManyPending(10);

		// Create one backlog task (allowed)
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "TASK-BACKLOG",
				phase: "test",
				title: "Backlog Task",
				description: "In backlog",
				status: "backlog",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		const task = db.tasks.getTaskByCode("test", REPO, "TASK-BACKLOG");
		if (!task) throw new Error("Seed task not found");

		// Move to pending (should be ALLOWED now)
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "pending",
				comment: "ready to start",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		const updatedTask = db.tasks.getTaskById(task.id);
		if (!updatedTask) throw new Error("Updated task not found");
		expect(updatedTask.status).toBe("pending");

		const stats = db.taskStats.getTaskStats("test", REPO);
		expect(stats.todo).toBe(11);
	});
});
