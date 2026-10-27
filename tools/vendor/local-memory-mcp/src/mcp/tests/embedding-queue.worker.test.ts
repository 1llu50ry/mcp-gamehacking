import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { Outbox, enqueueTask, enqueueMemory, enqueueCodebaseSymbols } from "../embedding-queue/outbox";
import { codebaseEntityId } from "../embedding-queue/enqueue";
import { EmbeddingWorker, isBusyError } from "../embedding-queue/worker";
import { RealVectorStore } from "../storage/vectors";
import { observationText } from "../tools/kg-archivist";
import { handleTaskDelete } from "../tools/task.delete";
import { _queueJobKindInvariant, type QueueJobKind } from "../embedding-queue/types";
import type { CodebaseSymbolInsert, CodebaseReferenceInsert } from "../types";
import { makeTask, makeMemory, makeWorker, makeStubVectors, getJob, countRows, REPO } from "./embedding-queue.helpers";
import { addLogSink } from "../utils/logger";

// ─── EmbeddingWorker behavior ────────────────────────────────────────────
// Split out from embedding-queue.test.ts (the worker half) to keep that file
// within the 500-line maintainability limit. Shared fixtures live in
// embedding-queue.helpers.ts; entity builders mirror the original.

function makeCodebaseSymbols(filePath: string): CodebaseSymbolInsert[] {
	return [
		{
			repo: REPO,
			file_path: filePath,
			name: "OrderService",
			kind: "class",
			signature: "class OrderService",
			doc_comment: "Handles order processing for Acme Corp"
		},
		{
			repo: REPO,
			file_path: filePath,
			name: "computeTotal",
			kind: "function",
			signature: "computeTotal(items)",
			doc_comment: "Computes the order total"
		}
	];
}

function makeCodebaseRefs(filePath: string): CodebaseReferenceInsert[] {
	return [
		{
			repo: REPO,
			symbol_name: "computeTotal",
			caller_file: filePath,
			caller_line: 5,
			caller_name: "OrderService",
			kind: "call"
		},
		{
			repo: REPO,
			symbol_name: "ExternalDep",
			caller_file: filePath,
			caller_line: 9,
			caller_name: "OrderService",
			kind: "import"
		}
	];
}

describe("EmbeddingWorker — canceled task jobs complete as no-ops (TASK-042)", () => {
	let db: SQLiteStore;
	let worker: EmbeddingWorker;

	beforeEach(async () => {
		db = await createTestStore();
		worker = makeWorker(db);
	});

	afterEach(() => {
		db.close();
	});

	it("a stale pending job for a canceled task is completed without embedding or KG extraction", async () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		// Soft-delete the task WITHOUT purging the queue row (the race the
		// purge + worker guard exist for — a job enqueued before the cancel).
		const now = new Date().toISOString();
		db.tasks.updateTask(task.id, { status: "canceled", canceled_at: now });
		expect(getJob(db, "task", task.id)).toBeDefined();

		const claimed = await worker.runOnce();
		expect(claimed).toBe(1);

		// Job completed as a no-op: no vector, no KG entities/observations.
		expect(getJob(db, "task", task.id)!.status).toBe("done");
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM task_vectors WHERE task_id = ?", [task.id])).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations")).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities")).toBe(0);
	});

	it("worker processes an active task; deleting it purges queue + vector + observations (TASK-042/045)", async () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		const claimed = await worker.runOnce();
		expect(claimed).toBe(1);

		// Worker wrote the vector + task-domain observations.
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM task_vectors WHERE task_id = ?", [task.id])).toBe(1);
		const obsText = observationText("task", task.title);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBeGreaterThan(
			0
		);

		// Deleting the task purges the queue row, the vector and the
		// observations its extracted entities created.
		await handleTaskDelete({ id: task.id, owner: "test", repo: REPO, json: true }, db);

		expect(getJob(db, "task", task.id)).toBeUndefined();
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM task_vectors WHERE task_id = ?", [task.id])).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations")).toBe(0);
	});
});

