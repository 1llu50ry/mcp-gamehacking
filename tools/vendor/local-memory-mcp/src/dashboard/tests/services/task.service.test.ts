/**
 * Unit tests for the task service layer (list status-fanout + soft-delete
 * scoping, owner resolution precedence, MCP tool-arg building, bulk actions).
 *
 * The HTTP layer pins bulk delete/soft-cancel + the 400/422 route guards;
 * these tests pin the SERVICE-owned rules not visible through routes: the
 * status-comment injection and completed-state defaults in buildToolArgs,
 * DASHBOARD_OWNER fallback for writes, and the time-stats aggregation shape.
 * Pure unit — db + mcpClient stubbed, purgeEntityAndCleanup mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_STATUS_IN_PROGRESS, TASK_STATUS_PENDING, TASK_STATUS_COMPLETED } from "../../../mcp/types/task";
import type { Task } from "../../../mcp/types/task";

const mocks = vi.hoisted(() => {
	const db = {
		tasks: {
			getTasksByMultipleStatuses: vi.fn(),
			countTasksByMultipleStatuses: vi.fn(),
			getTasksByRepo: vi.fn(),
			countTasks: vi.fn(),
			getTaskById: vi.fn(),
			getTaskByCode: vi.fn(),
			isTaskCodeDuplicate: vi.fn(),
			insertTask: vi.fn(),
			getTasksByIds: vi.fn(),
			bulkInsertTasks: vi.fn()
		},
		taskStats: {
			getTaskTimeStats: vi.fn(),
			getTaskComparisonSeries: vi.fn()
		},
		taskComments: {
			getTaskCommentById: vi.fn(),
			updateTaskComment: vi.fn(),
			deleteTaskComment: vi.fn()
		},
		actions: { logAction: vi.fn() },
		refresh: vi.fn(),
		withWrite: vi.fn((fn: () => unknown) => fn()),
		withExclusiveWrite: vi.fn((fn: () => unknown) => fn())
	};
	return {
		db,
		purge: vi.fn(() => 1),
		mcpClient: {
			start: vi.fn(),
			stop: vi.fn(),
			isConnected: vi.fn(() => false),
			getPendingCount: vi.fn(() => 0),
			callTool: vi.fn()
		},
		embeddingWorker: { getStats: vi.fn() },
		vectors: { upsert: vi.fn(), remove: vi.fn(), search: vi.fn() },
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		startTime: Date.now()
	};
});

vi.mock("../../lib/context", () => ({
	db: mocks.db,
	mcpClient: mocks.mcpClient,
	embeddingWorker: mocks.embeddingWorker,
	vectors: mocks.vectors,
	logger: mocks.logger,
	startTime: mocks.startTime
}));

vi.mock("../../../mcp/utils/purge-entity-cleanup", () => ({
	purgeEntityAndCleanup: mocks.purge
}));

import { TaskService } from "../../services/task.service";

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		owner: "acme",
		repo: "app",
		task_code: "T-1",
		phase: "Implementation",
		title: "Do the thing",
		description: null,
		status: TASK_STATUS_IN_PROGRESS,
		priority: 3,
		agent: "backend",
		role: "user",
		doc_path: null,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		in_progress_at: null,
		finished_at: null,
		canceled_at: null,
		est_tokens: 100,
		commit_id: "abc123",
		changed_files: ["src/a.ts"],
		tags: [],
		suggested_skills: [],
		metadata: {},
		parent_id: null,
		depends_on: null,
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(mocks.db.tasks.getTasksByMultipleStatuses).mockReturnValue([]);
	vi.mocked(mocks.db.tasks.countTasksByMultipleStatuses).mockReturnValue(0);
	vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValue([]);
	vi.mocked(mocks.db.tasks.countTasks).mockReturnValue(0);
	vi.mocked(mocks.db.tasks.isTaskCodeDuplicate).mockReturnValue(false);
	vi.mocked(mocks.db.tasks.bulkInsertTasks).mockReturnValue(0);
	vi.mocked(mocks.db.taskStats.getTaskTimeStats).mockReturnValue({
		completed: 1,
		tokens: 100,
		avgDuration: 10,
		added: 2
	});
	vi.mocked(mocks.db.taskStats.getTaskComparisonSeries).mockReturnValue([]);
	vi.mocked(mocks.mcpClient.callTool).mockResolvedValue({ structuredContent: { success: true } });
	vi.mocked(mocks.mcpClient.isConnected).mockReturnValue(false);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("TaskService.list", () => {
	it("fans out to the multi-status query when status contains commas", () => {
		vi.mocked(mocks.db.tasks.getTasksByMultipleStatuses).mockReturnValue([makeTask()]);
		vi.mocked(mocks.db.tasks.countTasksByMultipleStatuses).mockReturnValue(1);

		const result = TaskService.list({ repo: "app", status: "pending,in_progress", limit: 10, offset: 0 });

		expect(result.tasks).toHaveLength(1);
		expect(result.totalItems).toBe(1);
		expect(mocks.db.tasks.getTasksByMultipleStatuses).toHaveBeenCalledWith(
			"",
			"app",
			["pending", "in_progress"],
			10,
			0,
			undefined
		);
		expect(mocks.db.tasks.countTasksByMultipleStatuses).toHaveBeenCalledWith(
			"",
			"app",
			["pending", "in_progress"],
			undefined
		);
		expect(mocks.db.tasks.getTasksByRepo).not.toHaveBeenCalled();
	});

	it("uses the single-status path and hides canceled tasks when no status filter is given (TASK-209)", () => {
		TaskService.list({ repo: "app", limit: 10, offset: 0 });
		TaskService.list({ repo: "app", status: "canceled", limit: 10, offset: 0 });

		// excludeCanceled is !status → true when filtering by nothing, false when explicit.
		expect(mocks.db.tasks.getTasksByRepo.mock.calls.map((call) => call[6])).toEqual([true, false]);
		expect(mocks.db.tasks.countTasks.mock.calls.map((call) => call[4])).toEqual([true, false]);
	});
});

describe("TaskService.exists / getById / getByCode", () => {
	it("exists() reflects the row presence", () => {
		vi.mocked(mocks.db.tasks.getTaskById).mockReturnValue(makeTask());
		expect(TaskService.exists("task-1")).toBe(true);

		vi.mocked(mocks.db.tasks.getTaskById).mockReturnValue(null);
		expect(TaskService.exists("ghost")).toBe(false);
	});

	it("getById returns the task or null", () => {
		vi.mocked(mocks.db.tasks.getTaskById).mockReturnValue(makeTask());
		expect(TaskService.getById("task-1")?.id).toBe("task-1");

		vi.mocked(mocks.db.tasks.getTaskById).mockReturnValue(null);
		expect(TaskService.getById("ghost")).toBeNull();
	});

	it("getByCode resolves through the repo-scoped lookup", () => {
		vi.mocked(mocks.db.tasks.getTaskByCode).mockReturnValue(makeTask());
		expect(TaskService.getByCode("app", "T-1")?.task_code).toBe("T-1");
		expect(mocks.db.tasks.getTaskByCode).toHaveBeenCalledWith("", "app", "T-1");

		vi.mocked(mocks.db.tasks.getTaskByCode).mockReturnValue(null);
		expect(TaskService.getByCode("app", "NOPE")).toBeNull();
	});
});

describe("TaskService.create", () => {
	it("creates with an explicit owner and returns the generated id", async () => {
		const id = await TaskService.create({ repo: "app", task_code: "T-9", title: "New task", owner: "acme" });

		expect(id).toEqual(expect.any(String));
		expect(mocks.db.tasks.insertTask).toHaveBeenCalledWith(
			expect.objectContaining({ owner: "acme", repo: "app", task_code: "T-9", id })
		);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("write", "acme", "app", { taskId: id });
	});

	it("falls back to DASHBOARD_OWNER when no owner attribute is given", async () => {
		vi.stubEnv("DASHBOARD_OWNER", "acme");

		await TaskService.create({ repo: "app", task_code: "T-9", title: "New task" });

		const insertArg = mocks.db.tasks.insertTask.mock.calls[0][0] as Task;
		expect(insertArg.owner).toBe("acme");
	});

	it("rejects with 400 when no owner can be resolved", async () => {
		vi.stubEnv("DASHBOARD_OWNER", "");

		await expect(TaskService.create({ repo: "app", task_code: "T-9", title: "New task" })).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "owner is required (or set DASHBOARD_OWNER)"
		});
		expect(mocks.db.tasks.insertTask).not.toHaveBeenCalled();
	});

	it("rejects a duplicate task_code with 400", async () => {
		vi.mocked(mocks.db.tasks.isTaskCodeDuplicate).mockReturnValue(true);

		await expect(
			TaskService.create({ repo: "app", task_code: "T-1", title: "Dup", owner: "acme" })
		).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "Duplicate task_code"
		});
	});
});

describe("TaskService.update", () => {
	it("throws 404 when the task does not exist", async () => {
		vi.mocked(mocks.db.tasks.getTaskById).mockReturnValue(null);

		await expect(TaskService.update("ghost", { title: "x" })).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Task not found"
		});
		expect(mocks.mcpClient.callTool).not.toHaveBeenCalled();
	});

	it("delegates through the MCP client and reloads the updated task", async () => {
		vi.mocked(mocks.db.tasks.getTaskById)
			.mockReturnValueOnce(makeTask()) // pre-read
			.mockReturnValueOnce({ ...makeTask(), title: "Renamed" }); // post-refresh read
		vi.mocked(mocks.db.refresh).mockResolvedValue(undefined);

		const result = await TaskService.update("task-1", { title: "Renamed" });

		expect(result.title).toBe("Renamed");
		expect(mocks.mcpClient.start).toHaveBeenCalledTimes(1);
		expect(mocks.mcpClient.callTool).toHaveBeenCalledWith(
			"task-update",
			expect.objectContaining({
				repo: "app",
				owner: "acme",
				id: "task-1",
				agent: "dashboard",
				role: "user",
				model: "web-ui",
				structured: true,
				title: "Renamed"
			})
		);
		expect(mocks.db.refresh).toHaveBeenCalledTimes(1);
	});

	it("never lets a caller-supplied owner override the task row's owner", async () => {
		vi.mocked(mocks.db.tasks.getTaskById)
			.mockReturnValueOnce(makeTask()) // pre-read
			.mockReturnValueOnce({ ...makeTask(), title: "Renamed" }); // post-refresh read
		vi.mocked(mocks.db.refresh).mockResolvedValue(undefined);

		await TaskService.update("task-1", { title: "Renamed", owner: "attacker" });

		const toolArgs = mocks.mcpClient.callTool.mock.calls[0][1] as Record<string, unknown>;
		expect(toolArgs.owner).toBe("acme");
	});

	it("injects a status-change comment when the status is updated without one", async () => {
		vi.mocked(mocks.db.tasks.getTaskById)
			.mockReturnValueOnce(makeTask()) // status in_progress
			.mockReturnValueOnce({ ...makeTask(), status: TASK_STATUS_COMPLETED });
		vi.mocked(mocks.db.refresh).mockResolvedValue(undefined);

		await TaskService.update("task-1", { status: TASK_STATUS_COMPLETED });

		const toolArgs = mocks.mcpClient.callTool.mock.calls[0][1] as Record<string, unknown>;
		expect(toolArgs.comment).toBe("Status updated via dashboard to completed");
	});

	it("backfills est_tokens/commit_id/changed_files from the existing task for completed updates", async () => {
		vi.mocked(mocks.db.tasks.getTaskById)
			.mockReturnValueOnce(makeTask())
			.mockReturnValueOnce({ ...makeTask(), status: TASK_STATUS_COMPLETED });
		vi.mocked(mocks.db.refresh).mockResolvedValue(undefined);

		await TaskService.update("task-1", { status: TASK_STATUS_COMPLETED });

		const toolArgs = mocks.mcpClient.callTool.mock.calls[0][1] as Record<string, unknown>;
		expect(toolArgs.est_tokens).toBe(100);
		expect(toolArgs.commit_id).toBe("abc123");
		expect(toolArgs.changed_files).toEqual(["src/a.ts"]);
	});

	it("throws 500 when the task cannot be reloaded after the update", async () => {
		vi.mocked(mocks.db.tasks.getTaskById).mockReturnValueOnce(makeTask()).mockReturnValueOnce(null);
		vi.mocked(mocks.db.refresh).mockResolvedValue(undefined);

		await expect(TaskService.update("task-1", { title: "x" })).rejects.toMatchObject({
			name: "ServiceError",
			status: 500,
			message: "Task updated but could not be reloaded"
		});
	});
});

describe("TaskService.delete", () => {
	it("routes the single delete through the shared purge + cleanup contract", async () => {
		vi.mocked(mocks.db.tasks.getTaskById).mockReturnValue(makeTask());

		await TaskService.delete("task-1");

		expect(mocks.purge).toHaveBeenCalledWith(mocks.db, "task", [{ id: "task-1", title: "Do the thing", repo: "app" }]);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("delete", "acme", "app", { taskId: "task-1" });
	});

	it("throws 404 when the task does not exist (no purge attempted)", async () => {
		vi.mocked(mocks.db.tasks.getTaskById).mockReturnValue(null);

		await expect(TaskService.delete("ghost")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Task not found"
		});
		expect(mocks.purge).not.toHaveBeenCalled();
	});
});

describe("TaskService.bulkCreate", () => {
	it("defaults owner/task_code/timestamps and returns the inserted count", async () => {
		vi.mocked(mocks.db.tasks.bulkInsertTasks).mockReturnValue(2);

		const n = await TaskService.bulkCreate(
			[
				{ title: "a", owner: "acme" },
				{ title: "b", owner: "acme" }
			],
			"app"
		);

		expect(n).toBe(2);
		const entries = mocks.db.tasks.bulkInsertTasks.mock.calls[0][0] as Task[];
		expect(entries[0].owner).toBe("acme");
		expect(entries[0].repo).toBe("app");
		expect(entries[0].task_code).toEqual(expect.any(String)); // generated fallback
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("write", "acme", "app", { query: "Bulk imported 2 tasks" });
	});

	it("rejects with 400 when any item lacks an owner", async () => {
		await expect(TaskService.bulkCreate([{ title: "a", owner: "acme" }, { title: "b" }], "app")).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "owner is required on every item (or set DASHBOARD_OWNER)"
		});
		expect(mocks.db.tasks.bulkInsertTasks).not.toHaveBeenCalled();
	});
});

describe("TaskService.bulkAction", () => {
	it("bulk delete routes through the purge contract and returns the existing count", async () => {
		vi.mocked(mocks.db.tasks.getTasksByIds).mockReturnValue([makeTask({ id: "task-1" })]);

		const n = await TaskService.bulkAction("delete", ["task-1"]);

		expect(n).toBe(1);
		expect(mocks.purge).toHaveBeenCalledWith(mocks.db, "task", [{ id: "task-1", title: "Do the thing", repo: "app" }]);
	});

	it("rejects update/status without an updates payload with 400", async () => {
		await expect(TaskService.bulkAction("status", ["task-1"])).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "'updates' required for update/status action"
		});
		expect(mocks.mcpClient.callTool).not.toHaveBeenCalled();
	});

	it("rejects an unknown action with 400", async () => {
		await expect(TaskService.bulkAction("explode", ["task-1"])).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "Invalid action: must be 'delete', 'update', or 'status'"
		});
	});

	it("status action routes each id through the MCP client and reports 422 when all fail", async () => {
		vi.mocked(mocks.db.tasks.getTaskById).mockReturnValue(null); // every id unknown
		vi.mocked(mocks.db.refresh).mockResolvedValue(undefined);

		await expect(
			TaskService.bulkAction("status", ["ghost-1", "ghost-2"], { status: TASK_STATUS_PENDING })
		).rejects.toMatchObject({
			name: "ServiceError",
			status: 422,
			message: expect.stringContaining("All tasks failed")
		});
	});

	it("status action counts per-id successes and logs the outcome", async () => {
		vi.mocked(mocks.db.tasks.getTaskById).mockReturnValue(makeTask());
		vi.mocked(mocks.db.refresh).mockResolvedValue(undefined);

		const n = await TaskService.bulkAction("status", ["task-1", "task-2"], { status: TASK_STATUS_PENDING });

		expect(n).toBe(2);
		expect(mocks.mcpClient.callTool).toHaveBeenCalledTimes(2);
		expect(mocks.mcpClient.callTool).toHaveBeenCalledWith(
			"task-update",
			expect.objectContaining({ id: "task-1", status: TASK_STATUS_PENDING })
		);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("status", "acme", "app", {
			query: "Bulk status applied to 2 tasks"
		});
	});
});

describe("TaskService.getTimeStats / updateComment / deleteComment", () => {
	it("builds the daily/weekly/monthly/overall shape with history series", () => {
		const result = TaskService.getTimeStats("app");

		expect(mocks.db.taskStats.getTaskTimeStats).toHaveBeenCalledWith("", "app", "daily");
		expect(mocks.db.taskStats.getTaskTimeStats).toHaveBeenCalledWith("", "app", "weekly");
		expect(mocks.db.taskStats.getTaskTimeStats).toHaveBeenCalledWith("", "app", "monthly");
		expect(mocks.db.taskStats.getTaskTimeStats).toHaveBeenCalledWith("", "app", "overall");
		for (const period of ["daily", "weekly", "monthly", "overall"] as const) {
			expect(result[period]).toMatchObject({ completed: 1, tokens: 100, avgDuration: 10, added: 2, history: [] });
		}
	});

	it("coerces an empty repo to the global (null) scope", () => {
		TaskService.getTimeStats("");

		expect(mocks.db.taskStats.getTaskTimeStats.mock.calls.every((call) => call[1] === null)).toBe(true);
		expect(mocks.db.taskStats.getTaskComparisonSeries.mock.calls.every((call) => call[1] === null)).toBe(true);
	});

	it("updateComment throws 404 for a missing comment and updates inside the write lock otherwise", async () => {
		vi.mocked(mocks.db.taskComments.getTaskCommentById).mockReturnValue(null);
		await expect(TaskService.updateComment("c-ghost", "note")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Comment not found"
		});

		vi.mocked(mocks.db.taskComments.getTaskCommentById).mockReturnValue({ id: "c-1" } as never);
		await TaskService.updateComment("c-1", "note");
		expect(mocks.db.taskComments.updateTaskComment).toHaveBeenCalledWith("c-1", { comment: "note" });
	});

	it("deleteComment throws 404 for a missing comment and deletes inside the write lock otherwise", async () => {
		vi.mocked(mocks.db.taskComments.getTaskCommentById).mockReturnValue(null);
		await expect(TaskService.deleteComment("c-ghost")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Comment not found"
		});

		vi.mocked(mocks.db.taskComments.getTaskCommentById).mockReturnValue({ id: "c-1" } as never);
		await TaskService.deleteComment("c-1");
		expect(mocks.db.taskComments.deleteTaskComment).toHaveBeenCalledWith("c-1");
	});
});
