#!/usr/bin/env -S npx tsx
/**
 * Codebase-index real-parser benchmark.
 *
 * Exercises the repo's ACTUAL indexing pipeline (src/mcp/codebase-index) with
 * REAL tree-sitter WASM parsers — NOT the mock parser used by the fast
 * regression test (indexing-performance.test.ts). This isolates production
 * parse cost from historical mock timings.
 *
 * Scenarios (per file count):
 *   1. Initial index  — every file is new and must be parsed.
 *   2. Incremental     — a small % of files are mutated (re-parse), the rest
 *                        are backdated so the mtime fast-path skips them.
 *
 * Captured per scenario:
 *   - parseCount   (real ParserPool.parseFile invocations, via a counting proxy)
 *   - parsedFiles / skippedFiles / totalSymbols (from IndexResult)
 *   - durationMs   (wall-clock)
 *   - cpuUserMs / cpuSystemMs (process.cpuUsage deltas)
 *   - heapUsedBytes / peakHeapBytes / rssBytes (process.memoryUsage)
 *
 * Run: npx tsx scripts/bench/codebase-index-bench.ts [--counts 1000,10000]
 *      [--json-out <path>] [--markdown-out <path>]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { createCodebaseIndexService } from "../../src/mcp/codebase-index/services/indexing-service";
import { TreeSitterParserPool } from "../../src/mcp/codebase-index/parser/parser-pool";
import type { ParserPool, ParseResult } from "../../src/mcp/codebase-index/parser/language-visitor";
import { createTestStore, type SQLiteStore } from "../../src/mcp/storage/sqlite";

const require = createRequire(import.meta.url);

/** Read a dependency's version without triggering package "exports" restrictions. */
function pkgVersion(name: string): string | null {
	try {
		const pkgJson = require.resolve(`${name}/package.json`);
		return JSON.parse(fs.readFileSync(pkgJson, "utf8")).version;
	} catch {
		try {
			const p = path.join(
				path.dirname(fileURLToPath(import.meta.url)),
				"..",
				"..",
				"node_modules",
				name,
				"package.json"
			);
			return JSON.parse(fs.readFileSync(p, "utf8")).version;
		} catch {
			return null;
		}
	}
}

// ── CLI helpers ──────────────────────────────────────────────────────────

function argVal(argv: string[], name: string, dflt: string): string {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : dflt;
}

function parseCounts(argv: string[]): number[] {
	const raw = argVal(argv, "--counts", "1000,10000");
	return raw
		.split(",")
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => Number.isFinite(n) && n > 0)
		.sort((a, b) => a - b);
}

// ── Fixture generation ───────────────────────────────────────────────────

/** Generate TypeScript source with multiple exported symbols (realistic mix). */
function generateFileContent(index: number): string {
	const lines: string[] = [];

	const fnCount = 1 + (index % 3);
	for (let j = 0; j < fnCount; j++) {
		const prefix = j === 0 ? " default" : "";
		lines.push(`/** Doc for benchFn${index}_${j} */`);
		lines.push(
			`export${prefix ? " default" : ""} function benchFn${index}_${j}(a: string, b: number): Promise<{ result: string }> {`
		);
		lines.push(`  const x = a.repeat(b);`);
		lines.push(`  return { result: x + "${index}_${j}" };`);
		lines.push(`}`);
		lines.push("");
	}

	if (index % 4 === 0) {
		lines.push(`export interface BenchConfig${index} {`);
		lines.push(`  readonly id: string;`);
		lines.push(`  readonly enabled: boolean;`);
		lines.push(`  readonly options: Record<string, unknown>;`);
		lines.push(`}`);
		lines.push("");
	}

	if (index % 5 === 0) {
		lines.push(`export class BenchService${index} {`);
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

function generateSyntheticRepo(root: string, fileCount: number): void {
	fs.mkdirSync(root, { recursive: true });
	for (let i = 0; i < fileCount; i++) {
		const dir = path.join(root, `dir-${Math.floor(i / 100)}`);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, `file-${i}.ts`), generateFileContent(i), "utf-8");
	}
}

// ── Counting parser wrapper ───────────────────────────────────────────────

interface CountingState {
	parseCount: number;
	peakHeapBytes: number;
}

