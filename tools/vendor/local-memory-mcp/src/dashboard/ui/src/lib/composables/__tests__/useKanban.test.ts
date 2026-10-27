import { describe, expect, it, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
import { createKanbanHandler, COLUMNS } from "../useKanban";
import { currentRepo, taskSearch } from "../../stores";
import type { Task, Pagination } from "../../stores";

// createKanbanHandler() calls svelte's onMount() at the end of construction,
// and Svelte 5 throws when onMount is used outside a component lifecycle.
// No-op it so the handler can be built in a plain unit test. This only patches
// the root "svelte" module — svelte/store (get/writable) imports from
// svelte/internal, not the root, so real store semantics are preserved.
vi.mock("svelte", async (importOriginal) => {
	const mod = await importOriginal<typeof import("svelte")>();
	return { ...mod, onMount: () => {} };
});

// Mock the api module with a RELATIVE path so it resolves identically under
// both configs (the root vitest.config.ts does not define the $lib alias).
// Shared fn must come from vi.hoisted (hoisted above imports).
const { apiMock } = vi.hoisted(() => ({
	apiMock: {
		tasks: vi.fn(),
		updateTask: vi.fn(),
		export: vi.fn(),
		bulkTaskAction: vi.fn()
	}
}));

vi.mock("../../api", () => ({ api: apiMock }));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ALL_STATUSES = COLUMNS.map((c) => c.status);
const ACTIVE_STATUSES = ["in_progress", "pending", "backlog", "blocked"];
const TERMINAL_STATUSES = ["completed", "canceled"];

interface TaskListParams {
	repo: string;
	status: string;
	search: string;
	page: number;
	pageSize: number;
}

function makeTask(id: string, status: string, overrides: Partial<Task> = {}): Task {
	return {
		id,
		repo: "repo-a",
		task_code: `TC-${id}`,
		phase: "testing",
		title: `Task ${id}`,
		description: null,
		status,
		priority: 3,
		created_at: "2026-08-01T00:00:00Z",
		updated_at: "2026-08-01T00:00:00Z",
		...overrides
	};
}

function pagination(page: number, totalItems: number, pageSize = 20): Pagination {
	return { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) };
}

/** Server response shaped like GET /api/tasks?repo=&status=&page=&pageSize=. */
function tasksResponse(status: string, tasks: Task[], page = 1, totalItems?: number) {
	const ti = totalItems ?? tasks.length;
	return { tasks, pagination: pagination(page, ti) };
}

