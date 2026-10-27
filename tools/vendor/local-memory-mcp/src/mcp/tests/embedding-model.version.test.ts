/**
 * PERF-004 — explicit embedding-model version + full-refresh upgrade path.
 *
 * `src/mcp/storage/embedding-model.ts` is the single source of truth for the
 * model NAME and the integer `model_version` stamped on every `*_vectors` row.
 * These tests pin:
 *   1. `currentEmbeddingModelVersion()` returns the explicit
 *      `EMBEDDING_MODEL_VERSION` and is stable (the public accessor contract);
 *   2. a version change (stored row != current) re-enqueues EVERY affected row
 *      for re-embedding EXACTLY ONCE, and repeated restarts at the new version
 *      enqueue 0 (the upgrade procedure);
 *   3. an unchanged version enqueues 0 (no regression to the PERF-003
 *      idempotency contract);
 *   4. `RealVectorStore` loads its feature-extraction pipeline from the shared
 *      `EMBEDDING_MODEL_NAME` — no second hardcoded model name.
 *
 * In-memory store only (`createTestStore`) — never touches storage/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { Outbox } from "../embedding-queue/outbox";
import { EmbeddingWorker } from "../embedding-queue/worker";
import {
	EMBEDDING_MODEL_NAME,
	EMBEDDING_MODEL_VERSION,
	currentEmbeddingModelVersion
} from "../storage/embedding-model";
import * as embeddingModel from "../storage/embedding-model";
import { memoryJobPayload, standardJobPayload, taskJobPayload } from "../embedding-queue/enqueue";
import { embedPayloadContentHash } from "../embedding-queue/content-hash";
import type { RealVectorStore } from "../storage/vectors";
import type { MemoryEntry } from "../types";
import { makeTask, makeMemory, makeStandard, getJob } from "./embedding-queue.helpers";

/**
 * Shared reference to the mocked `env.backends.onnx` (hoisted so the `vi.mock`
 * factory and the assertions share ONE instance). Mirrors
 * vectors.threads.test.ts — the real ONNX runtime / model is never loaded.
 */
const { onnxEnvMock, pipelineMock } = vi.hoisted(() => {
	return {
		onnxEnvMock: { wasm: {} as { numThreads?: number }, logLevel: "" } as {
			wasm: { numThreads?: number };
			intraOpNumThreads?: number;
			interOpNumThreads?: number;
			logLevel: string;
		},
		pipelineMock: vi.fn()
	};
});

vi.mock("@xenova/transformers", () => ({
	env: { backends: { onnx: onnxEnvMock } },
	pipeline: pipelineMock
}));

/** Vectors stub returning one vector per input text (batch-safe). */
function makeBatchVectors(): RealVectorStore {
	return {
		embed: vi.fn().mockImplementation(async (texts: string[]) => texts.map(() => [0.1, 0.2]))
	} as unknown as RealVectorStore;
}

/** Worker with a per-text vectors stub and no backfill (tests drive backfill). */
function makeBatchWorker(db: SQLiteStore): EmbeddingWorker {
	return new EmbeddingWorker(db, makeBatchVectors(), {
		batchSize: 32,
		leaseMs: 60_000,
		poisonThreshold: 3,
		backoffBaseMs: 1_000,
		backoffMaxMs: 60_000,
		pollIntervalMs: 3_600_000,
		purgeIntervalMs: 3_600_000,
		backfillCap: 0
	});
}

/** The embed/KG payload the enqueue path builds for a memory. */
function memoryPayload(memory: MemoryEntry) {
	return memoryJobPayload({
		title: memory.title,
		content: memory.content,
		owner: memory.scope.owner,
		repo: memory.scope.repo,
		updatedAt: memory.updated_at
	});
}

/** Read the model_version of a derived vector row. */
function readModelVersion(
	db: SQLiteStore,
	table: "memory_vectors" | "task_vectors" | "standard_vectors",
	pk: string,
	id: string
): number | null {
	const row = db.db.prepare(`SELECT model_version FROM derived.${table} WHERE ${pk} = ?`).get(id) as
		| { model_version: number | null }
		| undefined;
	return row?.model_version ?? null;
}

describe("PERF-004 — explicit embedding-model version constant", () => {
	it("currentEmbeddingModelVersion() returns the explicit EMBEDDING_MODEL_VERSION", () => {
		expect(currentEmbeddingModelVersion()).toBe(EMBEDDING_MODEL_VERSION);
	});

	it("is stable across repeated calls and the model name is shared", () => {
		expect(currentEmbeddingModelVersion()).toBe(currentEmbeddingModelVersion());
		expect(EMBEDDING_MODEL_NAME).toBe("Xenova/all-MiniLM-L6-v2");
		expect(Number.isInteger(EMBEDDING_MODEL_VERSION)).toBe(true);
		expect(EMBEDDING_MODEL_VERSION).toBeGreaterThanOrEqual(1);
	});
});

