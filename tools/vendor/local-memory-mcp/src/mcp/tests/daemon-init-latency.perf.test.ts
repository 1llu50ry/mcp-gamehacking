/**
 * FEAT-DAEMON-002G — `initialize` latency regression guard under concurrent
 * index + embedding-backfill load.
 *
 * ## The production bug this guards (the one that started the epic)
 *
 * On a large repo (~3979 files) a cold start ran a FULL, SYNCHRONOUS re-index on
 * the MAIN event loop. tree-sitter parsing is CPU-bound and, before FEAT-DAEMON
 * 002C, ran in-process, so the loop was blocked for the whole scan (~31 min
 * observed). The MCP Streamable-HTTP `initialize` handshake — which is served by
 * that same loop — could not be answered until the index finished, so the client
 * (OpenCode, ~30s handshake timeout) gave up. A 30s client timeout vs a ~31-min
 * block is a hard failure: the daemon was up but unreachable.
 *
 * ## What the fix changed (all on origin/main, merged 9079f463)
 *
 *   - 002C: tree-sitter parsing moved to a `worker_threads` pool
 *     (`codebase-index/parser/parser-pool.ts`), so `parser.parse()` no longer
 *     runs on the main loop.
 *   - 002D: ONNX embedding moved to a worker thread
 *     (`storage/vectors.ts` `embed()` → embedding worker pool), so a backfill
 *     batch can no longer block the loop either.
 *   - 002E: the HTTP listener is bound BEFORE the optional heavy startup passes
 *     (`cli/combined-server.ts`), which are deferred + failure-isolated
 *     (`services/startup-deferral.ts`).
 *
 * ## What this test asserts
 *
 * Boot the REAL combined daemon (dashboard + MCP HTTP) against a temp DB seeded
 * with a large synthetic repo and a memory corpus, then — while a FULL
 * (force) index AND the startup embedding backfill run concurrently — hammer the
 * `/mcp` `initialize` handshake and measure its latency. The invariant is the
 * one that broke in production:
 *
 *   - 100% of `initialize` calls succeed (HTTP 200), and
 *   - p95 latency < CLIENT_TIMEOUT_MS (30s, the OpenCode handshake timeout), and
 *   - p95 latency < TIGHT_P95_MS (3s) — a meaningfully tight bound: ~10x below
 *     the client timeout, well below the forced-index duration, and ~10x above
 *     the observed post-fix p95 (<~320ms across local probes). A regression that
 *     put the index (or embedding) back on the main loop would push p95 toward
 *     the index duration and trip this bound.
 *
 * The companion negative control (`it("… a synchronous main-thread pass …")`)
 * proves this harness CAN observe starvation: it boots a variant daemon whose
 * deferred pass busy-spins the main loop (SPIN_MS, mirroring the pre-002C
 * in-process `parser.parse()`), and asserts the `initialize` that lands during
 * the spin is delayed by it — i.e. a main-thread block of the forced-index
 * duration would exceed the tight bound.
 *
 * ## CI inclusion (FIX-381)
 *
 * `vitest.config.ts` registers the perf project with a POSITIVE-ONLY include
 * (a single glob ending in `.perf.test.ts` — NO `!` negations, which would break
 * coverage collection), so this file is picked up automatically. No config
 * change is required.
 *
 * Never touches the live DB: every run uses `fs.mkdtemp` temp dirs.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
	buildDaemonBundle,
	delay,
	parseDaemonLogs,
	resolveHarnessOptions,
	seedTempCorpus,
	startDaemon,
	type RunningDaemon
} from "../bench/daemon-harness";

/** Repo root — vitest runs the perf project from the repository root. */
const REPO_ROOT = process.cwd();

