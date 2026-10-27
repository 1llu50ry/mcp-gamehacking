/**
 * Worker pool — concurrency limiter and configuration for tree-sitter parsing.
 *
 * tree-sitter Parser is NOT reentrant, so each concurrent slot creates its own
 * Parser instance while sharing the Language objects loaded once at init.
 */

import { clampPoolSize } from "../../workers/pool";

// ── Defaults ──────────────────────────────────────────────────────────

/** Default maximum time per file parse in milliseconds. */
export const DEFAULT_PARSE_TIMEOUT_MS = 10_000;

/** Default number of concurrent parse operations. */
export const DEFAULT_CONCURRENCY = 4;

/**
 * Slack added to the per-file parse deadline to form the worker-pool TASK
 * timeout (FEAT-DAEMON-002C). The task bundles grammar lazy-load + the
 * synchronous `parser.parse()` + visitor extraction, so the pool-level ceiling
 * must sit ABOVE the in-worker parse abort — otherwise the pool would kill a
 * worker mid-grammar-load before the graceful in-parse timeout could fire. The
 * in-worker `progressCallback` remains the primary bound; this is the backstop.
 */
export const PARSE_WORKER_TASK_SLACK_MS = 15_000;

/**
 * Warm-up task ceiling (FEAT-DAEMON-002C): the first `initialize()` sends one
 * `warmup` task that only instantiates web-tree-sitter WASM in a worker. Used
 * as a floor so a disabled parse timeout (`0`) still bounds the handshake.
 */
export const PARSE_WORKER_WARMUP_TIMEOUT_MS = 30_000;

// ── Configuration resolution ──────────────────────────────────────────

/** Read the parse timeout from environment, falling back to the programmatic default. */
export function resolveParseTimeoutMs(override?: number): number {
	if (override !== undefined) return override;
	const env = parseInt(process.env.CODEBASE_INDEX_PARSE_TIMEOUT_MS ?? "", 10);
	if (!isNaN(env) && env > 0) return env;
	return DEFAULT_PARSE_TIMEOUT_MS;
}

/**
 * Read the requested concurrency from the programmatic override or environment
 * (0 = auto, falling back to the programmatic default).
 *
 * Precedence (issue #65, TASK-237):
 *   1. Explicit programmatic override
 *   2. `CODEBASE_INDEX_WORKERS` (preferred; a value of 0 = auto → default)
 *   3. `CODEBASE_INDEX_PARSE_CONCURRENCY` (legacy alias — kept for back-compat)
 *   4. `DEFAULT_CONCURRENCY` (4)
 */
function resolveRequestedConcurrency(override?: number): number {
	if (override !== undefined && override > 0) return override;
	// Preferred knob: CODEBASE_INDEX_WORKERS (0 = auto → default).
	const workers = parseInt(process.env.CODEBASE_INDEX_WORKERS ?? "", 10);
	if (!isNaN(workers) && workers > 0) return workers;
	// Legacy alias: CODEBASE_INDEX_PARSE_CONCURRENCY.
	const env = parseInt(process.env.CODEBASE_INDEX_PARSE_CONCURRENCY ?? "", 10);
	if (!isNaN(env) && env > 0) return env;
	return DEFAULT_CONCURRENCY;
}

/**
 * Resolve the parser worker-pool size (FEAT-DAEMON-002C).
 *
 * This is now the REAL number of worker threads the pool spawns — not merely a
 * semaphore slot count. It applies the {@link resolveRequestedConcurrency}
 * precedence and then clamps the result to `[1, os.availableParallelism()]`
 * (via the shared {@link clampPoolSize}) so `CODEBASE_INDEX_WORKERS` can never
 * oversubscribe the host — matching the generic WorkerPool's own sizing
 * contract. The same value also bounds the parse-pipeline's concurrent batch.
 */
export function resolveConcurrency(override?: number): number {
	return clampPoolSize(resolveRequestedConcurrency(override));
}
