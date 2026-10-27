/**
 * PERF-003 — idempotent embedding backfill.
 *
 * The startup backfill used to mark a vector stale whenever
 * `vector.updated_at < entity.updated_at`, so ANY metadata-only `updated_at`
 * bump (notably the soul-maintenance importance decay that rewrites
 * `importance`/`updated_at` on thousands of memories) re-embedded the whole
 * corpus on every restart.
 *
 * The fix compares the vector row's stored `content_hash` + `model_version`
 * against the entity's CURRENT embed/KG payload:
 *   - no vector row                       → enqueue
 *   - stored hash/version differ          → enqueue
 *   - stored hash + version match         → NO enqueue (idempotent)
 *   - metadata-only `updated_at` bump     → NO enqueue (hash unchanged)
 *
 * These tests exercise the decision through the real `Outbox` + worker write
 * path so the hash stored at apply time is proven comparable to the hash the
 * backfill computes. In-memory store only — never touches storage/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { Outbox } from "../embedding-queue/outbox";
import { EmbeddingWorker } from "../embedding-queue/worker";
import {
	enqueueMemory,
	enqueueStandard,
	enqueueTask,
	memoryJobPayload,
	standardJobPayload,
	taskJobPayload
} from "../embedding-queue/enqueue";
import { embedPayloadContentHash } from "../embedding-queue/content-hash";
import { currentEmbeddingModelVersion } from "../storage/embedding-model";
import type { RealVectorStore } from "../storage/vectors";
import type { MemoryEntry } from "../types";
import { makeTask, makeMemory, makeStandard, makeWorker, getJob, countRows } from "./embedding-queue.helpers";

/**
 * Vectors stub that returns ONE vector per input text (the shared
 * `makeStubVectors` always returns a single row, which only works for
 * single-job batches). `runOnce` batches every pending job, so the
 * end-to-end test needs a per-text stub.
 */
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

/** Read the provenance columns of a derived vector row. */
function readVectorMeta(
	db: SQLiteStore,
	table: "memory_vectors" | "task_vectors" | "standard_vectors",
	pk: string,
	id: string
): { content_hash: string | null; model_version: number | null } | undefined {
	return db.db.prepare(`SELECT content_hash, model_version FROM derived.${table} WHERE ${pk} = ?`).get(id) as
		| { content_hash: string | null; model_version: number | null }
		| undefined;
}

describe("PERF-003 — backfill re-embed predicate", () => {
	let db: SQLiteStore;
	let outbox: Outbox;
	const version = currentEmbeddingModelVersion();

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("missing vector → enqueue", () => {
		const memory = makeMemory();
		db.memories.insert(memory);

		expect(outbox.backfillMissingVectors(100)).toBe(1);
		expect(getJob(db, "memory", memory.id)!.status).toBe("pending");
	});

	it("identical content_hash + model_version → NO enqueue", () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		const hash = embedPayloadContentHash(memoryPayload(memory));
		db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2], { contentHash: hash, modelVersion: version });

		expect(outbox.backfillMissingVectors(100)).toBe(0);
		expect(getJob(db, "memory", memory.id)).toBeUndefined();
	});

	it("changed content → enqueue", () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		const staleHash = embedPayloadContentHash(memoryPayload(memory));
		db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2], {
			contentHash: staleHash,
			modelVersion: version
		});

		// A genuine content change: the embedded content differs, so the
		// stored hash no longer matches the entity's current payload.
		db.db
			.prepare("UPDATE memories SET content = ?, updated_at = ? WHERE id = ?")
			.run("A completely different memory body", new Date().toISOString(), memory.id);

		expect(outbox.backfillMissingVectors(100)).toBe(1);
	});

	it("changed model_version → enqueue (even with identical content)", () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		const hash = embedPayloadContentHash(memoryPayload(memory));
		// A DIFFERENT model version (as if the model had been upgraded).
		db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2], {
			contentHash: hash,
			modelVersion: version + 1
		});

		expect(outbox.backfillMissingVectors(100)).toBe(1);
	});

	it("metadata-only updated_at bump → NO enqueue", () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		const hash = embedPayloadContentHash(memoryPayload(memory));
		db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2], { contentHash: hash, modelVersion: version });

		// Simulate the soul-maintenance decay: importance + updated_at change,
		// content/title unchanged → the embed payload hash is identical.
		db.db
			.prepare("UPDATE memories SET importance = 2, updated_at = ? WHERE id = ?")
			.run(new Date(Date.now() + 60_000).toISOString(), memory.id);

		expect(outbox.backfillMissingVectors(100)).toBe(0);
	});

	it("NULL stored hash (pre-PERF-003 row) → enqueue once, then idempotent after the worker stamps it", async () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		// A pre-fix vector row: no provenance columns stamped.
		db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2]);

		expect(outbox.backfillMissingVectors(100)).toBe(1);

		// The worker applies the job and stamps the hash; a second backfill is a
		// no-op.
		const worker = makeWorker(db);
		expect(await worker.runOnce()).toBe(1);

		const row = readVectorMeta(db, "memory_vectors", "memory_id", memory.id)!;
		expect(row.content_hash).not.toBeNull();
		expect(row.model_version).toBe(version);
		expect(outbox.backfillMissingVectors(100)).toBe(0);
	});
});

