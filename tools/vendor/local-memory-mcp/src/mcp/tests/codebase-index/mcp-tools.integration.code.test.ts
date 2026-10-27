import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import fs from "node:fs";
import path from "node:path";
import { data, setupIntegrationFixture } from "./mcp-tools.integration.shared.js";
import { registerRepo, clearWatchedRepos } from "../../codebase-index/services/file-watcher.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";

let store: SQLiteStore;
let vectors: VectorStore;
let tempDir: string;

beforeAll(async () => {
	const fixture = await setupIntegrationFixture();
	store = fixture.store;
	vectors = fixture.vectors;
	tempDir = fixture.tempDir;
});

afterAll(() => {
	store.close();
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("handleCodebaseRead (code mode)", () => {
	const CODE_REPO = "code-mode-test";
	const CODE_FILE = "code-fixture.ts";

	beforeAll(async () => {
		// Fixture file on disk, indexed with ACCURATE symbol spans so the
		// enrichment assertions are exact.
		const content =
			[
				"/**",
				" * Code search fixture.",
				" */",
				"export function greet(name: string): string {",
				"\treturn `Hello, ${name}!`;",
				"}",
				"",
				"export class Greeter {",
				"\tprivate name: string;",
				"",
				"\tconstructor(name: string) {",
				"\t\tthis.name = name;",
				"\t}",
				"",
				"\tpublic greet(): string {",
				"\t\treturn greet(this.name);",
				"\t}",
				"}"
			].join("\n") + "\n";
		fs.writeFileSync(path.join(tempDir, CODE_FILE), content, "utf-8");
		store.codebaseFiles.upsertFile({
			repo: CODE_REPO,
			file_path: CODE_FILE,
			language: "typescript",
			checksum: "code-fixture-sum",
			lines: content.split("\n").length,
			size_bytes: Buffer.byteLength(content, "utf-8")
		});
		store.codebaseSymbols.bulkUpsertSymbols([
			{
				repo: CODE_REPO,
				file_path: CODE_FILE,
				name: "greet",
				kind: "function",
				exported: true,
				start_line: 4,
				end_line: 6
			},
			{
				repo: CODE_REPO,
				file_path: CODE_FILE,
				name: "Greeter",
				kind: "class",
				exported: true,
				start_line: 8,
				end_line: 18
			}
		]);
	});

	it("greps indexed file contents with enclosing-symbol enrichment", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: CODE_REPO, content: "greet", repoPath: tempDir },
			store,
			vectors
		);
		const d = data(resp);

		expect(d.error).toBeUndefined();
		expect(d.mode).toBe("code");
		expect(d.content).toBe("greet");

		const matches = d.matches as Array<Record<string, unknown>>;
		// Lines 4 (fn decl), 8 ("Greeter"), 15 (method), 16 (call).
		expect(matches).toHaveLength(4);
		expect(d.total).toBe(4);
		expect(d.hasMore).toBe(false);
		expect(d.filesScanned).toBe(1);
		expect(d.indexedFiles).toBe(1);

		const byLine = new Map<number, Record<string, unknown>>(matches.map((m) => [m.line as number, m]));
		expect(byLine.get(4)!.enclosingSymbol).toEqual({
			name: "greet",
			kind: "function",
			startLine: 4,
			endLine: 6,
			docComment: null
		});
		expect(byLine.get(16)!.enclosingSymbol).toEqual({
			name: "Greeter",
			kind: "class",
			startLine: 8,
			endLine: 18,
			docComment: null
		});
		for (const m of matches) {
			expect(m.filePath).toBe(CODE_FILE);
			expect(m.language).toBe("typescript");
			expect(typeof m.snippet).toBe("string");
			expect((m.snippet as string).length).toBeGreaterThan(0);
			expect(typeof m.matchIndex).toBe("number");
			expect(m.line as number).toBeGreaterThan(0);
		}
	});

	it("respects the language filter (no files of that language → empty result)", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: CODE_REPO, content: "greet", language: "markdown", repoPath: tempDir },
			store,
			vectors
		);
		const d = data(resp);

		expect(d.error).toBeUndefined();
		expect(d.mode).toBe("code");
		expect(d.matches).toEqual([]);
		expect(d.total).toBe(0);
	});

	it("applies the code-mode default limit and pagination", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: CODE_REPO, content: "greet", limit: 2, repoPath: tempDir },
			store,
			vectors
		);
		const d = data(resp);

		expect(d.error).toBeUndefined();
		expect((d.matches as unknown[]).length).toBe(2);
		expect(d.limit).toBe(2);
		expect(d.hasMore).toBe(true);
	});

	it("empty content routes to architecture mode (empty string is not provided)", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: CODE_REPO, content: "", repoPath: tempDir },
			store,
			vectors
		);
		const d = data(resp);

		expect(d.mode).toBe("architecture");
		expect(d.summary).toBeDefined();
	});

	it("missing repoPath → REPO_PATH_REQUIRED", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: CODE_REPO, content: "greet" },
			store,
			vectors
		);
		const d = data(resp);

		expect(resp.isError).toBe(true);
		expect(d).toMatchObject({ schema: "tool-error", code: "REPO_PATH_REQUIRED", retryable: false });
	});

	it("non-existent repoPath → REPO_PATH_NOT_FOUND", async () => {
		const resp = await handleCodebaseRead(
			{
				owner: "vheins",
				json: true,
				repo: CODE_REPO,
				content: "greet",
				repoPath: path.join(tempDir, "does-not-exist")
			},
			store,
			vectors
		);
		const d = data(resp);

		expect(resp.isError).toBe(true);
		expect(d).toMatchObject({ schema: "tool-error", code: "REPO_PATH_NOT_FOUND", retryable: false });
	});

	it("unindexed repo → REPO_NOT_INDEXED", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: "never-indexed", content: "x", repoPath: tempDir },
			store,
			vectors
		);
		const d = data(resp);

		expect(resp.isError).toBe(true);
		expect(d).toMatchObject({ schema: "tool-error", code: "REPO_NOT_INDEXED", retryable: false });
	});

	it("subdirectory repoPath → REPO_PATH_NOT_ROOT (FIX-CODESEARCH-STORM)", async () => {
		const GUARD_REPO = "code-mode-root-guard";
		const subdir = path.join(tempDir, "search-test-fixture");
		registerRepo(GUARD_REPO, tempDir);
		try {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", json: true, repo: GUARD_REPO, content: "greet", repoPath: subdir },
				store,
				vectors
			);
			const d = data(resp);

			expect(resp.isError).toBe(true);
			expect(d).toMatchObject({ schema: "tool-error", code: "REPO_PATH_NOT_ROOT", retryable: false });
			expect((d.details as Record<string, unknown>).expected).toBe(tempDir);
		} finally {
			clearWatchedRepos();
		}
	});

	it("registered root repoPath passes the guard (no false positive)", async () => {
		const GUARD_REPO = "code-mode-root-ok";
		store.codebaseFiles.upsertFile({
			repo: GUARD_REPO,
			file_path: CODE_FILE,
			language: "typescript",
			checksum: "code-fixture-sum",
			lines: 1,
			size_bytes: 1
		});
		registerRepo(GUARD_REPO, tempDir);
		try {
			const resp = await handleCodebaseRead(
				{ owner: "vheins", json: true, repo: GUARD_REPO, content: "greet", repoPath: tempDir },
				store,
				vectors
			);
			const d = data(resp);

			expect(d.error).toBeUndefined();
			expect(d.mode).toBe("code");
		} finally {
			clearWatchedRepos();
		}
	});

	it("invalid regex → INVALID_REGEX", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, repo: CODE_REPO, content: "[", regex: true, repoPath: tempDir },
			store,
			vectors
		);
		const d = data(resp);

		expect(resp.isError).toBe(true);
		expect(d).toMatchObject({ schema: "tool-error", code: "INVALID_REGEX", retryable: false });
	});
});
