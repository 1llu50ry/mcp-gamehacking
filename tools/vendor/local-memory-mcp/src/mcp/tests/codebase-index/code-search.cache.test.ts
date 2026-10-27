import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { searchCodeInRepo } from "../../codebase-index/services/code-search.js";
import { codeSearchCache } from "../../codebase-index/services/code-search.js";
import { clearCodeSearchCache } from "../../codebase-index/services/code-search.js";
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

describe("codeSearchCache", () => {
	it("serves cached content while the row checksum is unchanged (index = source of truth)", async () => {
		const repo = freshRepo();
		const filePath = `${repo}/cache-a.ts`;
		writeIndexedFile(repo, filePath, "alpha one\nalpha two\n", "typescript", "sum-v1");

		const first = await searchCodeInRepo(store, repo, repoRoot, { needle: "alpha", limit: 10, offset: 0 });
		expect(first.total).toBe(2);
		expect(codeSearchCache.size).toBe(1);

		// Disk edited WITHOUT a re-index → row checksum unchanged → the cached
		// indexed snapshot is served (content always matches the symbol index).
		fs.writeFileSync(path.join(repoRoot, filePath), "beta one\n", "utf-8");
		const snapshot = await searchCodeInRepo(store, repo, repoRoot, { needle: "alpha", limit: 10, offset: 0 });
		expect(snapshot.total).toBe(2);
	});

	it("invalidates and reloads when the row checksum changes (re-index)", async () => {
		const repo = freshRepo();
		const filePath = `${repo}/cache-b.ts`;
		writeIndexedFile(repo, filePath, "alpha one\n", "typescript", "sum-v1");

		let result = await searchCodeInRepo(store, repo, repoRoot, { needle: "alpha", limit: 10, offset: 0 });
		expect(result.total).toBe(1);

		// Simulate re-index of the changed file: new disk content + row upsert
		// with a new checksum (the real writeParseBatch path).
		fs.writeFileSync(path.join(repoRoot, filePath), "beta one\n", "utf-8");
		store.codebaseFiles.upsertFile({
			repo,
			file_path: filePath,
			language: "typescript",
			checksum: "sum-v2",
			lines: 1,
			size_bytes: Buffer.byteLength("beta one\n", "utf-8")
		});

		result = await searchCodeInRepo(store, repo, repoRoot, { needle: "beta", limit: 10, offset: 0 });
		expect(result.total).toBe(1);
		expect(result.matches[0].line).toBe(1);

		result = await searchCodeInRepo(store, repo, repoRoot, { needle: "alpha", limit: 10, offset: 0 });
		expect(result.total).toBe(0);
	});

	it("keeps distinct cache entries per repo (shared cache, no cross-talk)", async () => {
		const repoA = freshRepo();
		const repoB = freshRepo();
		writeIndexedFile(repoA, `${repoA}/same.ts`, "AAA_CONTENT\n", "typescript", "a1");
		writeIndexedFile(repoB, `${repoB}/same.ts`, "BBB_CONTENT\n", "typescript", "b1");

		const a = await searchCodeInRepo(store, repoA, repoRoot, { needle: "AAA_CONTENT", limit: 10, offset: 0 });
		expect(a.total).toBe(1);

		const b = await searchCodeInRepo(store, repoB, repoRoot, { needle: "BBB_CONTENT", limit: 10, offset: 0 });
		expect(b.total).toBe(1);
		expect(codeSearchCache.size).toBe(2);
	});

	// ── Concurrent access (TASK-343 regression) ─────────────────────────────
	// All prior cache tests run sequentially, so totalBytes accounting could
	// only ever be exercised by one caller per key at a time. These tests fire
	// N simultaneous getContent calls for the SAME key: every caller shares the
	// single-flight read and must NOT re-account the entry on the way back.

	it("concurrent miss: N simultaneous getContent calls account the entry exactly once", async () => {
		const repo = freshRepo();
		const filePath = `${repo}/concurrent-miss.ts`;
		const content = "alpha one\nalpha two\n";
		const absolutePath = path.join(repoRoot, filePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, content, "utf-8");

		const results = await Promise.all(
			Array.from({ length: 8 }, () => codeSearchCache.getContent(repo, filePath, "sum-v1", absolutePath))
		);

		expect(results).toEqual(Array(8).fill(content));
		expect(codeSearchCache.size).toBe(1);
		// Pre-fix: every caller ran the insert path → totalBytes inflated 8×.
		expect(codeSearchCache.bytes).toBe(Buffer.byteLength(content, "utf-8"));
	});

	it("concurrent stale reload: checksum change while reads are in flight re-accounts exactly once", async () => {
		const repo = freshRepo();
		const filePath = `${repo}/concurrent-stale.ts`;
		const oldContent = "old content, short\n";
		const newContent = "new content, significantly longer so the byte delta is nonzero\n";
		const absolutePath = path.join(repoRoot, filePath);
		fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
		fs.writeFileSync(absolutePath, oldContent, "utf-8");

		// Populate the cache under checksum v1 (stale entry).
		await codeSearchCache.getContent(repo, filePath, "sum-v1", absolutePath);
		expect(codeSearchCache.bytes).toBe(Buffer.byteLength(oldContent, "utf-8"));

		// Simulate re-index: disk content grows AND the row checksum changes.
		fs.writeFileSync(absolutePath, newContent, "utf-8");

		const results = await Promise.all(
			Array.from({ length: 8 }, () => codeSearchCache.getContent(repo, filePath, "sum-v2", absolutePath))
		);

		expect(results).toEqual(Array(8).fill(newContent));
		expect(codeSearchCache.size).toBe(1);
		// Pre-fix: every caller subtracted the stale snapshot → totalBytes
		// under-counted (8×new − 7×old). Must reflect exactly the one entry.
		expect(codeSearchCache.bytes).toBe(Buffer.byteLength(newContent, "utf-8"));
	});
});
