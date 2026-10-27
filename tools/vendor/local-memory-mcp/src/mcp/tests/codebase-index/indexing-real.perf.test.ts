import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createCodebaseIndexService } from "../../codebase-index/services/indexing-service.js";
import { TreeSitterParserPool } from "../../codebase-index/parser/parser-pool.js";
import type { ParserPool, ParseResult } from "../../codebase-index/parser/language-visitor.js";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";

interface BenchmarkMetrics {
	fileCount: number;
	phase: "initial" | "incremental";
	changedFiles: number;
	unchangedFiles: number;
	parseCount: number;
	durationMs: number;
	cpuUserMs: number;
	cpuSystemMs: number;
	heapUsedBytes: number;
	rssBytes: number;
	parsedFiles: number;
	skippedFiles: number;
	totalSymbols: number;
}

const fileCounts = [1000, 10000] as const;

function generateSource(index: number): string {
	return [
		`export function benchmarkFunction${index}(value: string): string {`,
		`\treturn value + "${index}";`,
		`}`,
		`export interface BenchmarkConfig${index} { value: string; }`,
		""
	].join("\n");
}

function generateSyntheticRepo(root: string, fileCount: number): void {
	for (let index = 0; index < fileCount; index++) {
		const directory = path.join(root, `dir-${Math.floor(index / 100)}`);
		fs.mkdirSync(directory, { recursive: true });
		fs.writeFileSync(path.join(directory, `file-${index}.ts`), generateSource(index), "utf8");
	}
}

function createCountingParserPool(delegate: ParserPool, onParse: () => void): ParserPool {
	return {
		initialize: () => delegate.initialize(),
		isInitialized: () => delegate.isInitialized(),
		async parseFile(filePath: string, sourceCode: string): Promise<ParseResult> {
			onParse();
			return delegate.parseFile(filePath, sourceCode);
		}
	};
}

function measure<T>(
	fileCount: number,
	phase: BenchmarkMetrics["phase"],
	changedFiles: number,
	action: () => Promise<T>
): Promise<{ value: T; metrics: Omit<BenchmarkMetrics, "parsedFiles" | "skippedFiles" | "totalSymbols"> }> {
	const cpuBefore = process.cpuUsage();
	const memoryBefore = process.memoryUsage();
	const start = performance.now();
	return action().then((value) => {
		const cpu = process.cpuUsage(cpuBefore);
		const memory = process.memoryUsage();
		return {
			value,
			metrics: {
				fileCount,
				phase,
				changedFiles,
				unchangedFiles: fileCount - changedFiles,
				parseCount: 0,
				durationMs: Math.round(performance.now() - start),
				cpuUserMs: Math.round(cpu.user / 1000),
				cpuSystemMs: Math.round(cpu.system / 1000),
				heapUsedBytes: memory.heapUsed - memoryBefore.heapUsed,
				rssBytes: memory.rss
			}
		};
	});
}

describe("Codebase index real parser benchmarks", () => {
	const temporaryRoots: string[] = [];
	const stores: SQLiteStore[] = [];
	// Pools own worker threads (FEAT-DAEMON-002C) — track and close them so the
	// perf run never leaks workers between files.
	const pools: TreeSitterParserPool[] = [];

	beforeAll(() => {
		for (const fileCount of fileCounts) {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), `cbi-wasm-${fileCount}-`));
			generateSyntheticRepo(root, fileCount);
			temporaryRoots.push(root);
		}
	}, 120_000);

	afterAll(async () => {
		await Promise.all(pools.splice(0).map((pool) => pool.close()));
		for (const store of stores) store.close();
		for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
	});

	it.each(fileCounts)(
		"benchmarks initial and incremental indexing for %i TypeScript files",
		async (fileCount) => {
			const root = temporaryRoots[fileCounts.indexOf(fileCount)];
			if (!root) throw new Error(`Synthetic repository missing for ${fileCount} files`);
			const store = await createTestStore();
			stores.push(store);
			const realParser = new TreeSitterParserPool({ concurrency: 4 });
			pools.push(realParser);
			const parseState = { count: 0 };
			const parserPool = createCountingParserPool(realParser, () => {
				parseState.count++;
			});
			const service = createCodebaseIndexService(store, parserPool);
			const repo = `wasm-benchmark-${fileCount}`;

			const initial = await measure(fileCount, "initial", fileCount, () =>
				service.indexRepository(repo, root, { includeGlobs: ["**/*.ts"], batchSize: 100 })
			);
			initial.metrics.parseCount = parseState.count;
			parseState.count = 0;

			const changedFiles = Math.max(1, Math.floor(fileCount * 0.01));
			for (let index = 0; index < changedFiles; index++) {
				const filePath = path.join(root, `dir-${Math.floor(index / 100)}`, `file-${index}.ts`);
				fs.writeFileSync(filePath, `${generateSource(index)}\nexport const changed${index} = true;\n`, "utf8");
			}
			const backdate = new Date(Date.now() - 60_000);
			for (let index = changedFiles; index < fileCount; index++) {
				const filePath = path.join(root, `dir-${Math.floor(index / 100)}`, `file-${index}.ts`);
				fs.utimesSync(filePath, backdate, backdate);
			}

			const incremental = await measure(fileCount, "incremental", changedFiles, () =>
				service.indexRepository(repo, root, { includeGlobs: ["**/*.ts"], batchSize: 100 })
			);
			incremental.metrics.parseCount = parseState.count;
			const results = [
				{
					...initial.metrics,
					parsedFiles: initial.value.parsedFiles,
					skippedFiles: initial.value.skippedFiles,
					totalSymbols: initial.value.totalSymbols
				},
				{
					...incremental.metrics,
					parsedFiles: incremental.value.parsedFiles,
					skippedFiles: incremental.value.skippedFiles,
					totalSymbols: incremental.value.totalSymbols
				}
			];

			expect(initial.value.success).toBe(true);
			expect(incremental.value.success).toBe(true);
			expect(initial.value.parsedFiles).toBe(fileCount);
			expect(incremental.value.parsedFiles).toBe(changedFiles);
			expect(incremental.value.skippedFiles).toBe(fileCount - changedFiles);
			// totalSymbols is per-run (symbols inserted by THIS run), so the
			// incremental count reflects only the changed slice; assert the
			// changed slice produced symbols rather than an accumulation.
			expect(incremental.value.totalSymbols).toBeGreaterThan(0);
			console.log(`[CodebaseIndexBenchmark] ${JSON.stringify(results)}`);
		},
		600_000
	);
});
