/**
 * Real-parser codebase-index benchmark on a SMALL fixture.
 *
 * Unlike indexing-real.perf.test.ts (which stresses 1k/10k files for scaling
 * data) this perf test runs the repo's ACTUAL tree-sitter WASM pipeline on a
 * lightweight fixture (~200 files) so the perf project exercises the real
 * parser cheaply and asserts incremental skip behaviour. The heavy 1k/10k
 * numbers come from scripts/bench/codebase-index-bench.ts.
 */

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

const SAMPLE_FILE_COUNT = 200;

interface SampleMetrics {
	phase: "initial" | "incremental";
	changedFiles: number;
	parseCount: number;
	durationMs: number;
	cpuUserMs: number;
	cpuSystemMs: number;
	heapUsedBytes: number;
	parsedFiles: number;
	skippedFiles: number;
	skippedByMtime: number;
	totalSymbols: number;
}

function generateSource(index: number): string {
	return [
		`export function sampleFn${index}(value: string): string {`,
		`\treturn value + "${index}";`,
		`}`,
		`export interface SampleConfig${index} { value: string; }`,
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

function createCountingParserPool(
	delegate: ParserPool,
	state: { parseCount: number; peakHeapBytes: number }
): ParserPool {
	return {
		initialize: () => delegate.initialize(),
		isInitialized: () => delegate.isInitialized(),
		async parseFile(filePath: string, sourceCode: string): Promise<ParseResult> {
			state.parseCount++;
			const mem = process.memoryUsage();
			if (mem.heapUsed > state.peakHeapBytes) state.peakHeapBytes = mem.heapUsed;
			return delegate.parseFile(filePath, sourceCode);
		}
	};
}

describe("Codebase index real parser — small fixture", () => {
	let root: string;
	let store: SQLiteStore;
	// Pools own worker threads (FEAT-DAEMON-002C) — track and close them so the
	// perf run never leaks workers between files.
	const pools: TreeSitterParserPool[] = [];

	beforeAll(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-real-small-"));
		generateSyntheticRepo(root, SAMPLE_FILE_COUNT);
	}, 60_000);

	afterAll(async () => {
		await Promise.all(pools.splice(0).map((pool) => pool.close()));
		if (store) store.close();
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("indexes a small real-parser fixture and skips unchanged files on re-index", async () => {
		store = await createTestStore();
		const realParser = new TreeSitterParserPool({ concurrency: 4 });
		pools.push(realParser);
		const state = { parseCount: 0, peakHeapBytes: 0 };
		const parserPool = createCountingParserPool(realParser, state);
		const service = createCodebaseIndexService(store, parserPool);
		const repo = "real-parser-small-fixture";

		// ── Initial index ──
		const cpuBeforeInit = process.cpuUsage();
		const memBeforeInit = process.memoryUsage();
		const startInit = performance.now();

		const initialResult = await service.indexRepository(repo, root, {
			includeGlobs: ["**/*.ts"],
			batchSize: 50
		});

		const cpuInit = process.cpuUsage(cpuBeforeInit);
		const initial: SampleMetrics = {
			phase: "initial",
			changedFiles: SAMPLE_FILE_COUNT,
			parseCount: state.parseCount,
			durationMs: Math.round(performance.now() - startInit),
			cpuUserMs: Math.round(cpuInit.user / 1000),
			cpuSystemMs: Math.round(cpuInit.system / 1000),
			heapUsedBytes: process.memoryUsage().heapUsed - memBeforeInit.heapUsed,
			parsedFiles: initialResult.parsedFiles,
			skippedFiles: initialResult.skippedFiles,
			skippedByMtime: initialResult.skippedByMtime,
			totalSymbols: initialResult.totalSymbols
		};

		// Reset counters, then mutate a small slice and backdate the rest.
		state.parseCount = 0;
		state.peakHeapBytes = 0;

		const changedFiles = Math.max(1, Math.floor(SAMPLE_FILE_COUNT * 0.1));
		for (let index = 0; index < changedFiles; index++) {
			const filePath = path.join(root, `dir-${Math.floor(index / 100)}`, `file-${index}.ts`);
			fs.writeFileSync(filePath, `${generateSource(index)}\nexport const mutated${index} = true;\n`, "utf8");
		}
		const backdate = new Date(Date.now() - 60_000);
		for (let index = changedFiles; index < SAMPLE_FILE_COUNT; index++) {
			const filePath = path.join(root, `dir-${Math.floor(index / 100)}`, `file-${index}.ts`);
			fs.utimesSync(filePath, backdate, backdate);
		}

		// ── Incremental re-index ──
		const cpuBeforeInc = process.cpuUsage();
		const memBeforeInc = process.memoryUsage();
		const startInc = performance.now();

		const incrementalResult = await service.indexRepository(repo, root, {
			includeGlobs: ["**/*.ts"],
			batchSize: 50
		});

		const cpuInc = process.cpuUsage(cpuBeforeInc);
		const incremental: SampleMetrics = {
			phase: "incremental",
			changedFiles,
			parseCount: state.parseCount,
			durationMs: Math.round(performance.now() - startInc),
			cpuUserMs: Math.round(cpuInc.user / 1000),
			cpuSystemMs: Math.round(cpuInc.system / 1000),
			heapUsedBytes: process.memoryUsage().heapUsed - memBeforeInc.heapUsed,
			parsedFiles: incrementalResult.parsedFiles,
			skippedFiles: incrementalResult.skippedFiles,
			skippedByMtime: incrementalResult.skippedByMtime,
			totalSymbols: incrementalResult.totalSymbols
		};

		// ── Assertions ──
		expect(initialResult.success).toBe(true);
		expect(incrementalResult.success).toBe(true);

		// Initial: every file parsed (real parser invoked for each).
		expect(initialResult.parsedFiles).toBe(SAMPLE_FILE_COUNT);
		expect(initial.parseCount).toBe(SAMPLE_FILE_COUNT);

		// Incremental: only the changed slice is re-parsed; the rest skip.
		expect(incrementalResult.parsedFiles).toBe(changedFiles);
		expect(incremental.parseCount).toBe(changedFiles);
		expect(incrementalResult.skippedByMtime).toBe(SAMPLE_FILE_COUNT - changedFiles);

		// TotalSymbols is per-run (symbols inserted by THIS run, not a running
		// total — see parse-pipeline runParsePipeline / writeParseBatch), so the
		// incremental run's count reflects only the changed slice. Assert the
		// parse discipline instead: initial parses every file, incremental
		// re-parses only the changed slice and mtime-skips the rest, and the
		// changed slice still lands a fresh symbol for its new export.
		expect(incrementalResult.parsedFiles).toBe(changedFiles);
		expect(incrementalResult.totalSymbols).toBeGreaterThan(0);

		console.log(`[CodebaseIndexSmallFixture] ${JSON.stringify([initial, incremental])}`);
	}, 120_000);
});