describe("EmbeddingWorker — non-empty drain cadence (TASK-069/TASK-074)", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
	});

	it("backs off to pollIntervalMs after nonEmptyBackoffStreak consecutive non-empty batches", () => {
		const worker = new EmbeddingWorker(db, makeStubVectors(), {
			batchSize: 32,
			leaseMs: 60_000,
			poisonThreshold: 3,
			backoffBaseMs: 1_000,
			backoffMaxMs: 60_000,
			pollIntervalMs: 1_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0,
			nonEmptyBackoffStreak: 3
		});

		// First two non-empty cycles poll at the fast half interval.
		expect(worker.nextDelay(1)).toBe(500);
		expect(worker.nextDelay(1)).toBe(500);

		// Third consecutive non-empty cycle reaches the streak → full interval.
		expect(worker.nextDelay(1)).toBe(1000);

		// An empty batch resets the streak — fast drain resumes.
		expect(worker.nextDelay(0)).toBeGreaterThanOrEqual(500);
		expect(worker.nextDelay(1)).toBe(500);
	});

	it("defaults nonEmptyBackoffStreak to the env constant (5) when the option is omitted", () => {
		const worker = new EmbeddingWorker(db, makeStubVectors(), {
			pollIntervalMs: 1_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0
		});

		// Four consecutive non-empty cycles stay on the fast half interval...
		for (let i = 0; i < 4; i++) {
			expect(worker.nextDelay(1)).toBe(500);
		}
		// ...and the fifth (streak >= default 5) backs off to the full interval.
		expect(worker.nextDelay(1)).toBe(1000);
	});
});

describe("EmbeddingWorker — lazy ONNX warm-up gate (PERF-005)", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
	});

	it("eager (default): start() warms the model via vectors.initialize()", () => {
		const vectors = makeStubVectors();
		vectors.initialize = vi.fn().mockResolvedValue(undefined);
		const worker = new EmbeddingWorker(db, vectors, {
			pollIntervalMs: 3_600_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0
		});

		worker.start();
		expect(vectors.initialize).toHaveBeenCalledTimes(1);
		worker.stop();
	});

	it("lazy: start() does NOT warm the model — the engine loop still starts", () => {
		const vectors = makeStubVectors();
		vectors.initialize = vi.fn().mockResolvedValue(undefined);
		const worker = new EmbeddingWorker(db, vectors, {
			pollIntervalMs: 3_600_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0,
			lazyWarmup: true
		});

		worker.start();
		expect(vectors.initialize).not.toHaveBeenCalled();
		// The worker is genuinely running (not a silent no-op): its stats
		// report started=true and the model as not-yet-ready.
		const stats = worker.getStats();
		expect(stats.started).toBe(true);
		expect(stats.modelReady).toBe(false);
		worker.stop();
	});
});

describe("EmbeddingWorker — deferred startup maintenance (FIX-025)", () => {
	let db: SQLiteStore;
	let detach: (() => void) | null = null;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		detach?.();
		detach = null;
		db.close();
	});

	/**
	 * FIX-025 latency reduction: on a 2.6GB DB the synchronous startup sweep
	 * (reconcile + backfill + purge) blocked the event loop at boot — exactly
	 * when the HTTP listener is binding and clients send `initialize`. `start()`
	 * now defers the sweep to `setImmediate` so the listener becomes ready
	 * first; the worker still reports `started` synchronously.
	 */
	it("defers the maintenance sweep until after start() returns (listener-first)", async () => {
		const messages: string[] = [];
		detach = addLogSink((payload) => {
			if (typeof payload.data.message === "string") messages.push(payload.data.message);
		});
		const vectors = makeStubVectors();
		vectors.initialize = vi.fn().mockResolvedValue(undefined);
		const worker = new EmbeddingWorker(db, vectors, {
			pollIntervalMs: 3_600_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0
		});

		worker.start();

		// Synchronously after start(): the worker is marked started, but the
		// heavy sweep has NOT run yet (deferred to a later tick).
		expect(worker.getStats().started).toBe(true);
		expect(messages).toContain("[EmbeddingWorker] started");
		expect(messages).not.toContain("[EmbeddingWorker] startup maintenance complete");

		// The sweep settles on its own tick; callers can await it deterministically.
		await worker.whenStartupMaintenanceSettled();
		expect(messages).toContain("[EmbeddingWorker] startup maintenance complete");
		worker.stop();
	});

	it("does not run the deferred sweep after stop() (negative: no work past shutdown)", async () => {
		const messages: string[] = [];
		detach = addLogSink((payload) => {
			if (typeof payload.data.message === "string") messages.push(payload.data.message);
		});
		const vectors = makeStubVectors();
		vectors.initialize = vi.fn().mockResolvedValue(undefined);
		const worker = new EmbeddingWorker(db, vectors, {
			pollIntervalMs: 3_600_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0
		});

		worker.start();
		worker.stop();
		// The deferred callback sees `stopped` and skips the sweep entirely.
		await worker.whenStartupMaintenanceSettled();
		expect(messages).not.toContain("[EmbeddingWorker] startup maintenance complete");
	});
});

