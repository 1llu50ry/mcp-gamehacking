/**
 * ParserPool — dispatches tree-sitter parsing to the bounded worker pool.
 *
 * Architecture (v3, FEAT-DAEMON-002C):
 * - Language registry lives in language-routing.ts (declarative config per
 *   language).
 * - Concurrency configuration lives in worker-pool.ts.
 * - The ACTUAL parsing (web-tree-sitter WASM init, lazy grammar loading, the
 *   synchronous `parser.parse()`, and visitor extraction) runs in a
 *   `node:worker_threads` worker owned by the generic WorkerPool
 *   (src/mcp/workers/pool.ts) — see workers/parser.worker.ts.
 *
 * Key design decisions:
 * - Off-main-thread: the former in-process `parser.parse()` blocked the event
 *   loop (and the HTTP initialize handshake) for tens of minutes on a large
 *   repo. Parsing now runs on a bounded pool of worker threads so the server
 *   stays responsive.
 * - Bounded concurrency: the WorkerPool caps in-flight parses at the resolved
 *   worker count (`CODEBASE_INDEX_WORKERS`, capped at os.availableParallelism).
 *   The pool owns the queue; this class no longer needs a semaphore.
 * - Identical results: the worker reuses the SAME registry + visitors, so
 *   symbols/references are byte-identical to the previous in-process path.
 * - Per-file timeout: the in-worker `progressCallback` aborts a parse past the
 *   deadline; the pool task timeout is set above it as a backstop.
 * - Graceful degradation: parse errors are captured in ParseResult.error, never
 *   thrown — a worker crash/timeout also degrades to a per-file error.
 */

import { performance } from "node:perf_hooks";
import type { ParseResult, ParserPool } from "./language-visitor";
import { WorkerPool, WorkerPoolError, WorkerTaskTimeoutError, WorkerTaskCrashError } from "../../workers/pool";
import { resolveParserWorkerPath } from "../../workers/resolve-parser-worker";
import {
	PARSE_WORKER_TASK_SLACK_MS,
	PARSE_WORKER_WARMUP_TIMEOUT_MS,
	resolveParseTimeoutMs,
	resolveConcurrency
} from "./worker-pool";
import { logger } from "../../utils/logger";
import { FatalError } from "../types/errors";

// ── Pool options ─────────────────────────────────────────────────────

export interface ParserPoolOptions {
	/** Maximum time per file parse in milliseconds (default: 10_000). */
	parseTimeoutMs?: number;
	/** Number of concurrent parse workers (default: CODEBASE_INDEX_WORKERS / 4, capped at os.availableParallelism). */
	concurrency?: number;
}

// ── Worker request/response shapes (mirrors workers/parser.worker.ts) ──

interface ParserWorkerParseRequest {
	op: "parse";
	filePath: string;
	sourceCode: string;
	parseTimeoutMs: number;
}

interface ParserWorkerWarmupRequest {
	op: "warmup";
}

// ── Implementation ───────────────────────────────────────────────────

export class TreeSitterParserPool implements ParserPool {
	private initialized = false;
	private initPromise: Promise<void> | null = null;
	private initError: Error | null = null;
	private readonly parseTimeoutMs: number;
	private readonly concurrency: number;
	private pool: WorkerPool | null = null;

	constructor(options: ParserPoolOptions = {}) {
		this.parseTimeoutMs = resolveParseTimeoutMs(options.parseTimeoutMs);
		this.concurrency = resolveConcurrency(options.concurrency);
	}

	// ── ParserPool contract ───────────────────────────────────────

	isInitialized(): boolean {
		return this.initialized;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		if (this.initError) throw this.initError;

		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = this._doInitialize();
		try {
			await this.initPromise;
		} catch (err) {
			this.initError = err instanceof Error ? err : new Error(String(err));
			throw err;
		} finally {
			this.initPromise = null;
		}
	}

	async parseFile(filePath: string, sourceCode: string): Promise<ParseResult> {
		const startTime = performance.now();

		// Lazy-init on first call
		await this.initialize();

		try {
			const result = await this._dispatchParse(filePath, sourceCode);
			const durationMs = Math.round(performance.now() - startTime);
			result.durationMs = durationMs;
			return result;
		} catch (err) {
			const durationMs = Math.round(performance.now() - startTime);
			const message = err instanceof Error ? err.message : String(err);
			logger.warn("[ParserPool] Parse failed", { filePath, error: message, durationMs });
			return { symbols: [], error: message, durationMs };
		}
	}

