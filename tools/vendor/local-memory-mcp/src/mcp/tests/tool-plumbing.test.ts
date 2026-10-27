/**
 * Unit tests for src/mcp/utils/tool-plumbing.ts — the single write-lock set /
 * resource-invalidation source shared by BOTH transports (router.ts thin
 * adapter + tools/index.ts native SDK registration).
 *
 * Coverage targets (TASK-104): WRITE_TOOLS membership, collectAffectedResourceUris
 * URI derivation for memory/task/standard writes, and normalizePageLimit.
 *
 * Pure-logic suite: no store/vector dependencies, no DB.
 */

import { describe, expect, it } from "vitest";
import { WRITE_TOOLS, collectAffectedResourceUris, normalizePageLimit } from "../utils/tool-plumbing";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const NON_UUID = "MEM-101";
const TASK_UUID = "98765432-10ab-cdef-0123-456789abcdef";

describe("WRITE_TOOLS — write-lock membership", () => {
	it("includes every canonical write tool (memory/task/standard/handoff/claim/summarize)", () => {
		expect(WRITE_TOOLS).toEqual(
			new Set([
				"memory-write",
				"memory-delete",
				"repo-summarize",
				"handoff-write",
				"claim-manage",
				"standard-write",
				"standard-delete",
				"task-write",
				"task-delete",
				"observation-write"
			])
		);
	});

	it("excludes read-only tools", () => {
		for (const readTool of [
			"memory-read",
			"memory-search",
			"handoff-read",
			"handoff-list",
			"standard-read",
			"standard-search",
			"task-read",
			"task-list",
			"codebase-read"
		]) {
			expect(WRITE_TOOLS.has(readTool)).toBe(false);
		}
	});

	it("excludes 'codebase-index' — heavy CPU run must not hold the file lock (TASK-007)", () => {
		expect(WRITE_TOOLS.has("codebase-index")).toBe(false);
	});
});

