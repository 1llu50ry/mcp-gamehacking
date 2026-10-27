import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCodebaseIndexService } from "../../codebase-index/services/indexing-service.js";
import { IndexInProgressError } from "../../codebase-index/services/indexing-service.js";
import { clearIndexingRepos } from "../../codebase-index/services/indexing-service.js";

import type { IndexOptions } from "../../codebase-index/services/indexing-service.js";
import type { IndexResult } from "../../codebase-index/services/indexing-service.js";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { touch, createMockParserPool, type ParserPool } from "./indexing-service.shared.js";

describe("CodebaseIndexService", () => {
	let store: SQLiteStore;
	let tempDir: string;
	let parserPool: ParserPool;
	let repoDir: string;
	beforeEach(async () => {
		store = await createTestStore();
		parserPool = createMockParserPool();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-svc-"));
		repoDir = path.join(tempDir, "repo");
		fs.mkdirSync(repoDir, { recursive: true });
	});

	afterEach(() => {
		clearIndexingRepos();
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function service() {
		return createCodebaseIndexService(store, parserPool);
	}

	async function index(opts?: IndexOptions): Promise<IndexResult> {
		return service().indexRepository("test-repo", repoDir, opts);
	}

	it("full index: discovers, parses, stores files and symbols", async () => {
		touch(path.join(repoDir, "src", "main.ts"), "export function main() {}\n");
		touch(path.join(repoDir, "src", "utils.ts"), "export function util() {}\n");
		touch(path.join(repoDir, "lib", "helper.ts"), "export function helper() {}\n");

		const result = await index();

		expect(result.totalFiles).toBe(3);
		expect(result.parsedFiles).toBe(3);
		expect(result.skippedFiles).toBe(0);
		expect(result.failedFiles).toBe(0);
		expect(result.totalSymbols).toBe(3);
		expect(result.errors).toEqual([]);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.success).toBe(true);

		// Verify codebase_files records
		const files = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(files.length).toBe(3);
		const filePaths = files.map((f) => f.file_path);
		expect(filePaths).toContain("src/main.ts");
		expect(filePaths).toContain("src/utils.ts");
		expect(filePaths).toContain("lib/helper.ts");

		// Verify codebase_symbols records
		const mainSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "src/main.ts");
		expect(mainSymbols.length).toBe(1);
		expect(mainSymbols[0].name).toBe("main");
		expect(mainSymbols[0].kind).toBe("function");
		expect(mainSymbols[0].exported).toBe(true);

		// Verify checksum was stored
		expect(files[0].checksum).toBeTruthy();
		expect(files[0].checksum!.length).toBe(64); // SHA-256 hex
	});

	// ══════════════════════════════════════════════════════════════════
	// 2. Incremental index — unchanged files skipped
	// ══════════════════════════════════════════════════════════════════

	it("incremental index: unchanged files are skipped", async () => {
		touch(path.join(repoDir, "src", "a.ts"), "export const a = 1;\n");
		touch(path.join(repoDir, "src", "b.ts"), "export const b = 2;\n");

		const first = await index();
		expect(first.parsedFiles).toBe(2);

		const second = await index();
		expect(second.parsedFiles).toBe(0);
		expect(second.skippedFiles).toBe(2);
		expect(second.totalFiles).toBe(2);

		// Symbols should still exist
		const symbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "src/a.ts");
		expect(symbols.length).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 3. Checksum detection — modified file re-parsed
	// ══════════════════════════════════════════════════════════════════

	it("checksum detection: modified file is re-parsed, unchanged file skipped", async () => {
		touch(path.join(repoDir, "mod.ts"), "export const x = 1;\n");
		touch(path.join(repoDir, "keep.ts"), "export const y = 2;\n");

		await index();

		// Modify mod.ts
		fs.writeFileSync(path.join(repoDir, "mod.ts"), "export const x = 42;\n", "utf-8");

		const second = await index();
		expect(second.parsedFiles).toBe(1);
		expect(second.skippedFiles).toBe(1);
		expect(second.totalFiles).toBe(2);
	});

	// ══════════════════════════════════════════════════════════════════
	// 4. Force mode — re-parses all files
	// ══════════════════════════════════════════════════════════════════

	it("force mode: re-parses all files regardless of checksum", async () => {
		touch(path.join(repoDir, "one.ts"), "export const one = 1;\n");
		touch(path.join(repoDir, "two.ts"), "export const two = 2;\n");

		await index();

		const forced = await index({ force: true });
		expect(forced.parsedFiles).toBe(2);
		expect(forced.skippedFiles).toBe(0);
	});

	// ══════════════════════════════════════════════════════════════════
	// 5. Error handling — malformed file
	// ══════════════════════════════════════════════════════════════════

	it("error handling: malformed file records error but continues", async () => {
		touch(path.join(repoDir, "good.ts"), "export const good = 1;\n");
		touch(path.join(repoDir, "error.ts"), "broken syntax @@@\n");

		const result = await index();

		expect(result.totalFiles).toBe(2);
		expect(result.parsedFiles).toBe(1); // good.ts parsed
		expect(result.failedFiles).toBe(1); // error.ts failed
		expect(result.errors.length).toBe(1);
		expect(result.errors[0].filePath).toBe("error.ts");
		expect(result.success).toBe(false);

		// good.ts still stored
		const goodSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "good.ts");
		expect(goodSymbols.length).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 6. Empty repo
	// ══════════════════════════════════════════════════════════════════

	it("empty repo: returns zero counts", async () => {
		const result = await index();

		expect(result.totalFiles).toBe(0);
		expect(result.parsedFiles).toBe(0);
		expect(result.skippedFiles).toBe(0);
		expect(result.failedFiles).toBe(0);
		expect(result.totalSymbols).toBe(0);
		expect(result.errors).toEqual([]);
		expect(result.success).toBe(true);

		const files = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(files).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// 7. Concurrent prevention
	// ══════════════════════════════════════════════════════════════════

	it("concurrent prevention: throws IndexInProgressError on simultaneous call", async () => {
		// Create ONE service instance (not a factory) so both calls share the same indexingRepos set
		const slowPool = createMockParserPool({ delayMs: 500 });
		const svc = createCodebaseIndexService(store, slowPool);

		touch(path.join(repoDir, "slow.ts"), "export const s = 1;\n");

		// First call — starts indexing and grabs the locking set
		const firstPromise = svc.indexRepository("test-repo", repoDir);
		// Allow the microtask queue to flush so the synchronous set.add runs
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Second call — should throw immediately (same service instance)
		await expect(svc.indexRepository("test-repo", repoDir)).rejects.toThrow(IndexInProgressError);

		// First call should still complete successfully
		const first = await firstPromise;
		expect(first.success).toBe(true);
	});

	it("concurrent prevention: subsequent call after completion works", async () => {
		touch(path.join(repoDir, "a.ts"), "export const a = 1;\n");

		await index();

		touch(path.join(repoDir, "b.ts"), "export const b = 2;\n");
		const second = await index();
		expect(second.parsedFiles).toBe(1); // only new file
	});

	// ══════════════════════════════════════════════════════════════════
	// 8. Staleness check
	// ══════════════════════════════════════════════════════════════════

	it("checkStaleness: returns not stale when nothing indexed (empty index)", async () => {
		touch(path.join(repoDir, "src", "index.ts"), "export const x = 1;\n");

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(false);
		expect(s.staleFiles).toBe(0);
		expect(s.totalFiles).toBe(0);
		expect(s.staleRatio).toBe(0);
		expect(s.lastIndexedAt).toBeNull();
	});

	it("checkStaleness: returns not stale after indexing", async () => {
		touch(path.join(repoDir, "src", "index.ts"), "export const x = 1;\n");

		await index();

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(false);
		expect(s.staleFiles).toBe(0);
		expect(s.staleRatio).toBe(0);
		expect(s.lastIndexedAt).toBeTruthy();
	});

	it("checkStaleness: detects modified file as stale", async () => {
		touch(path.join(repoDir, "mod.ts"), "export const orig = 1;\n");

		await index();

		// Small delay to ensure mtime differs from last_indexed_at timestamp
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Modify file
		fs.writeFileSync(path.join(repoDir, "mod.ts"), "export const changed = 2;\n", "utf-8");

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(true);
		expect(s.staleFiles).toBe(1);
	});

	it("checkStaleness: coarse-granularity fs — modified file with clamped mtime is still stale (checksum confirmation)", async () => {
		touch(path.join(repoDir, "amb.ts"), "export const original = 1;\n");

		await index();

		const file = store.codebaseFiles.getFile("test-repo", "amb.ts");
		const indexedMs = new Date(file!.last_indexed_at!).getTime();

		// Content changes, but the mtime is clamped to just BEFORE
		// last_indexed_at — exactly what a coarse-granularity fs (ext3 1s /
		// FAT 2s) reports for a file modified shortly after indexing. The raw
		// `mtime > indexedTime` comparison alone would classify it fresh
		// (false-negative — TASK-055); the ambiguous-window checksum
		// confirmation must still flag it stale.
		fs.writeFileSync(path.join(repoDir, "amb.ts"), "export const changed = 2;\n", "utf-8");
		const clamped = new Date(indexedMs - 100);
		fs.utimesSync(path.join(repoDir, "amb.ts"), clamped, clamped);

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(true);
		expect(s.staleFiles).toBe(1);
	});

	it("checkStaleness: ambiguous mtime with unchanged content is NOT stale (no fresh-index false positive)", async () => {
		touch(path.join(repoDir, "fresh.ts"), "export const x = 1;\n");

		await index();

		const file = store.codebaseFiles.getFile("test-repo", "fresh.ts");
		const indexedMs = new Date(file!.last_indexed_at!).getTime();

		// Same content, mtime clamped inside the ambiguity window (mimics a
		// coarse-granularity fs): the checksum confirmation must prove the
		// file unchanged → not stale. Guards against the false-positive mode
		// where a naive margin on the raw comparison flags a just-indexed
		// repo as 100% stale (no checksum backstop there).
		const clamped = new Date(indexedMs - 100);
		fs.utimesSync(path.join(repoDir, "fresh.ts"), clamped, clamped);

		const s = await service().checkStaleness("test-repo", repoDir);
		expect(s.stale).toBe(false);
		expect(s.staleFiles).toBe(0);
	});

	it("checkStaleness: respects 5 percent threshold for stale flag", async () => {
		// Create 20 files — 5% = 1 file
		for (let i = 0; i < 20; i++) {
			touch(path.join(repoDir, `s${i}.ts`), `export const s${i} = ${i};\n`);
		}

		await index();

		// No changes — not stale
		const s1 = await service().checkStaleness("test-repo", repoDir);
		expect(s1.stale).toBe(false);
		expect(s1.staleFiles).toBe(0);
		expect(s1.staleRatio).toBe(0);

		// Modify 1 file (exactly 5%) — should trigger stale
		fs.writeFileSync(path.join(repoDir, "s0.ts"), "export const s0 = 999;\n", "utf-8");

		const s2 = await service().checkStaleness("test-repo", repoDir);
		expect(s2.stale).toBe(true);
		expect(s2.staleFiles).toBe(1);
		expect(s2.staleRatio).toBe(0.05);
	});

	// ══════════════════════════════════════════════════════════════════
	// 9. getIndexStatus
	// ══════════════════════════════════════════════════════════════════

	it("getIndexStatus: returns correct status after indexing", async () => {
		touch(path.join(repoDir, "status.ts"), "export const s = 1;\n");

		await index();

		const status = await service().getIndexStatus("test-repo");
		expect(status.repo).toBe("test-repo");
		expect(status.isIndexed).toBe(true);
		expect(status.isIndexing).toBe(false);
		expect(status.totalFiles).toBe(1);
		expect(status.totalSymbols).toBe(1);
		expect(status.lastIndexedAt).toBeTruthy();
		expect(status.progress).toBeNull();
	});
});
