import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../storage/sqlite";
import type { SQLiteStore } from "../storage/sqlite";

function createTaskWithComment(
	db: SQLiteStore,
	overrides: { taskId?: string; commentId?: string; repo?: string } = {}
): { taskId: string; commentId: string } {
	const taskId = overrides.taskId || "task-default";
	const commentId = overrides.commentId || "comment-default";
	const repo = overrides.repo || "test-repo";
	const now = new Date().toISOString();

	db.tasks.insertTask({
		id: taskId,
		owner: "test",
		repo,
		task_code: "TASK-" + taskId,
		phase: "execute",
		title: "Test Task",
		description: "Test Description",
		status: "pending",
		priority: 3,
		agent: "test",
		role: "test",
		doc_path: null,
		suggested_skills: [],
		finished_at: null,
		canceled_at: null,
		tags: [],
		metadata: {},
		created_at: now,
		updated_at: now,
		parent_id: null,
		depends_on: null,
		est_tokens: 0,
		in_progress_at: null,
		commit_id: null,
		changed_files: []
	});

	db.taskComments.insertTaskComment({
		id: commentId,
		task_id: taskId,
		owner: "test",
		repo,
		comment: "Initial comment",
		agent: "test",
		role: "test",
		model: "test",
		previous_status: null,
		next_status: null,
		created_at: now
	});

	return { taskId, commentId };
}

describe("TaskEntity - updateTaskComment", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;

	beforeEach(async () => {
		db = await createTestStore();
	});

	it("should only update valid columns and ignore invalid ones", () => {
		const { commentId } = createTaskWithComment(db, { commentId: "comment-123", taskId: "task-123" });

		// Now attempt to update with invalid keys
		const updates = {
			comment: "Updated comment",
			non_existent_column: "evil_value",
			"comment = 'hacked', agent": "evil_agent"
		};

		db.taskComments.updateTaskComment(commentId, updates as any);

		const updatedComment = db.taskComments.getTaskCommentById(commentId);

		expect(updatedComment).not.toBeNull();
		expect(updatedComment?.comment).toBe("Updated comment");
		// Ensure the non-existent column wasn't added to the object and didn't crash sqlite
		expect((updatedComment as any).non_existent_column).toBeUndefined();
	});

	it("should handle empty updates ({}) gracefully", () => {
		const { commentId } = createTaskWithComment(db, { commentId: "comment-empty", taskId: "task-empty" });

		db.taskComments.updateTaskComment(commentId, {});

		const updated = db.taskComments.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Initial comment");
	});

	it("should not update if all keys are invalid", () => {
		const { commentId, taskId } = createTaskWithComment(db, { commentId: "comment-inv", taskId: "task-inv" });

		db.taskComments.updateTaskComment(commentId, {
			invalid_key: "val1",
			task_id: "new-task-id",
			created_at: new Date().toISOString()
		} as any);

		const updated = db.taskComments.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Initial comment");
		expect(updated?.task_id).toBe(taskId);
	});

	it("should not update valid keys with undefined values", () => {
		const { commentId } = createTaskWithComment(db, { commentId: "comment-undef", taskId: "task-undef" });

		db.taskComments.updateTaskComment(commentId, {
			comment: undefined,
			agent: "new-agent"
		});

		const updated = db.taskComments.getTaskCommentById(commentId);
		expect(updated?.comment).toBe("Initial comment");
		expect(updated?.agent).toBe("new-agent");
	});
});

