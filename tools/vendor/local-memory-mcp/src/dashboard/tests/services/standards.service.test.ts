/**
 * Unit tests for the coding-standards service layer (export scope
 * resolution, import normalization + dedupe + vector-refresh decisions,
 * create defaults, purge contract, payload extraction).
 *
 * The HTTP layer pins route validation + a 200 export; these tests pin the
 * SERVICE-owned rules not visible through routes: export scope coercion,
 * id-vs-code dedupe on import, the >500-row vector-refresh short-circuit
 * (vectors_refreshed flag), vector-enqueue failure accounting, and create
 * defaults. Pure unit — db stubbed, enqueueStandard + purge mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodingStandardEntry } from "../../../mcp/types/memory";

const mocks = vi.hoisted(() => {
	const db = {
		standards: {
			search: vi.fn(),
			count: vi.fn(),
			getById: vi.fn(),
			getByCode: vi.fn(),
			incrementHitCounts: vi.fn(),
			update: vi.fn(),
			insert: vi.fn(),
			getByIds: vi.fn(),
			bulkUpdateStandards: vi.fn()
		},
		actions: { logAction: vi.fn() },
		withWrite: vi.fn((fn: () => unknown) => fn()),
		withExclusiveWrite: vi.fn((fn: () => unknown) => fn())
	};
	return {
		db,
		purge: vi.fn(() => 1),
		enqueue: vi.fn(),
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

vi.mock("../../../mcp/embedding-queue", () => ({
	enqueueStandard: mocks.enqueue
}));

vi.mock("../../../mcp/utils/purge-entity-cleanup", () => ({
	purgeEntityAndCleanup: mocks.purge
}));

import { StandardsService, standardsFromImportPayload } from "../../services/standards.service";

function makeStandard(overrides: Partial<CodingStandardEntry> = {}): CodingStandardEntry {
	return {
		id: "std-1",
		title: "Use UUID primary keys",
		content: "Every business entity MUST use a UUID primary key.",
		parent_id: null,
		context: "general",
		version: "1.0.0",
		language: null,
		stack: [],
		is_global: true,
		owner: "acme",
		repo: null,
		tags: ["database"],
		metadata: {},
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		hit_count: 0,
		last_used_at: null,
		agent: "dashboard",
		model: "web-ui",
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	// mockReset drops the throw-implementation used by the vector-failure case
	// so later cases get a clean no-op enqueue.
	vi.mocked(mocks.enqueue).mockReset();
	vi.mocked(mocks.db.standards.search).mockReturnValue([]);
	vi.mocked(mocks.db.standards.count).mockReturnValue(0);
	vi.mocked(mocks.db.standards.getById).mockReturnValue(null);
	vi.mocked(mocks.db.standards.getByCode).mockReturnValue(null);
	vi.mocked(mocks.db.standards.getByIds).mockReturnValue([]);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("StandardsService.list / exists", () => {
	it("returns items + a COUNT-based total without re-fetching rows", () => {
		vi.mocked(mocks.db.standards.search).mockReturnValueOnce([makeStandard()]);
		vi.mocked(mocks.db.standards.count).mockReturnValue(7);

		const result = StandardsService.list({
			repo: "app",
			language: "typescript",
			stack: ["react"],
			tags: ["ui"],
			limit: 10,
			offset: 0
		});

		expect(result.items).toHaveLength(1);
		expect(result.total).toBe(7);
		expect(mocks.db.standards.search).toHaveBeenCalledWith({
			query: undefined,
			language: "typescript",
			stack: "react", // first element only
			tag: "ui", // first element only
			repo: "app",
			is_global: undefined,
			limit: 10,
			offset: 0
		});
		// total comes from COUNT(*) — the old limit-100000 full materialization
		// is gone (TASK-406)
		expect(mocks.db.standards.count).toHaveBeenCalledWith({
			query: undefined,
			language: "typescript",
			stack: "react",
			tag: "ui",
			repo: "app",
			is_global: undefined
		});
		expect(mocks.db.standards.search).not.toHaveBeenCalledWith(expect.objectContaining({ limit: 100000 }));
	});

	it("exists() reflects the row presence", () => {
		vi.mocked(mocks.db.standards.getById).mockReturnValue(makeStandard());
		expect(StandardsService.exists("std-1")).toBe(true);

		vi.mocked(mocks.db.standards.getById).mockReturnValue(null);
		expect(StandardsService.exists("ghost")).toBe(false);
	});
});

describe("StandardsService.getById", () => {
	it("returns the standard and increments its hit count (read-tracking)", () => {
		vi.mocked(mocks.db.standards.getById).mockReturnValue(makeStandard());

		const result = StandardsService.getById("std-1");

		expect(result?.title).toBe("Use UUID primary keys");
		expect(mocks.db.standards.incrementHitCounts).toHaveBeenCalledWith(["std-1"]);
	});

	it("returns null for a missing standard without touching the hit counter", () => {
		vi.mocked(mocks.db.standards.getById).mockReturnValue(null);

		expect(StandardsService.getById("ghost")).toBeNull();
		expect(mocks.db.standards.incrementHitCounts).not.toHaveBeenCalled();
	});
});

describe("StandardsService.exportStandards", () => {
	it("resolves the repo scope and normalizes an unknown scope to repo", () => {
		StandardsService.exportStandards("app", "repo");
		StandardsService.exportStandards("app", "bogus");

		for (const call of mocks.db.standards.search.mock.calls) {
			expect(call[0]).toMatchObject({ repo: "app", is_global: undefined, limit: 100000, offset: 0 });
		}
	});

	it("exports global scope with is_global: true and no repo filter", () => {
		const payload = StandardsService.exportStandards(undefined, "global");

		expect(payload.scope).toBe("global");
		expect(mocks.db.standards.search).toHaveBeenCalledWith({
			repo: undefined,
			is_global: true,
			limit: 100000,
			offset: 0
		});
	});

	it("exports all scope with neither repo nor is_global filter", () => {
		const payload = StandardsService.exportStandards("app", "all");

		expect(payload.scope).toBe("all");
		expect(mocks.db.standards.search).toHaveBeenCalledWith({
			repo: undefined,
			is_global: undefined,
			limit: 100000,
			offset: 0
		});
	});

	it("shapes the payload with schema + exported_at + standards", () => {
		vi.mocked(mocks.db.standards.search).mockReturnValue([makeStandard()]);

		const payload = StandardsService.exportStandards("app", "repo");

		expect(payload.schema).toBe("local-memory-mcp.standards.v1");
		expect(payload.repo).toBe("app");
		expect(payload.exported_at).toEqual(expect.any(String));
		expect(payload.standards).toHaveLength(1);
	});

	it("nulls the repo field when repo is missing", () => {
		const payload = StandardsService.exportStandards(undefined, "repo");
		expect(payload.repo).toBeNull();
	});
});

describe("StandardsService.importStandards", () => {
	it("rejects an empty/whitespace payload with 400 before any DB work", async () => {
		await expect(StandardsService.importStandards([])).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "Import payload does not contain valid standards"
		});
		await expect(StandardsService.importStandards([{ no_title: true }])).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "Import payload does not contain valid standards"
		});
		expect(mocks.db.withExclusiveWrite).not.toHaveBeenCalled();
	});

	it("inserts new standards, enqueues vectors, and reports imported counts", async () => {
		const result = await StandardsService.importStandards([
			{ title: "A", content: "a" },
			{ title: "B", content: "b" }
		]);

		expect(result.imported).toHaveLength(2);
		expect(result.updated).toHaveLength(0);
		expect(result.total).toBe(2);
		expect(result.vectors_refreshed).toBe(true);
		expect(result.vector_failures).toBe(0);
		expect(mocks.db.standards.insert).toHaveBeenCalledTimes(2);
		expect(mocks.enqueue).toHaveBeenCalledTimes(2);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("write", "", "standards-import", {
			query: "standards-import",
			resultCount: 2
		});
	});

	it("updates standards matched by id and keeps them out of imported", async () => {
		vi.mocked(mocks.db.standards.getById).mockImplementation((id: string) =>
			id === "existing-id" ? makeStandard({ id: "existing-id" }) : null
		);

		const result = await StandardsService.importStandards([{ id: "existing-id", title: "A", content: "updated" }]);

		expect(result.updated).toEqual(["existing-id"]);
		expect(result.imported).toHaveLength(0);
		expect(mocks.db.standards.update).toHaveBeenCalledWith(
			"existing-id",
			expect.objectContaining({ title: "A", content: "updated" })
		);
		expect(mocks.db.standards.insert).not.toHaveBeenCalled();
	});

	it("dedupes by code when the id is unknown", async () => {
		vi.mocked(mocks.db.standards.getByCode).mockReturnValue(makeStandard({ id: "by-code", code: "STD-1" }));

		const result = await StandardsService.importStandards([{ code: "STD-1", title: "A", content: "a" }]);

		expect(result.updated).toEqual(["by-code"]);
		expect(mocks.db.standards.getByCode).toHaveBeenCalledWith("STD-1");
	});

	it("skips vector refresh for >500 rows unless explicitly requested", async () => {
		const bigPayload = Array.from({ length: 501 }, (_, i) => ({ title: `S${i}`, content: "c" }));

		const defaultResult = await StandardsService.importStandards(bigPayload);
		expect(defaultResult.vectors_refreshed).toBe(false);
		expect(mocks.enqueue).not.toHaveBeenCalled();

		const forcedResult = await StandardsService.importStandards(bigPayload, true);
		expect(forcedResult.vectors_refreshed).toBe(true);
		expect(mocks.enqueue).toHaveBeenCalledTimes(501);
	});

	it("counts vector enqueue failures instead of aborting the import", async () => {
		vi.mocked(mocks.enqueue).mockImplementation(() => {
			throw new Error("queue full");
		});

		const result = await StandardsService.importStandards([{ title: "A", content: "a" }]);

		expect(result.imported).toHaveLength(1);
		expect(result.vector_failures).toBe(1);
	});
});

describe("StandardsService.create", () => {
	it("applies documented defaults and persists + enqueues + logs", async () => {
		const entry = await StandardsService.create({ title: "T", content: "C", tags: ["x"], metadata: {} });

		expect(entry.is_global).toBe(true);
		expect(entry.version).toBe("1.0.0");
		expect(entry.context).toBe("general");
		expect(entry.hit_count).toBe(0);
		expect(entry.agent).toBe("dashboard");
		expect(entry.model).toBe("web-ui");
		expect(mocks.db.standards.insert).toHaveBeenCalledWith(entry);
		expect(mocks.enqueue).toHaveBeenCalledWith(mocks.db, entry);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("write", entry.owner, entry.repo || "global", {
			query: entry.title,
			resultCount: 1
		});
	});

	it("honors explicit is_global=false and language/stack", async () => {
		const entry = await StandardsService.create({
			title: "T",
			content: "C",
			tags: [],
			metadata: {},
			is_global: false,
			language: "typescript",
			stack: ["react"]
		});

		expect(entry.is_global).toBe(false);
		expect(entry.language).toBe("typescript");
		expect(entry.stack).toEqual(["react"]);
	});
});

describe("StandardsService.update / delete", () => {
	it("throws 404 when updating a missing standard", async () => {
		vi.mocked(mocks.db.standards.getById).mockReturnValue(null);

		await expect(StandardsService.update("ghost", { title: "x" })).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Coding standard not found"
		});
	});

	it("updates + enqueues the merged entry with a fresh updated_at", async () => {
		vi.mocked(mocks.db.standards.getById).mockReturnValue(makeStandard());

		await StandardsService.update("std-1", { title: "Renamed" });

		expect(mocks.db.standards.update).toHaveBeenCalledWith("std-1", { title: "Renamed" });
		expect(mocks.enqueue).toHaveBeenCalledWith(
			mocks.db,
			expect.objectContaining({ title: "Renamed", updated_at: expect.any(String) })
		);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("update", "acme", "global", {
			query: "Use UUID primary keys",
			resultCount: 1
		});
	});

	it("throws 404 when deleting a missing standard", async () => {
		vi.mocked(mocks.db.standards.getById).mockReturnValue(null);

		await expect(StandardsService.delete("ghost")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			message: "Coding standard not found"
		});
		expect(mocks.purge).not.toHaveBeenCalled();
	});

	it("routes the single delete through the shared purge + cleanup contract", async () => {
		vi.mocked(mocks.db.standards.getById).mockReturnValue(makeStandard({ repo: "app" }));

		await StandardsService.delete("std-1");

		expect(mocks.purge).toHaveBeenCalledWith(mocks.db, "standard", [
			{ id: "std-1", title: "Use UUID primary keys", repo: "app" }
		]);
		expect(mocks.db.actions.logAction).toHaveBeenCalledWith("delete", "acme", "app", {
			query: "Use UUID primary keys",
			resultCount: 1
		});
	});
});

describe("StandardsService.bulkAction", () => {
	it("bulk delete routes through the purge contract", async () => {
		vi.mocked(mocks.db.standards.getByIds).mockReturnValue([makeStandard({ id: "std-1" })]);

		const n = await StandardsService.bulkAction("delete", ["std-1"]);

		expect(n).toBe(1);
		expect(mocks.purge).toHaveBeenCalledWith(mocks.db, "standard", [
			{ id: "std-1", title: "Use UUID primary keys", repo: "" }
		]);
	});

	it("bulk update applies bulkUpdateStandards with the payload", async () => {
		vi.mocked(mocks.db.standards.getByIds).mockReturnValue([makeStandard({ id: "std-1" })]);
		vi.mocked(mocks.db.standards.bulkUpdateStandards).mockReturnValue(1);

		const n = await StandardsService.bulkAction("update", ["std-1"], { title: "Renamed" });

		expect(n).toBe(1);
		expect(mocks.db.standards.bulkUpdateStandards).toHaveBeenCalledWith(["std-1"], { title: "Renamed" });
	});

	it("rejects an unknown action with 400", async () => {
		await expect(StandardsService.bulkAction("explode", ["std-1"])).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: "Invalid action"
		});
	});
});

describe("standardsFromImportPayload", () => {
	it("extracts standards from a bare array, { standards }, and data.attributes.standards", () => {
		expect(standardsFromImportPayload([{ title: "A" }])).toEqual([{ title: "A" }]);
		expect(standardsFromImportPayload({ standards: [{ title: "B" }] })).toEqual([{ title: "B" }]);
		expect(standardsFromImportPayload({ data: { attributes: { standards: [{ title: "C" }] } } })).toEqual([
			{ title: "C" }
		]);
	});

	it("returns an empty array for malformed bodies", () => {
		expect(standardsFromImportPayload(null)).toEqual([]);
		expect(standardsFromImportPayload("raw")).toEqual([]);
		expect(standardsFromImportPayload({ standards: "not-an-array" })).toEqual([]);
		expect(standardsFromImportPayload({})).toEqual([]);
	});
});
