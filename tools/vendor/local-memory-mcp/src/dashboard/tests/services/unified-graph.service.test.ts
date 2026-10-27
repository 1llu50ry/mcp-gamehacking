/**
 * Unit tests for the unified-graph service layer (owner/repo resolution,
 * per-domain node/edge assembly, co_defined + entity edges, stats).
 *
 * The HTTP layer pins the 400-missing-owner and a 200 happy path; these
 * tests pin the SERVICE-owned assembly rules not visible through routes:
 * owner inference from owner/repo input, memory node size math + description
 * truncation, same-file co_defined edge chaining, repo-vs-global codebase
 * symbol fan-out, entity node/edge payload shapes, and the stats counts.
 * Pure unit — db stubbed via the mocked context.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryEntry } from "../../../mcp/types/memory";
import type { Task } from "../../../mcp/types/task";
import type { KgEntityRow, KgRelationRow } from "../../../mcp/entities/knowledge-graph";

const mocks = vi.hoisted(() => {
	const db = {
		memories: { listMemoriesForDashboard: vi.fn() },
		codebaseSymbols: { getSymbolsByRepo: vi.fn(), getAllSymbols: vi.fn() },
		tasks: { getTasksByRepo: vi.fn(), listRecentTasks: vi.fn() },
		knowledgeGraph: { listEntitiesForGraph: vi.fn(), listRelationsForGraph: vi.fn() }
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

import { UnifiedGraphService, type UnifiedGraphParams } from "../../services/unified-graph.service";

function makeMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: "mem-1",
		type: "code_fact",
		title: "Auth uses JWT",
		content: "JWT tokens with 1h expiry.",
		importance: 3,
		agent: "backend",
		role: "user",
		model: "claude",
		scope: { owner: "acme", repo: "app" },
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: null,
		supersedes: null,
		status: "active",
		tags: [],
		metadata: {},
		is_global: false,
		...overrides
	};
}

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		owner: "acme",
		repo: "app",
		task_code: "T-1",
		phase: "Implementation",
		title: "Do the thing",
		description: null,
		status: "pending",
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

function makeEntity(overrides: Partial<KgEntityRow> = {}): KgEntityRow {
	return {
		name: "User",
		type: "class",
		description: "The user entity",
		repo: "acme/app",
		owner: "acme",
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

function makeRelation(overrides: Partial<KgRelationRow> = {}): KgRelationRow {
	return {
		from_entity: "User",
		to_entity: "Order",
		relation_type: "creates",
		repo: "acme/app",
		owner: "acme",
		created_at: "2026-01-01T00:00:00.000Z",
		confidence: 0.9,
		...overrides
	};
}

function params(overrides: Partial<UnifiedGraphParams> = {}): UnifiedGraphParams {
	return { repo: "acme/app", owner: "acme", domains: [], limit: 50, minImportance: 0, ...overrides };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(mocks.db.memories.listMemoriesForDashboard).mockReturnValue({ items: [], total: 0 });
	vi.mocked(mocks.db.codebaseSymbols.getSymbolsByRepo).mockReturnValue([]);
	vi.mocked(mocks.db.codebaseSymbols.getAllSymbols).mockReturnValue([]);
	vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValue([]);
	vi.mocked(mocks.db.tasks.listRecentTasks).mockReturnValue([]);
	vi.mocked(mocks.db.knowledgeGraph.listEntitiesForGraph).mockReturnValue([]);
	vi.mocked(mocks.db.knowledgeGraph.listRelationsForGraph).mockReturnValue([]);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("UnifiedGraphService.getGraph — owner/repo resolution", () => {
	it("throws 400 when no owner can be resolved", () => {
		expect(() => UnifiedGraphService.getGraph(params({ repo: "plain-repo", owner: undefined }))).toThrowError(
			expect.objectContaining({ name: "ServiceError", status: 400, message: "owner query parameter is required" })
		);
	});

	it("infers the owner from an owner/repo input and uses the short repo name", () => {
		UnifiedGraphService.getGraph(params({ owner: undefined, domains: ["task"] }));

		expect(mocks.db.tasks.getTasksByRepo).toHaveBeenCalledWith("acme", "app", undefined, 50);
	});

	it("uses the explicit owner over the repo-derived one", () => {
		UnifiedGraphService.getGraph(params({ owner: "other", domains: ["task"] }));

		expect(mocks.db.tasks.getTasksByRepo).toHaveBeenCalledWith("other", "app", undefined, 50);
	});
});

describe("UnifiedGraphService.getGraph — memory domain", () => {
	it("assembles memory nodes with size math and 200-char description truncation", () => {
		vi.mocked(mocks.db.memories.listMemoriesForDashboard).mockReturnValue({
			items: [
				makeMemory({ id: "m1", title: "Long title", content: "x".repeat(300), importance: 4 }),
				makeMemory({ id: "m2", title: "Low", content: "short", importance: 0 })
			],
			total: 2
		});

		const result = UnifiedGraphService.getGraph(params({ domains: ["memory"], minImportance: 2 }));

		expect(mocks.db.memories.listMemoriesForDashboard).toHaveBeenCalledWith({
			owner: "acme",
			repo: "app",
			minImportance: 2,
			limit: 50,
			sortBy: "importance"
		});
		const [n1, n2] = result.nodes;
		expect(n1).toMatchObject({
			id: "mem-m1",
			name: "Long title",
			domain: "memory",
			type: "code_fact",
			size: 24,
			importance: 4
		});
		expect((n1.description as string).length).toBe(200); // truncated
		expect(n2).toMatchObject({ size: 6, importance: 0 }); // (0 || 1) * 6
		expect(result.stats.domains.memory).toBe(2);
	});
});

describe("UnifiedGraphService.getGraph — codebase domain", () => {
	const symbol = (id: string, name: string, filePath: string) => ({
		id,
		name,
		kind: "function",
		file_path: filePath
	});

	it("builds sym nodes and chains consecutive same-file symbols into co_defined edges", () => {
		vi.mocked(mocks.db.codebaseSymbols.getSymbolsByRepo).mockReturnValue([
			symbol("s1", "alpha", "src/a.ts"),
			symbol("s2", "beta", "src/a.ts"),
			symbol("s3", "gamma", "src/a.ts"),
			symbol("s4", "delta", "src/b.ts")
		]);

		const result = UnifiedGraphService.getGraph(params({ domains: ["codebase"] }));

		expect(mocks.db.codebaseSymbols.getSymbolsByRepo).toHaveBeenCalledWith("app", 50);
		expect(result.nodes).toHaveLength(4);
		// a.ts has 3 symbols → 2 consecutive edges; b.ts has 1 → none.
		expect(result.edges).toEqual([
			{ source: "sym-s1", target: "sym-s2", relation: "co_defined", weight: 0.5 },
			{ source: "sym-s2", target: "sym-s3", relation: "co_defined", weight: 0.5 }
		]);
		expect(result.stats.domains.codebase).toBe(4);
	});

	it("fans out globally (getAllSymbols) when no repo is given", () => {
		vi.mocked(mocks.db.codebaseSymbols.getAllSymbols).mockReturnValue([symbol("s1", "alpha", "src/a.ts")]);

		const result = UnifiedGraphService.getGraph(params({ repo: undefined, domains: ["codebase"] }));

		expect(mocks.db.codebaseSymbols.getAllSymbols).toHaveBeenCalledWith(50);
		expect(mocks.db.codebaseSymbols.getSymbolsByRepo).not.toHaveBeenCalled();
		expect(result.nodes).toHaveLength(1);
	});
});

describe("UnifiedGraphService.getGraph — task domain", () => {
	it("builds task nodes from the repo-scoped query", () => {
		vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValue([makeTask({ id: "t1", status: "in_progress" })]);

		const result = UnifiedGraphService.getGraph(params({ domains: ["task"] }));

		expect(result.nodes[0]).toMatchObject({
			id: "task-t1",
			name: "Do the thing",
			domain: "task",
			type: "feature",
			status: "in_progress",
			size: 18
		});
		expect(result.stats.domains.task).toBe(1);
	});

	it("uses the global recent-task list when no repo is given", () => {
		vi.mocked(mocks.db.tasks.listRecentTasks).mockReturnValue([makeTask({ id: "t1" })]);

		const result = UnifiedGraphService.getGraph(params({ repo: undefined, domains: ["task"] }));

		expect(mocks.db.tasks.listRecentTasks).toHaveBeenCalledWith(50);
		expect(result.nodes).toHaveLength(1);
	});
});

describe("UnifiedGraphService.getGraph — entity domain", () => {
	it("builds ent nodes and ships edges for the fetched relations (subset-scoped query)", () => {
		vi.mocked(mocks.db.knowledgeGraph.listEntitiesForGraph).mockReturnValue([
			makeEntity({ name: "User" }),
			makeEntity({ name: "Order" })
		]);
		vi.mocked(mocks.db.knowledgeGraph.listRelationsForGraph).mockReturnValue([
			makeRelation({ from_entity: "User", to_entity: "Order" })
		]);

		const result = UnifiedGraphService.getGraph(params({ domains: ["entity"] }));

		expect(mocks.db.knowledgeGraph.listEntitiesForGraph).toHaveBeenCalledWith("app", 50);
		// The node-subset filter (TASK-070) is applied inside the query: the
		// service passes the entity names it just built.
		expect(mocks.db.knowledgeGraph.listRelationsForGraph).toHaveBeenCalledWith("app", ["User", "Order"]);
		expect(result.nodes).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "ent-User", domain: "entity", type: "class", size: 14 })])
		);
		expect(result.edges).toEqual([{ source: "ent-User", target: "ent-Order", relation: "creates", weight: 1.0 }]);
		expect(result.stats.domains.entity).toBe(2);
	});
});

describe("UnifiedGraphService.getGraph — stats & empty graph", () => {
	it("reports zero nodes/edges when no domains are requested", () => {
		const result = UnifiedGraphService.getGraph(params({ domains: [] }));

		expect(result.id).toBe("unified-graph-acme/app");
		expect(result.nodes).toEqual([]);
		expect(result.edges).toEqual([]);
		expect(result.stats).toEqual({
			totalNodes: 0,
			totalEdges: 0,
			domains: { memory: 0, codebase: 0, task: 0, entity: 0 }
		});
		// No domain query runs when its flag is absent.
		expect(mocks.db.memories.listMemoriesForDashboard).not.toHaveBeenCalled();
		expect(mocks.db.codebaseSymbols.getSymbolsByRepo).not.toHaveBeenCalled();
		expect(mocks.db.tasks.getTasksByRepo).not.toHaveBeenCalled();
		expect(mocks.db.knowledgeGraph.listEntitiesForGraph).not.toHaveBeenCalled();
	});

	it("totals the stats across all requested domains", () => {
		vi.mocked(mocks.db.memories.listMemoriesForDashboard).mockReturnValue({ items: [makeMemory()], total: 1 });
		vi.mocked(mocks.db.tasks.getTasksByRepo).mockReturnValue([makeTask()]);
		vi.mocked(mocks.db.knowledgeGraph.listEntitiesForGraph).mockReturnValue([makeEntity()]);
		vi.mocked(mocks.db.codebaseSymbols.getSymbolsByRepo).mockReturnValue([
			{ id: "s1", name: "a", kind: "function", file_path: "f.ts" }
		]);

		const result = UnifiedGraphService.getGraph(params({ domains: ["memory", "codebase", "task", "entity"] }));

		expect(result.stats.totalNodes).toBe(4);
		expect(result.stats.domains).toEqual({ memory: 1, codebase: 1, task: 1, entity: 1 });
	});
});