describe("TaskEntity - empty-owner code paths", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;

	beforeEach(async () => {
		db = await createTestStore();
	});

	describe("getTaskByCode", () => {
		it("returns task when owner is empty and task has empty owner", () => {
			const now = new Date().toISOString();
			db.tasks.insertTask({
				id: "empty-owner-task-1",
				owner: "",
				repo: "test-repo",
				task_code: "TASK-EMPTY-OWNER",
				phase: "execute",
				title: "Empty Owner Task",
				description: "",
				status: "pending",
				priority: 3,
				agent: "",
				role: "",
				doc_path: null,
				suggested_skills: [],
				finished_at: null,
				canceled_at: null,
				tags: [],
				metadata: {},
				created_at: now,
				updated_at: now,
				parent_id: null,
				depends_on: null,
				est_tokens: 0,
				in_progress_at: null,
				commit_id: null,
				changed_files: []
			});

			const task = db.tasks.getTaskByCode("", "test-repo", "TASK-EMPTY-OWNER");
			expect(task).not.toBeNull();
			expect(task?.id).toBe("empty-owner-task-1");
		});

		it("returns task when owner is empty and task belongs to a different owner", () => {
			const now = new Date().toISOString();
			db.tasks.insertTask({
				id: "alice-task-1",
				owner: "alice",
				repo: "test-repo",
				task_code: "TASK-ALICE",
				phase: "execute",
				title: "Alice Task",
				description: "",
				status: "pending",
				priority: 3,
				agent: "alice",
				role: "developer",
				doc_path: null,
				suggested_skills: [],
				finished_at: null,
				canceled_at: null,
				tags: [],
				metadata: {},
				created_at: now,
				updated_at: now,
				parent_id: null,
				depends_on: null,
				est_tokens: 0,
				in_progress_at: null,
				commit_id: null,
				changed_files: []
			});

			// Empty owner should skip owner filter and find the task regardless
			const task = db.tasks.getTaskByCode("", "test-repo", "TASK-ALICE");
			expect(task).not.toBeNull();
			expect(task?.id).toBe("alice-task-1");
		});
	});

	describe("isTaskCodeDuplicate", () => {
		it("returns true when a task with the code exists under empty owner", () => {
			const now = new Date().toISOString();
			db.tasks.insertTask({
				id: "dup-task-1",
				owner: "",
				repo: "test-repo",
				task_code: "TASK-DUP",
				phase: "execute",
				title: "Duplicate Test",
				description: "",
				status: "pending",
				priority: 3,
				agent: "",
				role: "",
				doc_path: null,
				suggested_skills: [],
				finished_at: null,
				canceled_at: null,
				tags: [],
				metadata: {},
				created_at: now,
				updated_at: now,
				parent_id: null,
				depends_on: null,
				est_tokens: 0,
				in_progress_at: null,
				commit_id: null,
				changed_files: []
			});

			expect(db.tasks.isTaskCodeDuplicate("", "test-repo", "TASK-DUP")).toBe(true);
		});

		it("returns false when no task with the code exists", () => {
			expect(db.tasks.isTaskCodeDuplicate("", "test-repo", "TASK-NONEXISTENT")).toBe(false);
		});

		it("returns false when the only match is excluded by id", () => {
			const now = new Date().toISOString();
			db.tasks.insertTask({
				id: "exclude-me",
				owner: "",
				repo: "test-repo",
				task_code: "TASK-EXCLUDE",
				phase: "execute",
				title: "Exclude Test",
				description: "",
				status: "pending",
				priority: 3,
				agent: "",
				role: "",
				doc_path: null,
				suggested_skills: [],
				finished_at: null,
				canceled_at: null,
				tags: [],
				metadata: {},
				created_at: now,
				updated_at: now,
				parent_id: null,
				depends_on: null,
				est_tokens: 0,
				in_progress_at: null,
				commit_id: null,
				changed_files: []
			});

			expect(db.tasks.isTaskCodeDuplicate("", "test-repo", "TASK-EXCLUDE", "exclude-me")).toBe(false);
		});
	});

	describe("getExistingTaskCodes", () => {
		it("returns codes that exist under empty owner", () => {
			const now = new Date().toISOString();
			for (const code of ["TASK-A", "TASK-B"]) {
				db.tasks.insertTask({
					id: `task-${code}`,
					owner: "",
					repo: "test-repo",
					task_code: code,
					phase: "execute",
					title: `Task ${code}`,
					description: "",
					status: "pending",
					priority: 3,
					agent: "",
					role: "",
					doc_path: null,
					suggested_skills: [],
					finished_at: null,
					canceled_at: null,
					tags: [],
					metadata: {},
					created_at: now,
					updated_at: now,
					parent_id: null,
					depends_on: null,
					est_tokens: 0,
					in_progress_at: null,
					commit_id: null,
					changed_files: []
				});
			}

			const existing = db.tasks.getExistingTaskCodes("", "test-repo", ["TASK-A", "TASK-B", "TASK-C"]);
			expect(existing.has("TASK-A")).toBe(true);
			expect(existing.has("TASK-B")).toBe(true);
			expect(existing.has("TASK-C")).toBe(false);
		});

		it("returns empty set for empty codes array", () => {
			const existing = db.tasks.getExistingTaskCodes("", "test-repo", []);
			expect(existing.size).toBe(0);
		});
	});
});
