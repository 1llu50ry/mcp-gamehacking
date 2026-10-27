/**
 * Performance test — measures indexing time for a synthetic repo.
 *
 * Generates 1000 small .ts files, indexes them, and asserts the operation
 * completes under 10 seconds.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { createCodebaseIndexService } from "../../codebase-index/services/indexing-service";
import type { ParserPool, ParseResult } from "../../codebase-index/parser/language-visitor";
import { SymbolKind } from "../../codebase-index/parser/language-visitor";
import { createTestStore, SQLiteStore } from "../../storage/sqlite";

// ── Helpers ────────────────────────────────────────────────────────────

/** Generate N .ts files with varying symbol counts into a temp directory. */
function generateSyntheticRepo(root: string, fileCount: number): void {
	fs.mkdirSync(root, { recursive: true });

	for (let i = 0; i < fileCount; i++) {
		const dir = path.join(root, `dir-${Math.floor(i / 100)}`);
		fs.mkdirSync(dir, { recursive: true });

		const symbols = generateFileContent(i);
		fs.writeFileSync(path.join(dir, `file-${i}.ts`), symbols, "utf-8");
	}
}

/** Generate TypeScript source with multiple exported symbols. */
function generateFileContent(index: number): string {
	const lines: string[] = [];

	// 1-3 exported functions per file
	const fnCount = 1 + (index % 3);
	for (let j = 0; j < fnCount; j++) {
		const prefix = j === 0 ? "default" : "";
		lines.push(`/** Doc for fn${index}_${j} */`);
		lines.push(
			`export${prefix ? " default" : ""} function fn${index}_${j}(a: string, b: number): Promise<{ result: string }> {`
		);
		lines.push(`  const x = a.repeat(b);`);
		lines.push(`  return { result: x + "${index}_${j}" };`);
		lines.push(`}`);
		lines.push("");
	}

	// 0-1 exported interfaces
	if (index % 4 === 0) {
		lines.push(`export interface Config${index} {`);
		lines.push(`  readonly id: string;`);
		lines.push(`  readonly enabled: boolean;`);
		lines.push(`  readonly options: Record<string, unknown>;`);
		lines.push(`}`);
		lines.push("");
	}

	// 0-1 exported classes
	if (index % 5 === 0) {
		lines.push(`export class Service${index} {`);
		lines.push(`  private state: Map<string, string> = new Map();`);
		lines.push(`  public get(key: string): string | undefined {`);
		lines.push(`    return this.state.get(key);`);
		lines.push(`  }`);
		lines.push(`  public set(key: string, value: string): void {`);
		lines.push(`    this.state.set(key, value);`);
		lines.push(`  }`);
		lines.push(`}`);
	}

	return lines.join("\n");
}

/** A mock parser that returns realistic symbols without WASM dependency. */
function createFastMockParser(): ParserPool {
	return {
		async initialize(): Promise<void> {},
		isInitialized(): boolean {
			return true;
		},
		async parseFile(filePath: string, _sourceCode: string): Promise<ParseResult> {
			const basename = path.basename(filePath, ".ts"); // file-N
			const index = parseInt(basename.replace("file-", ""), 10) || 0;

			const symbols: ParseResult["symbols"] = [];

			const fnCount = 1 + (index % 3);
			for (let j = 0; j < fnCount; j++) {
				symbols.push({
					name: `fn${index}_${j}`,
					kind: SymbolKind.Function,
					startLine: 1,
					startCol: 1,
					endLine: 1,
					endCol: 1,
					signature: `fn${index}_${j}(a: string, b: number): Promise<{ result: string }>`,
					docComment: `Doc for fn${index}_${j}`,
					exported: j === 0,
					defaultExport: j === 0,
					parentName: null
				});
			}

			if (index % 4 === 0) {
				symbols.push({
					name: `Config${index}`,
					kind: SymbolKind.Interface,
					startLine: 1,
					startCol: 1,
					endLine: 1,
					endCol: 1,
					signature: `Config${index} { id: string; enabled: boolean; options: Record<string, unknown>; }`,
					docComment: null,
					exported: true,
					defaultExport: false,
					parentName: null
				});
			}

			if (index % 5 === 0) {
				symbols.push({
					name: `Service${index}`,
					kind: SymbolKind.Class,
					startLine: 1,
					startCol: 1,
					endLine: 1,
					endCol: 1,
					signature: `class Service${index}`,
					docComment: null,
					exported: true,
					defaultExport: false,
					parentName: null
				});
			}

			return {
				symbols,
				error: null,
				durationMs: 0
			};
		}
	};
}