describe("collectAffectedResourceUris — URI derivation", () => {
	it("returns [] for a tool call with no repo", () => {
		expect(collectAffectedResourceUris("memory-write", {}, undefined)).toEqual([]);
	});

	it("memory-write with repo arg derives memories collection + index", () => {
		const uris = collectAffectedResourceUris("memory-write", { repo: "acme/repo" }, {});
		expect(uris).toContain("repository://acme%2Frepo/memories");
		expect(uris).toContain("repository://index");
		expect(uris).not.toContain("repository://acme%2Frepo/tasks");
	});

	it("derives repo from args.scope.repo when args.repo is absent", () => {
		const uris = collectAffectedResourceUris("memory-write", { scope: { owner: "x", repo: "scoped-repo" } }, {});
		expect(uris).toContain("repository://scoped-repo/memories");
	});

	it("derives repo from result.structuredContent.repo as last-resort fallback", () => {
		const uris = collectAffectedResourceUris("memory-write", {}, { structuredContent: { repo: "result-repo" } });
		expect(uris).toContain("repository://result-repo/memories");
	});

	it("task-write derives BOTH tasks and memories collections (task writes can touch memory rows)", () => {
		const uris = collectAffectedResourceUris("task-write", { repo: "r" }, {});
		expect(uris).toContain("repository://r/tasks");
		expect(uris).toContain("repository://r/memories");
	});

	it("task-delete derives tasks collection", () => {
		const uris = collectAffectedResourceUris("task-delete", { repo: "r" }, {});
		expect(uris).toContain("repository://r/tasks");
		expect(uris).toContain("repository://index");
	});

	it("a read-only tool with a repo only derives the index resource", () => {
		const uris = collectAffectedResourceUris("handoff-read", { repo: "r" }, {});
		expect(uris).toEqual(["repository://index"]);
	});

	it("adds memory://{id} for memory-write with args.id (UUID)", () => {
		const uris = collectAffectedResourceUris("memory-write", { id: UUID, repo: "r" }, {});
		expect(uris).toContain(`memory://${UUID}`);
	});

	it("adds memory://{id} for memory-delete with args.memory_id (UUID)", () => {
		const uris = collectAffectedResourceUris("memory-delete", { memory_id: UUID, repo: "r" }, {});
		expect(uris).toContain(`memory://${UUID}`);
	});

	it("adds memory://{id} from result.structuredContent.id", () => {
		const uris = collectAffectedResourceUris("memory-write", {}, { structuredContent: { id: UUID } });
		expect(uris).toContain(`memory://${UUID}`);
	});

	it("adds task://{id} for task-write with args.id (UUID)", () => {
		const uris = collectAffectedResourceUris("task-write", { id: UUID, repo: "r" }, {});
		expect(uris).toContain(`task://${UUID}`);
	});

	it("adds task://{id} for task-write with args.task_id (UUID)", () => {
		const uris = collectAffectedResourceUris("task-write", { task_id: UUID, repo: "r" }, {});
		expect(uris).toContain(`task://${UUID}`);
	});

	it("adds task://{id} from result.structuredContent.id", () => {
		const uris = collectAffectedResourceUris("task-write", {}, { structuredContent: { id: UUID } });
		expect(uris).toContain(`task://${UUID}`);
	});

	// OPT-DRY-08: response-derived ids MUST come from `structuredContent` — the
	// field McpResponse actually exposes — never from the non-existent
	// `structuredData`/`data` keys the old copy-pasted readers used.

	it("derives task:// ids from a task-read/search results table (buildTableResult envelope)", () => {
		const uris = collectAffectedResourceUris(
			"task-read",
			{ repo: "r", query: "ship" },
			{
				structuredContent: {
					schema: "task-read/search",
					results: {
						columns: ["id", "task_code", "title", "status", "priority", "score", "confidence", "updated_at", "phase"],
						rows: [[UUID, "T-1", "One", "backlog", 1, 0.5, "high", "2026-01-01", "dev"]]
					},
					count: 1,
					total: 1
				}
			}
		);
		expect(uris).toContain(`task://${UUID}`);
		expect(uris).toContain("repository://r/tasks");
		expect(uris).not.toContain("repository://r/memories");
	});

	it("derives task:// ids from task-read/list tasks table", () => {
		const uris = collectAffectedResourceUris(
			"task-read",
			{ repo: "r" },
			{
				structuredContent: {
					schema: "task-read/list",
					tasks: {
						columns: ["id", "task_code", "title", "status", "priority", "updated_at", "comments_count"],
						rows: [[UUID, "T-1", "One", "backlog", 1, "2026-01-01", 0]]
					},
					count: 1
				}
			}
		);
		expect(uris).toContain(`task://${UUID}`);
	});

	it("derives task:// ids from task-read/detail bulk tasks ARRAY (mirrors memory-side array handling, TASK-183)", () => {
		const uris = collectAffectedResourceUris(
			"task-read",
			{ repo: "r" },
			{
				structuredContent: {
					schema: "task-read/detail",
					count: 2,
					tasks: [
						{ id: UUID, title: "One", phase: "dev" },
						{ id: TASK_UUID, title: "Two", phase: "dev" }
					]
				}
			}
		);
		expect(uris).toContain(`task://${UUID}`);
		expect(uris).toContain(`task://${TASK_UUID}`);
		// Cross-domain negative: an array of tasks must never yield memory://.
		expect(uris).not.toContain(`memory://${UUID}`);
		expect(uris).not.toContain(`memory://${TASK_UUID}`);
	});

	it("derives task:// ids from task-write/bulk results array", () => {
		const uris = collectAffectedResourceUris(
			"task-write",
			{ repo: "r" },
			{
				structuredContent: {
					success: true,
					repo: "r",
					createdCount: 1,
					results: [{ index: 0, operation: "create", success: true, id: UUID, code: "T-1", title: "One" }]
				}
			}
		);
		expect(uris).toContain(`task://${UUID}`);
	});

	it("derives memory:// ids from memory-read/detail nested memory and bulk memories array", () => {
		const single = collectAffectedResourceUris("memory-read", {}, { structuredContent: { memory: { id: UUID } } });
		expect(single).toContain(`memory://${UUID}`);

		const bulk = collectAffectedResourceUris(
			"memory-read",
			{},
			{ structuredContent: { memories: [{ id: UUID }, { id: TASK_UUID }] } }
		);
		expect(bulk).toContain(`memory://${UUID}`);
		expect(bulk).toContain(`memory://${TASK_UUID}`);
	});

	it("derives memory:// ids from memory-write/bulk results array and memory.read search table", () => {
		const bulk = collectAffectedResourceUris(
			"memory-write",
			{ repo: "r" },
			{
				structuredContent: {
					success: true,
					processed: 1,
					results: [{ operation: "create", success: true, id: UUID, code: "M-1", title: "One" }]
				}
			}
		);
		expect(bulk).toContain(`memory://${UUID}`);

		// memory.read search builds the table envelope WITHOUT a key — columns/
		// rows sit at the top level of structuredContent.
		const search = collectAffectedResourceUris(
			"memory-read",
			{ repo: "r" },
			{
				structuredContent: {
					columns: ["id", "code", "title", "type", "importance"],
					rows: [[UUID, "M-1", "One", "code_fact", 3]],
					count: 1
				}
			}
		);
		expect(search).toContain(`memory://${UUID}`);
	});

	it("returns no response-derived URIs and never throws when structuredContent is absent (includeJson not set)", () => {
		// A real McpResponse without structuredContent (handler did not pass
		// includeJson) — args-driven repository URIs still apply, task:// does not.
		const uris = collectAffectedResourceUris(
			"task-write",
			{ repo: "r" },
			{ content: [{ type: "text", text: "Created T-1" }], isError: false }
		);
		expect(uris).toEqual(["repository://r/memories", "repository://r/tasks", "repository://index"]);

		expect(() => collectAffectedResourceUris("task-write", {}, undefined)).not.toThrow();
		expect(() => collectAffectedResourceUris("memory-write", {}, null)).not.toThrow();
	});

	it("does NOT leak cross-domain ids into the wrong URI (memory tool returning task ids)", () => {
		const uris = collectAffectedResourceUris("memory-write", {}, { structuredContent: { task: { id: TASK_UUID } } });
		expect(uris).not.toContain(`task://${TASK_UUID}`);
		expect(uris).not.toContain(`memory://${TASK_UUID}`);
	});

	it("does NOT leak cross-domain ids into the wrong URI (task tool returning memory ids)", () => {
		const uris = collectAffectedResourceUris("task-read", {}, { structuredContent: { memory: { id: UUID } } });
		expect(uris).not.toContain(`memory://${UUID}`);
		expect(uris).not.toContain(`task://${UUID}`);
	});

	it("does NOT read the legacy structuredData key (silent-no-op regression guard)", () => {
		const uris = collectAffectedResourceUris("task-write", {}, { structuredData: { id: UUID } });
		expect(uris).toEqual([]);
	});

	it("does NOT add memory:// or task:// for non-UUID ids (codes are not resource URIs)", () => {
		const uris = collectAffectedResourceUris("memory-write", { id: NON_UUID, repo: "r" }, {});
		expect(uris).not.toContain(`memory://${NON_UUID}`);
		expect(uris).toContain("repository://r/memories");
	});

	it("deduplicates URIs when the same id is provided via multiple args", () => {
		const uris = collectAffectedResourceUris(
			"task-write",
			{ id: UUID, task_id: UUID, repo: "r" },
			{ structuredContent: { id: UUID } }
		);
		expect(uris.filter((u) => u === `task://${UUID}`)).toHaveLength(1);
	});

	it("URI-encodes repo names", () => {
		const uris = collectAffectedResourceUris("memory-write", { repo: "my org/repo name" }, {});
		expect(uris).toContain("repository://my%20org%2Frepo%20name/memories");
	});
});