	/**
	 * Gracefully stop the worker pool. Idempotent and safe to call when the pool
	 * was never initialized. Provided for tests / process teardown; the
	 * process-wide singleton lives for the process lifetime.
	 */
	async close(): Promise<void> {
		const pool = this.pool;
		this.pool = null;
		this.initialized = false;
		this.initPromise = null;
		this.initError = null;
		if (pool) await pool.close({ mode: "cancel" });
	}

	// ── Private methods ───────────────────────────────────────────

	private async _doInitialize(): Promise<void> {
		this.pool ??= new WorkerPool({
			workerPath: resolveParserWorkerPath(),
			size: this.concurrency,
			// Backstop only: the in-worker progressCallback aborts the parse at
			// `parseTimeoutMs`; the pool ceiling sits above it so a slow grammar
			// load never gets killed before the graceful in-parse timeout fires.
			taskTimeoutMs: this.parseTimeoutMs > 0 ? this.parseTimeoutMs + PARSE_WORKER_TASK_SLACK_MS : 0
		});
		const pool = this.pool;

		logger.debug("[ParserPool] Initializing worker pool", {
			workers: this.concurrency,
			parseTimeoutMs: this.parseTimeoutMs
		});

		try {
			// Warm ALL workers (M3, FEAT-DAEMON-002 review): a single warmup task
			// only instantiates WASM in ONE worker, so with the default 4 workers
			// the other 3 paid the grammar-init cost lazily on the first real
			// burst. Dispatching `poolSize` warmups lets the pool's FIFO queue
			// assign exactly one to each worker (one in-flight task per worker),
			// so every worker is ready before the first index batch. Bounded to
			// the actual pool size.
			const warmupTimeoutMs = Math.max(this.parseTimeoutMs, PARSE_WORKER_WARMUP_TIMEOUT_MS);
			await Promise.all(
				Array.from({ length: pool.poolSize }, () =>
					pool.run<ParserWorkerWarmupRequest, { warmed: true }>({ op: "warmup" }, { timeoutMs: warmupTimeoutMs })
				)
			);
		} catch (err) {
			// A failed warm-up means the WASM runtime could not initialize in a
			// worker (bad path, missing bootstrap, crashed worker). Surface it as
			// a FatalError — matching the former in-process contract — and tear
			// the pool down so a retry starts clean.
			this.pool = null;
			void pool.close({ mode: "cancel" });
			const message = err instanceof Error ? err.message : String(err);
			logger.error("[ParserPool] Worker pool warm-up failed", { error: message });
			throw new FatalError(`WASM initialization failed: ${message}`, { operation: "Parser.init" });
		}

		logger.debug("[ParserPool] Worker pool ready, grammars will be loaded lazily per worker");
		this.initialized = true;
	}

	/** Dispatch one parse task to the worker pool and normalize the outcome. */
	private async _dispatchParse(filePath: string, sourceCode: string): Promise<ParseResult> {
		const pool = this.pool;
		if (!pool) {
			return { symbols: [], error: "Parser pool not initialized", durationMs: 0 };
		}

		const request: ParserWorkerParseRequest = {
			op: "parse",
			filePath,
			sourceCode,
			parseTimeoutMs: this.parseTimeoutMs
		};

		try {
			const result = await pool.run<ParserWorkerParseRequest, ParseResult>(request);
			// The worker always returns a well-formed ParseResult; normalize the
			// optional references field so callers see a stable shape.
			return { ...result, references: result.references ?? [] };
		} catch (err) {
			// A worker crash / task timeout is a RETRYABLE infrastructure fault,
			// not a parse error. Degrade gracefully to a per-file error so the
			// index run continues (the pool respawns the worker automatically).
			if (err instanceof WorkerTaskTimeoutError || err instanceof WorkerTaskCrashError) {
				logger.warn("[ParserPool] Worker task failed — degrading to per-file error", {
					filePath,
					retryable: (err as WorkerPoolError).retryable,
					error: err.message
				});
			}
			const message = err instanceof Error ? err.message : String(err);
			return { symbols: [], error: message, durationMs: 0 };
		}
	}
}