describe("EmbeddingWorker — codebase_symbol → KG auto-population (TASK-293)", () => {
	let db: SQLiteStore;
	let worker: EmbeddingWorker;

	beforeEach(async () => {
		db = await createTestStore();
		worker = makeWorker(db);
	});

	afterEach(() => {
		db.close();
	});

	it("positive: a codebase job KG-extracts entities + relations and writes NO vector (no double-vector)", async () => {
		const FILE = "src/order.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols(makeCodebaseSymbols(FILE));
		db.codebaseReferences.bulkUpsertReferences(REPO, makeCodebaseRefs(FILE));

		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE))).toBe(true);
		expect(getJob(db, "codebase_symbol", entityId)).toBeDefined();

		const claimed = await worker.runOnce();
		expect(claimed).toBe(1);
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("done");

		// KG: the file-scoped "codebase" observation exists (shared by
		// saveExtractions + the relation writer) …
		const obsText = observationText("codebase", FILE);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBeGreaterThan(
			0
		);
		// … symbol entities exist (name-keyed; compromise extraction may have
		// created them first with a generic type, so the TYPE is pinned only
		// deterministically in the direct saveCodebaseRelations tests) …
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = 'OrderService'")).toBe(1);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = 'computeTotal'")).toBe(1);
		// … and reference edges (caller → referenced symbol, type = ref kind).
		const callRel = db.db
			.prepare("SELECT relation_type FROM relations WHERE from_entity = 'OrderService' AND to_entity = 'computeTotal'")
			.get() as { relation_type: string } | undefined;
		expect(callRel).toBeDefined();
		expect(callRel!.relation_type).toBe("call");

		// No vector writes: codebase symbols have no vector store (the dead
		// codebase_symbol_vectors table was dropped in migration v35, TASK-042),
		// and the worker must NOT fall into the task-vector branch either — the
		// double-vector guard (TASK-293).
		expect(
			db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codebase_symbol_vectors'").get()
		).toBeUndefined();
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM task_vectors")).toBe(0);
	});

	it("negative: a codebase-only batch never invokes the ONNX embed path — KG extraction still runs (TASK-338)", async () => {
		const FILE = "src/embed-skip.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols(makeCodebaseSymbols(FILE));
		db.codebaseReferences.bulkUpsertReferences(REPO, makeCodebaseRefs(FILE));
		enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE));

		// The embed spy FAILS the test if ONNX inference is attempted — the
		// pre-fix batch embed (worker.ts:290) would reject here, poisoning the
		// job instead of completing it.
		const embedMock = vi.fn().mockRejectedValue(new Error("embed must not run for codebase_symbol jobs"));
		const noEmbedWorker = new EmbeddingWorker(db, { embed: embedMock } as unknown as RealVectorStore, {
			batchSize: 32,
			leaseMs: 60_000,
			poisonThreshold: 3,
			backoffBaseMs: 1_000,
			backoffMaxMs: 60_000,
			pollIntervalMs: 3_600_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0
		});

		const claimed = await noEmbedWorker.runOnce();
		expect(claimed).toBe(1);
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("done");

		// Embed path untouched — zero ONNX inference for the codebase job.
		expect(embedMock).not.toHaveBeenCalled();

		// The KG side still ran: file-scoped observation + symbol entities.
		const obsText = observationText("codebase", FILE);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBeGreaterThan(
			0
		);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = 'OrderService'")).toBe(1);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = 'computeTotal'")).toBe(1);
	});

	it("mixed batch: only memory/standard/task texts reach ONNX; codebase jobs embed-skip with a placeholder vector (TASK-338)", async () => {
		const FILE = "src/mixed.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols(makeCodebaseSymbols(FILE));
		enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE));

		const memory = makeMemory();
		db.memories.insert(memory);
		enqueueMemory(db, memory);

		// Single 1-D vector is enough: exactly ONE text may reach the embed
		// call — the codebase symbol payload must be filtered out.
		const embedMock = vi.fn().mockResolvedValue([[0.1, 0.2]]);
		const mixedWorker = new EmbeddingWorker(db, { embed: embedMock } as unknown as RealVectorStore, {
			batchSize: 32,
			leaseMs: 60_000,
			poisonThreshold: 3,
			backoffBaseMs: 1_000,
			backoffMaxMs: 60_000,
			pollIntervalMs: 3_600_000,
			purgeIntervalMs: 3_600_000,
			backfillCap: 0
		});

		const claimed = await mixedWorker.runOnce();
		expect(claimed).toBe(2);
		expect(getJob(db, "memory", memory.id)!.status).toBe("done");
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("done");

		// Exactly one embed call, carrying ONLY the embed-needed (memory) text.
		expect(embedMock).toHaveBeenCalledTimes(1);
		expect(embedMock.mock.calls[0][0]).toEqual([memory.content]);

		// Memory vector persisted; codebase KG observation written with the
		// placeholder vector (never persisted — zero symbol/task vectors).
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM memory_vectors WHERE memory_id = ?", [memory.id])).toBe(1);
		const obsText = observationText("codebase", FILE);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ?", [obsText])).toBeGreaterThan(
			0
		);
		expect(
			db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codebase_symbol_vectors'").get()
		).toBeUndefined();
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM task_vectors")).toBe(0);
	});

	it("LWW + content-hash dedup: identical re-enqueue dedups, changed content LWW-resets the single row", () => {
		const FILE = "src/lww.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });

		// Identical re-parse → dedup (OPT-FLOW-03) — still exactly one row.
		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE))).toBe(true);
		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE))).toBe(false);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?", [
				entityId
			])
		).toBe(1);

		// Changed symbol content → LWW reset of the SAME row (no duplicate).
		const changed = [
			{ ...makeCodebaseSymbols(FILE)[0], doc_comment: "Handles orders v2" },
			makeCodebaseSymbols(FILE)[1]
		];
		expect(enqueueCodebaseSymbols(db, REPO, FILE, changed, makeCodebaseRefs(FILE))).toBe(true);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?", [
				entityId
			])
		).toBe(1);
		expect(getJob(db, "codebase_symbol", entityId)!.payload).toContain("orders v2");
	});

	it("reference-only change (identical symbols) invalidates dedup via the ref digest", () => {
		const FILE = "src/calls.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });

		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE))).toBe(true);

		// Same symbols, changed call graph → ref digest differs → re-enqueue.
		const changedRefs = [
			...makeCodebaseRefs(FILE),
			{
				repo: REPO,
				symbol_name: "NewDep",
				caller_file: FILE,
				caller_line: 90,
				caller_name: "OrderService",
				kind: "call"
			}
		];
		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), changedRefs)).toBe(true);
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("pending");
	});

	it("ref digest is stable across per-parse target_symbol_id churn (TASK-342)", () => {
		const FILE = "src/stable-target.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });

		// Wave 1 resolution result: same edge, same resolved target FILE, but
		// re-parse re-created the target symbol row with a fresh UUID
		// (delete-by-file + bulkUpsertSymbols) — target_symbol_id must NOT
		// churn the digest, or every force re-index of an unchanged file would
		// re-enqueue and re-run ONNX/KG. target_file is the stable identity.
		const refsWithUuidA = makeCodebaseRefs(FILE).map((r) => ({
			...r,
			target_file: "src/dep.ts",
			target_symbol_id: "3f9c4c2e-0000-4000-8000-00000000000a"
		}));
		const refsWithUuidB = makeCodebaseRefs(FILE).map((r) => ({
			...r,
			target_file: "src/dep.ts",
			target_symbol_id: "b7d1e8f4-1111-4111-8111-111111111111"
		}));

		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), refsWithUuidA)).toBe(true);
		// Identical edge identity (same name/kind/caller/target_file), only the
		// per-parse symbol UUID differs → same ref digest → same content hash →
		// deduped, single row. Pre-fix (hashing target_symbol_id) this returned
		// true and LWW-reset the row on every re-parse.
		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), refsWithUuidB)).toBe(false);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs WHERE entity_kind = 'codebase_symbol' AND entity_id = ?", [
				entityId
			])
		).toBe(1);
	});

	it("negative: a job whose indexed file no longer exists completes as a no-op (no KG rows)", async () => {
		const FILE = "src/ghost.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols(makeCodebaseSymbols(FILE));
		enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE));

		// The file is deleted after enqueue (stale cleanup race) — the worker
		// precheck must skip KG extraction for the stale job.
		db.codebaseFiles.deleteFile(REPO, FILE);

		const claimed = await worker.runOnce();
		expect(claimed).toBe(1);
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("done");
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities")).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations")).toBe(0);
	});

	it("queue-kind contract: QueueJobKind re-admits codebase_symbol (compile-time invariant)", () => {
		// _queueJobKindInvariant is 'true' at compile time — tsc fails if the
		// QueueJobKind derivation drifts. This runtime test pins the union.
		expect(_queueJobKindInvariant).toBe(true);
		const kinds: QueueJobKind[] = ["memory", "standard", "task", "codebase_symbol"];
		expect(kinds).toHaveLength(4);
	});
});

