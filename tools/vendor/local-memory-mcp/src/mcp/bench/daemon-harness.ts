/**
 * PERF-008 — daemon lightness harness (launch + sample + scenarios).
 *
 * Boots the REAL combined daemon (dashboard + MCP HTTP) from source, drives the
 * four scenarios PERF-008 requires, and records the metrics the PERF-002..007
 * changes actually move:
 *
 *   - CPU peak + average, sampled from `/proc/<pid>/stat` (utime+stime deltas)
 *   - native thread count from `/proc/<pid>/task` (PERF-002 caps the ORT pool)
 *   - VmRSS and VmHWM from `/proc/<pid>/status` — reported SEPARATELY from
 *     VmSize, because the original "2.6 GB RSS" claim was a VmSize misread
 *   - startup backfill rows enqueued (PERF-003: 0 on an unchanged corpus)
 *   - DB size + freelist via the production vacuum helpers (PERF-007)
 *
 * Why this lives under `src/` and not `scripts/`: the perf test in
 * `src/mcp/tests/` is compiled by `tsconfig.test.json` (rootDir `src`), so it
 * cannot import from `scripts/`. Everything reusable therefore lives here; the
 * CLI in `scripts/bench/` is a thin wrapper that writes the reports.
 *
 * Launch mechanism: `tsx` cannot run the combined server (a TS-only export in
 * the codebase-index barrel breaks Node's ESM linking), and `dist/` may not
 * exist on a clean checkout. The harness therefore bundles a tiny entry that
 * imports `startCombinedServer` with esbuild, using the same `createRequire`
 * banner `tsup.config.ts` needs for the bundled TypeScript compiler.
 *
 * Never touches the live DB: every run gets its own `fs.mkdtemp` directory,
 * passed through `MEMORY_DB_PATH` + `LOCAL_MEMORY_DAEMON_DIR`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { sampleProcess, summarizeSeries, type ProcSeriesSummary, type ProcSnapshot } from "./proc-metrics";

/**
 * The four scenarios PERF-008 requires, plus the eager-warmup A/B.
 *
 * `idle-eager` is the control for `idle`: it boots with
 * `EMBEDDING_LAZY_WARMUP=false` so the ORT/ONNX pool is actually loaded. Without
 * it the thread cap (PERF-002) and the eager RSS retainer (PERF-005) are never
 * exercised — every other scenario runs lazy and never touches the model.
 */
export type LightnessScenarioId =
	| "clean-startup"
	| "repeated-restart"
	| "write-read-burst"
	| "idle"
	| "idle-eager"
	| "engines-active";

/** All scenario ids in report order. */
export const LIGHTNESS_SCENARIOS: readonly LightnessScenarioId[] = [
	"clean-startup",
	"repeated-restart",
	"write-read-burst",
	"idle",
	"idle-eager",
	"engines-active"
];

/** Tunables; every one is env-overridable so CI can run a shorter pass. */
export interface HarnessOptions {
	/** Sampling interval for `/proc` reads. */
	sampleIntervalMs: number;
	/** How long to watch a boot before calling it settled. */
	settleMs: number;
	/** How long the idle scenario observes a running daemon. */
	idleMs: number;
	/** Boots performed by the repeated-restart scenario. */
	restartCount: number;
	/** Writes issued by the write/read burst. */
	burstWrites: number;
	/** Memories pre-seeded into the repeated-restart DB (PERF-003 backfill probe). */
	corpusSize: number;
	/**
	 * Boot with the proactive engines enabled (`ENABLE_FILE_WATCHER=true`,
	 * `CODEBASE_AUTO_INDEX=true`). Always false for the lightness scenarios —
	 * indexing injects CPU/RSS noise that would make them incomparable. The
	 * `engines-active` scenario overrides it per call to prove the engines still
	 * activate.
	 */
	enableWatcher: boolean;
	/** `EMBEDDING_LAZY_WARMUP` value for the run (PERF-005 A/B). */
	lazyWarmup: boolean;
	/** Emit progress lines to stdout. */
	verbose: boolean;
}

