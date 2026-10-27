/**
 * Unit tests for the system service layer (health, repos, stats TTL wiring,
 * metrics, recent actions, capabilities, streaming export, MCP delegation).
 *
 * Business rules asserted here that are NOT pinned through the HTTP layer:
 * repo-scoped stats cache reuse wiring, null→undefined action mapping +
 * pagination slice, deprecated-tool filtering, export streaming structure.
 * Pure unit — db/mcpClient/embeddingWorker are stubbed; TOOL_DEFINITIONS,
 * resources and the PROMPTS registry are mocked for full control.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";

const mocks = vi.hoisted(() => {
	const db = {
		system: {
			getGlobalStats: vi.fn(),
			listRepoNavigation: vi.fn(),
			getDashboardStats: vi.fn(),
			getGlobalDashboardStats: vi.fn()
		},
		getDbPath: vi.fn(),
		actions: { getRecentActions: vi.fn() },
		memories: { getAllMemoriesWithStats: vi.fn() },
		tasks: { getTasksByRepo: vi.fn() },
		taskComments: { getAllTaskCommentsByRepo: vi.fn() },
		reuseTelemetry: { summarize: vi.fn() }
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
		startTime: Date.now() - 10_000
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

vi.mock("../../../mcp/types/tool-definitions", () => ({
	TOOL_DEFINITIONS: [
		{ name: "memory-write", title: "Write a memory", description: "Stores a durable memory" },
		{ name: "memory-read", title: "Read a memory", description: "Reads memories" },
		{ name: "legacy-tool", title: "legacy-tool (Deprecated)", description: "Old tool" },
		{ name: "dead-tool", title: "Dead tool", description: "DEPRECATED — use memory-write instead" }
	]
}));

vi.mock("../../../mcp/resources", () => ({
	listResources: vi.fn(() => ({
		resources: [
			{
				uri: "repository://index",
				name: "Repository Index",
				title: "Repository Index",
				description: "All known repos",
				mimeType: "application/json",
				annotations: { audience: ["assistant"], priority: 1, lastModified: "2026-01-01T00:00:00.000Z" }
			}
		]
	}))
}));

vi.mock("../../../mcp/runtime-capabilities", () => ({
	getRuntimeCapabilities: () => ({
		snapshot: () => ({
			profile: "full",
			capabilities: { semantic: { state: "ready" } },
			footprint: { rss_bytes: 1024, heap_used_bytes: 512 }
		})
	})
}));

vi.mock("../../../mcp/prompts/registry", () => ({
	PROMPTS: {
		greeter: { name: "greeter", description: "Greets the user" },
		fallback: { name: "fallback", description: "Fallback prompt" }
	}
}));

import { SystemService } from "../../services/system.service";
import { clearRepoStatsCache } from "../../services/statsCache";

beforeEach(() => {
	vi.clearAllMocks();
	clearRepoStatsCache();
	vi.mocked(mocks.db.system.getGlobalStats).mockReturnValue({ totalMemories: 3, totalRepos: 2 });
	vi.mocked(mocks.db.getDbPath).mockReturnValue("/tmp/storage/test.db");
	vi.mocked(mocks.db.system.getDashboardStats).mockReturnValue({ totalMemories: 1 });
	vi.mocked(mocks.db.system.getGlobalDashboardStats).mockReturnValue({ totalMemories: 7 });
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("SystemService.getHealth", () => {
	it("assembles the health payload from db + mcp client state", () => {
		vi.mocked(mocks.mcpClient.isConnected).mockReturnValue(true);
		vi.mocked(mocks.mcpClient.getPendingCount).mockReturnValue(4);

		const health = SystemService.getHealth();

		expect(health).toEqual({
			connected: true,
			uptime: expect.any(Number),
			version: expect.any(String),
			memoryCount: 3,
			repoCount: 2,
			pendingRequests: 4,
			dbPath: "/tmp/storage/test.db",
			// PERF-009: the running build identity is surfaced on health.
			build: expect.any(String)
		});
		expect(mocks.db.system.getGlobalStats).toHaveBeenCalledTimes(1);
	});

	it("surfaces the disconnected client as connected=false", () => {
		vi.mocked(mocks.mcpClient.isConnected).mockReturnValue(false);
		expect(SystemService.getHealth().connected).toBe(false);
	});
});

describe("SystemService.getRepos", () => {
	it("maps navigation rows to { id, name, ...row }", () => {
		vi.mocked(mocks.db.system.listRepoNavigation).mockReturnValue([
			{ repo: "acme/app", memoryCount: 2 },
			{ repo: "acme/lib", memoryCount: 0 }
		]);

		const repos = SystemService.getRepos();

		expect(repos).toEqual([
			{ id: "acme/app", name: "acme/app", repo: "acme/app", memoryCount: 2 },
			{ id: "acme/lib", name: "acme/lib", repo: "acme/lib", memoryCount: 0 }
		]);
	});

	it("returns an empty array when no repos are navigable", () => {
		vi.mocked(mocks.db.system.listRepoNavigation).mockReturnValue([]);
		expect(SystemService.getRepos()).toEqual([]);
	});
});

describe("SystemService.getStats", () => {
	it("computes repo-scoped stats on a cold cache and caches the result", () => {
		const stats = SystemService.getStats("app", "acme");

		expect(stats).toEqual({ totalMemories: 1 });
		expect(mocks.db.system.getDashboardStats).toHaveBeenCalledWith("acme", "app");
	});

	it("serves repo-scoped stats from the TTL cache without re-aggregating", () => {
		SystemService.getStats("app", "acme");
		vi.mocked(mocks.db.system.getDashboardStats).mockReturnValue({ totalMemories: 999 });

		const second = SystemService.getStats("app", "acme");

		expect(second).toEqual({ totalMemories: 1 });
		expect(mocks.db.system.getDashboardStats).toHaveBeenCalledTimes(1);
	});

	it("recomputes repo stats after the TTL elapses (DASHBOARD_STATS_TTL_MS=0)", () => {
		vi.stubEnv("DASHBOARD_STATS_TTL_MS", "0");
		SystemService.getStats("app", "acme");
		vi.mocked(mocks.db.system.getDashboardStats).mockReturnValue({ totalMemories: 999 });
		const second = SystemService.getStats("app", "acme");

		expect(second).toEqual({ totalMemories: 999 });
		expect(mocks.db.system.getDashboardStats).toHaveBeenCalledTimes(2);
	});

	it("uses the global dashboard stats when no repo is provided (no cache read)", () => {
		const stats = SystemService.getStats(undefined, undefined);

		expect(stats).toEqual({ totalMemories: 7 });
		expect(mocks.db.system.getGlobalDashboardStats).toHaveBeenCalledTimes(1);
		expect(mocks.db.system.getDashboardStats).not.toHaveBeenCalled();
	});
});

describe("SystemService.getMetrics", () => {
	it("includes a repo/time-window reuse summary when scoped", () => {
		vi.mocked(mocks.embeddingWorker.getStats).mockReturnValue({ pending: 0, running: true });
		vi.mocked(mocks.db.reuseTelemetry.summarize).mockReturnValue({ from: "from", to: "to", metrics: {} });
		const result = SystemService.getMetrics("owner", "repo", 48);
		expect(mocks.db.reuseTelemetry.summarize).toHaveBeenCalledWith("owner", "repo", 48);
		expect(result.reuse).toEqual({ from: "from", to: "to", metrics: {} });
	});

	it("merges the runtime snapshot with the embedding worker stats", () => {
		vi.mocked(mocks.embeddingWorker.getStats).mockReturnValue({ pending: 5, running: true });

		const metrics = SystemService.getMetrics();

		expect(metrics.process).toBe("dashboard");
		expect(metrics.uptimeSeconds).toEqual(expect.any(Number));
		expect(metrics.pid).toBe(process.pid);
		expect(metrics.tools).toBeDefined();
		expect(metrics.toolOutcomes).toBeDefined();
		expect(metrics.writeHandler).toBeDefined();
		expect(metrics.embedLatency).toBeDefined();
		expect(metrics.worker).toEqual({ pending: 5, running: true });
		expect(metrics.reuse).toBeNull();
	});
});

describe("SystemService.getRecentActions", () => {
	const row = {
		id: 1,
		action: "read",
		query: null,
		response: null,
		memory_id: null,
		memory_title: null,
		memory_type: "code_fact",
		task_id: null,
		task_title: null,
		task_code: null,
		result_count: 2,
		created_at: "2026-01-01T00:00:00.000Z"
	};

	it("maps nulls to undefined, condenses, and slices by pageSize/offset", () => {
		// Distinct actions so nothing condenses into a burst — the slice +
		// null→undefined mapping is the rule under test.
		vi.mocked(mocks.db.actions.getRecentActions).mockReturnValue([
			{ ...row, id: 1, action: "read:one" },
			{ ...row, id: 2, action: "read:two" },
			{ ...row, id: 3, action: "read:three" }
		]);

		const result = SystemService.getRecentActions("app", 2, 0);

		expect(result.totalItems).toBe(3);
		expect(result.items).toHaveLength(2);
		expect(result.items[0]).toMatchObject({
			id: 1,
			action: "read:one",
			query: undefined,
			response: undefined,
			memory_id: undefined,
			created_at: "2026-01-01T00:00:00.000Z",
			burstCount: 1
		});
		expect(mocks.db.actions.getRecentActions).toHaveBeenCalledWith("", "app", 100);
	});

	it("returns an empty page when offset is beyond the condensed list", () => {
		vi.mocked(mocks.db.actions.getRecentActions).mockReturnValue([row]);

		const result = SystemService.getRecentActions("app", 10, 5);

		expect(result.items).toEqual([]);
		expect(result.totalItems).toBe(1);
	});
});

describe("SystemService.getCapabilities", () => {
	it("maps tools/resources/prompts to the capability DTO and drops deprecated entries", () => {
		const caps = SystemService.getCapabilities();

		// "legacy-tool" (title "(Deprecated)") and "dead-tool" (description
		// "DEPRECATED …") are filtered — only the two live tools remain.
		expect(caps.tools.map((t) => t.id)).toEqual(["memory-write", "memory-read"]);
		expect(caps.tools[0]).toMatchObject({ type: "tool", id: "memory-write" });

		expect(caps.resources).toHaveLength(1);
		expect(caps.resources[0]).toMatchObject({ type: "resource", id: "repository://index" });

		expect(caps.prompts.map((p) => p.id)).toEqual(["greeter", "fallback"]);
		expect(caps.prompts[0]).toMatchObject({ type: "prompt", id: "greeter" });
		expect(caps.runtime).toMatchObject({
			profile: "full",
			capabilities: { semantic: { state: "ready" } },
			footprint: { rss_bytes: 1024, heap_used_bytes: 512 }
		});
	});
});

describe("SystemService.callTool", () => {
	it("starts the MCP client when disconnected, then delegates", async () => {
		vi.mocked(mocks.mcpClient.isConnected).mockReturnValue(false);
		vi.mocked(mocks.mcpClient.callTool).mockResolvedValue({ ok: true });

		const result = await SystemService.callTool("memory-read", { query: "q" });

		expect(mocks.mcpClient.start).toHaveBeenCalledTimes(1);
		expect(mocks.mcpClient.callTool).toHaveBeenCalledWith("memory-read", { query: "q" });
		expect(result).toEqual({ ok: true });
	});

	it("skips start when the client is already connected", async () => {
		vi.mocked(mocks.mcpClient.isConnected).mockReturnValue(true);
		vi.mocked(mocks.mcpClient.callTool).mockResolvedValue({ ok: true });

		await SystemService.callTool("memory-read", {});

		expect(mocks.mcpClient.start).not.toHaveBeenCalled();
		expect(mocks.mcpClient.callTool).toHaveBeenCalledTimes(1);
	});
});

describe("SystemService.streamExport", () => {
	function makeResponse() {
		const chunks: string[] = [];
		const res = {
			setHeader: vi.fn(),
			write: vi.fn((chunk: string) => {
				chunks.push(chunk);
				return true;
			}),
			end: vi.fn()
		} as unknown as Response;
		return { res, chunks };
	}

	it("streams memories → tasks → comments in a single JSON document (500-row pages)", async () => {
		vi.mocked(mocks.db.memories.getAllMemoriesWithStats).mockReturnValueOnce([
			{ id: "m1", title: "Memory one" }
		] as never);
		vi.mocked(mocks.db.memories.getAllMemoriesWithStats).mockReturnValueOnce([]);
		vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValueOnce([{ id: "t1", title: "Task one" }] as never);
		vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValueOnce([]);
		vi.mocked(mocks.db.taskComments.getAllTaskCommentsByRepo).mockReturnValueOnce([
			{ id: "c1", comment: "a note" }
		] as never);
		vi.mocked(mocks.db.taskComments.getAllTaskCommentsByRepo).mockReturnValueOnce([]);

		const { res, chunks } = makeResponse();
		await SystemService.streamExport("app", "acme", res);

		const body = chunks.join("");
		expect(body).toContain('"type": "export"');
		expect(body).toContain('"id": "export-app"');
		expect(body).toContain('"repo": "app"');
		expect(body).toContain('"id":"m1"');
		expect(body).toContain('"id":"t1"');
		expect(body).toContain('"id":"c1"');
		expect(body).toContain('"memories"');
		expect(body).toContain('"tasks"');
		expect(body).toContain('"comments"');
		expect(body.endsWith("\n    }\n  }\n}\n")).toBe(true);
		expect(res.end).toHaveBeenCalledTimes(1);
		// Requests are paginated: first page 500 rows, then empty → loop stops.
		expect(mocks.db.memories.getAllMemoriesWithStats).toHaveBeenCalledWith("acme", "app", 500, 0);
		expect(mocks.db.memories.getAllMemoriesWithStats).toHaveBeenCalledWith("acme", "app", 500, 500);
		expect(mocks.db.tasks.getTasksByRepo).toHaveBeenCalledWith("acme", "app", undefined, 500, 0);
		expect(mocks.db.taskComments.getAllTaskCommentsByRepo).toHaveBeenCalledWith("acme", "app", 500, 0);
	});

	it("writes empty arrays and ends the response when the repo has no data", async () => {
		vi.mocked(mocks.db.memories.getAllMemoriesWithStats).mockReturnValue([]);
		vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValue([]);
		vi.mocked(mocks.db.taskComments.getAllTaskCommentsByRepo).mockReturnValue([]);

		const { res, chunks } = makeResponse();
		await SystemService.streamExport("empty", "acme", res);

		const body = chunks.join("");
		expect(body).toContain('"memories"');
		expect(body).toContain('"tasks"');
		expect(body).toContain('"comments"');
		expect(body).not.toContain('"id": "m1"');
		expect(res.end).toHaveBeenCalledTimes(1);
	});
});