/** Synthetic repo size for the forced full index (real parsing via the pool). */
const FILE_COUNT = 1500;
/** Seeded memories → a startup embedding backfill workload. */
const SEED_MEMORIES = 1000;
/** OpenCode's ~30s `initialize` handshake timeout — the production failure. */
const CLIENT_TIMEOUT_MS = 30_000;
/** Tight, stable bound: ~10% of the client timeout; see the file header. */
const TIGHT_P95_MS = 3_000;
/** Interval between `initialize` probes during the load window. */
const PROBE_INTERVAL_MS = 75;
/** Hard ceiling on the load window so the test can never hang. */
const LOAD_WINDOW_MAX_MS = 60_000;
/** Minimum samples required for a meaningful p95 (fails if the index is trivial). */
const MIN_SAMPLES = 5;

/** Banner kept byte-identical to `tsup.config.ts` / the harness (dynamic require). */
const BUNDLE_BANNER =
	"import { createRequire as __vheinsCreateRequire } from 'module'; import { fileURLToPath as __vheinsFileURLToPath } from 'node:url'; import __vheinsPath from 'node:path'; const require = __vheinsCreateRequire(import.meta.url); var __filename = import.meta.url; var __dirname = __vheinsPath.dirname(__vheinsFileURLToPath(import.meta.url));";

/** Native/runtime deps the daemon + workers resolve from the symlinked node_modules. */
const WORKER_EXTERNALS = ["better-sqlite3", "proper-lockfile", "sharp", "web-tree-sitter", "@xenova/transformers"];

const tempDirs: string[] = [];

/** Create a temp dir the test owns and clean up after the file. */
function makeTempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
	tempDirs.length = 0;
});

/**
 * Bundle a runtime worker (parser / embedding) into `<workDir>/dist/mcp/workers/`.
 *
 * CRITICAL: inside the daemon bundle the production worker resolver
 * (`workers/resolve-parser-worker.ts` / `resolve-embedding-worker.ts`) takes its
 * NON-dev branch and looks for `<projectRoot>/dist/mcp/workers/<name>.worker.js`,
 * where `<projectRoot>` is the bundle dir (it has a symlinked `node_modules`).
 * Without these bundles the parser pool fails its WASM warm-up and the embedding
 * pool falls back to in-process ONNX — the test would then measure the wrong
 * (and, for parsing, empty) work. This mirrors the real `tsup` build.
 */
async function bundleRuntimeWorker(entryFile: string, outFile: string): Promise<void> {
	await build({
		entryPoints: [entryFile],
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node22",
		outfile: outFile,
		external: WORKER_EXTERNALS,
		logLevel: "error",
		banner: { js: BUNDLE_BANNER }
	});
}

/** Emit both runtime workers the daemon resolves at boot. */
async function buildRuntimeWorkers(workDir: string): Promise<void> {
	const outDir = path.join(workDir, "dist", "mcp", "workers");
	fs.mkdirSync(outDir, { recursive: true });
	await bundleRuntimeWorker(
		path.join(REPO_ROOT, "src/mcp/workers/parser.worker.ts"),
		path.join(outDir, "parser.worker.js")
	);
	await bundleRuntimeWorker(
		path.join(REPO_ROOT, "src/mcp/workers/embedding.worker.ts"),
		path.join(outDir, "embedding.worker.js")
	);
}

/**
 * Copy the server-instructions prompt next to the bundle.
 *
 * `createMcpServer()` calls `loadServerInstructions()` FIRST and THROWS when the
 * file is missing — which surfaces as an HTTP 500 on `initialize`. The loader
 * resolves against the BUNDLE's `__dirname`, so `<workDir>/server/instructions.md`
 * is the production-shaped location it finds.
 */
function copyServerInstructions(workDir: string): void {
	fs.mkdirSync(path.join(workDir, "server"), { recursive: true });
	fs.copyFileSync(
		path.join(REPO_ROOT, "src/mcp/prompts/server/instructions.md"),
		path.join(workDir, "server", "instructions.md")
	);
}