describe("PERF-003 — backfill is idempotent across repeated restarts", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("second backfill run enqueues 0 when the jobs are already queued", () => {
		const memory = makeMemory();
		const standard = makeStandard();
		const task = makeTask();
		db.memories.insert(memory);
		db.standards.insert(standard);
		db.tasks.insertTask(task);

		// First pass: every vector is missing → all three enqueued.
		expect(outbox.backfillMissingVectors(100)).toBe(3);

		// A restart with the same entities but the jobs already queued:
		// enqueueIfAbsent keeps the second pass at 0.
		expect(outbox.backfillMissingVectors(100)).toBe(0);
	});

	it("after the worker stamps vectors, restarts enqueue 0 (end-to-end)", async () => {
		const memory = makeMemory();
		const standard = makeStandard();
		const task = makeTask();
		db.memories.insert(memory);
		db.standards.insert(standard);
		db.tasks.insertTask(task);

		enqueueMemory(db, memory);
		enqueueStandard(db, standard);
		enqueueTask(db, task);

		const worker = makeBatchWorker(db);
		// Drain the three jobs (batchSize 32 → one runOnce covers all).
		expect(await worker.runOnce()).toBe(3);

		// Every vector row now carries the hash + version the backfill compares.
		const memRow = readVectorMeta(db, "memory_vectors", "memory_id", memory.id)!;
		expect(memRow.content_hash).toBe(embedPayloadContentHash(memoryPayload(memory)));
		expect(memRow.model_version).toBe(currentEmbeddingModelVersion());

		const taskRow = readVectorMeta(db, "task_vectors", "task_id", task.id)!;
		expect(taskRow.content_hash).toBe(embedPayloadContentHash(taskJobPayload(task)));
		expect(taskRow.model_version).toBe(currentEmbeddingModelVersion());

		const stdRow = readVectorMeta(db, "standard_vectors", "standard_id", standard.id)!;
		expect(stdRow.content_hash).toBe(embedPayloadContentHash(standardJobPayload(standard)));
		expect(stdRow.model_version).toBe(currentEmbeddingModelVersion());

		// Repeated restarts are now genuinely no-ops.
		expect(outbox.backfillMissingVectors(100)).toBe(0);
		expect(outbox.backfillMissingVectors(100)).toBe(0);
	});
});

