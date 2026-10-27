/**
 * EmbeddingWorker internals — split out of `worker.ts` (TASK-554).
 *
 * The directory mirrors the original single-file responsibilities:
 * - `options.ts` — `EmbeddingWorkerOptions` + env-backed default resolution.
 * - `sqlite-busy.ts` — `isBusyError` (TASK-457 lock-contention classification).
 * - `counters.ts` — monotonic processed/failed/poisoned job counters.
 * - `poll-delay.ts` — exponential idle/drain poll-delay state machine.
 * - `latency.ts` — ONNX batch-latency sampling (per-worker + process metrics).
 * - `batch.ts` — the claim→parse→existence-check→embed→apply→complete cycle.
 * - `maintenance.ts` — startup reconcile/backfill/purge + purge sweep.
 *
 * `worker.ts` re-exports the public surface (`EmbeddingWorker`,
 * `EmbeddingWorkerOptions`, `isBusyError`) so existing importers are
 * unaffected.
 */
export { resolveWorkerOptions } from "./options";
export type { EmbeddingWorkerOptions, ResolvedWorkerOptions } from "./options";
export { isBusyError } from "./sqlite-busy";
export { createWorkerCounters, recordNoOpComplete } from "./counters";
export type { WorkerCounters } from "./counters";
export { createPollState, nextPollDelay, IDLE_STREAK_CAP, NON_EMPTY_STREAK_CAP } from "./poll-delay";
export type { PollState } from "./poll-delay";
export { timeEmbedBatch } from "./latency";
export { drainClaimedBatch, runOutboxWrite } from "./batch";
export type { ApplyItem, ResolvedJob } from "./batch";
export { runPurgeSweep, runStartupMaintenance } from "./maintenance";