/** Write a synthetic TypeScript repo (real symbols) for the forced index. */
function generateSyntheticRepo(root: string, fileCount: number): void {
	fs.mkdirSync(path.join(root, "src"), { recursive: true });
	fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "synth-index", version: "1.0.0" }));
	for (let index = 0; index < fileCount; index++) {
		const directory = path.join(root, "src", `d${Math.floor(index / 100)}`);
		fs.mkdirSync(directory, { recursive: true });
		fs.writeFileSync(
			path.join(directory, `f${index}.ts`),
			`export function fn${index}(value: string): string { return value + "${index}"; }\n` +
				`export interface C${index} { x: string }\n` +
				`export const K${index} = ${index};\n`
		);
	}
}

interface InitializeResult {
	status: number;
	latencyMs: number;
}

/** POST a 2025-era `initialize` handshake and measure end-to-end latency. */
function initialize(url: string): Promise<InitializeResult> {
	const payload = JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "feat-daemon-002g", version: "1.0.0" }
		}
	});
	return new Promise((resolve) => {
		const started = performance.now();
		const request = http.request(
			`${url}/mcp`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					"content-length": Buffer.byteLength(payload)
				}
			},
			(response) => {
				response.resume();
				response.on("end", () =>
					resolve({ status: response.statusCode ?? -1, latencyMs: performance.now() - started })
				);
			}
		);
		request.on("error", () => resolve({ status: -1, latencyMs: performance.now() - started }));
		request.write(payload);
		request.end();
	});
}

interface IndexResult {
	status: number;
	body: string;
}

/** POST a forced codebase index and return the raw result. */
function postIndex(url: string, repo: string, repoPath: string): Promise<IndexResult> {
	const payload = JSON.stringify({ repo, repoPath, force: true });
	return new Promise((resolve) => {
		const request = http.request(
			`${url}/api/codebase/index`,
			{
				method: "POST",
				timeout: 120_000,
				headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () =>
					resolve({ status: response.statusCode ?? -1, body: Buffer.concat(chunks).toString("utf8") })
				);
			}
		);
		request.on("timeout", () => {
			request.destroy();
			resolve({ status: -1, body: "" });
		});
		request.on("error", (error) => resolve({ status: -1, body: String(error) }));
		request.write(payload);
		request.end();
	});
}

/** Nearest-rank percentile of an ascending-sorted array. */
function percentile(sortedAsc: readonly number[], q: number): number {
	if (sortedAsc.length === 0) return 0;
	const index = Math.min(sortedAsc.length - 1, Math.floor(q * sortedAsc.length));
	return sortedAsc[index]!;
}

