/**
 * Codebase API Integration Tests — file-content module.
 *
 * Split from codebase-api.integration.test.ts (TASK-428). The shared
 * `vi.mock("../../dashboard/lib/context", ...)` and helpers live in
 * ./codebase-api.shared; the index/metadata/search and symbols/graph modules
 * live in their own files. Tests run against an in-memory SQLiteStore.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { createTempDir, createTempTsFile, startCodebaseServer } from "./codebase-api.shared";

describe("Codebase API: file-content", () => {
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

	describe("file-content", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = createTempDir();
		});

		afterEach(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/file/content?path=src/main.ts`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO");
		});

		it("returns 400 when path is missing", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/file/content?repo=test-owner/x`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_FILE_PATH");
		});

		it("returns 400 when repoPath cannot be resolved", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/file/content?repo=test-owner/no-such-dir&path=src/main.ts`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("MISSING_REPO_PATH");
		});

		it("serves an indexed file from disk through the shared cache", async () => {
			const content = `export function hello(): string {\n  return "world";\n}\n`;
			createTempTsFile(tmpDir, "src/index.ts", content);

			const { db } = await import("../../dashboard/lib/context");
			db.codebaseFiles.upsertFile({
				repo: "fc-repo",
				file_path: "src/index.ts",
				language: "typescript",
				checksum: "fc123",
				lines: 3,
				size_bytes: 60
			});

			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-repo&path=src/index.ts&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.file_path).toBe("src/index.ts");
			expect(body.language).toBe("typescript");
			// Same convention as the index's countLines (1 + # of \n).
			expect(body.lines).toBe(content.split(/\r?\n/).length);
			expect(body.size_bytes).toBe(Buffer.byteLength(content, "utf-8"));
			expect(body.content).toContain('return "world"');
			expect(body.truncated).toBe(false);
		});

		it("serves a non-indexed file with extension-derived language", async () => {
			const content = `# Notes\n\nSome markdown for the FileViewer.\n`;
			createTempTsFile(tmpDir, "docs/notes.md", content);

			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-raw&path=docs/notes.md&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.file_path).toBe("docs/notes.md");
			expect(body.language).toBe("markdown");
			expect(body.content).toContain("# Notes");
			expect(body.truncated).toBe(false);
		});

		it("accepts POST with body params", async () => {
			createTempTsFile(tmpDir, "src/post.ts", `export const V = 1;\n`);

			const res = await fetch(`${baseUrl}/api/codebase/file/content`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ repo: "test-owner/fc-post", path: "src/post.ts", repoPath: tmpDir })
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.file_path).toBe("src/post.ts");
			expect(body.content).toContain("export const V");
		});

		it("truncates content beyond the line cap", async () => {
			// FILE_CONTENT_MAX_LINES is overridden to 10 for this file. No
			// trailing newline so the fixture is exactly 25 lines.
			const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
			createTempTsFile(tmpDir, "src/long.ts", lines.join("\n"));

			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-long&path=src/long.ts&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.lines).toBe(25);
			expect(body.truncated).toBe(true);
			expect(body.content.split("\n")).toHaveLength(10);
		});

		it("returns 404 for a file missing on disk", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-missing&path=src/nope.ts&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("FILE_NOT_FOUND");
		});

		it("rejects path traversal (relative escape)", async () => {
			createTempTsFile(tmpDir, "src/ok.ts", `const a = 1;\n`);
			// ../../etc/passwd resolves outside tmpDir → path traversal.
			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-trav&path=../../etc/passwd&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("PATH_TRAVERSAL");
		});

		it("rejects path traversal (absolute path)", async () => {
			const res = await fetch(
				`${baseUrl}/api/codebase/file/content?repo=test-owner/fc-abs&path=/etc/passwd&repoPath=${tmpDir}`
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.code).toBe("PATH_TRAVERSAL");
		});
	});
});
