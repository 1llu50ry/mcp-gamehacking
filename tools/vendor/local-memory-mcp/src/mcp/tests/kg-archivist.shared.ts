import { vi } from "vitest";
import { EmbeddingWorker } from "../embedding-queue/worker";
import { RealVectorStore } from "../storage/vectors";
import { SQLiteStore } from "../storage/sqlite";
import type { VectorStore } from "../types/vector";

// Shared KG-archivist test helpers, extracted from kg-archivist.test.ts during
// the TASK-427 file-size refactor so the per-concern split files don't each
// duplicate them.

export function makeMockVectorStore(): VectorStore {
	return {
		upsert: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		search: vi.fn().mockResolvedValue([])
	};
}

/**
 * Stand-in embedding backend — the worker only needs `embed()` to run one cycle.
 */
export function makeWorkerVectors(): RealVectorStore {
	return { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) } as unknown as RealVectorStore;
}

/**
 * Drain the embedding outbox so enqueued memory jobs run their KG extraction.
 * memory-write enqueues (TASK-013) and the worker extracts asynchronously, so
 * tests asserting on entities/observations must run one worker cycle first.
 */
export async function drainOutbox(db: SQLiteStore): Promise<void> {
	await new EmbeddingWorker(db, makeWorkerVectors(), {
		batchSize: 32,
		leaseMs: 60_000,
		poisonThreshold: 3,
		backoffBaseMs: 1_000,
		backoffMaxMs: 60_000,
		pollIntervalMs: 3_600_000,
		purgeIntervalMs: 3_600_000,
		backfillCap: 0
	}).runOnce();
}