const emptyResponse = () => ({ tasks: [], pagination: pagination(1, 0) });

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useKanban column loading", () => {
	beforeEach(() => {
		apiMock.tasks.mockReset();
		apiMock.tasks.mockResolvedValue(emptyResponse());
		currentRepo.set(null);
		taskSearch.set("");
	});

	it("loadTasks fires the ACTIVE batch before the TERMINAL batch (two-batch loading)", async () => {
		currentRepo.set("repo-a");
		taskSearch.set("feature");
		const handler = createKanbanHandler();

		await handler.loadTasks("repo-a", "feature");

		expect(apiMock.tasks).toHaveBeenCalledTimes(6);
		const statuses = (apiMock.tasks.mock.calls as [TaskListParams][]).map(([params]) => params.status);
		expect(statuses).toEqual([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);

		// Every request carries the repo, search, and first-page pagination.
		for (const [params] of apiMock.tasks.mock.calls as [TaskListParams][]) {
			expect(params).toMatchObject({ repo: "repo-a", search: "feature", page: 1, pageSize: 20 });
		}
	});

	it("requests all six column statuses exactly once on a full load", async () => {
		currentRepo.set("repo-a");
		const handler = createKanbanHandler();

		await handler.loadTasks("repo-a", "");

		expect(apiMock.tasks).toHaveBeenCalledTimes(ALL_STATUSES.length);
		const counts = new Map<string, number>();
		for (const [params] of apiMock.tasks.mock.calls as [TaskListParams][]) {
			counts.set(params.status, (counts.get(params.status) ?? 0) + 1);
		}
		expect([...counts.keys()].sort()).toEqual([...ALL_STATUSES].sort());
		for (const status of ALL_STATUSES) {
			expect(counts.get(status)).toBe(1);
		}
	});

	it("updates per-column pagination state from response meta (totalItems, totalPages, hasMore)", async () => {
		currentRepo.set("repo-a");
		apiMock.tasks.mockImplementation(({ status }: TaskListParams) => {
			if (status === "in_progress") return Promise.resolve(tasksResponse(status, [makeTask("ip-1", status)], 1, 25));
			if (status === "completed") return Promise.resolve(tasksResponse(status, [makeTask("co-1", status)], 1, 1));
			return Promise.resolve(tasksResponse(status, []));
		});
		const handler = createKanbanHandler();

		await handler.loadTasks("repo-a", "");

		const state = get(handler);
		// 1 of 25 fetched → 2 pages, more available.
		expect(state.pagination["in_progress"]).toEqual({
			page: 1,
			pageSize: 20,
			totalItems: 25,
			totalPages: 2,
			hasMore: true
		});
		expect(state.columnTasks["in_progress"]).toEqual([expect.objectContaining({ id: "ip-1" })]);
		// 1 of 1 fetched → single page, nothing more.
		expect(state.pagination["completed"]).toEqual({
			page: 1,
			pageSize: 20,
			totalItems: 1,
			totalPages: 1,
			hasMore: false
		});
		// Empty column → 0 items, nothing more.
		expect(state.pagination["backlog"]).toEqual({
			page: 1,
			pageSize: 20,
			totalItems: 0,
			totalPages: 0,
			hasMore: false
		});
	});

	it("loadMore increments the page for one column only and appends its tasks", async () => {
		currentRepo.set("repo-a");
		apiMock.tasks.mockImplementation(({ status, page }: TaskListParams) => {
			if (status === "pending" && page === 1)
				return Promise.resolve(tasksResponse(status, [makeTask("p-1", status)], 1, 2));
			if (status === "pending" && page === 2)
				return Promise.resolve(tasksResponse(status, [makeTask("p-2", status)], 2, 2));
			return Promise.resolve(tasksResponse(status, []));
		});
		const handler = createKanbanHandler();
		await handler.loadTasks("repo-a", "");

		await handler.loadMore("pending");

		// pending got exactly one extra request, for page 2 (search from taskSearch store).
		const pendingCalls = (apiMock.tasks.mock.calls as [TaskListParams][]).filter(([p]) => p.status === "pending");
		expect(pendingCalls).toHaveLength(2);
		expect(pendingCalls[1][0]).toEqual({ repo: "repo-a", status: "pending", search: "", page: 2, pageSize: 20 });

		const state = get(handler);
		expect(state.pagination["pending"].page).toBe(2);
		expect(state.pagination["pending"].totalItems).toBe(2);
		expect(state.columnTasks["pending"].map((t) => t.id)).toEqual(["p-1", "p-2"]);
		// Every other column still sits on page 1.
		for (const c of COLUMNS) {
			if (c.status !== "pending") expect(state.pagination[c.status].page).toBe(1);
		}
	});

	it("loadingCols guard prevents a duplicate concurrent load of the same column", async () => {
		currentRepo.set("repo-a");
		const inFlight = deferred<ReturnType<typeof tasksResponse>>();
		apiMock.tasks.mockImplementation(({ status, page }: TaskListParams) => {
			if (status === "in_progress" && page === 2) return inFlight.promise;
			return Promise.resolve(tasksResponse(status, []));
		});
		const handler = createKanbanHandler();
		await handler.loadTasks("repo-a", ""); // page-1 warm-up for all columns

		apiMock.tasks.mockClear(); // clears call records, keeps the implementation

		const p1 = handler.loadMore("in_progress");
		const p2 = handler.loadMore("in_progress"); // fired while page-2 request is in flight

		// The second call must return early at the loadingCols guard: only ONE
		// in_progress request is issued, for page 2.
		const inProgressCalls = (apiMock.tasks.mock.calls as [TaskListParams][]).filter(
			([p]) => p.status === "in_progress"
		);
		expect(inProgressCalls).toHaveLength(1);
		expect(inProgressCalls[0][0].page).toBe(2);

		inFlight.resolve(tasksResponse("in_progress", [makeTask("ip-1", "in_progress")], 2, 1));
		await Promise.all([p1, p2]);

		// Loading flag cleared once the in-flight request settles.
		expect(get(handler).loadingCols.has("in_progress")).toBe(false);
		expect(get(handler).columnTasks["in_progress"].map((t) => t.id)).toEqual(["ip-1"]);
	});

	it("dedupes tasks by id when appending a later page", async () => {
		currentRepo.set("repo-a");
		const dup = makeTask("dup-1", "backlog");
		apiMock.tasks.mockImplementation(({ status, page }: TaskListParams) => {
			if (status === "backlog" && page === 1) return Promise.resolve(tasksResponse(status, [dup], 1, 3));
			if (status === "backlog" && page === 2)
				return Promise.resolve(tasksResponse(status, [dup, makeTask("back-2", "backlog")], 2, 3));
			return Promise.resolve(tasksResponse(status, []));
		});
		const handler = createKanbanHandler();
		await handler.loadTasks("repo-a", "");
		await handler.loadMore("backlog");

		const state = get(handler);
		// dup-1 reappeared on page 2 — it must not be duplicated in the column.
		expect(state.columnTasks["backlog"].map((t) => t.id)).toEqual(["dup-1", "back-2"]);
		expect(state.columnTasks["backlog"]).toHaveLength(2);
		// 2 of 3 loaded → more pages available.
		expect(state.pagination["backlog"].hasMore).toBe(true);
	});

	it("swallows a failed column load: logs the error and clears the loading flag", async () => {
		currentRepo.set("repo-a");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		apiMock.tasks.mockRejectedValue(new Error("boom"));
		const handler = createKanbanHandler();

		await handler.loadTasks("repo-a", "");

		expect(errorSpy).toHaveBeenCalled();
		expect(get(handler).loadingCols.size).toBe(0);
		// The failed column keeps no partial data.
		for (const c of COLUMNS) {
			expect(get(handler).columnTasks[c.status]).toEqual([]);
		}
		errorSpy.mockRestore();
	});
});
