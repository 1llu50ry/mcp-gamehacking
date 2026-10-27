import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { searchCodeInRepo, clearCodeSearchWarnDedup } from "../../codebase-index/services/code-search.js";
import { clearCodeSearchCache } from "../../codebase-index/services/code-search.js";
import { logger } from "../../utils/logger.js";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import { computeChecksum } from "../../codebase-index/services/indexing-cache.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const REPO_ROOT = "code-search-test";
let repoRoot: string;
let store: SQLiteStore;
let seq = 0;
beforeAll(async () => {
	store = await createTestStore();
	repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${REPO_ROOT}-`));
});
afterAll(() => {
	store.close();
	fs.rmSync(repoRoot, { recursive: true, force: true });
});
beforeEach(() => {
	clearCodeSearchCache();
});
function freshRepo(): string {
	seq += 1;
	return `${REPO_ROOT}-${seq}`;
}
function writeIndexedFile(
	repo: string,
	filePath: string,
	content: string,
	language = "typescript",
	checksum?: string
): void {
	const abs = path.join(repoRoot, filePath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf-8");
	store.codebaseFiles.upsertFile({
		repo,
		file_path: filePath,
		language,
		checksum: checksum ?? computeChecksum(content),
		lines: content.split("\n").length,
		size_bytes: Buffer.byteLength(content, "utf-8")
	});
}
function seedSymbol(
	repo: string,
	filePath: string,
	name: string,
	kind: string,
	startLine: number,
	endLine: number
): void {
	store.codebaseSymbols.bulkUpsertSymbols([
		{ repo, file_path: filePath, name, kind, start_line: startLine, end_line: endLine, exported: true }
	]);
}

describe("searchCodeInRepo", () => {
	it("greps indexed files and enriches matches with the enclosing symbol", async () => {
		const repo = freshRepo();
		const filePath = `${repo}/greet.ts`;
		writeIndexedFile(
			repo,
			filePath,
			[
				"export function greet(name: string): string {",
				"\treturn `Hi ${name}`;",
				"}",
				"",
				"export class Greeter {",
				"\tgreet(): string {",
				"\t\treturn greet('x');",
				"\t}",
				"}"
			].join("\n") + "\n"
		);
		seedSymbol(repo, filePath, "greet", "function", 1, 3);
		seedSymbol(repo, filePath, "Greeter", "class", 5, 9);

		const result = await searchCodeInRepo(store, repo, repoRoot, { needle: "greet", limit: 10, offset: 0 });

		expect(result.indexedFiles).toBe(1);
		expect(result.fileCount).toBe(1);
		expect(result.filesScanned).toBe(1);
		expect(result.matches.map((m) => m.line)).toEqual([1, 5, 6, 7]);
		expect(result.matches[0].enclosingSymbol).toEqual({
			name: "greet",
			kind: "function",
			startLine: 1,
			endLine: 3,
			docComment: null
		});
		// Lines 5 (class name) / 6 (method) / 7 (call) are inside the class.
		for (const m of result.matches.slice(1)) {
			expect(m.enclosingSymbol).toEqual({ name: "Greeter", kind: "class", startLine: 5, endLine: 9, docComment: null });
		}
		for (const m of result.matches) {
			expect(m.filePath).toBe(filePath);
			expect(m.language).toBe("typescript");
			// Substring mode is case-insensitive: line 5 'export class Greeter {'
			// matches "greet" via 'Greeter', so the containment check must be too.
			expect(m.snippet.toLowerCase()).toContain("greet");
			expect(m.matchIndex).toBeGreaterThanOrEqual(0);
		}
		expect(result.total).toBe(4);
		expect(result.hasMore).toBe(false);
	});

	it("language filter restricts the scan before any disk read", async () => {
		const repo = freshRepo();
		writeIndexedFile(repo, `${repo}/lang.ts`, "const marker = 1;\n", "typescript");
		writeIndexedFile(repo, `${repo}/lang.md`, "# marker\n", "markdown");

		const ts = await searchCodeInRepo(store, repo, repoRoot, {
			needle: "marker",
			language: "typescript",
			limit: 10,
			offset: 0
		});
		expect(ts.fileCount).toBe(1);
		expect(ts.matches.map((m) => m.filePath)).toEqual([`${repo}/lang.ts`]);

		const md = await searchCodeInRepo(store, repo, repoRoot, {
			needle: "marker",
			language: "markdown",
			limit: 10,
			offset: 0
		});
		expect(md.matches.map((m) => m.filePath)).toEqual([`${repo}/lang.md`]);

		// Language matching is case-insensitive.
		const upper = await searchCodeInRepo(store, repo, repoRoot, {
			needle: "marker",
			language: "TypeScript",
			limit: 10,
			offset: 0
		});
		expect(upper.fileCount).toBe(1);

		// No indexed files of that language → fileCount 0, empty result.
		const none = await searchCodeInRepo(store, repo, repoRoot, {
			needle: "marker",
			language: "rust",
			limit: 10,
			offset: 0
		});
		expect(none.fileCount).toBe(0);
		expect(none.matches).toEqual([]);
	});

	it("caps results at limit and honors offset pagination without overlap", async () => {
		const repo = freshRepo();
		writeIndexedFile(
			repo,
			`${repo}/cap.ts`,
			Array.from({ length: 10 }, (_, i) => `line ${i + 1} has needle here`).join("\n") + "\n"
		);

		const page1 = await searchCodeInRepo(store, repo, repoRoot, { needle: "needle", limit: 4, offset: 0 });
		expect(page1.matches).toHaveLength(4);
		expect(page1.total).toBeGreaterThanOrEqual(4);
		expect(page1.hasMore).toBe(true);

		const page2 = await searchCodeInRepo(store, repo, repoRoot, { needle: "needle", limit: 4, offset: 4 });
		expect(page2.matches).toHaveLength(4);

		const page1Lines = new Set(page1.matches.map((m) => m.line));
		for (const m of page2.matches) {
			expect(page1Lines.has(m.line)).toBe(false);
		}
	});

	it("empty needle is a no-op — never a full-file dump", async () => {
		const repo = freshRepo();
		writeIndexedFile(repo, `${repo}/empty.ts`, "any content at all\n");

		const result = await searchCodeInRepo(store, repo, repoRoot, { needle: "", limit: 10, offset: 0 });
		expect(result.matches).toEqual([]);
		expect(result.total).toBe(0);
		expect(result.filesScanned).toBe(0);
	});

	it("only greps indexed files — node_modules / untracked files on disk are excluded", async () => {
		const repo = freshRepo();
		// On disk but NOT in codebase_files:
		fs.mkdirSync(path.join(repoRoot, "node_modules", "pkg"), { recursive: true });
		fs.writeFileSync(path.join(repoRoot, "node_modules", "pkg", "lib.js"), "SECRET_TOKEN_LEAK\n", "utf-8");
		fs.writeFileSync(path.join(repoRoot, "untracked.ts"), "SECRET_TOKEN_LEAK\n", "utf-8");

		writeIndexedFile(repo, `${repo}/tracked.ts`, "SECRET_TOKEN_LEAK\n");

		const result = await searchCodeInRepo(store, repo, repoRoot, {
			needle: "SECRET_TOKEN_LEAK",
			limit: 10,
			offset: 0
		});
		expect(result.indexedFiles).toBe(1);
		expect(result.matches.map((m) => m.filePath)).toEqual([`${repo}/tracked.ts`]);
	});

	it("returns an empty result for a repo with no indexed files", async () => {
		const result = await searchCodeInRepo(store, freshRepo(), repoRoot, { needle: "x", limit: 10, offset: 0 });
		expect(result.indexedFiles).toBe(0);
		expect(result.fileCount).toBe(0);
		expect(result.matches).toEqual([]);
	});

	it("skips indexed rows whose file_path escapes the repo root (traversal guard)", async () => {
		const repo = freshRepo();
		// The row points OUTSIDE the repo root; the escape target contains the
		// needle — if the guard failed, the search would surface a match.
		const escapeName = `escape-${repo}.ts`;
		const sibling = path.join(repoRoot, "..", escapeName);
		fs.writeFileSync(sibling, "escape needle\n", "utf-8");
		store.codebaseFiles.upsertFile({
			repo,
			file_path: `../${escapeName}`,
			language: "typescript",
			checksum: "x"
		});
		try {
			const result = await searchCodeInRepo(store, repo, repoRoot, { needle: "escape", limit: 10, offset: 0 });
			expect(result.matches).toEqual([]);
			expect(result.filesScanned).toBe(0);
		} finally {
			fs.rmSync(sibling, { force: true });
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// SKIP-WARNING DEDUP (FIX-CODESEARCH-STORM)
// ═══════════════════════════════════════════════════════════════════════════

describe("skip-warning dedup (FIX-CODESEARCH-STORM)", () => {
	beforeEach(() => {
		clearCodeSearchWarnDedup();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		clearCodeSearchWarnDedup();
	});

	it("emits ONE warning for a repo-wide resolution failure, not one per file", async () => {
		const repo = freshRepo();
		// Three indexed rows whose files live under repoRoot…
		for (const name of ["a.ts", "b.ts", "c.ts"]) {
			writeIndexedFile(repo, `${repo}/${name}`, "needle here\n");
		}
		// …but the search runs against a DIFFERENT (empty) root, so every file
		// resolves to a non-existent path → each would warn without dedup.
		const wrongRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-search-wrong-"));
		const warnSpy = vi.spyOn(logger, "warn");
		try {
			const result = await searchCodeInRepo(store, repo, wrongRoot, { needle: "needle", limit: 10, offset: 0 });
			expect(result.matches).toEqual([]);
			expect(result.filesScanned).toBe(0);

			const skipWarnings = warnSpy.mock.calls.filter(([msg]) => String(msg).includes("Skipping unreadable indexed file"));
			expect(skipWarnings).toHaveLength(1);
		} finally {
			fs.rmSync(wrongRoot, { recursive: true, force: true });
		}
	});

	it("annotates the next emission with the suppressed count after the interval", async () => {
		const repo = freshRepo();
		for (const name of ["a.ts", "b.ts", "c.ts"]) {
			writeIndexedFile(repo, `${repo}/${name}`, "needle here\n");
		}
		const wrongRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-search-wrong2-"));
		const warnSpy = vi.spyOn(logger, "warn");
		const realNow = Date.now;
		try {
			let clock = realNow();
			vi.spyOn(Date, "now").mockImplementation(() => clock);

			// First call → one warning, 2 occurrences suppressed (3 files).
			await searchCodeInRepo(store, repo, wrongRoot, { needle: "needle", limit: 10, offset: 0 });
			expect(warnSpy).toHaveBeenCalledTimes(1);

			// Advance past the dedup interval → next call emits again, carrying
			// the count suppressed since the previous emission.
			clock += 61_000;
			await searchCodeInRepo(store, repo, wrongRoot, { needle: "needle", limit: 10, offset: 0 });
			expect(warnSpy).toHaveBeenCalledTimes(2);
			const secondContext = warnSpy.mock.calls[1][1] as Record<string, unknown>;
			expect(secondContext.suppressedSincePrevious).toBe(2);
		} finally {
			vi.spyOn(Date, "now").mockRestore();
			fs.rmSync(wrongRoot, { recursive: true, force: true });
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// CACHE — checksum-keyed validity
// ═══════════════════════════════════════════════════════════════════════════