describe("normalizePageLimit", () => {
	it("passes through valid integers within [1, 100]", () => {
		expect(normalizePageLimit(1, 10)).toBe(1);
		expect(normalizePageLimit(50, 10)).toBe(50);
		expect(normalizePageLimit(100, 10)).toBe(100);
	});

	it("clamps values above 100 to 100", () => {
		expect(normalizePageLimit(150, 10)).toBe(100);
		expect(normalizePageLimit(10_000, 10)).toBe(100);
	});

	it("falls back for missing/nullish values", () => {
		expect(normalizePageLimit(undefined, 20)).toBe(20);
		expect(normalizePageLimit(null, 20)).toBe(20);
	});

	it("falls back for non-numeric and non-integer values", () => {
		expect(normalizePageLimit("10", 20)).toBe(20);
		expect(normalizePageLimit(3.7, 20)).toBe(20);
		expect(normalizePageLimit(NaN, 20)).toBe(20);
	});

	it("falls back for values <= 0", () => {
		expect(normalizePageLimit(0, 20)).toBe(20);
		expect(normalizePageLimit(-5, 20)).toBe(20);
	});

	it("clamps the fallback to a minimum of 1", () => {
		expect(normalizePageLimit(undefined, 0)).toBe(1);
		expect(normalizePageLimit(undefined, -10)).toBe(1);
	});
});