// ── Test suite ─────────────────────────────────────────────────────────

describe("CodebaseIndexService — Performance", () => {
	const TARGET_FILE_COUNT = 1000;
	const MAX_DURATION_MS = 10_000; // 10 seconds

	let tempDir: string;
	let repoPath: string;
	let store: SQLiteStore;

	beforeAll(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-perf-"));
		repoPath = path.join(tempDir, "synthetic-repo");
		store = await createTestStore();
		generateSyntheticRepo(repoPath, TARGET_FILE_COUNT);
	}, 30_000); // 30s timeout for file generation

	afterAll(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it(
		`indexes ${TARGET_FILE_COUNT} .ts files in under ${MAX_DURATION_MS / 1000}s`,
		async () => {
			const parserPool = createFastMockParser();
			const service = createCodebaseIndexService(store, parserPool);

			const startTime = performance.now();
			const result = await service.indexRepository("test-repo", repoPath, {
				includeGlobs: ["**/*.ts"],
				batchSize: 100
			});
			const durationMs = Math.round(performance.now() - startTime);

			// ── Assertions ─────────────────────────────────────────────
			expect(result.success).toBe(true);
			expect(result.totalFiles).toBe(TARGET_FILE_COUNT);
			expect(result.parsedFiles).toBe(TARGET_FILE_COUNT);
			expect(result.failedFiles).toBe(0);

			// All files should have at least 1 symbol (function), more for files
			// with interfaces or classes
			expect(result.totalSymbols).toBeGreaterThanOrEqual(TARGET_FILE_COUNT);

			// Performance assertion
			expect(durationMs).toBeLessThan(MAX_DURATION_MS);

			console.log(
				`\n[Performance] Indexed ${TARGET_FILE_COUNT} files in ${durationMs}ms ` +
					`(${(durationMs / 1000).toFixed(1)}s) — ` +
					`${result.totalSymbols} symbols extracted ` +
					`(${(TARGET_FILE_COUNT / (durationMs / 1000)).toFixed(0)} files/sec)`
			);
		},
		MAX_DURATION_MS + 5_000
	); // Vitest timeout with buffer

	it(`re-indexes ${TARGET_FILE_COUNT} unchanged .ts files in under 1s (mtime delta fast-path)`, async () => {
		const parserPool = createFastMockParser();
		const service = createCodebaseIndexService(store, parserPool);

		// The repo is already fully indexed by the test above (1000 files).
		// Backdate every file's mtime to well before last_indexed_at so the
		// planner's mtime pre-filter proves content unchanged WITHOUT a read
		// (issue #60 — incremental indexing via mtime delta, fast-path).
		//
		// REL-051: a 60s margin (was 10s). The first index above is bounded by
		// MAX_DURATION_MS (10s), so the whole first pass finishes <10s after
		// "now"; backdating by 60s guarantees every file's mtime is strictly
		// BEFORE last_indexed_at even under heavy parallel load, which is what
		// the mtime fast-path (and the parsedFiles===0 assertion) depends on.
		const backdate = new Date(Date.now() - 60_000); // 60s before now (REL-051)
		for (let i = 0; i < TARGET_FILE_COUNT; i++) {
			const dir = path.join(repoPath, `dir-${Math.floor(i / 100)}`);
			fs.utimesSync(path.join(dir, `file-${i}.ts`), backdate, backdate);
		}

		const startTime = performance.now();
		const result = await service.indexRepository("test-repo", repoPath, {
			includeGlobs: ["**/*.ts"],
			batchSize: 100
		});
		const durationMs = Math.round(performance.now() - startTime);

		// ── Assertions ──
		expect(result.success).toBe(true);
		expect(result.totalFiles).toBe(TARGET_FILE_COUNT);
		// Incremental skip: ZERO files re-parsed, all taken via the mtime
		// fast-path (file mtime safely before last_indexed_at).
		expect(result.parsedFiles).toBe(0);
		expect(result.skippedFiles).toBe(TARGET_FILE_COUNT);
		expect(result.skippedByMtime).toBe(TARGET_FILE_COUNT);

		// AC4: a re-index of an unchanged repo must be near-instant (< 1s).
		expect(durationMs).toBeLessThan(1000);

		console.log(
			`\n[Performance] Re-indexed ${TARGET_FILE_COUNT} unchanged files in ${durationMs}ms ` +
				`(parsed=${result.parsedFiles}, mtime-skipped=${result.skippedByMtime})`
		);
	}, 10_000); // generous buffer; assert is durationMs < 1000
});