describe("EmbeddingWorker — isBusyError classification matrix (TASK-457)", () => {
	it("classifies the transient SQLite lock-contention codes as busy", () => {
		// The better-sqlite3 SqliteError extended codes, per the better-sqlite3
		// convention already used by SQLITE_CONSTRAINT_UNIQUE (TASK-457). WAL
		// makes SQLITE_BUSY_RECOVERY uncommon, but it is the same transient
		// write-lock contention and must never poison a healthy job (F3).
		expect(isBusyError({ code: "SQLITE_BUSY" })).toBe(true);
		expect(isBusyError({ code: "SQLITE_BUSY_SNAPSHOT" })).toBe(true);
		expect(isBusyError({ code: "SQLITE_BUSY_RECOVERY" })).toBe(true);
	});

	it("treats non-busy codes, plain Errors, and malformed inputs as NOT busy", () => {
		expect(isBusyError({ code: "SQLITE_CONSTRAINT_UNIQUE" })).toBe(false);
		expect(isBusyError({ code: "SQLITE_READONLY" })).toBe(false);
		// A plain Error with a busy-looking MESSAGE is NOT busy: only the
		// SqliteError `code` discriminates — message-text sniffing would
		// misclassify real failures as transient (anti-hallucination guard).
		expect(isBusyError(new Error("database is locked"))).toBe(false);
		expect(isBusyError({})).toBe(false);
		expect(isBusyError(null)).toBe(false);
		expect(isBusyError(undefined)).toBe(false);
		expect(isBusyError("SQLITE_BUSY")).toBe(false);
		expect(isBusyError(42)).toBe(false);
	});
});