describe("PERF-FIX-001 — terminal `done` queue rows cannot block a required re-embed", () => {
	let db: SQLiteStore;
	let outbox: Outbox;
	const version = currentEmbeddingModelVersion();

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("post-drain + model_version mismatch → exactly 1 enqueue, and the row is revived to pending", () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		const hash = embedPayloadContentHash(memoryPayload(memory));
		// The post-drain state: a vector stamped with the CURRENT hash but a
		// STALE model_version, plus the terminal `done` row `Outbox.complete()`
		// leaves behind (it marks done, it does not delete).
		db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2], { contentHash: hash, modelVersion: version + 1 });
		enqueueMemory(db, memory);
		db.db.prepare("UPDATE queue_jobs SET status = 'done', attempts = 2 WHERE entity_id = ?").run(memory.id);

		// Before PERF-FIX-001 this returned 0: the terminal row conflicted and
		// the required re-enqueue was silently dropped for up to 6h.
		expect(outbox.backfillMissingVectors(100)).toBe(1);

		const row = getJob(db, "memory", memory.id)!;
		expect(row.status).toBe("pending");
		expect(row.attempts).toBe(0);
		expect(row.content_hash).toBe(hash);

		// Exactly once: a second pass is a no-op (the row is now live/pending).
		expect(outbox.backfillMissingVectors(100)).toBe(0);
	});

	it("post-drain + content_hash mismatch → exactly 1 enqueue", () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		const currentHash = embedPayloadContentHash(memoryPayload(memory));
		// Stale hash, current model_version, terminal `done` row.
		db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2], {
			contentHash: "stale-hash-does-not-match",
			modelVersion: version
		});
		enqueueMemory(db, memory);
		db.db.prepare("UPDATE queue_jobs SET status = 'done', attempts = 1 WHERE entity_id = ?").run(memory.id);

		expect(outbox.backfillMissingVectors(100)).toBe(1);

		const row = getJob(db, "memory", memory.id)!;
		expect(row.status).toBe("pending");
		expect(row.content_hash).toBe(currentHash);
		expect(outbox.backfillMissingVectors(100)).toBe(0);
	});

	it("post-drain + unchanged content/version → 0 enqueues (idempotency preserved)", () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		const hash = embedPayloadContentHash(memoryPayload(memory));
		db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2], { contentHash: hash, modelVersion: version });
		enqueueMemory(db, memory);
		db.db.prepare("UPDATE queue_jobs SET status = 'done', attempts = 3 WHERE entity_id = ?").run(memory.id);

		// `needsReembed` is false, so the terminal row must stay untouched —
		// the fix must not turn every drained row into a re-embed.
		expect(outbox.backfillMissingVectors(100)).toBe(0);

		const row = getJob(db, "memory", memory.id)!;
		expect(row.status).toBe("done");
		expect(row.attempts).toBe(3);
	});

	it("a poison row that still needs a re-embed is NOT reset by the backfill", () => {
		const memory = makeMemory();
		db.memories.insert(memory);
		// No vector row → `needsReembed` is true, but the row is terminal
		// `poison`: the backfill must never reset it (poison recovery is purge
		// TTL + the write path's LWW reset, TASK-068/069).
		enqueueMemory(db, memory);
		db.db
			.prepare("UPDATE queue_jobs SET status = 'poison', attempts = 5, last_error = 'FK failure' WHERE entity_id = ?")
			.run(memory.id);

		expect(outbox.backfillMissingVectors(100)).toBe(0);

		const row = getJob(db, "memory", memory.id)!;
		expect(row.status).toBe("poison");
		expect(row.attempts).toBe(5);
		expect(row.last_error).toBe("FK failure");
	});
});

describe("PERF-003 — backfill preserves live job backoff", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("a pending row in exponential backoff is never reset by backfill", () => {
		const taskA = makeTask();
		const taskB = makeTask({ title: "Absent task B" });
		db.tasks.insertTask(taskA);
		db.tasks.insertTask(taskB);
		enqueueTask(db, taskA);

		const futureBackoff = new Date(Date.now() + 60_000).toISOString();
		db.db
			.prepare("UPDATE queue_jobs SET attempts = 3, backoff_until = ?, last_error = 'FK failure' WHERE entity_id = ?")
			.run(futureBackoff, taskA.id);

		const enqueued = outbox.backfillMissingVectors(100);
		expect(enqueued).toBe(1); // only the absent task B

		const rowA = getJob(db, "task", taskA.id)!;
		expect(rowA.status).toBe("pending");
		expect(rowA.attempts).toBe(3);
		expect(rowA.backoff_until).toBe(futureBackoff);
		expect(rowA.last_error).toBe("FK failure");

		const rowB = getJob(db, "task", taskB.id)!;
		expect(rowB.attempts).toBe(0);
		expect(rowB.backoff_until).toBeNull();
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs")).toBe(2);
	});
});
