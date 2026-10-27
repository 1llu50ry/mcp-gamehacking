import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleTaskWrite } from "../tools/task.write";
import { createTestStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { toErrorResponse } from "../utils/mcp-error";

describe("Consolidated Task Write — Status Transitions", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let mockVectors: VectorStore;
	const REPO = "test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		mockVectors = {
			upsert: vi.fn().mockResolvedValue(undefined),
			remove: vi.fn().mockResolvedValue(undefined),
			search: vi.fn().mockResolvedValue([])
		};
	});

	async function createTask(taskCode: string, status: string) {
		return await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: taskCode,
				phase: "test",
				title: "Test Task",
				description: "Test Description",
				status: status,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
	}

	it("should block transition from backlog to completed with actionable guidance", async () => {
		await createTask("TASK-001", "backlog");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		let thrown: unknown;
		try {
			await handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					id: task.id,
					status: "completed",
					comment: "finishing",
					est_tokens: 100,
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(Error);
		const message = (thrown as Error).message;
		expect(message).toMatch(/Cannot transition from 'backlog' directly to 'completed'/);
		// FIX-033: the rejection is caller-actionable — it names the allowed next
		// states and the exact retry calls, never a bare "Cannot transition".
		expect(message).toMatch(/Allowed next states from 'backlog': pending, in_progress, canceled, blocked/);
		expect(message).toMatch(/Must go through 'in_progress' first/);
		expect(message).toContain('code: "TASK-001"');

		// No silent state manipulation: the task stays in backlog.
		expect(db.tasks.getTaskById(task.id)?.status).toBe("backlog");
	});

	it("should allow transition from backlog to pending", async () => {
		await createTask("TASK-001", "backlog");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "pending",
				comment: "ready for execution",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		const updatedTask = db.tasks.getTaskById(task.id);
		expect(updatedTask?.status).toBe("pending");
	});

	it("should block transition from pending to completed with allowed-next-states guidance", async () => {
		await createTask("TASK-001", "pending");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		let thrown: unknown;
		try {
			await handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					id: task.id,
					status: "completed",
					comment: "finishing",
					est_tokens: 100,
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(Error);
		const message = (thrown as Error).message;
		expect(message).toMatch(/Cannot transition from 'pending' directly to 'completed'/);
		expect(message).toMatch(/Allowed next states from 'pending': backlog, in_progress, canceled, blocked/);
		expect(db.tasks.getTaskById(task.id)?.status).toBe("pending");
	});

	it("should allow transition from pending to in_progress", async () => {
		await createTask("TASK-001", "pending");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "in_progress",
				comment: "starting",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		const updatedTask = db.tasks.getTaskById(task.id);
		expect(updatedTask?.status).toBe("in_progress");
	});

	it("should allow transition from in_progress to completed", async () => {
		await createTask("TASK-001", "pending");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		// to in_progress first
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "in_progress",
				comment: "starting",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "completed",
				comment: "done",
				est_tokens: 100,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		const updatedTask = db.tasks.getTaskById(task.id);
		expect(updatedTask?.status).toBe("completed");
	});

	it("should allow transition to blocked and back", async () => {
		await createTask("TASK-001", "pending");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		// to in_progress first
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "in_progress",
				comment: "starting",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		// to blocked
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "blocked",
				comment: "waiting for feedback",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
		expect(db.tasks.getTaskById(task.id)?.status).toBe("blocked");

		// back to in_progress
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "in_progress",
				comment: "feedback received",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
		expect(db.tasks.getTaskById(task.id)?.status).toBe("in_progress");

		// to blocked from pending
		await createTask("TASK-002", "pending");
		const task2 = db.tasks.getTaskByCode("test", REPO, "TASK-002");
		if (!task2) throw new Error("Task TASK-002 not found");

		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task2.id,
				status: "blocked",
				comment: "blocked early",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);
		expect(db.tasks.getTaskById(task2.id)?.status).toBe("blocked");
	});

	it("should block completing parent task with incomplete children", async () => {
		await createTask("PARENT-001", "pending");
		const parent = db.tasks.getTaskByCode("test", REPO, "PARENT-001")!;

		// Move parent to in_progress
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: parent.id,
				status: "in_progress",
				comment: "starting parent",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		// Create child tasks
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "CHILD-001",
				phase: "test",
				title: "Child Task 1",
				description: "Child task 1",
				status: "pending",
				parent_id: parent.id,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "CHILD-002",
				phase: "test",
				title: "Child Task 2",
				description: "Child task 2",
				status: "pending",
				parent_id: parent.id,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		await expect(
			handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					id: parent.id,
					status: "completed",
					comment: "trying to finish parent",
					est_tokens: 200,
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			)
		).rejects.toThrow(/incomplete child/);
	});

	it("should allow completing parent task when all children are completed", async () => {
		await createTask("PARENT-002", "pending");
		const parent = db.tasks.getTaskByCode("test", REPO, "PARENT-002")!;

		// Move parent to in_progress
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: parent.id,
				status: "in_progress",
				comment: "starting parent",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		// Create child task
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: "CHILD-003",
				phase: "test",
				title: "Child Task 3",
				description: "Child task 3",
				status: "pending",
				parent_id: parent.id,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		const child = db.tasks.getTaskByCode("test", REPO, "CHILD-003")!;

		// Move child to in_progress then complete
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: child.id,
				status: "in_progress",
				comment: "starting child",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: child.id,
				status: "completed",
				comment: "child done",
				est_tokens: 100,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		// Complete parent — should succeed now
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: parent.id,
				status: "completed",
				comment: "parent done, all children completed",
				est_tokens: 200,
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		const updatedParent = db.tasks.getTaskById(parent.id);
		expect(updatedParent?.status).toBe("completed");
	});

	it("should block transition from blocked to completed", async () => {
		await createTask("TASK-001", "pending");
		const task = db.tasks.getTasksByRepo("test", REPO)[0];

		// to blocked
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: task.id,
				status: "blocked",
				comment: "blocked",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			mockVectors
		);

		let thrown: unknown;
		try {
			await handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					id: task.id,
					status: "completed",
					comment: "finishing anyway",
					est_tokens: 100,
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(Error);
		const message = (thrown as Error).message;
		expect(message).toMatch(/Cannot transition from 'blocked' directly to 'completed'/);
		// FIX-033: the allowed-next-states enumeration is present for blocked too.
		expect(message).toMatch(/Allowed next states from 'blocked': backlog, pending, in_progress, canceled/);
		expect(db.tasks.getTaskById(task.id)?.status).toBe("blocked");
	});

	// issue #108 (PRIMARY): a state-machine rejection must surface through the
	// canonical error envelope as VALIDATION_ERROR with the real message — NOT
	// the opaque INTERNAL_ERROR / "Internal tool error". This exercises the full
	// throw-site → toErrorResponse path (the transport catch).
	describe("error envelope for expected rejections (issue #108)", () => {
		it("backlog → completed direct transition yields VALIDATION_ERROR with the real message", async () => {
			await createTask("TASK-001", "backlog");
			const task = db.tasks.getTasksByRepo("test", REPO)[0];

			let thrown: unknown;
			try {
				await handleTaskWrite(
					{
						owner: "test",
						repo: REPO,
						id: task.id,
						status: "completed",
						comment: "finishing",
						est_tokens: 100,
						agent: "test-agent",
						role: "test-role"
					},
					db,
					mockVectors
				);
			} catch (err) {
				thrown = err;
			}

			expect(thrown).toBeInstanceOf(Error);
			const res = toErrorResponse(thrown);
			expect(res.isError).toBe(true);
			expect(res.structuredContent).toMatchObject({
				schema: "tool-error",
				code: "VALIDATION_ERROR",
				retryable: false
			});
			expect((res.structuredContent as { message: string }).message).toMatch(
				/Cannot transition from 'backlog' directly to 'completed'/
			);
			// The real message must survive — not the sanitized generic text.
			expect(res.content?.[0]).toMatchObject({
				type: "text",
				text: expect.stringContaining("Must go through 'in_progress' first") as unknown
			});
			expect(JSON.stringify(res)).not.toContain("Internal tool error");
		});

		it("incomplete-children completion gate yields VALIDATION_ERROR with the real message", async () => {
			await createTask("PARENT-001", "pending");
			const parent = db.tasks.getTaskByCode("test", REPO, "PARENT-001")!;

			await handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					id: parent.id,
					status: "in_progress",
					comment: "starting parent",
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);

			await handleTaskWrite(
				{
					repo: REPO,
					owner: "test",
					task_code: "CHILD-001",
					phase: "test",
					title: "Child Task 1",
					description: "Child task 1",
					status: "pending",
					parent_id: parent.id,
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);

			let thrown: unknown;
			try {
				await handleTaskWrite(
					{
						owner: "test",
						repo: REPO,
						id: parent.id,
						status: "completed",
						comment: "trying to finish parent",
						est_tokens: 200,
						agent: "test-agent",
						role: "test-role"
					},
					db,
					mockVectors
				);
			} catch (err) {
				thrown = err;
			}

			const res = toErrorResponse(thrown);
			expect(res.structuredContent).toMatchObject({
				schema: "tool-error",
				code: "VALIDATION_ERROR",
				retryable: false
			});
			expect((res.structuredContent as { message: string }).message).toMatch(/incomplete child task/);
			expect(JSON.stringify(res)).not.toContain("Internal tool error");
		});
	});

	// issue #108 (secondary #2 & #3): the response must report only fields that
	// were actually persisted, and the completion summary must not render a
	// literal `undefined` when no commit_id is supplied.
	describe("update response hygiene (issue #108)", () => {
		it("updatedFields lists only persisted columns, not request plumbing keys", async () => {
			await createTask("TASK-001", "pending");
			const task = db.tasks.getTasksByRepo("test", REPO)[0];

			const res = await handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					code: "TASK-001",
					id: task.id,
					status: "in_progress",
					comment: "starting",
					json: true,
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);

			const updatedFields = (res.structuredContent as { updatedFields: string[] }).updatedFields;
			expect(updatedFields).toContain("status");
			// Plumbing keys must not be reported as written fields.
			for (const plumbing of ["code", "json", "comment", "id", "interactive", "tasks", "force"]) {
				expect(updatedFields).not.toContain(plumbing);
			}
		});

		it("omits the commit clause (no literal 'undefined') when completing without a commit_id", async () => {
			await createTask("TASK-001", "pending");
			const task = db.tasks.getTasksByRepo("test", REPO)[0];

			await handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					id: task.id,
					status: "in_progress",
					comment: "starting",
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);

			const res = await handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					id: task.id,
					status: "completed",
					comment: "done",
					est_tokens: 100,
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);

			const text = (res.content ?? [])
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			expect(text).not.toContain("undefined");
			expect(text).toContain("completed");
		});

		it("includes the commit id in the completion summary when supplied", async () => {
			await createTask("TASK-001", "pending");
			const task = db.tasks.getTasksByRepo("test", REPO)[0];

			await handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					id: task.id,
					status: "in_progress",
					comment: "starting",
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);

			const res = await handleTaskWrite(
				{
					owner: "test",
					repo: REPO,
					id: task.id,
					status: "completed",
					comment: "done",
					est_tokens: 100,
					commit_id: "abc1234",
					changed_files: ["src/a.ts"],
					agent: "test-agent",
					role: "test-role"
				},
				db,
				mockVectors
			);

			const text = (res.content ?? [])
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			expect(text).toContain("completed with commit abc1234");
			expect(text).not.toContain("undefined");
		});
	});
});