/** Read harness options from the environment, applying the documented defaults. */
export function resolveHarnessOptions(env: NodeJS.ProcessEnv = process.env): HarnessOptions {
	const int = (name: string, fallback: number): number => {
		const raw = env[name];
		if (raw === undefined || raw.trim() === "") return fallback;
		const parsed = Number.parseInt(raw, 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
	};
	const bool = (name: string, fallback: boolean): boolean => {
		const raw = env[name];
		if (raw === undefined) return fallback;
		return raw === "1" || raw.toLowerCase() === "true";
	};
	// CI mode shortens the wall-clock scenarios; the metric SHAPE is unchanged.
	const ci = bool("LIGHTNESS_CI", false);
	return {
		sampleIntervalMs: int("LIGHTNESS_SAMPLE_MS", 250),
		settleMs: int("LIGHTNESS_SETTLE_MS", ci ? 4_000 : 15_000),
		idleMs: int("LIGHTNESS_IDLE_MS", ci ? 20_000 : 300_000),
		restartCount: int("LIGHTNESS_RESTARTS", ci ? 2 : 3),
		burstWrites: int("LIGHTNESS_BURST_WRITES", ci ? 20 : 100),
		corpusSize: int("LIGHTNESS_CORPUS_SIZE", ci ? 25 : 200),
		enableWatcher: false,
		lazyWarmup: bool("LIGHTNESS_LAZY_WARMUP", true),
		verbose: bool("LIGHTNESS_VERBOSE", true)
	};
}

/** Per-scenario recorded metrics (bytes for memory, percent for CPU). */
export interface ScenarioMetrics {
	scenario: LightnessScenarioId;
	/** Wall-clock duration the scenario observed. */
	durationMs: number;
	/** Boots included (repeated-restart > 1). */
	boots: number;
	/** Peak one-core-relative CPU percent across sampled windows. */
	peakCpuPercent: number;
	/** Average one-core-relative CPU percent over the whole scenario. */
	averageCpuPercent: number;
	/** Peak native thread count. */
	peakThreadCount: number;
	/** Native thread count at the end of the scenario. */
	finalThreadCount: number;
	/** Peak resident set (VmRSS), bytes. */
	peakVmRssBytes: number;
	/** Final resident set (VmRSS), bytes. */
	finalVmRssBytes: number;
	/** Peak resident high-water mark (VmHWM), bytes. */
	peakVmHwmBytes: number;
	/** Peak virtual address space (VmSize), bytes — NEVER conflate with RSS. */
	peakVmSizeBytes: number;
	/** Startup backfill rows enqueued, summed across boots (PERF-003). */
	backfilledRows: number;
	/** Per-boot backfilled row counts, in boot order. */
	backfilledPerBoot: number[];
	/** `lazyWarmup` value the daemon was started with. */
	lazyWarmup: boolean;
	/** DB file size in bytes (memory.db) at the end. */
	dbBytes: number;
	/** SQLite page count at the end. */
	pageCount: number;
	/** SQLite freelist page count at the end. */
	freelistCount: number;
	/** Freelist bytes at the end. */
	freelistBytes: number;
	/** Writes completed in the burst scenario. */
	writesCompleted?: number;
	/** Reads completed in the burst scenario. */
	readsCompleted?: number;
	/** Wall-clock of the burst, ms. */
	burstWallMs?: number;
	/**
	 * Runtime capability states observed via `GET /api/capabilities`
	 * (`capability → state`). This is the "all functions still active" evidence:
	 * a degraded/failed capability here means a PERF change silently disabled a
	 * feature. `null` when the endpoint could not be read.
	 */
	capabilities?: Record<string, string> | null;
	/** Note attached when a metric could not be collected. */
	note?: string;
}

/** A full harness run across the selected scenarios. */
export interface HarnessReport {
	generatedAt: string;
	node: string;
	platform: string;
	arch: string;
	options: HarnessOptions;
	scenarios: ScenarioMetrics[];
}

/** Log facts parsed out of the daemon's stderr. */
interface DaemonLogFacts {
	ready: boolean;
	backfilledRows: number;
	queueDepthTotal: number | null;
	lazyWarmup: boolean | null;
	buildIdentity: string | null;
}

const READY_TIMEOUT_MS = 120_000;

/** Create a temp dir the harness owns and must remove. */
export function createHarnessDir(prefix = "perf008-daemon-"): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Bundle a tiny entry that boots `startCombinedServer` from source.
 *
 * @param repoRoot - Absolute repo root (source of `src/mcp/cli/combined-server.ts`).
 * @param outDir - Directory to write `daemon-bench.mjs` into.
 * @returns Absolute path to the bundle.
 */
export async function buildDaemonBundle(repoRoot: string, outDir: string): Promise<string> {
	// The bundle externalizes native/runtime deps, so Node must resolve them
	// from the bundle's own directory — symlink the repo's node_modules in.
	const modulesLink = path.join(outDir, "node_modules");
	if (!fs.existsSync(modulesLink)) {
		try {
			fs.symlinkSync(path.join(repoRoot, "node_modules"), modulesLink, "dir");
		} catch {
			// A pre-existing link (or an unsupported platform) is fine; the
			// spawn below then falls back to NODE_PATH-style resolution.
		}
	}
	const entryPath = path.join(outDir, "daemon-entry.ts");
	const combined = path.join(repoRoot, "src/mcp/cli/combined-server.ts").replace(/\\/g, "/");
	const entrySource = [
		`import { startCombinedServer } from ${JSON.stringify(combined)};`,
		"const handle = await startCombinedServer({ host: '127.0.0.1', port: 0 });",
		"console.log(`BENCH_READY ${JSON.stringify({ url: handle.url, port: handle.port, pid: process.pid })}`);",
		"const shutdown = async () => { try { await handle.close(); } finally { process.exit(0); } };",
		"process.on('SIGTERM', () => void shutdown());",
		"process.on('SIGINT', () => void shutdown());",
		"await new Promise(() => {});",
		""
	].join("\n");
	fs.writeFileSync(entryPath, entrySource, "utf8");

	const outfile = path.join(outDir, "daemon-bench.mjs");
	await build({
		entryPoints: [entryPath],
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node22",
		outfile,
		external: ["better-sqlite3", "proper-lockfile", "sharp", "web-tree-sitter", "@xenova/transformers"],
		logLevel: "error",
		banner: {
			// Required for the bundled TypeScript compiler (dynamic require +
			// __filename/__dirname in an ESM chunk with top-level await). Kept
			// byte-identical to tsup.config.ts so the bundle behaves like a build.
			js: "import { createRequire as __vheinsCreateRequire } from 'module'; import { fileURLToPath as __vheinsFileURLToPath } from 'node:url'; import __vheinsPath from 'node:path'; const require = __vheinsCreateRequire(import.meta.url); var __filename = import.meta.url; var __dirname = __vheinsPath.dirname(__vheinsFileURLToPath(import.meta.url));"
		}
	});
	return outfile;
}

/** A running daemon under observation. */
export interface RunningDaemon {
	child: ChildProcess;
	pid: number;
	url: string;
	logs: string[];
	samples: ProcSnapshot[];
	stop(): Promise<void>;
}

/**
 * Start a daemon on a temp DB and wait until it reports listening.
 *
 * @param bundlePath - Bundle produced by {@link buildDaemonBundle}.
 * @param dbDir - Temp dir that owns the DB + daemon files.
 * @param lazyWarmup - `EMBEDDING_LAZY_WARMUP` for this boot.
 * @param options - Harness tunables.
 * @param cwd - Working directory for the daemon. Defaults to the bundle dir; set
 *   it to the repo root when the proactive engines are enabled, because
 *   `evaluateAutoIndexTarget` only indexes a directory that looks like a project.
 */
export async function startDaemon(
	bundlePath: string,
	dbDir: string,
	lazyWarmup: boolean,
	options: HarnessOptions,
	cwd?: string
): Promise<RunningDaemon> {
	const child = spawn(process.execPath, [bundlePath], {
		cwd: cwd ?? path.dirname(bundlePath),
		env: {
			...process.env,
			MEMORY_DB_PATH: path.join(dbDir, "memory.db"),
			LOCAL_MEMORY_DAEMON_DIR: dbDir,
			MCP_RUNTIME_PROFILE: "full",
			MCP_SERVER: "false",
			EMBEDDING_LAZY_WARMUP: lazyWarmup ? "true" : "false",
			CODEBASE_AUTO_INDEX: options.enableWatcher ? "true" : "false",
			ENABLE_FILE_WATCHER: options.enableWatcher ? "true" : "false",
			LOG_LEVEL: process.env.LIGHTNESS_LOG_LEVEL ?? "info"
		},
		stdio: ["ignore", "pipe", "pipe"]
	});

	const logs: string[] = [];
	const samples: ProcSnapshot[] = [];
	let url = "";
	let readyResolve: (() => void) | null = null;
	const ready = new Promise<void>((resolve) => {
		readyResolve = resolve;
	});

	const onChunk = (chunk: Buffer): void => {
		const text = chunk.toString("utf8");
		logs.push(text);
		const match = /BENCH_READY (\{.*\})/.exec(text);
		if (match && !url) {
			try {
				const parsed = JSON.parse(match[1]!) as { url: string };
				url = parsed.url;
				readyResolve?.();
			} catch {
				// ignore a partial line
			}
		}
	};
	child.stdout?.on("data", onChunk);
	child.stderr?.on("data", onChunk);

	const pid = child.pid ?? 0;
	const sampler = setInterval(() => {
		const snapshot = sampleProcess(pid);
		if (snapshot) samples.push(snapshot);
	}, options.sampleIntervalMs);
	sampler.unref();

	const timeout = new Promise<void>((_, reject) =>
		setTimeout(() => reject(new Error("daemon did not report BENCH_READY in time")), READY_TIMEOUT_MS).unref()
	);

	try {
		await Promise.race([ready, timeout]);
	} catch (error) {
		clearInterval(sampler);
		child.kill("SIGKILL");
		throw error;
	}

	const stop = async (): Promise<void> => {
		clearInterval(sampler);
		if (child.exitCode !== null || child.signalCode !== null) return;
		child.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				resolve();
			}, 15_000);
			timer.unref();
			child.once("exit", () => {
				clearTimeout(timer);
				resolve();
			});
		});
	};

	return { child, pid, url, logs, samples, stop };
}