describe("EmbeddingWorker — SQLITE_BUSY is never a job failure (TASK-457 anti-poison)", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
	});

	it("a per-job BUSY releases the claim with attempts/backoff untouched and failed NOT incremented", async () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		// Inject BUSY on the per-job complete (the write immediately after
		// applyJob's vector write) — exercising the per-job catch
		// (worker.ts runOnce). The catch must release the claim and retry
		// next cycle instead of counting an attempt or poisoning the job.
		const completeSpy = vi.spyOn(Outbox.prototype, "complete").mockImplementation((): boolean => {
			throw { code: "SQLITE_BUSY" };
		});
		const worker = makeWorker(db);
		try {
			const claimed = await worker.runOnce();
			expect(claimed).toBe(1);
		} finally {
			completeSpy.mockRestore();
		}

		// Job re-pended (release), NOT poison; attempts — the poison gauge —
		// stay 0 (lock contention is not a job failure).
		const row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("pending");
		expect(row.attempts).toBe(0);
		expect(row.locked_by).toBeNull();
		expect(row.lease_until).toBeNull();

		// The linchpin: failed is NOT incremented on the BUSY path.
		const stats = worker.getStats();
		expect(stats.failed).toBe(0);
	});

	it("a deferred Phase-1 complete (unparseable payload + BUSY) does not bump stats.failed (F2)", async () => {
		// Directly insert an unparseable job — parsePayload returns null, so
		// runOnce routes it through the Phase-1 no-op complete. When that
		// complete defers on BUSY, `failed` must stay 0 (the row stays
		// 'claimed' and self-heals via lease expiry — it is lock contention,
		// not a job failure).
		const now = new Date().toISOString();
		db.db
			.prepare(
				`INSERT INTO queue_jobs (id, entity_kind, entity_id, entity_repo, payload, content_hash, status, attempts, created_at, updated_at)
				 VALUES (?, 'task', ?, '', ?, NULL, 'pending', 0, ?, ?)`
			)
			.run("job-unparseable-1", "unparseable-1", "not-json", now, now);

		const completeSpy = vi.spyOn(Outbox.prototype, "complete").mockImplementation((): boolean => {
			throw { code: "SQLITE_BUSY" };
		});
		const worker = makeWorker(db);
		try {
			const claimed = await worker.runOnce();
			expect(claimed).toBe(1);
		} finally {
			completeSpy.mockRestore();
		}

		expect(worker.getStats().failed).toBe(0);
	});
});

