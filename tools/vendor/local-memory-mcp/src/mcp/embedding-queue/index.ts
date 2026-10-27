/**
 * Embedding/KG outbox queue — SQLite-backed job queue + in-process lease
 * worker (TASK-013 / MEM-368).
 *
 * - `enqueue*` helpers are synchronous (~µs) and safe inside the write lock.
 * - `EmbeddingWorker` drains the queue in the background (batched ONNX +
 *   compromise KG), never holding the proper-lockfile write lock.
 * - Both the MCP server and the dashboard run their own worker against the
 *   shared `queue_jobs` table; atomic claims serialize across processes.
 *
 * Layout (TASK-074): `outbox.ts` owns the worker-facing `Outbox` lifecycle
 * (claim/complete/fail/reconcile/purge/count); `enqueue.ts` owns the
 * synchronous enqueue helpers, snapshot payload builders, and startup
 * backfill.
 */
export { Outbox, outboxFor } from "./outbox";
export type { Outbox as OutboxInstance } from "./outbox";
export {
	backfillMissingVectors,
	codebaseEntityId,
	codebaseEntityParts,
	codebaseSymbolJobPayload,
	countByStatus,
	enqueueCodebaseSymbols,
	enqueueEmbeddingJob,
	enqueueIfAbsent,
	enqueueMemory,
	enqueueStandard,
	enqueueTask,
	memoryJobPayload,
	standardJobPayload,
	taskJobPayload
} from "./enqueue";
export { EmbeddingWorker } from "./worker";
export type { EmbeddingWorkerOptions } from "./worker";
export type {
	EmbeddingJobInput,
	EmbeddingJobPayload,
	EmbeddingWorkerStats,
	QueueCounts,
	QueueJobKind,
	QueueJobListOptions,
	QueueJobRow,
	QueueJobStatus
} from "./types";
