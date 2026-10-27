/**
 * Unit tests for the coordination service layer (claims + handoffs).
 *
 * Focus: argument normalization (active_only default, agent filter),
 * task_code → task_id resolution for claim release, MCP delegation for
 * handoff creation, and the null-return contracts of status updates.
 * Pure unit — db + mcpClient stubbed via the mocked context module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Claim, Handoff } from "../../../mcp/types/handoff";

const mocks = vi.hoisted(() => {
	const db = {
		handoffs: {
			listClaims: vi.fn(),
			countClaims: vi.fn(),
			listHandoffs: vi.fn(),
			countHandoffs: vi.fn(),
			getHandoffById: vi.fn(),
			updateHandoffStatus: vi.fn(),
			releaseClaim: vi.fn()
		},
		tasks: { getTaskByCode: vi.fn() },
		withWrite: vi.fn((fn: () => unknown) => fn())
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

import { CoordinationService } from "../../services/coordination.service";

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
	vi.mocked(mocks.db.handoffs.listClaims).mockReturnValue([]);
	vi.mocked(mocks.db.handoffs.countClaims).mockReturnValue(0);
	vi.mocked(mocks.db.handoffs.listHandoffs).mockReturnValue([]);
	vi.mocked(mocks.db.handoffs.countHandoffs).mockReturnValue(0);
	vi.mocked(mocks.mcpClient.isConnected).mockReturnValue(false);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("CoordinationService.listClaims", () => {
	it("lists claims with active_only defaulting to true and returns total", () => {
		vi.mocked(mocks.db.handoffs.listClaims).mockReturnValue([makeClaim()]);
		vi.mocked(mocks.db.handoffs.countClaims).mockReturnValue(1);

		const result = CoordinationService.listClaims({ repo: "app", limit: 20, offset: 0 });

		expect(result.claims).toHaveLength(1);
		expect(result.total).toBe(1);
		expect(mocks.db.handoffs.listClaims).toHaveBeenCalledWith({
			owner: "",
			repo: "app",
			agent: undefined,
			active_only: true,
			limit: 20,
			offset: 0
		});
		expect(mocks.db.handoffs.countClaims).toHaveBeenCalledWith({
			owner: "",
			repo: "app",
			agent: undefined,
			active_only: true
		});
	});

	it("passes an explicit agent filter and active_only=false through", () => {
		const result = CoordinationService.listClaims({
			repo: "app",
			agent: "tester",
			active_only: false,
			limit: 5,
			offset: 10
		});

		expect(result.claims).toEqual([]);
		expect(mocks.db.handoffs.listClaims).toHaveBeenCalledWith({
			owner: "",
			repo: "app",
			agent: "tester",
			active_only: false,
			limit: 5,
			offset: 10
		});
	});
});

describe("CoordinationService.listHandoffs", () => {
	it("forwards the status/to_agent/from_agent filters to list + count", () => {
		vi.mocked(mocks.db.handoffs.listHandoffs).mockReturnValue([makeHandoff()]);
		vi.mocked(mocks.db.handoffs.countHandoffs).mockReturnValue(1);

		const result = CoordinationService.listHandoffs({
			repo: "app",
			status: "pending",
			to_agent: "tester",
			from_agent: "backend",
			limit: 10,
			offset: 0
		});

		expect(result.handoffs).toHaveLength(1);
		expect(result.total).toBe(1);
		expect(mocks.db.handoffs.listHandoffs).toHaveBeenCalledWith({
			owner: "",
			repo: "app",
			status: "pending",
			to_agent: "tester",
			from_agent: "backend",
			limit: 10,
			offset: 0
		});
		expect(mocks.db.handoffs.countHandoffs).toHaveBeenCalledWith({
			owner: "",
			repo: "app",
			status: "pending",
			to_agent: "tester",
			from_agent: "backend"
		});
	});
});

describe("CoordinationService.updateHandoffStatus", () => {
	it("updates inside the write lock and returns the refreshed handoff", async () => {
		vi.mocked(mocks.db.handoffs.getHandoffById)
			.mockReturnValueOnce(makeHandoff()) // pre-check
			.mockReturnValueOnce({ ...makeHandoff(), status: "accepted" }); // refresh
		vi.mocked(mocks.db.handoffs.updateHandoffStatus).mockReturnValue(true);

		const result = await CoordinationService.updateHandoffStatus("handoff-1", "accepted");

		expect(result?.status).toBe("accepted");
		expect(mocks.db.handoffs.updateHandoffStatus).toHaveBeenCalledWith("handoff-1", "accepted");
	});

	it("returns null when the handoff does not exist (no write attempted)", async () => {
		vi.mocked(mocks.db.handoffs.getHandoffById).mockReturnValue(null);

		const result = await CoordinationService.updateHandoffStatus("ghost", "accepted");

		expect(result).toBeNull();
		expect(mocks.db.handoffs.updateHandoffStatus).not.toHaveBeenCalled();
	});

	it("returns null when the guarded update reports failure", async () => {
		vi.mocked(mocks.db.handoffs.getHandoffById).mockReturnValue(makeHandoff());
		vi.mocked(mocks.db.handoffs.updateHandoffStatus).mockReturnValue(false);

		const result = await CoordinationService.updateHandoffStatus("handoff-1", "expired");

		expect(result).toBeNull();
	});
});

describe("CoordinationService.createHandoff", () => {
	it("starts the MCP client when disconnected and delegates with structured: true", async () => {
		vi.mocked(mocks.mcpClient.isConnected).mockReturnValue(false);
		vi.mocked(mocks.mcpClient.callTool).mockResolvedValue({ structuredContent: { id: "h-9" } });

		const result = await CoordinationService.createHandoff({ summary: "hello" });

		expect(mocks.mcpClient.start).toHaveBeenCalledTimes(1);
		expect(mocks.mcpClient.callTool).toHaveBeenCalledWith("handoff-write", { summary: "hello", structured: true });
		expect(result).toEqual({ id: "h-9" });
	});

	it("falls back to the raw result when the tool returns no structuredContent", async () => {
		vi.mocked(mocks.mcpClient.isConnected).mockReturnValue(true);
		vi.mocked(mocks.mcpClient.callTool).mockResolvedValue({ content: [] });

		const result = await CoordinationService.createHandoff({ summary: "hello" });

		expect(mocks.mcpClient.start).not.toHaveBeenCalled();
		expect(result).toEqual({ content: [] });
	});
});

describe("CoordinationService.releaseClaim", () => {
	it("releases by task_id and returns the success payload with null agent", async () => {
		vi.mocked(mocks.db.handoffs.releaseClaim).mockReturnValue(true);

		const result = await CoordinationService.releaseClaim({ task_id: "task-1" });

		expect(result).toEqual({ success: true, task_id: "task-1", agent: null });
		expect(mocks.db.handoffs.releaseClaim).toHaveBeenCalledWith("task-1", undefined);
	});

	it("resolves task_code → task_id before releasing", async () => {
		vi.mocked(mocks.db.tasks.getTaskByCode).mockReturnValue({ id: "task-42" });
		vi.mocked(mocks.db.handoffs.releaseClaim).mockReturnValue(true);

		const result = await CoordinationService.releaseClaim({ task_code: "T-42", repo: "app", agent: "tester" });

		expect(mocks.db.tasks.getTaskByCode).toHaveBeenCalledWith("", "app", "T-42");
		expect(mocks.db.handoffs.releaseClaim).toHaveBeenCalledWith("task-42", "tester");
		expect(result).toEqual({ success: true, task_id: "task-42", agent: "tester" });
	});

	it("throws when task_code does not resolve to a task", async () => {
		vi.mocked(mocks.db.tasks.getTaskByCode).mockReturnValue(null);

		await expect(CoordinationService.releaseClaim({ task_code: "NOPE", repo: "app" })).rejects.toThrow(
			'Task not found: NOPE (owner="", repo="app")'
		);
		expect(mocks.db.handoffs.releaseClaim).not.toHaveBeenCalled();
	});

	it("throws when neither task_id nor task_code is provided", async () => {
		await expect(CoordinationService.releaseClaim({ repo: "app" })).rejects.toThrow("task_id or task_code is required");
	});

	it("throws when the claim release reports no active claim", async () => {
		vi.mocked(mocks.db.handoffs.releaseClaim).mockReturnValue(false);

		await expect(CoordinationService.releaseClaim({ task_id: "task-1" })).rejects.toThrow(
			"No active claim found for task task-1"
		);
	});
});