/**
 * Parse the daemon's captured output for the facts the harness reports.
 *
 * @param logs - Raw stdout/stderr chunks.
 */
export function parseDaemonLogs(logs: readonly string[]): DaemonLogFacts {
	const text = logs.join("");
	const facts: DaemonLogFacts = {
		ready: /BENCH_READY/.test(text),
		backfilledRows: 0,
		queueDepthTotal: null,
		lazyWarmup: null,
		buildIdentity: null
	};
	const maintenance = /\[EmbeddingWorker\] startup maintenance complete (\{[^\n]*\})/.exec(text);
	if (maintenance) {
		try {
			const parsed = JSON.parse(maintenance[1]!) as {
				backfilled?: number;
				queueDepth?: { total?: number };
			};
			facts.backfilledRows = typeof parsed.backfilled === "number" ? parsed.backfilled : 0;
			facts.queueDepthTotal =
				parsed.queueDepth && typeof parsed.queueDepth.total === "number" ? parsed.queueDepth.total : null;
		} catch {
			// leave defaults
		}
	}
	const started = /\[EmbeddingWorker\] started (\{[^\n]*\})/.exec(text);
	if (started) {
		try {
			const parsed = JSON.parse(started[1]!) as { lazyWarmup?: boolean };
			if (typeof parsed.lazyWarmup === "boolean") facts.lazyWarmup = parsed.lazyWarmup;
		} catch {
			// leave default
		}
	}
	const identity = /\[Daemon\] build identity (\{[^\n]*\})/.exec(text);
	if (identity) facts.buildIdentity = identity[1]!;
	return facts;
}

