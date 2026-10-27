/**
 * Embedding-worker option types + env-backed defaults (TASK-554 split out of
 * `worker.ts`).
 *
 * `EmbeddingWorkerOptions` is the public, all-optional construction contract
 * used by the MCP server, the dashboard, and the test suites. The defaults
 * below mirror the env configuration exactly (`EMBEDDING_QUEUE_*` constants) —
 * each option falls back to its env constant when omitted, so callers can
 * override only what they need without forking the env behavior (TASK-554
 * preserves the original env-config contract).
 */

import {
	EMBEDDING_LAZY_WARMUP,
	EMBEDDING_QUEUE_BACKFILL_CAP,
	EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE,
	EMBEDDING_QUEUE_BACKOFF_BASE_MS,
	EMBEDDING_QUEUE_BACKOFF_MAX_MS,
	EMBEDDING_QUEUE_BATCH_SIZE,
	EMBEDDING_QUEUE_DONE_TTL_MS,
	EMBEDDING_QUEUE_LEASE_MS,
	EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS,
	EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK,
	EMBEDDING_QUEUE_POISON_THRESHOLD,
	EMBEDDING_QUEUE_POISON_TTL_MS,
	EMBEDDING_QUEUE_POLL_INTERVAL_MS,
	EMBEDDING_QUEUE_PURGE_INTERVAL_MS
} from "../../utils/constants";

export interface EmbeddingWorkerOptions {
	pollIntervalMs?: number;
	maxPollIntervalMs?: number;
	batchSize?: number;
	leaseMs?: number;
	poisonThreshold?: number;
	backoffBaseMs?: number;
	backoffMaxMs?: number;
	backfillCap?: number;
	backfillMinQueue?: number;
	doneTtlMs?: number;
	poisonTtlMs?: number;
	purgeIntervalMs?: number;
	/**
	 * Consecutive non-empty batches before the worker backs off from the fast
	 * half-interval drain to `pollIntervalMs`. Defaults to the
	 * EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK env constant (5).
	 */
	nonEmptyBackoffStreak?: number;
	/**
	 * When true, the worker does NOT eagerly warm the ONNX model on `start()`;
	 * the model is loaded on first use (first claimed batch) instead. Defaults
	 * to the EMBEDDING_LAZY_WARMUP env constant (false = eager, preserving the
	 * historical `full`-profile startup warm-up).
	 */
	lazyWarmup?: boolean;
}

/**
 * A fully-resolved worker configuration — every option present with its
 * effective value. Built once in the `EmbeddingWorker` constructor via
 * {@link resolveWorkerOptions}.
 */
export type ResolvedWorkerOptions = Required<EmbeddingWorkerOptions>;

/** Resolve user options against the env-backed defaults (see module doc). */
export function resolveWorkerOptions(options: EmbeddingWorkerOptions): ResolvedWorkerOptions {
	return {
		pollIntervalMs: options.pollIntervalMs ?? EMBEDDING_QUEUE_POLL_INTERVAL_MS,
		maxPollIntervalMs: options.maxPollIntervalMs ?? EMBEDDING_QUEUE_MAX_POLL_INTERVAL_MS,
		batchSize: options.batchSize ?? EMBEDDING_QUEUE_BATCH_SIZE,
		leaseMs: options.leaseMs ?? EMBEDDING_QUEUE_LEASE_MS,
		poisonThreshold: options.poisonThreshold ?? EMBEDDING_QUEUE_POISON_THRESHOLD,
		backoffBaseMs: options.backoffBaseMs ?? EMBEDDING_QUEUE_BACKOFF_BASE_MS,
		backoffMaxMs: options.backoffMaxMs ?? EMBEDDING_QUEUE_BACKOFF_MAX_MS,
		backfillCap: options.backfillCap ?? EMBEDDING_QUEUE_BACKFILL_CAP,
		backfillMinQueue: options.backfillMinQueue ?? EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE,
		doneTtlMs: options.doneTtlMs ?? EMBEDDING_QUEUE_DONE_TTL_MS,
		poisonTtlMs: options.poisonTtlMs ?? EMBEDDING_QUEUE_POISON_TTL_MS,
		purgeIntervalMs: options.purgeIntervalMs ?? EMBEDDING_QUEUE_PURGE_INTERVAL_MS,
		nonEmptyBackoffStreak: options.nonEmptyBackoffStreak ?? EMBEDDING_QUEUE_NON_EMPTY_BACKOFF_STREAK,
		lazyWarmup: options.lazyWarmup ?? EMBEDDING_LAZY_WARMUP
	};
}