describe("EmbeddingWorker — codebase owner threading (FIX-OWNER-CODEBASE)", () => {
	let db: SQLiteStore;
	let worker: EmbeddingWorker;

	beforeEach(async () => {
		db = await createTestStore();
		worker = makeWorker(db);
	});

	afterEach(() => {
		db.close();
	});

	it("threads the caller's owner into the codebase KG rows instead of hardcoding \"\"", async () => {
		const FILE = "src/order.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols(makeCodebaseSymbols(FILE));
		db.codebaseReferences.bulkUpsertReferences(REPO, makeCodebaseRefs(FILE));

		expect(
			enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE), "vheins")
		).toBe(true);
		await worker.runOnce();

		// Every KG row the codebase job writes carries the threaded owner —
		// this is the regression net for the "" that used to be hardcoded
		// (and kept re-creating owner='' rows after the favori-app repair).
		const ownerless = countRows(
			db,
			"SELECT COUNT(*) as cnt FROM entities WHERE repo = ? AND name IN ('OrderService', 'computeTotal') AND owner != 'vheins'",
			[REPO]
		);
		expect(ownerless).toBe(0);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM relations WHERE repo = ? AND owner != 'vheins'", [REPO])
		).toBe(0);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE repo = ? AND owner != 'vheins'", [REPO])
		).toBe(0);
		// And at least one row of each kind WAS written with the owner (guards
		// against a vacuous pass where nothing was written at all).
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE repo = ? AND owner = 'vheins'", [REPO])).toBeGreaterThan(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM relations WHERE repo = ? AND owner = 'vheins'", [REPO])).toBeGreaterThan(0);
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("done");
	});

	it("still falls back to \"\" when the caller has no owner (rootless CLI index)", async () => {
		const FILE = "src/order.ts";
		const entityId = codebaseEntityId(REPO, FILE);
		db.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript" });
		db.codebaseSymbols.bulkUpsertSymbols(makeCodebaseSymbols(FILE));
		db.codebaseReferences.bulkUpsertReferences(REPO, makeCodebaseRefs(FILE));

		expect(enqueueCodebaseSymbols(db, REPO, FILE, makeCodebaseSymbols(FILE), makeCodebaseRefs(FILE))).toBe(true);
		await worker.runOnce();

		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE repo = ? AND owner = '' AND name = 'OrderService'", [REPO])
		).toBe(1);
		expect(getJob(db, "codebase_symbol", entityId)!.status).toBe("done");
	});
});