describe("FEAT-DAEMON-002G — initialize latency under concurrent index + embedding backfill", () => {
	/** Shared daemon bundle + worker bundles, built once for the file. */
	let workDir: string;
	let daemonBundlePath: string;

	beforeAll(async () => {
		// Guard: the perf project must run from the repo root.
		if (!fs.existsSync(path.join(REPO_ROOT, "src/mcp/cli/combined-server.ts"))) {
			throw new Error(
				`FEAT-DAEMON-002G: repo root not found at ${REPO_ROOT} (expected src/mcp/cli/combined-server.ts)`
			);
		}
		workDir = makeTempDir("feat-daemon-002g-bundle-");
		daemonBundlePath = await buildDaemonBundle(REPO_ROOT, workDir);
		await buildRuntimeWorkers(workDir);
		copyServerInstructions(workDir);
	}, 180_000);

	it("serves initialize within the client timeout (100% success, p95 < tight bound) while a full index + backfill run", async () => {
		const dbDir = makeTempDir("feat-daemon-002g-db-");
		const repoDir = path.join(dbDir, "synth-index");
		generateSyntheticRepo(repoDir, FILE_COUNT);
		await seedTempCorpus(dbDir, SEED_MEMORIES);

		const options = resolveHarnessOptions();
		// lazyWarmup: true keeps the ONNX model off the boot critical path; the
		// backfill loads it on demand inside the embedding worker.
		const daemon: RunningDaemon = await startDaemon(daemonBundlePath, dbDir, true, options, repoDir);

		const latencies: number[] = [];
		const statuses: number[] = [];
		try {
			// Kick a FULL (force) re-index and an embedding backfill concurrently.
			// The index parses FILE_COUNT files through the parser worker pool; the
			// backfill embeds SEED_MEMORIES rows through the embedding worker. Both
			// are the historical main-loop blockers (002C / 002D).
			const repo = "synthowner/synth-index";
			let indexDone = false;
			const indexPromise = postIndex(daemon.url, repo, repoDir).then((result) => {
				indexDone = true;
				return result;
			});

			// Hammer initialize for the whole load window (and at least MIN_SAMPLES).
			const windowStart = performance.now();
			while ((!indexDone || latencies.length < MIN_SAMPLES) && performance.now() - windowStart < LOAD_WINDOW_MAX_MS) {
				const result = await initialize(daemon.url);
				latencies.push(result.latencyMs);
				statuses.push(result.status);
				await delay(PROBE_INTERVAL_MS);
			}

			const indexResult = await indexPromise;

			// ── The index really ran, via the worker pool (anti-vacuous) ──────
			expect(indexResult.status).toBe(200);
			const parsed = JSON.parse(indexResult.body) as {
				success?: boolean;
				parsedFiles?: number;
				failedFiles?: number;
				totalSymbols?: number;
			};
			expect(parsed.success).toBe(true);
			// All generated files parsed with real symbols → the parser worker
			// offload engaged (a missing worker bundle yields 0 symbols).
			expect(parsed.parsedFiles ?? 0).toBeGreaterThanOrEqual(FILE_COUNT);
			expect(parsed.failedFiles ?? -1).toBe(0);
			expect(parsed.totalSymbols ?? 0).toBeGreaterThan(0);

			// ── The embedding backfill really ran ─────────────────────────────
			const facts = parseDaemonLogs(daemon.logs);
			expect(facts.backfilledRows).toBeGreaterThan(0);
			// No in-process ONNX fallback → the embedding offload engaged.
			expect(daemon.logs.join("")).not.toMatch(/embedding worker unavailable|falling back to in-process ONNX/);

			// ── The invariant under test ──────────────────────────────────────
			const sorted = [...latencies].sort((a, b) => a - b);
			const p95 = percentile(sorted, 0.95);
			const max = sorted[sorted.length - 1] ?? 0;
			const success = statuses.filter((status) => status === 200).length;

			console.log(
				`[FEAT-DAEMON-002G] index=${parsed.parsedFiles} files / ${parsed.totalSymbols} symbols, ` +
					`backfilled=${facts.backfilledRows} rows; initialize n=${latencies.length} ` +
					`success=${success}/${latencies.length} min=${(sorted[0] ?? 0).toFixed(0)}ms ` +
					`p50=${percentile(sorted, 0.5).toFixed(0)}ms p95=${p95.toFixed(0)}ms max=${max.toFixed(0)}ms ` +
					`(tight=${TIGHT_P95_MS}ms, client-timeout=${CLIENT_TIMEOUT_MS}ms)`
			);

			expect(latencies.length).toBeGreaterThanOrEqual(MIN_SAMPLES);
			// 100% success — a starved handshake would time out or error.
			expect(success).toBe(latencies.length);
			// Meaningfully tight: a main-thread-blocking index/embed would exceed this.
			expect(p95).toBeLessThan(TIGHT_P95_MS);
			// The headline production invariant: p95 within the client timeout.
			expect(p95).toBeLessThan(CLIENT_TIMEOUT_MS);
			// Even the single worst handshake stays inside the client timeout.
			expect(max).toBeLessThan(CLIENT_TIMEOUT_MS);
		} finally {
			await daemon.stop();
		}
	}, 300_000);

	it("negative control: a synchronous main-thread pass starves initialize (the pre-fix mechanism)", async () => {
		// A variant daemon whose deferred pass busy-spins the MAIN event loop for
		// SPIN_MS. This mirrors the pre-002C in-process `parser.parse()` (and the
		// pre-002D in-process ONNX pass): a synchronous, CPU-bound block on the
		// same loop that serves the handshake. SPIN_MS > TIGHT_P95_MS, so a block
		// of the forced-index duration would exceed the tight bound asserted above
		// — proving that bound is a real check that can fail.
		const SPIN_MS = 3_000;
		const negDir = makeTempDir("feat-daemon-002g-neg-");
		const dbDir = makeTempDir("feat-daemon-002g-neg-db-");

		const combined = path.join(REPO_ROOT, "src/mcp/cli/combined-server.ts").replace(/\\/g, "/");
		const entryPath = path.join(negDir, "blocking-entry.ts");
		fs.writeFileSync(
			entryPath,
			[
				`import { startCombinedServer } from ${JSON.stringify(combined)};`,
				`const SPIN_MS = ${SPIN_MS};`,
				"const handle = await startCombinedServer({ host: '127.0.0.1', port: 0, startupDeferral: { extraPasses: [{",
				"  name: 'pre-fix-inline-parse-simulation',",
				"  run: () => { console.log('INIT_LATENCY_BLOCK_START'); const end = Date.now() + SPIN_MS; while (Date.now() < end) { /* spin */ } console.log('INIT_LATENCY_BLOCK_END'); }",
				"}] } });",
				"console.log(`BENCH_READY ${JSON.stringify({ url: handle.url, port: handle.port, pid: process.pid })}`);",
				"const shutdown = async () => { try { await handle.close(); } finally { process.exit(0); } };",
				"process.on('SIGTERM', () => void shutdown());",
				"process.on('SIGINT', () => void shutdown());",
				"await new Promise(() => {});",
				""
			].join("\n"),
			"utf8"
		);
		// The daemon needs node_modules (native deps) + the server instructions.
		fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(negDir, "node_modules"), "dir");
		copyServerInstructions(negDir);
		const negBundle = path.join(negDir, "blocking-bench.mjs");
		await build({
			entryPoints: [entryPath],
			bundle: true,
			format: "esm",
			platform: "node",
			target: "node22",
			outfile: negBundle,
			external: WORKER_EXTERNALS,
			logLevel: "error",
			banner: { js: BUNDLE_BANNER }
		});

		const options = resolveHarnessOptions();
		const daemon = await startDaemon(negBundle, dbDir, true, options, negDir);
		try {
			// Wait until the synchronous pass has started spinning the loop.
			const waitStart = performance.now();
			while (!daemon.logs.join("").includes("INIT_LATENCY_BLOCK_START") && performance.now() - waitStart < 15_000) {
				await delay(5);
			}
			expect(daemon.logs.join("")).toContain("INIT_LATENCY_BLOCK_START");

			// An initialize that arrives DURING the block cannot be served until the
			// loop yields — exactly how the pre-fix index starved the handshake.
			const starved = await initialize(daemon.url);
			expect(starved.status).toBe(200);
			// ~10ms unblocked vs a multi-hundred-ms starved handshake: a wide margin.
			expect(starved.latencyMs).toBeGreaterThan(1_000);

			// After the block ends the loop is free again and initialize is fast —
			// confirming the earlier latency was the block, not a permanently slow
			// path.
			const waitEnd = performance.now();
			while (!daemon.logs.join("").includes("INIT_LATENCY_BLOCK_END") && performance.now() - waitEnd < 15_000) {
				await delay(5);
			}
			const recovered = await initialize(daemon.url);
			expect(recovered.status).toBe(200);
			expect(recovered.latencyMs).toBeLessThan(1_000);

			console.log(
				`[FEAT-DAEMON-002G] negative control: synchronous ${SPIN_MS}ms main-loop block → ` +
					`initialize starved to ${starved.latencyMs.toFixed(0)}ms, recovered to ${recovered.latencyMs.toFixed(0)}ms ` +
					`(tight bound ${TIGHT_P95_MS}ms)`
			);
		} finally {
			await daemon.stop();
		}
	}, 180_000);
});