function createCountingParserPool(delegate: ParserPool, state: CountingState): ParserPool {
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

// ── Measurement ───────────────────────────────────────────────────────────

interface ScenarioResult {
	fileCount: number;
	phase: "initial" | "incremental";
	changedFiles: number;
	unchangedFiles: number;
	parseCount: number;
	parsedFiles: number;
	skippedFiles: number;
	skippedByMtime: number;
	totalSymbols: number;
	durationMs: number;
	cpuUserMs: number;
	cpuSystemMs: number;
	heapUsedBytes: number;
	peakHeapBytes: number;
	rssBytes: number;
	success: boolean;
}

async function runScenario(opts: {
	store: SQLiteStore;
	repo: string;
	repoPath: string;
	pool: ParserPool;
	state: CountingState;
	fileCount: number;
	phase: "initial" | "incremental";
	changedFiles: number;
}): Promise<ScenarioResult> {
	const { store, repo, repoPath, pool, state, fileCount, phase, changedFiles } = opts;

	const cpuBefore = process.cpuUsage();
	const memBefore = process.memoryUsage();
	const start = performance.now();

	const result = await createCodebaseIndexService(store, pool).indexRepository(repo, repoPath, {
		includeGlobs: ["**/*.ts"],
		batchSize: 100
	});

	const cpu = process.cpuUsage(cpuBefore);
	const memAfter = process.memoryUsage();

	return {
		fileCount,
		phase,
		changedFiles,
		unchangedFiles: fileCount - changedFiles,
		parseCount: state.parseCount,
		parsedFiles: result.parsedFiles,
		skippedFiles: result.skippedFiles,
		skippedByMtime: result.skippedByMtime,
		totalSymbols: result.totalSymbols,
		durationMs: Math.round(performance.now() - start),
		cpuUserMs: Math.round(cpu.user / 1000),
		cpuSystemMs: Math.round(cpu.system / 1000),
		heapUsedBytes: memAfter.heapUsed - memBefore.heapUsed,
		peakHeapBytes: state.peakHeapBytes,
		rssBytes: memAfter.rss,
		success: result.success
	};
}

// ── Markdown report ───────────────────────────────────────────────────────

function buildMarkdown(result: { meta: Record<string, unknown>; scenarios: ScenarioResult[] }): string {
	const rows = result.scenarios
		.map((s) => {
			const filesPerSec =
				s.durationMs > 0
					? ((s.phase === "initial" ? s.fileCount : s.changedFiles) / (s.durationMs / 1000)).toFixed(0)
					: "n/a";
			return (
				`| ${s.fileCount} | ${s.phase} | ${s.changedFiles} | ${s.parseCount} | ` +
				`${s.parsedFiles} | ${s.skippedByMtime} | ${s.totalSymbols} | ${s.durationMs} | ` +
				`${s.cpuUserMs}/${s.cpuSystemMs} | ${(s.peakHeapBytes / 1024 / 1024).toFixed(1)} | ${filesPerSec} |`
			);
		})
		.join("\n");

	return [
		`# Codebase-Index Real-Parser Benchmark (TASK-481)`,
		``,
		`- date: ${result.meta.date}`,
		`- commit: ${result.meta.commitSha} (${result.meta.branch}${result.meta.dirty ? ", dirty" : ""})`,
		`- node: ${result.meta.node}`,
		`- web-tree-sitter: ${result.meta.webTreeSitter}`,
		`- tree-sitter: ${result.meta.treeSitter}`,
		`- concurrency: ${result.meta.concurrency}`,
		``,
		`| files | phase | changed | parseCount | parsed | mtimeSkipped | symbols | durationMs | cpuU/S(ms) | peakHeap(MB) | files/sec |`,
		`| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
		rows,
		``,
		`> parseCount = real \`ParserPool.parseFile\` invocations (counting proxy).`,
		`> Initial phase parses every file (parseCount == fileCount).`,
		`> Incremental phase re-parses only changed files; unchanged files skip via the mtime fast-path (mtimeSkipped).`
	].join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const counts = parseCounts(argv);
	const jsonOut = argVal(
		argv,
		"--json-out",
		path.resolve(".agents/documents/analysis/codebase-index-bench-results.json")
	);
	const markdownOut = argVal(
		argv,
		"--markdown-out",
		path.resolve(".agents/documents/analysis/codebase-index-bench.md")
	);

	const concurrency = parseInt(process.env.CODEBASE_INDEX_WORKERS ?? "4", 10) || 4;

	const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-bench-"));
	const repos: { fileCount: number; root: string }[] = [];
	for (const fileCount of counts) {
		const root = path.join(tmpRoot, `repo-${fileCount}`);
		generateSyntheticRepo(root, fileCount);
		repos.push({ fileCount, root });
	}

	const scenarios: ScenarioResult[] = [];
	const errors: { fileCount: number; error: string }[] = [];

	try {
		for (const { fileCount, root } of repos) {
			const store = await createTestStore();
			const realParser = new TreeSitterParserPool({ concurrency });
			const state: CountingState = { parseCount: 0, peakHeapBytes: 0 };
			const parserPool = createCountingParserPool(realParser, state);
			const repo = `real-bench-${fileCount}`;

			try {
				// 1. Initial index
				const initial = await runScenario({
					store,
					repo,
					repoPath: root,
					pool: parserPool,
					state,
					fileCount,
					phase: "initial",
					changedFiles: fileCount
				});
				scenarios.push(initial);
				console.error(
					`[bench] ${fileCount} initial: parseCount=${initial.parseCount} parsed=${initial.parsedFiles} ` +
						`duration=${initial.durationMs}ms cpu=${initial.cpuUserMs}/${initial.cpuSystemMs}ms ` +
						`peakHeap=${(initial.peakHeapBytes / 1024 / 1024).toFixed(1)}MB`
				);
				state.parseCount = 0;
				state.peakHeapBytes = 0;

				// 2. Incremental index — mutate 1% of files, backdate the rest.
				const changedFiles = Math.max(1, Math.floor(fileCount * 0.01));
				for (let i = 0; i < changedFiles; i++) {
					const filePath = path.join(root, `dir-${Math.floor(i / 100)}`, `file-${i}.ts`);
					fs.writeFileSync(filePath, `${generateFileContent(i)}\nexport const benchChanged${i} = true;\n`, "utf-8");
				}
				const backdate = new Date(Date.now() - 60_000);
				for (let i = changedFiles; i < fileCount; i++) {
					const filePath = path.join(root, `dir-${Math.floor(i / 100)}`, `file-${i}.ts`);
					fs.utimesSync(filePath, backdate, backdate);
				}

				const incremental = await runScenario({
					store,
					repo,
					repoPath: root,
					pool: parserPool,
					state,
					fileCount,
					phase: "incremental",
					changedFiles
				});
				scenarios.push(incremental);
				console.error(
					`[bench] ${fileCount} incremental: parseCount=${incremental.parseCount} parsed=${incremental.parsedFiles} ` +
						`mtimeSkipped=${incremental.skippedByMtime} duration=${incremental.durationMs}ms ` +
						`cpu=${incremental.cpuUserMs}/${incremental.cpuSystemMs}ms`
				);
			} catch (err) {
				errors.push({ fileCount, error: String((err as Error)?.message ?? err) });
			} finally {
				store.close();
			}
		}

		let commitSha: string | null = null;
		let branch: string | null = null;
		let dirty = false;
		try {
			commitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() || null;
			branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim() || null;
			dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
		} catch {
			/* git not available */
		}

		const result = {
			meta: {
				task: "TASK-481",
				date: new Date().toISOString(),
				commitSha,
				branch,
				dirty,
				node: process.version,
				webTreeSitter: pkgVersion("web-tree-sitter"),
				treeSitter: pkgVersion("tree-sitter"),
				concurrency,
				parser: "real-tree-sitter-wasm",
				fileCounts: counts,
				changedRatio: 0.01
			},
			scenarios,
			...(errors.length ? { errors } : {})
		};

		fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
		fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
		console.log(`JSON → ${jsonOut}`);

		fs.mkdirSync(path.dirname(markdownOut), { recursive: true });
		fs.writeFileSync(markdownOut, `${buildMarkdown(result)}\n`);
		console.log(`Markdown → ${markdownOut}`);

		// Console summary for quick eyeballing.
		console.log("\n[CodebaseIndexBenchmark]");
		for (const s of scenarios) {
			console.log(
				`  ${s.fileCount} ${s.phase}: parseCount=${s.parseCount} parsed=${s.parsedFiles} ` +
					`mtimeSkipped=${s.skippedByMtime} symbols=${s.totalSymbols} ` +
					`duration=${s.durationMs}ms cpu=${s.cpuUserMs}/${s.cpuSystemMs}ms ` +
					`peakHeap=${(s.peakHeapBytes / 1024 / 1024).toFixed(1)}MB`
			);
		}
		if (errors.length) process.exitCode = 1;
	} finally {
		fs.rmSync(tmpRoot, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error("FATAL:", JSON.stringify(err?.message ?? err));
	process.exit(1);
});
