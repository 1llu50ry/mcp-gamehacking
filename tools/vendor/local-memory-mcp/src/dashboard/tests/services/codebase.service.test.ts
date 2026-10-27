/**
 * Unit tests for the codebase service layer (owner injection, repo path
 * resolution, error-code mapping, MCP tool delegation + MISSING_REPO_PATH
 * guard, and codebase-graph delegation).
 *
 * The HTTP layer pins the codebase routes end-to-end (codebase-api
 * integration suite); these tests pin the SERVICE-owned rules not visible
 * through routes: owner injection precedence (explicit → owner/repo parse →
 * git remote fallback), candidate-order path resolution, the documented
 * error-code → HTTP map, and the empty-response 500 contract.
 * Pure unit — tool handlers + parser pool mocked; disk fixtures are
 * mkdtemp temp dirs (cleaned after the suite).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => {
	const db = {
		codebaseFiles: { getFile: vi.fn(), getFileCountByRepo: vi.fn() },
		codebaseSymbols: {
			getSymbolByName: vi.fn(),
			getSymbolsByFile: vi.fn(),
			getSymbolsByRepo: vi.fn()
		},
		codebaseReferences: { getReferencesBySymbol: vi.fn(), getReferencesByRepo: vi.fn() }
	};
	return {
		db,
		handleCodebaseRead: vi.fn(),
		handleCodebaseIndexStatus: vi.fn(),
		handleCodebaseIndexRepository: vi.fn(),
		autoIndexIfStale: vi.fn(),
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

vi.mock("../../../mcp/tools/codebase.read", () => ({
	handleCodebaseRead: mocks.handleCodebaseRead
}));

vi.mock("../../../mcp/tools/codebase-index", () => ({
	handleCodebaseIndexStatus: mocks.handleCodebaseIndexStatus,
	handleCodebaseIndexRepository: mocks.handleCodebaseIndexRepository
}));

vi.mock("../../../mcp/codebase-index/services/indexing-service", () => ({
	autoIndexIfStale: mocks.autoIndexIfStale
}));

vi.mock("../../../mcp/codebase-index/parser/parser-pool", () => ({
	TreeSitterParserPool: class {}
}));

import { CodebaseService, injectOwner, resolveRepoPath, errorCodeToHttp } from "../../services/codebase.service";

let tmpRoot: string;
let reposDir: string;

beforeAll(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codebase-service-test-"));
	reposDir = path.join(tmpRoot, "repos");
	fs.mkdirSync(path.join(reposDir, "app"), { recursive: true });
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("injectOwner", () => {
	it("passes through when an owner is already provided", () => {
		expect(injectOwner({ repo: "app", owner: "acme" })).toEqual({ repo: "app", owner: "acme" });
	});

	it("passes through when there is no repo to derive from", () => {
		expect(injectOwner({ query: "q" })).toEqual({ query: "q" });
	});

	it("extracts the owner from an owner/repo input", () => {
		expect(injectOwner({ repo: "vheins/local-memory-mcp" })).toEqual({
			repo: "vheins/local-memory-mcp",
			owner: "vheins"
		});
	});

	it("falls back to the git remote origin of the CWD", () => {
		const gitDir = path.join(tmpRoot, "git-repo");
		fs.mkdirSync(path.join(gitDir, ".git"), { recursive: true });
		fs.writeFileSync(
			path.join(gitDir, ".git", "config"),
			'[remote "origin"]\n\turl = git@github.com:acme-org/widgets.git\n'
		);
		vi.spyOn(process, "cwd").mockReturnValue(gitDir);

		expect(injectOwner({ repo: "widgets" })).toEqual({ repo: "widgets", owner: "acme-org" });
	});

	it("does not inject an owner from an invalid git remote username", () => {
		const gitDir = path.join(tmpRoot, "git-repo-invalid");
		fs.mkdirSync(path.join(gitDir, ".git"), { recursive: true });
		fs.writeFileSync(
			path.join(gitDir, ".git", "config"),
			'[remote "origin"]\n\turl = https://github.com/-bad-owner/widgets.git\n'
		);
		vi.spyOn(process, "cwd").mockReturnValue(gitDir);

		expect(injectOwner({ repo: "widgets" })).toEqual({ repo: "widgets" });
	});

	it("returns params unchanged when no git config exists in the CWD", () => {
		vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);

		expect(injectOwner({ repo: "widgets" })).toEqual({ repo: "widgets" });
	});
});

describe("resolveRepoPath", () => {
	it("returns an explicit repoPath as-is", () => {
		expect(resolveRepoPath("acme/app", "/explicit/path")).toBe("/explicit/path");
	});

	it("resolves repo against CODEBASE_REPOS_DIR", () => {
		vi.stubEnv("CODEBASE_REPOS_DIR", reposDir);
		expect(resolveRepoPath("app")).toBe(path.join(reposDir, "app"));
	});

	it("resolves the short repo name under CODEBASE_REPOS_DIR for owner/repo input", () => {
		vi.stubEnv("CODEBASE_REPOS_DIR", reposDir);
		expect(resolveRepoPath("acme/app")).toBe(path.join(reposDir, "app"));
	});

	it("returns null when no candidate directory exists", () => {
		vi.stubEnv("CODEBASE_REPOS_DIR", path.join(tmpRoot, "empty"));
		expect(resolveRepoPath("no-such-repo")).toBeNull();
	});
});

describe("errorCodeToHttp", () => {
	it("maps documented tool error codes to the HTTP contract", () => {
		expect(errorCodeToHttp("PATH_NOT_FOUND")).toBe(400);
		expect(errorCodeToHttp("NOT_A_DIRECTORY")).toBe(400);
		expect(errorCodeToHttp("REPO_PATH_REQUIRED")).toBe(400);
		expect(errorCodeToHttp("REPO_PATH_NOT_FOUND")).toBe(400);
		expect(errorCodeToHttp("REPO_FILES_MISSING")).toBe(400);
		expect(errorCodeToHttp("INVALID_REGEX")).toBe(400);
		expect(errorCodeToHttp("SYMBOL_NOT_FOUND")).toBe(404);
		expect(errorCodeToHttp("FILE_NOT_INDEXED")).toBe(404);
		expect(errorCodeToHttp("REPO_NOT_INDEXED")).toBe(404);
		expect(errorCodeToHttp("AMBIGUOUS_SYMBOL")).toBe(409);
		expect(errorCodeToHttp("INDEX_FAILED")).toBe(500);
		expect(errorCodeToHttp("TRACE_FAILED")).toBe(500);
		expect(errorCodeToHttp("CODE_SEARCH_FAILED")).toBe(500);
	});

	it("defaults unknown codes to 500", () => {
		expect(errorCodeToHttp("SOMETHING_ELSE")).toBe(500);
	});
});

describe("CodebaseService read delegation", () => {
	beforeEach(() => {
		vi.mocked(mocks.handleCodebaseRead).mockReset();
		vi.mocked(mocks.handleCodebaseIndexStatus).mockReset();
		vi.mocked(mocks.handleCodebaseIndexRepository).mockReset();
		vi.mocked(mocks.autoIndexIfStale).mockReset();
	});

	it("readArchitecture delegates with depth/symbolCounts and returns structuredContent", async () => {
		vi.mocked(mocks.handleCodebaseRead).mockResolvedValue({ structuredContent: { tree: [] } });

		const result = await CodebaseService.readArchitecture("acme/app", "3", "true");

		expect(result).toEqual({ tree: [] });
		expect(mocks.handleCodebaseRead).toHaveBeenCalledWith(
			{ repo: "acme/app", depth: "3", includeSymbolCounts: "true", json: true, owner: "acme" },
			mocks.db,
			expect.any(Object)
		);
	});

	it("readArchitecture throws 500 when the handler returns no structuredContent", async () => {
		vi.mocked(mocks.handleCodebaseRead).mockResolvedValue({ isError: true });

		await expect(CodebaseService.readArchitecture("app")).rejects.toMatchObject({
			name: "ServiceError",
			status: 500,
			message: "Unexpected empty response"
		});
	});

	it("traceSymbol forwards includeReferences and trims the repo", async () => {
		vi.mocked(mocks.handleCodebaseRead).mockResolvedValue({ structuredContent: { symbol: {} } });

		await CodebaseService.traceSymbol("alpha", "  acme/app  ", "true");

		expect(mocks.handleCodebaseRead).toHaveBeenCalledWith(
			{ name: "alpha", repo: "acme/app", includeReferences: "true", json: true, owner: "acme" },
			mocks.db,
			expect.any(Object)
		);
	});

	it("getIndexStatus delegates to the index-status handler", async () => {
		vi.mocked(mocks.handleCodebaseIndexStatus).mockResolvedValue({ structuredContent: { status: "fresh" } });

		const result = await CodebaseService.getIndexStatus("acme/app");

		expect(result).toEqual({ status: "fresh" });
		expect(mocks.handleCodebaseIndexStatus).toHaveBeenCalledWith(
			{ repo: "acme/app", owner: "acme" },
			mocks.db,
			expect.any(Object)
		);
	});

	it("startIndex resolves the path and delegates with force + globs", async () => {
		vi.stubEnv("CODEBASE_REPOS_DIR", reposDir);
		vi.mocked(mocks.handleCodebaseIndexRepository).mockResolvedValue({ structuredContent: { indexed: 5 } });

		const result = await CodebaseService.startIndex("app", "", true, ["**/*.ts"], ["**/test/**"]);

		expect(result).toEqual({ indexed: 5 });
		expect(mocks.handleCodebaseIndexRepository).toHaveBeenCalledWith(
			expect.objectContaining({ repo: "app", repoPath: path.join(reposDir, "app"), force: true }),
			mocks.db,
			expect.any(Object)
		);
	});

	it("startIndex throws 400 MISSING_REPO_PATH when the repo cannot be resolved", async () => {
		vi.stubEnv("CODEBASE_REPOS_DIR", path.join(tmpRoot, "empty"));

		await expect(CodebaseService.startIndex("no-such-repo", "")).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			code: "MISSING_REPO_PATH"
		});
	});

	it("autoIndex delegates to the staleness check and normalizes a null reason", async () => {
		vi.stubEnv("CODEBASE_REPOS_DIR", reposDir);
		vi.mocked(mocks.autoIndexIfStale).mockResolvedValue({ status: "up_to_date", reason: null });

		const result = await CodebaseService.autoIndex("app");

		expect(result).toEqual({ status: "up_to_date", reason: "" });
		expect(mocks.autoIndexIfStale).toHaveBeenCalledWith("app", path.join(reposDir, "app"), mocks.db, expect.anything());
	});

	it("autoIndex throws 400 MISSING_REPO_PATH when the repo cannot be resolved", async () => {
		vi.stubEnv("CODEBASE_REPOS_DIR", path.join(tmpRoot, "empty"));

		await expect(CodebaseService.autoIndex("no-such-repo")).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			message: expect.stringContaining("repoPath is required")
		});
	});
});

describe("CodebaseService searchCode / readFileContent / symbolCallers / codeGraph", () => {
	beforeEach(() => {
		vi.mocked(mocks.handleCodebaseRead).mockReset();
		vi.mocked(mocks.db.codebaseFiles.getFile).mockReset();
		vi.mocked(mocks.db.codebaseFiles.getFileCountByRepo).mockReset();
		vi.mocked(mocks.db.codebaseSymbols.getSymbolByName).mockReset();
		vi.mocked(mocks.db.codebaseReferences.getReferencesBySymbol).mockReset();
	});

	it("searchCode rejects with 400 MISSING_REPO_PATH when the repo path is unresolvable", async () => {
		vi.stubEnv("CODEBASE_REPOS_DIR", path.join(tmpRoot, "empty"));

		await expect(CodebaseService.searchCode({ repo: "no-such-repo", query: "foo" })).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			code: "MISSING_REPO_PATH"
		});
	});

	it("searchCode injects the resolved repoPath and delegates", async () => {
		vi.stubEnv("CODEBASE_REPOS_DIR", reposDir);
		vi.mocked(mocks.handleCodebaseRead).mockResolvedValue({ structuredContent: { results: [] } });

		const result = await CodebaseService.searchCode({ repo: "acme/app", query: "tokenize" });

		expect(result).toEqual({ results: [] });
		expect(mocks.handleCodebaseRead).toHaveBeenCalledWith(
			expect.objectContaining({ repo: "acme/app", repoPath: path.join(reposDir, "app"), query: "tokenize" }),
			mocks.db,
			expect.any(Object)
		);
	});

	it("readFileContent rejects with 400 when the repo root is unresolvable", async () => {
		vi.stubEnv("CODEBASE_REPOS_DIR", path.join(tmpRoot, "empty"));

		await expect(CodebaseService.readFileContent("no-such-repo", "a.ts")).rejects.toMatchObject({
			name: "ServiceError",
			status: 400,
			code: "MISSING_REPO_PATH"
		});
	});

	it("readFileContent reads a non-indexed file from disk at the resolved root", async () => {
		fs.writeFileSync(path.join(reposDir, "app", "readme.md"), "line one\nline two\n");
		vi.stubEnv("CODEBASE_REPOS_DIR", reposDir);
		vi.mocked(mocks.db.codebaseFiles.getFile).mockReturnValue(undefined);

		const result = await CodebaseService.readFileContent("acme/app", "readme.md");

		// Trailing newline counts as a line (split(/\r?\n/).length semantics).
		expect(result).toMatchObject({ file_path: "readme.md", lines: 3, truncated: false });
		expect((result as { content: string }).content).toBe("line one\nline two\n");
	});

	it("symbolCallers normalizes the repo to its short name before delegating", async () => {
		vi.mocked(mocks.db.codebaseSymbols.getSymbolByName).mockReturnValue([
			{ id: "s1", name: "alpha", kind: "function", file_path: "src/a.ts", start_line: 1 }
		]);
		vi.mocked(mocks.db.codebaseReferences.getReferencesBySymbol).mockReturnValue([]);

		const result = await CodebaseService.symbolCallers("acme/app", "alpha");

		expect(mocks.db.codebaseSymbols.getSymbolByName).toHaveBeenCalledWith("app", "alpha");
		expect(result).toMatchObject({ total: 0, pairs: [], symbol: { name: "alpha" } });
	});

	it("codeGraph normalizes the repo and reports empty graph stats for an empty index", async () => {
		vi.mocked(mocks.db.codebaseFiles.getFileCountByRepo).mockReturnValue(1);
		vi.mocked(mocks.db.codebaseSymbols.getSymbolsByRepo).mockReturnValue([]);
		vi.mocked(mocks.db.codebaseReferences.getReferencesByRepo).mockReturnValue([]);

		const result = await CodebaseService.codeGraph("acme/app", "50", "call");

		expect(mocks.db.codebaseFiles.getFileCountByRepo).toHaveBeenCalledWith("app");
		expect(result).toMatchObject({
			id: "codebase-graph-app",
			nodes: [],
			edges: [],
			truncated: false,
			stats: { totalSymbols: 0, totalRefs: 0 }
		});
	});
});