/**
 * Read the runtime capability states from a running daemon.
 *
 * This is the "no function was lost" surface: `GET /api/capabilities` returns
 * the `RuntimeCapabilityRegistry.snapshot()`, whose `capabilities.<name>.state`
 * is `ready` when the engine actually loaded. A `degraded`/`failed` entry after
 * a PERF change means a feature was silently disabled.
 *
 * @param url - Daemon base URL.
 * @returns `capability → state`, or `null` when the endpoint is unreadable.
 */
export async function readCapabilities(url: string): Promise<Record<string, string> | null> {
	const payload = (await getJson(`${url}/api/capabilities`)) as {
		data?: { attributes?: { runtime?: { capabilities?: Record<string, { state?: string }> } } };
	} | null;
	const capabilities = payload?.data?.attributes?.runtime?.capabilities;
	if (!capabilities || typeof capabilities !== "object") return null;
	const states: Record<string, string> = {};
	for (const [name, entry] of Object.entries(capabilities)) {
		states[name] = typeof entry?.state === "string" ? entry.state : "unknown";
	}
	return states;
}

/** GET a dashboard endpoint and return the parsed JSON (null on any failure). */
export async function getJson(url: string, timeoutMs = 10_000): Promise<unknown | null> {
	return new Promise((resolve) => {
		const request = http.get(url, { timeout: timeoutMs }, (response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("end", () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
				} catch {
					resolve(null);
				}
			});
		});
		request.on("timeout", () => {
			request.destroy();
			resolve(null);
		});
		request.on("error", () => resolve(null));
	});
}