describe("PERF-004 — version change triggers a one-time full refresh", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("re-enqueues every row once at the new version, then restarts enqueue 0", async () => {
		const memoryA = makeMemory();
		const memoryB = makeMemory({ title: "Second memory" });
		const standard = makeStandard();
		const task = makeTask();
		db.memories.insert(memoryA);
		db.memories.insert(memoryB);
		db.standards.insert(standard);
		db.tasks.insertTask(task);

		// A stale-but-present vector at the PREVIOUS model version: the content
		// hash matches exactly, so the ONLY reason to re-embed is the version
		// mismatch. This is precisely the post-upgrade state.
		const staleVersion = EMBEDDING_MODEL_VERSION + 1;
		db.memoryVectors.upsertVectorEmbedding(memoryA.id, [0.1, 0.2], {
			contentHash: embedPayloadContentHash(memoryPayload(memoryA)),
			modelVersion: staleVersion
		});
		db.memoryVectors.upsertVectorEmbedding(memoryB.id, [0.1, 0.2], {
			contentHash: embedPayloadContentHash(memoryPayload(memoryB)),
			modelVersion: staleVersion
		});
		db.standards.upsertVectorEmbedding(standard.id, [0.1, 0.2], {
			contentHash: embedPayloadContentHash(standardJobPayload(standard)),
			modelVersion: staleVersion
		});
		db.tasks.upsertTaskVectorEmbedding(task.id, [0.1, 0.2], {
			contentHash: embedPayloadContentHash(taskJobPayload(task)),
			modelVersion: staleVersion
		});

		// First startup at the new version: every affected row is enqueued.
		expect(outbox.backfillMissingVectors(100)).toBe(4);
		// A second startup while those jobs are still queued: 0 (insert-only).
		expect(outbox.backfillMissingVectors(100)).toBe(0);

		// The worker re-embeds all four and stamps the current version.
		const worker = makeBatchWorker(db);
		expect(await worker.runOnce()).toBe(4);

		expect(readModelVersion(db, "memory_vectors", "memory_id", memoryA.id)).toBe(EMBEDDING_MODEL_VERSION);
		expect(readModelVersion(db, "memory_vectors", "memory_id", memoryB.id)).toBe(EMBEDDING_MODEL_VERSION);
		expect(readModelVersion(db, "standard_vectors", "standard_id", standard.id)).toBe(EMBEDDING_MODEL_VERSION);
		expect(readModelVersion(db, "task_vectors", "task_id", task.id)).toBe(EMBEDDING_MODEL_VERSION);

		// Every row now matches the current version → restarts enqueue 0.
		expect(outbox.backfillMissingVectors(100)).toBe(0);
		expect(outbox.backfillMissingVectors(100)).toBe(0);
	});

	it("a mocked version bump re-enqueues matching rows; restoring the version makes it 0 again", () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		const hash = embedPayloadContentHash(memoryPayload(memory));
		// Current, fully up-to-date row.
		db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2], {
			contentHash: hash,
			modelVersion: EMBEDDING_MODEL_VERSION
		});

		expect(outbox.backfillMissingVectors(100)).toBe(0);

		// Simulate the operator bumping EMBEDDING_MODEL_VERSION: the stored row
		// is now behind the "current" version and must be re-enqueued.
		const spy = vi.spyOn(embeddingModel, "currentEmbeddingModelVersion").mockReturnValue(EMBEDDING_MODEL_VERSION + 1);
		expect(outbox.backfillMissingVectors(100)).toBe(1);
		expect(getJob(db, "memory", memory.id)!.status).toBe("pending");
		spy.mockRestore();
	});

	it("an unchanged version + matching hash enqueues 0 (PERF-003 contract intact)", () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2], {
			contentHash: embedPayloadContentHash(memoryPayload(memory)),
			modelVersion: currentEmbeddingModelVersion()
		});

		expect(outbox.backfillMissingVectors(100)).toBe(0);
		expect(getJob(db, "memory", memory.id)).toBeUndefined();
	});
});

describe("PERF-004 — RealVectorStore uses the shared model name", () => {
	afterEach(() => {
		pipelineMock.mockReset();
		delete onnxEnvMock.wasm.numThreads;
		delete onnxEnvMock.intraOpNumThreads;
		delete onnxEnvMock.interOpNumThreads;
		onnxEnvMock.logLevel = "";
		delete process.env.MCP_SERVER;
		vi.resetModules();
	});

	it("loads the feature-extraction pipeline with EMBEDDING_MODEL_NAME", async () => {
		vi.resetModules();
		const { RealVectorStore } = await import("../storage/vectors");
		const extractor = vi.fn();
		pipelineMock.mockResolvedValue(extractor);

		const store = new RealVectorStore({} as never);
		const loaded = await (store as unknown as { getExtractor(): Promise<unknown> }).getExtractor();

		expect(loaded).toBe(extractor);
		expect(pipelineMock).toHaveBeenCalledTimes(1);
		expect(pipelineMock).toHaveBeenCalledWith("feature-extraction", EMBEDDING_MODEL_NAME);
	});
});
