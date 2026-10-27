/**
 * Unit tests for the memory service layer (list normalization, CRUD
 * orchestration, the shared purge+cleanup contract, bulk actions).
 *
 * The HTTP layer pins soft-archive visibility + write-lock scope; these
 * tests pin the SERVICE-owned rules not visible through routes: sort-order
 * normalization (only exact "ASC" means ascending), importance parsing,
 * default scope/owner wiring on create, and the 400 invalid-action guard for
 * bulk actions. Pure unit — db stubbed, purgeEntityAndCleanup mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryEntry } from "../../../mcp/types/memory";

const mocks = vi.hoisted(() => {
	const db = {
		memories: {
			listMemoriesForDashboard: vi.fn(),
			getByIdWithStats: vi.fn(),
			insert: vi.fn(),
			update: vi.fn(),
			bulkInsertMemories: vi.fn(),
			getByIds: vi.fn(),
			getById: vi.fn(),
			bulkUpdateMemories: vi.fn()
		},
		actions: { logAction: vi.fn() },
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

import { MemoryService } from "../../services/memory.service";

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

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(mocks.db.memories.listMemoriesForDashboard).mockReturnValue({ items: [], total: 0 });
	vi.mocked(mocks.db.memories.bulkInsertMemories).mockReturnValue(0);
	vi.mocked(mocks.db.memories.getByIds).mockReturnValue([]);
	vi.mocked(mocks.db.memories.bulkUpdateMemories).mockReturnValue(0);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("MemoryService.list", () => {
	it("passes filters through and parses importance bounds", () => {
		vi.mocked(mocks.db.memories.listMemoriesForDashboard).mockReturnValue({ items: [makeMemory()], total: 1 });

		const result = MemoryService.list({
			repo: "app",
			type: "code_fact",
			search: "jwt",
			minImportance: "2",
			maxImportance: "4",
			sortBy: "importance",
			includeArchived: true,
			limit: 20,
			offset: 0
		});

		expect(result.items).toHaveLength(1);
		expect(result.total).toBe(1);
		expect(mocks.db.memories.listMemoriesForDashboard).toHaveBeenCalledWith({
			repo: "app",
			type: "code_fact",
			search: "jwt",
			minImportance: 2,
			maxImportance: 4,
			sortBy: "importance",
			sortOrder: "DESC",
			includeArchived: true,
			limit: 20,
			offset: 0
		});
	});

	it("normalizes sort order case-insensitively — only asc-ish values sort ascending", () => {
		MemoryService.list({ repo: "app", sortOrder: "ASC", limit: 10, offset: 0 });
		MemoryService.list({ repo: "app", sortOrder: "desc", limit: 10, offset: 0 });
		MemoryService.list({ repo: "app", sortOrder: "bogus", limit: 10, offset: 0 });

		const orders = mocks.db.memories.listMemoriesForDashboard.mock.calls.map((call) => call[0].sortOrder);
		expect(orders).toEqual(["ASC", "DESC", "DESC"]);
	});

	it("omits importance bounds when the values are absent", () => {
		MemoryService.list({ repo: "app", limit: 10, offset: 0 });

		expect(mocks.db.memories.listMemoriesForDashboard.mock.calls[0][0].minImportance).toBeUndefined();
		expect(mocks.db.memories.listMemoriesForDashboard.mock.calls[0][0].maxImportance).toBeUndefined();
	});
});

describe("MemoryService.exists / getById", () => {
	it("exists() is true for a found row (archived included in the lookup)", () => {
		vi.mocked(mocks.db.memories.getByIdWithStats).mockReturnValue(makeMemory());
		expect(MemoryService.exists("mem-1")).toBe(true);
		expect(mocks.db.memories.getByIdWithStats).toHaveBeenCalledWith("mem-1", true);
	});

	it("exists() is false when the row is missing", () => {
		vi.mocked(mocks.db.memories.getByIdWithStats).mockReturnValue(null);
		expect(MemoryService.exists("ghost")).toBe(false);
	});

	it("getById hides archived rows by default and honors includeArchived", () => {
		vi.mocked(mocks.db.memories.getByIdWithStats).mockReturnValue(makeMemory());

		MemoryService.getById("mem-1");
		MemoryService.getById("mem-1", true);

		expect(mocks.db.memories.getByIdWithStats.mock.calls.map((call) => call[1])).toEqual([false, true]);
	});
});

describe("MemoryService.create", () => {
	it("generates an id, wires scope defaults, timestamps, and writes the action log", async () => {
		const id = await MemoryService.create({ repo: "app", type: "code_fact", content: "c" });

		expect(id).toEqual(expect.any(String));
		const insertArg = mocks.db.memories.insert.mock.calls[0][0] as MemoryEntry;
		expect(insertArg.id).toBe(id);
		expect(insertArg.scope).toEqual({ repo: "app", owner: "" });
		expect(insertArg.created_at).toEqual(expect.any(String));
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("write", "", "app", { memoryId: id });
		expect(mocks.db.withWrite).toHaveBeenCalledTimes(1);
	});

	it("uses the provided owner in the scope when present", async () => {
		await MemoryService.create({ repo: "app", owner: "acme", type: "code_fact", content: "c" });

		const insertArg = mocks.db.memories.insert.mock.calls[0][0] as MemoryEntry;
		expect(insertArg.scope).toEqual({ repo: "app", owner: "acme" });
	});
});

describe("MemoryService.update", () => {
	it("throws 404 when the memory does not exist", async () => {
		vi.mocked(mocks.db.memories.getByIdWithStats).mockReturnValue(null);

		await expect(MemoryService.update("ghost", { title: "x" })).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Memory not found"
		});
		expect(mocks.db.memories.update).not.toHaveBeenCalled();
	});

	it("applies the updates with a fresh updated_at and logs against the existing scope", async () => {
		vi.mocked(mocks.db.memories.getByIdWithStats).mockReturnValue(makeMemory({ title: "old" }));

		await MemoryService.update("mem-1", { title: "new", content: "updated" });

		expect(mocks.db.memories.update).toHaveBeenCalledWith(
			"mem-1",
			expect.objectContaining({ title: "new", content: "updated", updated_at: expect.any(String) })
		);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("update", "acme", "app", { memoryId: "mem-1" });
	});
});

describe("MemoryService.delete", () => {
	it("routes the single delete through the shared purge + cleanup contract", async () => {
		vi.mocked(mocks.db.memories.getByIdWithStats).mockReturnValue(makeMemory());

		await MemoryService.delete("mem-1");

		expect(mocks.purge).toHaveBeenCalledWith(mocks.db, "memory", [
			{ id: "mem-1", title: "Auth uses JWT", repo: "app" }
		]);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("delete", "acme", "app", { memoryId: "mem-1" });
	});

	it("throws 404 when the memory does not exist (no purge attempted)", async () => {
		vi.mocked(mocks.db.memories.getByIdWithStats).mockReturnValue(null);

		await expect(MemoryService.delete("ghost")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Memory not found"
		});
		expect(mocks.purge).not.toHaveBeenCalled();
	});
});

describe("MemoryService.bulkCreate", () => {
	it("defaults ids and timestamps, merges the repo scope, and returns the inserted count", async () => {
		vi.mocked(mocks.db.memories.bulkInsertMemories).mockReturnValue(2);

		const count = await MemoryService.bulkCreate(
			[
				{ type: "code_fact", content: "a", scope: { owner: "acme" } },
				{ id: "fixed-id", type: "decision", content: "b" }
			],
			"app"
		);

		expect(count).toBe(2);
		const entries = mocks.db.memories.bulkInsertMemories.mock.calls[0][0] as MemoryEntry[];
		expect(entries[0].id).toEqual(expect.any(String)); // generated
		expect(entries[0].scope).toEqual({ owner: "acme", repo: "app" });
		expect(entries[0].created_at).toEqual(expect.any(String));
		expect(entries[1].id).toBe("fixed-id"); // preserved
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("write", "", "app", {
			query: "Bulk imported 2 memories"
		});
	});
});

describe("MemoryService.bulkAction", () => {
	it("routes bulk delete through the purge contract with per-item repo/title metadata", async () => {
		vi.mocked(mocks.db.memories.getByIds).mockReturnValue([
			makeMemory({ id: "mem-1", scope: { owner: "acme", repo: "app" } }),
			makeMemory({ id: "mem-2", scope: { owner: "acme", repo: "lib" } })
		]);

		const n = await MemoryService.bulkAction("delete", ["mem-1", "mem-2"]);

		expect(n).toBe(2);
		expect(mocks.purge).toHaveBeenCalledWith(mocks.db, "memory", [
			{ id: "mem-1", title: "Auth uses JWT", repo: "app" },
			{ id: "mem-2", title: "Auth uses JWT", repo: "lib" }
		]);
		expect(mocks.db.withExclusiveWrite).toHaveBeenCalledTimes(1);
	});

	it("purges phantom ids without metadata when they are not found", async () => {
		vi.mocked(mocks.db.memories.getByIds).mockReturnValue([]);

		await MemoryService.bulkAction("delete", ["ghost-1", "ghost-2"]);

		expect(mocks.purge).toHaveBeenCalledWith(mocks.db, "memory", [{ id: "ghost-1" }, { id: "ghost-2" }]);
	});

	it("archive action bulk-updates with the archived status when no updates are given (no purge)", async () => {
		vi.mocked(mocks.db.memories.getById).mockReturnValue(makeMemory());
		vi.mocked(mocks.db.memories.bulkUpdateMemories).mockReturnValue(3);

		const n = await MemoryService.bulkAction("archive", ["mem-1"]);

		expect(n).toBe(3);
		expect(mocks.db.memories.bulkUpdateMemories).toHaveBeenCalledWith(["mem-1"], { status: "archived" });
		expect(mocks.purge).not.toHaveBeenCalled();
	});

	it("rejects an unknown action with 400", async () => {
		await expect(MemoryService.bulkAction("explode", ["mem-1"])).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "Invalid action"
		});
		expect(mocks.db.withExclusiveWrite).toHaveBeenCalledTimes(1);
	});
});