/** POST JSON to a dashboard endpoint and return the status code (-1 on error). */
export async function postJson(url: string, body: unknown, timeoutMs = 10_000): Promise<number> {
	return new Promise((resolve) => {
		const payload = JSON.stringify(body);
		const request = http.request(
			url,
			{
				method: "POST",
				timeout: timeoutMs,
				headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
			},
			(response) => {
				response.resume();
				response.on("end", () => resolve(response.statusCode ?? -1));
			}
		);
		request.on("timeout", () => {
			request.destroy();
			resolve(-1);
		});
		request.on("error", () => resolve(-1));
		request.write(payload);
		request.end();
	});
}

/** Summarize one boot's samples into the shared metric shape. */
export function summarizeBoot(samples: readonly ProcSnapshot[]): ProcSeriesSummary {
	return summarizeSeries([...samples]);
}

/** Sleep helper (unref'd so it never holds the process open). */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		timer.unref();
	});
}

/**
 * Seed a temp DB with a deterministic memory corpus BEFORE the first boot.
 *
 * This is what makes the repeated-restart scenario a real PERF-003 measurement:
 * the first boot must backfill every unembedded memory, and every later boot on
 * the same DB must enqueue 0. Seeding directly (rather than through the API)
 * keeps the corpus identical across runs.
 *
 * @param dbDir - Temp dir that owns `memory.db`.
 * @param count - Number of memories to insert.
 * @returns The number of rows inserted.
 */
export async function seedTempCorpus(dbDir: string, count: number): Promise<number> {
	const { SQLiteStore } = await import("../storage/sqlite");
	const store = await SQLiteStore.create(path.join(dbDir, "memory.db"));
	try {
		const now = new Date().toISOString();
		for (let index = 0; index < count; index++) {
			store.memories.insert({
				id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
				type: "code_fact",
				title: `Lightness corpus record ${index}`,
				content: `Deterministic corpus body number ${index} describing a distinct technical subject for embedding.`,
				importance: 3,
				agent: "perf008",
				role: "backend",
				model: "perf008",
				scope: { owner: "perf008", repo: "perf008-corpus" },
				created_at: now,
				updated_at: now,
				completed_at: null,
				hit_count: 0,
				recall_count: 0,
				last_used_at: null,
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: [],
				metadata: {},
				is_global: false
			});
		}
		return count;
	} finally {
		store.close();
	}
}

/** Read the temp DB's size + vacuum state after the daemon has stopped. */
export async function readDbAccounting(dbDir: string): Promise<{
	dbBytes: number;
	pageCount: number;
	freelistCount: number;
	freelistBytes: number;
}> {
	const dbPath = path.join(dbDir, "memory.db");
	const dbBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
	try {
		// Imported lazily so the harness module stays importable in a context
		// where opening a store is undesirable (e.g. pure log parsing).
		const { SQLiteStore } = await import("../storage/sqlite");
		const { getVacuumState } = await import("../services/vacuum");
		const store = await SQLiteStore.create(dbPath);
		try {
			const state = getVacuumState(store);
			return {
				dbBytes,
				pageCount: state.pageCount,
				freelistCount: state.freelistCount,
				freelistBytes: state.freelistBytes
			};
		} finally {
			store.close();
		}
	} catch {
		return { dbBytes, pageCount: 0, freelistCount: 0, freelistBytes: 0 };
	}
}
