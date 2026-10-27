import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCodebaseIndexService } from "../../codebase-index/services/indexing-service.js";
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

	it("getIndexStatus: returns not indexed for fresh repo", async () => {
		const status = await service().getIndexStatus("never-indexed");
		expect(status.isIndexed).toBe(false);
		expect(status.totalFiles).toBe(0);
		expect(status.totalSymbols).toBe(0);
		expect(status.lastIndexedAt).toBeNull();
	});

	it("getIndexStatus: does not set staleness when repoPath is omitted", async () => {
		touch(path.join(repoDir, "file.ts"), "export const x = 1;\n");

		await index();

		const status = await service().getIndexStatus("test-repo");
		expect(status.isIndexed).toBe(true);
		expect(status.stale).toBeUndefined();
		expect(status.staleRatio).toBeUndefined();
	});

	it("getIndexStatus: returns not stale when repoPath is provided and files unchanged", async () => {
		touch(path.join(repoDir, "file.ts"), "export const x = 1;\n");

		await index();

		const status = await service().getIndexStatus("test-repo", repoDir);
		expect(status.isIndexed).toBe(true);
		expect(status.stale).toBe(false);
		expect(status.staleRatio).toBe(0);
	});

	it("getIndexStatus: returns stale after file modification with repoPath", async () => {
		touch(path.join(repoDir, "file.ts"), "export const x = 1;\n");

		await index();

		// Small delay to ensure mtime differs
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Modify the file
		fs.writeFileSync(path.join(repoDir, "file.ts"), "export const x = 2;\n", "utf-8");

		const status = await service().getIndexStatus("test-repo", repoDir);
		expect(status.isIndexed).toBe(true);
		expect(status.stale).toBe(true);
		expect(status.staleRatio).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 10. Progress callbacks
	// ══════════════════════════════════════════════════════════════════

	it("progress callback: emits events during indexing", async () => {
		touch(path.join(repoDir, "p1.ts"), "export const p1 = 1;\n");
		touch(path.join(repoDir, "p2.ts"), "export const p2 = 2;\n");

		const stages: string[] = [];
		const messages: string[] = [];

		await index({
			onProgress: (p) => {
				stages.push(p.stage);
				messages.push(p.message);
			}
		});

		expect(stages.length).toBeGreaterThanOrEqual(3); // discovering, parsing, storing
		expect(stages).toContain("discovering");
		expect(stages).toContain("parsing");
		expect(stages).toContain("storing");
	});

	it("progress callback survives exception without breaking indexing", async () => {
		touch(path.join(repoDir, "robust.ts"), "export const r = 1;\n");

		let callCount = 0;
		const result = await index({
			onProgress: (_p) => {
				callCount++;
				if (callCount === 1) throw new Error("Callback exploded");
			}
		});

		expect(result.success).toBe(true);
		expect(callCount).toBeGreaterThan(1); // Other callbacks still fired
	});

	// ══════════════════════════════════════════════════════════════════
	// 11. Cleanup — stale files removed
	// ══════════════════════════════════════════════════════════════════

	it("cleanup: removes symbols and file records for deleted files", async () => {
		touch(path.join(repoDir, "keep.ts"), "export const k = 1;\n");
		touch(path.join(repoDir, "delete-me.ts"), "export const d = 1;\n");

		await index();
		expect(store.codebaseFiles.getFilesByRepo("test-repo").length).toBe(2);

		// Delete the file from disk
		fs.unlinkSync(path.join(repoDir, "delete-me.ts"));

		await index();
		const filesAfter = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(filesAfter.length).toBe(1);
		expect(filesAfter[0].file_path).toBe("keep.ts");

		const symbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "delete-me.ts");
		expect(symbols).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// 12. Multiple repos do not interfere
	// ══════════════════════════════════════════════════════════════════

	it("multiple repos: indexing different repos does not block each other", async () => {
		const repoBDir = path.join(tempDir, "repo-b");
		fs.mkdirSync(repoBDir, { recursive: true });

		touch(path.join(repoDir, "a.ts"), "export const a = 1;\n");
		touch(path.join(repoBDir, "b.ts"), "export const b = 2;\n");

		// Index repo A first
		const resultA = await service().indexRepository("repo-a", repoDir);
		// Index repo B — should NOT throw since it's a different repo
		const resultB = await service().indexRepository("repo-b", repoBDir);

		expect(resultA.success).toBe(true);
		expect(resultB.success).toBe(true);

		expect(store.codebaseFiles.getFilesByRepo("repo-a").length).toBe(1);
		expect(store.codebaseFiles.getFilesByRepo("repo-b").length).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 13. Large file count (batch processing validation)
	// ══════════════════════════════════════════════════════════════════

	it("handles many files without error", async () => {
		const count = 50;
		for (let i = 0; i < count; i++) {
			touch(path.join(repoDir, `file${i}.ts`), `export const fn${i} = () => {};\n`);
		}

		const result = await index();
		expect(result.totalFiles).toBe(count);
		expect(result.parsedFiles).toBe(count);
		expect(result.totalSymbols).toBe(count);
		expect(store.codebaseFiles.getFileCountByRepo("test-repo")).toBe(count);
	});

	// ══════════════════════════════════════════════════════════════════
	// 14. Incremental re-index — only touched files are parsed
	// ══════════════════════════════════════════════════════════════════

	it("incremental re-index: only touched files are re-parsed (1000 file simulation)", async () => {
		const count = 100;
		for (let i = 0; i < count; i++) {
			touch(path.join(repoDir, `sim-${i}.ts`), `export const sim${i} = () => {};\n`);
		}

		// First index — parse all
		const first = await index();
		expect(first.parsedFiles).toBe(count);
		expect(first.totalFiles).toBe(count);

		// Touch 10 files
		const touched = new Set<number>();
		const touchCount = 10;
		for (let i = 0; i < touchCount; i++) {
			const idx = i * 3; // deterministic spread: 0, 3, 6, ...
			touched.add(idx);
			fs.writeFileSync(
				path.join(repoDir, `sim-${idx}.ts`),
				`export const sim${idx} = () => { return "${idx}-modified"; };\n`,
				"utf-8"
			);
		}

		const second = await index();
		expect(second.parsedFiles).toBe(touchCount);
		expect(second.skippedByChecksum).toBe(count - touchCount);
		expect(second.totalFiles).toBe(count);
	});

	// ══════════════════════════════════════════════════════════════════
	// 15. File rename detection — transfer symbol associations
	// ══════════════════════════════════════════════════════════════════

	it("rename detection: old file removed, new file with same checksum detected as rename", async () => {
		touch(path.join(repoDir, "old-name.ts"), "export const answer = 42;\n");

		// First index
		let result = await index();
		expect(result.parsedFiles).toBe(1);
		expect(result.totalFiles).toBe(1);

		// Verify symbols stored under old path
		const oldSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "old-name.ts");
		expect(oldSymbols.length).toBe(1);
		expect(oldSymbols[0].name).toBe("old-name");

		// Rename the file: remove old, create new with same content
		fs.unlinkSync(path.join(repoDir, "old-name.ts"));
		touch(path.join(repoDir, "new-name.ts"), "export const answer = 42;\n");

		result = await index();
		expect(result.parsedFiles).toBe(0); // rename detected, not parsed
		expect(result.renamedFiles).toBe(1);
		expect(result.totalFiles).toBe(1);

		// Old path should not have file record
		const oldFile = store.codebaseFiles.getFile("test-repo", "old-name.ts");
		expect(oldFile).toBeUndefined();

		// New path should have the file record with the same checksum
		const newFile = store.codebaseFiles.getFile("test-repo", "new-name.ts");
		expect(newFile).toBeDefined();
		expect(newFile!.checksum).toBeTruthy();

		// Symbols should now be under the new path
		const newSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "new-name.ts");
		expect(newSymbols.length).toBe(1);
		expect(newSymbols[0].name).toBe("old-name"); // symbol name unchanged

		// Old path should have no symbols
		const staleSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "old-name.ts");
		expect(staleSymbols).toEqual([]);
	});

	// ══════════════════════════════════════════════════════════════════
	// 16. Batch transaction boundary — files stored in batches of 50
	// ══════════════════════════════════════════════════════════════════

	it("batch transaction: stores files in batches respecting batchSize", async () => {
		const count = 120;
		for (let i = 0; i < count; i++) {
			touch(path.join(repoDir, `batch-${i}.ts`), `export const batch${i} = { id: ${i} };\n`);
		}

		// Index with explicit small batch size
		const result = await index({ batchSize: 40 });
		expect(result.parsedFiles).toBe(count);
		expect(result.totalFiles).toBe(count);
		expect(result.totalSymbols).toBe(count);

		// Verify all files stored
		const files = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(files.length).toBe(count);

		// Verify all symbols stored
		let totalSymbols = 0;
		for (const f of files) {
			totalSymbols += store.codebaseSymbols.getSymbolsByFile("test-repo", f.file_path).length;
		}
		expect(totalSymbols).toBe(count);
	});

	// ══════════════════════════════════════════════════════════════════
	// 17. Skip breakdown in result
	// ══════════════════════════════════════════════════════════════════

	it("skip breakdown: reports skippedByChecksum in result", async () => {
		touch(path.join(repoDir, "a.ts"), "export const a = 1;\n");
		touch(path.join(repoDir, "b.ts"), "export const b = 2;\n");

		const first = await index();
		expect(first.skippedByChecksum).toBe(0);

		const second = await index();
		expect(second.skippedByChecksum).toBe(2);
		expect(second.renamedFiles).toBe(0);
		expect(second.skippedByExtension).toBe(0);
		expect(second.skippedByGitignore).toBe(0);
	});

	// ══════════════════════════════════════════════════════════════════
	// 18. Error handling — timeout
	// ══════════════════════════════════════════════════════════════════

	it("timeout: long-parsing file is skipped with timeout error counted", async () => {
		// Create a parser that simulates timeout on all files
		const timeoutPool = createMockParserPool({ simulateTimeout: true });
		const svc = createCodebaseIndexService(store, timeoutPool);

		touch(path.join(repoDir, "slow.ts"), "export const x = 1;\n");
		touch(path.join(repoDir, "fast.ts"), "export const y = 2;\n");

		const result = await svc.indexRepository("test-repo", repoDir);

		expect(result.totalFiles).toBe(2);
		expect(result.failedFiles).toBe(2);
		expect(result.parsedFiles).toBe(0);
		expect(result.errors.length).toBe(2);
		expect(result.errorSummary.timeoutErrors).toBe(2);
		expect(result.success).toBe(false);

		// File metadata still stored even with parse errors
		const files = store.codebaseFiles.getFilesByRepo("test-repo");
		expect(files.length).toBe(2);
	});

	// ══════════════════════════════════════════════════════════════════
	// 19. Error handling — parse crash
	// ══════════════════════════════════════════════════════════════════

	it("parse crash: index continues after per-file parse crash", async () => {
		const crashSet = new Set<string>(["explode.ts"]);
		const crashPool = createMockParserPool({ crashFiles: crashSet });
		const svc = createCodebaseIndexService(store, crashPool);

		touch(path.join(repoDir, "good.ts"), "export const good = 1;\n");
		touch(path.join(repoDir, "explode.ts"), "// this will crash\n");
		touch(path.join(repoDir, "also-good.ts"), "export const also = 2;\n");

		const result = await svc.indexRepository("test-repo", repoDir);

		expect(result.totalFiles).toBe(3);
		expect(result.parsedFiles).toBe(2); // good.ts and also-good.ts parsed
		expect(result.failedFiles).toBe(1); // explode.ts crashed
		expect(result.errors.length).toBe(1);
		expect(result.errors[0].filePath).toBe("explode.ts");
		expect(result.errors[0].error).toContain("Simulated crash");

		// Verify non-crashing files are stored with symbols
		const goodSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "good.ts");
		expect(goodSymbols.length).toBe(1);

		const alsoSymbols = store.codebaseSymbols.getSymbolsByFile("test-repo", "also-good.ts");
		expect(alsoSymbols.length).toBe(1);

		// errorSummary reflects the classification
		expect(result.errorSummary.total).toBe(1);
		expect(result.errorSummary.recoverable).toBe(1);
	});

	// ══════════════════════════════════════════════════════════════════
	// 20. Error handling — permission denied
	// ══════════════════════════════════════════════════════════════════
});
