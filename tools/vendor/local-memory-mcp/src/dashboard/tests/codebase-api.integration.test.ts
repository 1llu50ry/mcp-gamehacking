/**
 * Codebase API Integration Tests — index, metadata & search module.
 *
 * Split from codebase-api.integration.test.ts (TASK-428). The shared
 * `vi.mock("../../dashboard/lib/context", ...)`, helpers and seed fixtures
 * live in ./codebase-api.shared; the file-content and symbols/graph modules
 * live in their own files. Tests run against an in-memory SQLiteStore.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { createTempDir, createTempTsFile, startCodebaseServer } from "./codebase-api.shared";

describe("Codebase API: index, metadata & search", () => {
	let baseUrl: string;
	let closeServer: () => Promise<void>;

	beforeAll(async () => {
		const server = await startCodebaseServer();
		baseUrl = server.baseUrl;
		closeServer = server.close;
	});

	afterAll(async () => {
		await closeServer();
	});

	describe("index-status", () => {
		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/index-status?repo=`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns index status for a known repo", async () => {
			const { db } = await import("../../dashboard/lib/context");
			db.codebaseFiles.upsertFile({
				repo: "test-repo",
				file_path: "src/index.ts",
				language: "typescript",
				checksum: "abc123",
				lines: 10,
				size_bytes: 200
			});

			const res = await fetch(`${baseUrl}/api/codebase/index-status?repo=test-owner/test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			// Repo is normalized by the schema (owner prefix stripped)
			expect(body.repo).toBe("test-repo");
			expect(body.isIndexed).toBe(true);
			expect(body.totalFiles).toBeGreaterThanOrEqual(1);
		});
	});

	describe("architecture", () => {
		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/architecture`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns architecture tree for indexed repo", async () => {
			const { db } = await import("../../dashboard/lib/context");

			// DB stores repo as short name (after schema normalizeRepo strips owner prefix)
			db.codebaseFiles.upsertFile({
				repo: "arch-repo",
				file_path: "src/controllers/user.controller.ts",
				language: "typescript",
				checksum: "def456",
				lines: 42,
				size_bytes: 1200
			});
			db.codebaseFiles.upsertFile({
				repo: "arch-repo",
				file_path: "src/services/auth.service.ts",
				language: "typescript",
				checksum: "ghi789",
				lines: 88,
				size_bytes: 2400
			});

			db.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: "arch-repo",
					file_path: "src/controllers/user.controller.ts",
					name: "UserController",
					kind: "Class",
					exported: true,
					default_export: false,
					start_line: 1,
					start_col: 0,
					end_line: 42,
					end_col: 1,
					signature: "class UserController",
					doc_comment: null,
					parent_symbol_id: null
				},
				{
					repo: "arch-repo",
					file_path: "src/services/auth.service.ts",
					name: "authenticate",
					kind: "Function",
					exported: true,
					default_export: false,
					start_line: 10,
					start_col: 0,
					end_line: 30,
					end_col: 1,
					signature: "function authenticate(token: string): User | null",
					doc_comment: "Authenticates a user by token",
					parent_symbol_id: null
				}
			]);

			const res = await fetch(`${baseUrl}/api/codebase/architecture?repo=test-owner/arch-repo&depth=3`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.root).toBeDefined();
			expect(body.root.type).toBe("directory");
			expect(body.summary.totalFiles).toBe(2);
			expect(body.summary.totalSymbols).toBe(2);
			expect(body.summary.topLevelExports.length).toBe(2);
		});
	});

	describe("symbols", () => {
		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbols?filePath=foo.ts`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns 400 when filePath is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/symbols?repo=test/test`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_FILE_PATH");
		});

		it("returns symbols for an indexed file", async () => {
			const { db } = await import("../../dashboard/lib/context");

			db.codebaseFiles.upsertFile({
				repo: "sym-repo",
				file_path: "src/lib/helpers.ts",
				language: "typescript",
				checksum: "sym123",
				lines: 50,
				size_bytes: 1800
			});

			db.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: "sym-repo",
					file_path: "src/lib/helpers.ts",
					name: "formatDate",
					kind: "Function",
					exported: true,
					default_export: false,
					start_line: 5,
					start_col: 0,
					end_line: 12,
					end_col: 1,
					signature: "function formatDate(date: Date): string",
					doc_comment: "Formats a date to ISO string",
					parent_symbol_id: null
				},
				{
					repo: "sym-repo",
					file_path: "src/lib/helpers.ts",
					name: "parseNumber",
					kind: "Function",
					exported: false,
					default_export: false,
					start_line: 15,
					start_col: 0,
					end_line: 20,
					end_col: 1,
					signature: null,
					doc_comment: null,
					parent_symbol_id: null
				}
			]);

			const res = await fetch(`${baseUrl}/api/codebase/symbols?repo=test-owner/sym-repo&filePath=src/lib/helpers.ts`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.file).toBeDefined();
			expect(body.file.language).toBe("typescript");
			expect(body.symbols).toHaveLength(2);
			expect(body.total).toBe(2);
		});
	});

	describe("search", () => {
		it("returns empty result for a search with no matches", async () => {
			const { db } = await import("../../dashboard/lib/context");

			db.codebaseFiles.upsertFile({
				repo: "search-repo",
				file_path: "src/main.ts",
				language: "typescript",
				checksum: "search123",
				lines: 5,
				size_bytes: 100
			});

			db.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: "search-repo",
					file_path: "src/main.ts",
					name: "main",
					kind: "Function",
					exported: false,
					default_export: false,
					start_line: 1,
					start_col: 0,
					end_line: 5,
					end_col: 1,
					signature: null,
					doc_comment: null,
					parent_symbol_id: null
				}
			]);

			const res = await fetch(`${baseUrl}/api/codebase/search?repo=test-owner/search-repo&query=zzTopNotFound`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.total).toBe(0);
			expect(body.symbols).toEqual([]);
		});

		it("finds symbols by name", async () => {
			const { db } = await import("../../dashboard/lib/context");

			db.codebaseFiles.upsertFile({
				repo: "search-repo-2",
				file_path: "src/app.ts",
				language: "typescript",
				checksum: "srch2",
				lines: 20,
				size_bytes: 300
			});

			db.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: "search-repo-2",
					file_path: "src/app.ts",
					name: "startServer",
					kind: "Function",
					exported: true,
					default_export: false,
					start_line: 10,
					start_col: 0,
					end_line: 20,
					end_col: 1,
					signature: "function startServer(): void",
					doc_comment: null,
					parent_symbol_id: null
				}
			]);

			const res = await fetch(`${baseUrl}/api/codebase/search?repo=test-owner/search-repo-2&query=start`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.total).toBeGreaterThanOrEqual(1);
			expect(body.symbols[0].name).toBe("startServer");
		});
	});

	describe("trace", () => {
		it("returns 400 when name is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/trace`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_NAME");
		});

		it("returns symbol details for a unique match", async () => {
			const { db } = await import("../../dashboard/lib/context");

			db.codebaseFiles.upsertFile({
				repo: "trace-repo",
				file_path: "src/utils/logger.ts",
				language: "typescript",
				checksum: "trace001",
				lines: 30,
				size_bytes: 600
			});

			db.codebaseSymbols.bulkUpsertSymbols([
				{
					repo: "trace-repo",
					file_path: "src/utils/logger.ts",
					name: "createLogger",
					kind: "Function",
					exported: true,
					default_export: false,
					start_line: 3,
					start_col: 0,
					end_line: 10,
					end_col: 1,
					signature: "function createLogger(name: string): Logger",
					doc_comment: "Creates a named logger instance",
					parent_symbol_id: null
				}
			]);

			const res = await fetch(`${baseUrl}/api/codebase/trace?name=createLogger&repo=test-owner/trace-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.symbol).toBeDefined();
			expect(body.symbol.name).toBe("createLogger");
			expect(body.symbol.kind).toBe("Function");
			expect(body.definition.file).toBe("src/utils/logger.ts");
		});
	});

	describe("index", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = createTempDir();
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/index`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repoPath: "/tmp/some-path" })
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns 400 when repoPath is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/index`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repo: "test/test" })
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO_PATH");
		});

		it("indexes a small TypeScript file in a temp directory", async () => {
			createTempTsFile(
				tmpDir,
				"src/index.ts",
				`export function hello(): string {
  return "world";
}
`
			);

			const res = await fetch(`${baseUrl}/api/codebase/index`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repo: "test-owner/index-test", repoPath: tmpDir })
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.success).toBe(true);
			expect(body.totalFiles).toBe(1);
			expect(body.totalSymbols).toBeGreaterThanOrEqual(1);
		});
	});

	describe("auto-index", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = createTempDir();
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/auto-index`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repoPath: "/tmp/some-path" })
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("indexes when no prior index exists", async () => {
			createTempTsFile(
				tmpDir,
				"src/main.ts",
				`export function bootstrap(): void {
  console.log("boot");
}
`
			);

			const res = await fetch(`${baseUrl}/api/codebase/auto-index`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repo: "test-owner/auto-index-test", repoPath: tmpDir })
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			// Controller returns { status, reason } from autoIndexIfStale
			expect(body.status).toBe("started");
			expect(body.reason).toBeDefined();
			expect(typeof body.reason).toBe("string");
		});

		it("returns status for an already-indexed repo", async () => {
			createTempTsFile(tmpDir, "src/app.ts", `export const VERSION = "1.0";\n`);

			// Pre-populate the index so auto-index detects existing files
			const { db } = await import("../../dashboard/lib/context");
			db.codebaseFiles.upsertFile({
				repo: "test-owner/auto-skip",
				file_path: "src/app.ts",
				language: "typescript",
				checksum: null,
				lines: 1,
				size_bytes: 30
			});

			const res = await fetch(`${baseUrl}/api/codebase/auto-index?threshold=0.0`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repo: "test-owner/auto-skip", repoPath: tmpDir })
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			// Controller returns { status, reason } from autoIndexIfStale
			expect(body.status).toBeDefined();
			expect(["started", "skipped"]).toContain(body.status);
			expect(body.reason).toBeDefined();
		});
	});

	describe("error handling", () => {
		it("returns structured error with code on bad request", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/architecture`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body).toHaveProperty("error");
			expect(body).toHaveProperty("code");
		});

		it("returns 404 for file not in index", async () => {
			// File not inserted → handler returns FILE_NOT_INDEXED
			const res = await fetch(`${baseUrl}/api/codebase/symbols?repo=test-owner/nonexist&filePath=src/nope.ts`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("FILE_NOT_INDEXED");
		});

		it("returns 404 for unknown symbol in trace", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/trace?name=TotallyMadeUpSymbol&repo=test-owner/nonexist`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("SYMBOL_NOT_FOUND");
		});

		it("returns 404 for POST to GET-only endpoint", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/architecture?repo=test/test`, {
				method: "POST"
			});
			// Express default: no POST route registered, returns default 404 HTML
			expect(res.status).toBe(404);
		});
	});
});
