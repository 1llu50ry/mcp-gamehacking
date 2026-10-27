/**
 * Unit tests for the Arena overview aggregate service (TASK-269 / audit F7).
 *
 * Asserts the server-side aggregation business rules: per-repo fan-out with
 * the exact per-status/per-kind caps the arena client used, repo sort order,
 * and the short-TTL overview cache (ARENA_OVERVIEW_TTL_MS). Pure unit — db is
 * a stubbed context (no HTTP, no SQLite).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_STATUS_IN_PROGRESS, TASK_STATUS_PENDING, TASK_STATUS_BLOCKED } from "../../../mcp/types/task";
import type { Task } from "../../../mcp/types/task";
import type { Claim, Handoff } from "../../../mcp/types/handoff";

const mocks = vi.hoisted(() => {
	const db = {
		system: { listRepos: vi.fn() },
		tasks: { getTasksByRepo: vi.fn() },
		handoffs: { listClaims: vi.fn(), listHandoffs: vi.fn() }
	};
	return {
		db,
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

import { ArenaService, clearArenaOverviewCache } from "../../services/arena.service";

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
		est_tokens: 0,
		commit_id: null,
		changed_files: [],
		tags: [],
		suggested_skills: [],
		metadata: {},
		parent_id: null,
		depends_on: null,
		...overrides
	};
}

function makeClaim(overrides: Partial<Claim> = {}): Claim {
	return {
		id: "claim-1",
		owner: "acme",
		repo: "app",
		task_id: "task-1",
		task_code: "T-1",
		agent: "backend",
		role: "user",
		claimed_at: "2026-01-01T00:00:00.000Z",
		released_at: null,
		metadata: {},
		...overrides
	};
}

function makeHandoff(overrides: Partial<Handoff> = {}): Handoff {
	return {
		id: "handoff-1",
		owner: "acme",
		repo: "app",
		from_agent: "backend",
		to_agent: "tester",
		task_id: "task-1",
		task_code: "T-1",
		summary: "pass the baton",
		context: {},
		status: "pending",
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		expires_at: null,
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	clearArenaOverviewCache();
	vi.mocked(mocks.db.system.listRepos).mockReturnValue([]);
	vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValue([]);
	vi.mocked(mocks.db.handoffs.listClaims).mockReturnValue([]);
	vi.mocked(mocks.db.handoffs.listHandoffs).mockReturnValue([]);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("ArenaService.getOverview", () => {
	it("returns empty aggregates when no repos exist", () => {
		const result = ArenaService.getOverview();
		expect(result).toEqual({ tasks: [], claims: [], handoffs: [] });
		expect(mocks.db.tasks.getTasksByRepo).not.toHaveBeenCalled();
	});

	it("aggregates tasks/claims/handoffs for every repo (sorted), passing the legacy per-repo limits", () => {
		vi.mocked(mocks.db.system.listRepos).mockReturnValue(["zeta", "alpha"]);
		vi.mocked(mocks.db.tasks.getTasksByRepo)
			.mockReturnValueOnce([makeTask({ repo: "alpha" })])
			.mockReturnValue([]);
		vi.mocked(mocks.db.handoffs.listClaims).mockReturnValue([makeClaim()]);
		vi.mocked(mocks.db.handoffs.listHandoffs).mockReturnValue([makeHandoff()]);

		const result = ArenaService.getOverview();

		expect(result.tasks).toHaveLength(1);
		expect(result.claims).toHaveLength(2); // 1 per repo
		expect(result.handoffs).toHaveLength(2); // 1 per repo

		// Repos are visited in sorted order.
		const calledRepos = mocks.db.tasks.getTasksByRepo.mock.calls.map((call) => call[1]);
		expect(calledRepos).toEqual(["alpha", "alpha", "alpha", "zeta", "zeta", "zeta"]);

		// Per-status caps: in_progress 10 / pending 8 / blocked 4, claims 50, handoffs 10.
		expect(mocks.db.tasks.getTasksByRepo.mock.calls.map((call) => call[2])).toEqual([
			TASK_STATUS_IN_PROGRESS,
			TASK_STATUS_PENDING,
			TASK_STATUS_BLOCKED,
			TASK_STATUS_IN_PROGRESS,
			TASK_STATUS_PENDING,
			TASK_STATUS_BLOCKED
		]);
		expect(mocks.db.tasks.getTasksByRepo.mock.calls.map((call) => call[3])).toEqual([10, 8, 4, 10, 8, 4]);
		expect(mocks.db.handoffs.listClaims.mock.calls.map((call) => call[0].limit)).toEqual([50, 50]);
		expect(mocks.db.handoffs.listClaims.mock.calls.map((call) => call[0].active_only)).toEqual([true, true]);
		expect(mocks.db.handoffs.listHandoffs.mock.calls.map((call) => call[0].status)).toEqual(["pending", "pending"]);
		expect(mocks.db.handoffs.listHandoffs.mock.calls.map((call) => call[0].limit)).toEqual([10, 10]);
	});

	it("serves repeated calls from the overview cache (single aggregate pass within TTL)", () => {
		vi.mocked(mocks.db.system.listRepos).mockReturnValue(["alpha"]);
		vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValue([makeTask()]);

		const first = ArenaService.getOverview();
		const second = ArenaService.getOverview();

		expect(second).toBe(first); // same cached object reference
		expect(mocks.db.system.listRepos).toHaveBeenCalledTimes(1);
		expect(mocks.db.tasks.getTasksByRepo).toHaveBeenCalledTimes(3);
	});

	it("recomputes on every call when ARENA_OVERVIEW_TTL_MS is 0", () => {
		vi.stubEnv("ARENA_OVERVIEW_TTL_MS", "0");
		vi.mocked(mocks.db.system.listRepos).mockReturnValue(["alpha"]);
		vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValue([]);

		ArenaService.getOverview();
		ArenaService.getOverview();

		expect(mocks.db.system.listRepos).toHaveBeenCalledTimes(2);
	});

	it("falls back to the 5s default TTL when the env value is negative (cache still serves)", () => {
		vi.stubEnv("ARENA_OVERVIEW_TTL_MS", "-1");
		vi.mocked(mocks.db.system.listRepos).mockReturnValue(["alpha"]);
		vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValue([]);

		ArenaService.getOverview();
		ArenaService.getOverview();

		expect(mocks.db.system.listRepos).toHaveBeenCalledTimes(1);
	});

	it("clearArenaOverviewCache forces the next read to recompute", () => {
		vi.mocked(mocks.db.system.listRepos).mockReturnValue(["alpha"]);
		vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValue([]);

		ArenaService.getOverview();
		clearArenaOverviewCache();
		ArenaService.getOverview();

		expect(mocks.db.system.listRepos).toHaveBeenCalledTimes(2);
	});
});
