/**
 * Unit tests for the codebase-graph service layer (TASK-324 CG-B).
 *
 * Focus (unpinned at the HTTP layer): the traversal security boundary
 * (absolute / ../ / symlink-escape → 400 PATH_TRAVERSAL, missing → 404
 * FILE_NOT_FOUND), checksum-keyed cache reuse for indexed files, symbol
 * disambiguation (404/409 AMBIGUOUS_SYMBOL, filePath scoping), pair dedupe +
 * caller-kind resolution, and code-graph assembly (degree ranking, edge
 * capping with combined-degree priority, co_defined chaining, node-limit
 * clamping, kind validation).
 *
 * Small caps (CODE_GRAPH_MAX_EDGES=3, FILE_CONTENT_MAX_LINES=10) are set
 * BEFORE the service → constants import. Disk fixtures are mkdtemp temp
 * dirs cleaned after the suite.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodebaseSymbol, CodebaseReference } from "../../../mcp/types";

vi.hoisted(() => {
	process.env.CODE_GRAPH_MAX_EDGES = "3";
	process.env.FILE_CONTENT_MAX_LINES = "10";
});

const mocks = vi.hoisted(() => {
	const db = {
		codebaseFiles: { getFile: vi.fn(), getFileCountByRepo: vi.fn() },
		codebaseSymbols: { getSymbolByName: vi.fn(), getSymbolsByFile: vi.fn(), getSymbolsByRepo: vi.fn() },
		codebaseReferences: { getReferencesBySymbol: vi.fn(), getReferencesByRepo: vi.fn() }
	};
	return {
		db,
		getContent: vi.fn(),
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

vi.mock("../../../mcp/codebase-index/services/code-search", () => ({
	codeSearchCache: { getContent: mocks.getContent }
}));

import {
	readFileContent,
	getSymbolCallers,
	buildCodeGraph,
	CODE_GRAPH_KINDS
} from "../../services/codebase-graph.service";
import { CODE_GRAPH_DEFAULT_NODE_LIMIT, CODE_GRAPH_MAX_NODES } from "../../../mcp/utils/constants";

let tmpRoot: string;
let repoRoot: string;

function makeSymbol(overrides: Partial<CodebaseSymbol> = {}): CodebaseSymbol {
	return {
		id: "sym-1",
		repo: "app",
		file_path: "src/a.ts",
		name: "alpha",
		kind: "function",
		exported: true,
		default_export: false,
		start_line: 1,
		start_col: 0,
		end_line: 5,
		end_col: 0,
		signature: null,
		doc_comment: null,
		parent_symbol_id: null,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

function makeRef(overrides: Partial<CodebaseReference> = {}): CodebaseReference {
	return {
		id: "ref-1",
		repo: "app",
		symbol_name: "beta",
		caller_file: "src/a.ts",
		caller_line: 2,
		caller_name: "alpha",
		kind: "call",
		target_file: "src/b.ts",
		target_symbol_id: "sym-2",
		role: null,
		local_name: null,
		imported_name: null,
		module_specifier: null,
		import_kind: null,
		created_at: "2026-01-01T00:00:00.000Z",
		...overrides
	};
}

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-graph-service-test-"));
	repoRoot = path.join(tmpRoot, "repo");
	fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
	fs.writeFileSync(path.join(repoRoot, "src", "util.ts"), "line one\nline two\n");
});

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(mocks.db.codebaseFiles.getFile).mockReturnValue(undefined);
	vi.mocked(mocks.db.codebaseFiles.getFileCountByRepo).mockReturnValue(0);
	vi.mocked(mocks.db.codebaseSymbols.getSymbolByName).mockReturnValue([]);
	vi.mocked(mocks.db.codebaseSymbols.getSymbolsByFile).mockReturnValue([]);
	vi.mocked(mocks.db.codebaseSymbols.getSymbolsByRepo).mockReturnValue([]);
	vi.mocked(mocks.db.codebaseReferences.getReferencesBySymbol).mockReturnValue([]);
	vi.mocked(mocks.db.codebaseReferences.getReferencesByRepo).mockReturnValue([]);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("readFileContent — traversal security boundary", () => {
	it("rejects an absolute path with 400 PATH_TRAVERSAL", async () => {
		await expect(readFileContent(repoRoot, "app", "/etc/passwd")).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			code: "PATH_TRAVERSAL"
		});
	});

	it("rejects a ../ escape with 400 PATH_TRAVERSAL", async () => {
		await expect(readFileContent(repoRoot, "app", "../escape.txt")).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			code: "PATH_TRAVERSAL"
		});
	});

	it("rejects a symlink whose realpath leaves the repo root (defense-in-depth)", async () => {
		const secret = path.join(tmpRoot, "secret.txt");
		fs.writeFileSync(secret, "top secret");
		const link = path.join(repoRoot, "src", "link.txt");
		fs.symlinkSync(secret, link);

		await expect(readFileContent(repoRoot, "app", "src/link.txt")).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			code: "PATH_TRAVERSAL"
		});
	});

	it("returns 404 FILE_NOT_FOUND for a missing file inside the root", async () => {
		await expect(readFileContent(repoRoot, "app", "src/nope.ts")).rejects.toMatchObject({
			name: "ServiceError",
			status: 404,
			code: "FILE_NOT_FOUND",
			message: expect.stringContaining("File not found on disk")
		});
	});

	it("reads a non-indexed file fresh from disk with extension-derived language", async () => {
		const result = await readFileContent(repoRoot, "app", "src/util.ts");

		expect(result).toMatchObject({
			file_path: "src/util.ts",
			lines: 3, // trailing newline counts as a line
			size_bytes: expect.any(Number),
			truncated: false,
			content: "line one\nline two\n"
		});
		expect(mocks.getContent).not.toHaveBeenCalled();
	});

	it("reuses the checksum-keyed cache for indexed files (no disk read)", async () => {
		vi.mocked(mocks.db.codebaseFiles.getFile).mockReturnValue({
			id: "f1",
			repo: "app",
			file_path: "src/util.ts",
			language: "rust",
			checksum: "abc123",
			lines: 2,
			size_bytes: 18,
			last_indexed_at: "2026-01-01T00:00:00.000Z",
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z"
		});
		vi.mocked(mocks.getContent).mockResolvedValue("cached body");

		const result = await readFileContent(repoRoot, "app", "src/util.ts");

		expect(result.content).toBe("cached body");
		expect(result.language).toBe("rust"); // authoritative from the index row
		expect(mocks.getContent).toHaveBeenCalledWith("app", "src/util.ts", "abc123", expect.any(String));
	});

	it("truncates content to FILE_CONTENT_MAX_LINES and flags truncated", async () => {
		const longFile = path.join(repoRoot, "src", "long.ts");
		fs.writeFileSync(longFile, Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"));

		const result = await readFileContent(repoRoot, "app", "src/long.ts");

		expect(result.truncated).toBe(true);
		expect(result.lines).toBe(12);
		expect(result.content.split("\n")).toHaveLength(10);
	});
});

describe("getSymbolCallers", () => {
	const alphaSymbol = makeSymbol({ id: "sym-a", name: "alpha", kind: "function", file_path: "src/a.ts" });

	it("returns the symbol + deduped pairs + caller grouping with resolved caller kinds", () => {
		vi.mocked(mocks.db.codebaseSymbols.getSymbolByName).mockReturnValue([alphaSymbol]);
		vi.mocked(mocks.db.codebaseReferences.getReferencesBySymbol).mockReturnValue([
			makeRef({ id: "r1", caller_name: "foo", caller_file: "src/a.ts", caller_line: 5, kind: "call" }),
			makeRef({ id: "r2", caller_name: "foo", caller_file: "src/a.ts", caller_line: 5, kind: "call" }), // duplicate site
			makeRef({ id: "r3", caller_name: "foo", caller_file: "src/a.ts", caller_line: 9, kind: "import" })
		]);
		vi.mocked(mocks.db.codebaseSymbols.getSymbolsByFile).mockReturnValue([
			makeSymbol({ id: "sym-foo", name: "foo", kind: "function", file_path: "src/a.ts" })
		]);

		const result = getSymbolCallers("app", "alpha");

		expect(result.symbol).toMatchObject({ name: "alpha", kind: "function", filePath: "src/a.ts", line: 1 });
		expect(result.total).toBe(2); // the duplicate call site is deduped
		expect(result.pairs).toHaveLength(2);
		expect(result.groupedByCaller).toHaveLength(1);
		expect(result.groupedByCaller[0]).toMatchObject({
			caller: { name: "foo", filePath: "src/a.ts", kind: "function" },
			count: 2
		});
	});

	it("throws 404 SYMBOL_NOT_FOUND when the symbol does not exist", () => {
		vi.mocked(mocks.db.codebaseSymbols.getSymbolByName).mockReturnValue([]);

		expect(() => getSymbolCallers("app", "ghost")).toThrowError(
			expect.objectContaining({ name: "ServiceError", status: 404, code: "SYMBOL_NOT_FOUND" })
		);
	});

	it("throws 404 SYMBOL_NOT_FOUND when filePath scoping finds no match", () => {
		vi.mocked(mocks.db.codebaseSymbols.getSymbolByName).mockReturnValue([alphaSymbol]); // only in src/a.ts

		expect(() => getSymbolCallers("app", "alpha", undefined, "src/other.ts")).toThrowError(
			expect.objectContaining({ name: "ServiceError", status: 404, code: "SYMBOL_NOT_FOUND" })
		);
	});

	it("throws 409 AMBIGUOUS_SYMBOL for duplicate names that filePath does not narrow", () => {
		vi.mocked(mocks.db.codebaseSymbols.getSymbolByName).mockReturnValue([
			alphaSymbol,
			makeSymbol({ id: "sym-a2", name: "alpha", file_path: "src/b.ts" })
		]);

		expect(() => getSymbolCallers("app", "alpha")).toThrowError(
			expect.objectContaining({
				name: "ServiceError",
				status: 409,
				code: "AMBIGUOUS_SYMBOL",
				message: expect.stringContaining("provide filePath")
			})
		);
	});

	it("narrows duplicate names to the matching definition via filePath", () => {
		vi.mocked(mocks.db.codebaseSymbols.getSymbolByName).mockReturnValue([
			alphaSymbol,
			makeSymbol({ id: "sym-a2", name: "alpha", file_path: "src/b.ts" })
		]);
		vi.mocked(mocks.db.codebaseReferences.getReferencesBySymbol).mockReturnValue([
			makeRef({ id: "r1", target_symbol_id: "sym-a2", target_file: "src/b.ts" })
		]);

		const result = getSymbolCallers("app", "alpha", undefined, "src/b.ts");

		expect(result.symbol.filePath).toBe("src/b.ts");
		// filePath-scoped pairs are filtered to rows attributable to that symbol.
		expect(result.total).toBe(1);
	});

	it("filters pairs by kind when a kind is requested", () => {
		vi.mocked(mocks.db.codebaseSymbols.getSymbolByName).mockReturnValue([alphaSymbol]);
		vi.mocked(mocks.db.codebaseReferences.getReferencesBySymbol).mockReturnValue([
			makeRef({ id: "r1", kind: "call" }),
			makeRef({ id: "r2", kind: "import" })
		]);

		const result = getSymbolCallers("app", "alpha", "import");

		expect(result.total).toBe(1);
		expect(result.pairs[0].kind).toBe("import");
	});
});

describe("buildCodeGraph", () => {
	it("throws 404 REPO_NOT_INDEXED when the repo has no indexed files", () => {
		vi.mocked(mocks.db.codebaseFiles.getFileCountByRepo).mockReturnValue(0);

		expect(() => buildCodeGraph("app")).toThrowError(
			expect.objectContaining({ name: "ServiceError", status: 404, code: "REPO_NOT_INDEXED" })
		);
	});

	it("rejects an invalid kind with 400 INVALID_GRAPH_KIND", () => {
		vi.mocked(mocks.db.codebaseFiles.getFileCountByRepo).mockReturnValue(1);

		expect(() => buildCodeGraph("app", undefined, "bogus")).toThrowError(
			expect.objectContaining({ name: "ServiceError", status: 400, code: "INVALID_GRAPH_KIND" })
		);
	});

	it("exposes the valid kind taxonomy", () => {
		expect(CODE_GRAPH_KINDS).toEqual(["call", "import", "co_defined"]);
	});

	it("assembles degree-ranked nodes + reference edges and size-scales by degree", () => {
		vi.mocked(mocks.db.codebaseFiles.getFileCountByRepo).mockReturnValue(1);
		vi.mocked(mocks.db.codebaseSymbols.getSymbolsByRepo).mockReturnValue([
			makeSymbol({ id: "sym-a", name: "alpha", file_path: "src/a.ts" }),
			makeSymbol({ id: "sym-b", name: "beta", file_path: "src/b.ts" })
		]);
		vi.mocked(mocks.db.codebaseReferences.getReferencesByRepo).mockReturnValue([
			makeRef({
				id: "r1",
				caller_name: "alpha",
				caller_file: "src/a.ts",
				symbol_name: "beta",
				target_symbol_id: "sym-b"
			})
		]);

		const result = buildCodeGraph("app", undefined, "call");

		expect(result.id).toBe("codebase-graph-app");
		expect(result.nodes).toHaveLength(2);
		expect(result.edges).toEqual([{ source: "sym-sym-a", target: "sym-sym-b", relation_type: "call" }]);
		// size = 14 + min(degree, 30); alpha has degree 1.
		expect(result.nodes.find((n) => n.id === "sym-sym-a")).toMatchObject({ name: "alpha", degree: 1, size: 15 });
		expect(result.truncated).toBe(false);
		expect(result.stats).toMatchObject({
			totalSymbols: 2,
			totalRefs: 1,
			nodeLimit: CODE_GRAPH_DEFAULT_NODE_LIMIT,
			edgeCap: 3
		});
	});

	it("chains consecutive same-file symbols into co_defined edges in all-mode", () => {
		vi.mocked(mocks.db.codebaseFiles.getFileCountByRepo).mockReturnValue(1);
		vi.mocked(mocks.db.codebaseSymbols.getSymbolsByRepo).mockReturnValue([
			makeSymbol({ id: "sym-a", name: "alpha", file_path: "src/a.ts" }),
			makeSymbol({ id: "sym-b", name: "beta", file_path: "src/a.ts" })
		]);
		vi.mocked(mocks.db.codebaseReferences.getReferencesByRepo).mockReturnValue([]);

		const result = buildCodeGraph("app");

		expect(result.edges).toEqual([{ source: "sym-sym-a", target: "sym-sym-b", relation_type: "co_defined" }]);
		// No refs/co signal bumps degree in all-mode → file-order fallback nodes.
		expect(result.nodes.map((n) => n.name)).toEqual(["alpha", "beta"]);
	});

	it("co_defined mode ships only co edges and derives degree from them", () => {
		vi.mocked(mocks.db.codebaseFiles.getFileCountByRepo).mockReturnValue(1);
		vi.mocked(mocks.db.codebaseSymbols.getSymbolsByRepo).mockReturnValue([
			makeSymbol({ id: "sym-a", name: "alpha", file_path: "src/a.ts" }),
			makeSymbol({ id: "sym-b", name: "beta", file_path: "src/a.ts" }),
			makeSymbol({ id: "sym-c", name: "gamma", file_path: "src/a.ts" })
		]);
		// A call ref exists but must be ignored in co_defined mode.
		vi.mocked(mocks.db.codebaseReferences.getReferencesByRepo).mockReturnValue([
			makeRef({
				id: "r1",
				caller_name: "alpha",
				caller_file: "src/a.ts",
				symbol_name: "beta",
				target_symbol_id: "sym-b",
				kind: "call"
			})
		]);

		const result = buildCodeGraph("app", undefined, "co_defined");

		expect(result.edges).toEqual([
			{ source: "sym-sym-a", target: "sym-sym-b", relation_type: "co_defined" },
			{ source: "sym-sym-b", target: "sym-sym-c", relation_type: "co_defined" }
		]);
		// Middle symbol has degree 2 → larger size.
		expect(result.nodes.find((n) => n.id === "sym-sym-b")?.degree).toBe(2);
	});

	it("caps edges at CODE_GRAPH_MAX_EDGES keeping the highest combined-degree edges", () => {
		vi.mocked(mocks.db.codebaseFiles.getFileCountByRepo).mockReturnValue(1);
		const names = ["a", "b", "c", "d", "e", "f"];
		vi.mocked(mocks.db.codebaseSymbols.getSymbolsByRepo).mockReturnValue(
			names.map((n) => makeSymbol({ id: `sym-${n}`, name: n, file_path: `src/${n}.ts` }))
		);
		vi.mocked(mocks.db.codebaseReferences.getReferencesByRepo).mockReturnValue([
			makeRef({ id: "r1", caller_name: "a", caller_file: "src/a.ts", symbol_name: "b", target_symbol_id: "sym-b" }),
			makeRef({ id: "r2", caller_name: "a", caller_file: "src/a.ts", symbol_name: "c", target_symbol_id: "sym-c" }),
			makeRef({ id: "r3", caller_name: "b", caller_file: "src/b.ts", symbol_name: "d", target_symbol_id: "sym-d" }),
			makeRef({ id: "r4", caller_name: "c", caller_file: "src/c.ts", symbol_name: "e", target_symbol_id: "sym-e" }),
			makeRef({ id: "r5", caller_name: "d", caller_file: "src/d.ts", symbol_name: "f", target_symbol_id: "sym-f" })
		]);

		const result = buildCodeGraph("app", undefined, "call");

		expect(result.truncated).toBe(true); // 5 in-scope edges > cap 3
		expect(result.edges).toHaveLength(3);
		// a→b / a→c / b→d all carry combined degree 4 (a=2, b=2, c=2, d=2),
		// while c→e and d→f carry 3 — the highest-degree edges survive.
		expect(result.edges.map((e) => e.target)).toEqual(["sym-sym-b", "sym-sym-c", "sym-sym-d"]);
	});

	it("clamps the node limit to CODE_GRAPH_MAX_NODES and falls back to the default on garbage", () => {
		vi.mocked(mocks.db.codebaseFiles.getFileCountByRepo).mockReturnValue(1);
		vi.mocked(mocks.db.codebaseSymbols.getSymbolsByRepo).mockReturnValue([
			makeSymbol({ id: "sym-a", name: "alpha", file_path: "src/a.ts" })
		]);
		vi.mocked(mocks.db.codebaseReferences.getReferencesByRepo).mockReturnValue([]);

		expect(buildCodeGraph("app", "999999", "call").stats.nodeLimit).toBe(CODE_GRAPH_MAX_NODES);
		expect(buildCodeGraph("app", "-3", "call").stats.nodeLimit).toBe(CODE_GRAPH_DEFAULT_NODE_LIMIT);
		expect(buildCodeGraph("app", "garbage", "call").stats.nodeLimit).toBe(CODE_GRAPH_DEFAULT_NODE_LIMIT);
	});
});
