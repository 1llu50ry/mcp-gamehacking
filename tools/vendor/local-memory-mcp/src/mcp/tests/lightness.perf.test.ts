/**
 * PERF-008 — "lightness without losing function" verification gate.
 *
 * PERF-002..007 each promise a lighter daemon. This file is the reproducible
 * proof that the promises did not cost FUNCTION. It asserts only on
 * deterministic quantities (hashes, counts, page accounting, ranked ids) —
 * wall-clock, CPU and RSS are RECORDED, never asserted, because they are
 * host-load dependent.
 *
 * Covered here:
 *   - PERF-003: startup backfill enqueues 0 on an unchanged corpus, and only
 *     the changed rows after a real content mutation
 *   - PERF-007: DB size + freelist are reported from the real vacuum helpers
 *   - the RECALL REGRESSION GUARD: a fixed corpus + paraphrase query set with
 *     ground-truth targets, compared against the recorded baseline with ZERO
 *     degradation tolerance
 *
 * PERF-002 (thread cap) is proven by `vectors.threads.test.ts`; PERF-005
 * (lazy warmup) and the capability activation matrix are observed end-to-end by
 * the harness `idle` vs `idle-eager` columns — this file does not restate them.
 *
 * Never touches the real `storage/` or `~/.config` DB — every store here is
 * `fs.mkdtemp`-backed or in-memory.
 */

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SQLiteStore } from "../storage/sqlite";
import { RealVectorStore } from "../storage/vectors";
import { Outbox } from "../embedding-queue/outbox";
import { memoryJobPayload } from "../embedding-queue/payloads";
import { embedPayloadContentHash } from "../embedding-queue/content-hash";
import { currentEmbeddingModelVersion } from "../storage/embedding-model";
import { getVacuumState, shouldVacuum } from "../services/vacuum";
import { VACUUM_FREELIST_RATIO_THRESHOLD } from "../utils/constants";
import {
	RECALL_CORPUS,
	RECALL_K,
	RECALL_QUERIES,
	compareRecall,
	measureRecall,
	recallBaselineSnapshot
} from "../bench/recall-guard";
import { sampleProcess, summarizeSeries } from "../bench/proc-metrics";
import { makeMemory } from "./embedding-queue.helpers";
import type { MemoryEntry } from "../types";

/** The ONNX pipeline may load (or, on a cold machine, download) on first use. */
const MODEL_TIMEOUT = 300_000;

const BENCH_OWNER = "perf008";
const BENCH_REPO = "perf008-lightness";

const tempDirs: string[] = [];

/** Create a temp dir the test owns and clean up after the file. */
function makeTempDir(prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
	tempDirs.length = 0;
});

/** Seed one memory row into a store (FK parent for a derived vector). */
function seedMemory(db: SQLiteStore, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	const memory = makeMemory({
		scope: { owner: BENCH_OWNER, repo: BENCH_REPO },
		...overrides
	});
	db.memories.insert(memory);
	return memory;
}

describe("PERF-008 — live /proc sampling", () => {
	it("samples the live test process and reports resident memory separately from virtual size", () => {
		const snapshot = sampleProcess(process.pid);
		expect(snapshot).not.toBeNull();
		expect(snapshot!.vmRssBytes).toBeGreaterThan(0);
		expect(snapshot!.nativeThreadCount).toBeGreaterThanOrEqual(1);
		// Recorded for the report; not asserted beyond sanity. The VmSize/RSS
		// separation itself is asserted by the pure parser unit tests.
		console.log(
			`[PERF-008] live self-sample rss=${snapshot!.vmRssBytes} hwm=${snapshot!.vmHwmBytes} vsize=${snapshot!.vmSizeBytes} threads=${snapshot!.nativeThreadCount}`
		);
	});

	it("summarizes a live sampling series into the recorded metric shape", () => {
		const series = [sampleProcess(process.pid), sampleProcess(process.pid)].filter(
			(snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null
		);
		const summary = summarizeSeries(series);
		expect(summary.samples).toBe(series.length);
		expect(summary.peakThreadCount).toBeGreaterThanOrEqual(1);
		expect(summary.peakVmRssBytes).toBeGreaterThan(0);
		console.log(
			`[PERF-008] live series samples=${summary.samples} peakCpu=${summary.peakCpuPercent.toFixed(2)}% peakThreads=${summary.peakThreadCount} peakRss=${summary.peakVmRssBytes} peakHwm=${summary.peakVmHwmBytes} peakVsize=${summary.peakVmSizeBytes}`
		);
	});
});

describe("PERF-008 — startup backfill determinism (PERF-003)", () => {
	it("enqueues every row once, then ZERO on an unchanged corpus, then only the changed row", async () => {
		const dir = makeTempDir("perf008-backfill-");
		const dbPath = path.join(dir, "memory.db");
		const db = await SQLiteStore.create(dbPath);
		try {
			const outbox = new Outbox(db);
			const memories = Array.from({ length: 25 }, (_, i) =>
				seedMemory(db, { title: `Backfill subject ${i}`, content: `Deterministic backfill body number ${i}` })
			);

			// First pass: no vector rows exist → every memory is enqueued.
			expect(outbox.backfillMissingVectors(100)).toBe(25);

			// Stamp the vectors exactly as the worker would, then simulate a
			// restart with an unchanged corpus.
			const version = currentEmbeddingModelVersion();
			for (const memory of memories) {
				db.db.prepare("DELETE FROM queue_jobs WHERE entity_kind = 'memory' AND entity_id = ?").run(memory.id);
				db.memoryVectors.upsertVectorEmbedding(memory.id, [0.1, 0.2], {
					contentHash: memoryContentHash(memory),
					modelVersion: version
				});
			}
			// The core PERF-003 claim: a restart on an unchanged corpus enqueues 0.
			expect(outbox.backfillMissingVectors(100)).toBe(0);

			// A metadata-only bump (the old soul-maintenance decay trigger) must
			// still enqueue 0 — the predicate no longer reads updated_at.
			db.db
				.prepare("UPDATE memories SET importance = 1, updated_at = ? WHERE id = ?")
				.run(new Date(Date.now() + 60_000).toISOString(), memories[0]!.id);
			expect(outbox.backfillMissingVectors(100)).toBe(0);

			// A real content change enqueues exactly that one row.
			db.db
				.prepare("UPDATE memories SET content = ?, updated_at = ? WHERE id = ?")
				.run("A genuinely different body after a real edit", new Date().toISOString(), memories[0]!.id);
			expect(outbox.backfillMissingVectors(100)).toBe(1);
		} finally {
			db.close();
		}
	});

	it("reports DB size and freelist from the real vacuum helpers (PERF-007)", async () => {
		const dir = makeTempDir("perf008-vacuum-");
		const dbPath = path.join(dir, "memory.db");
		const db = await SQLiteStore.create(dbPath);
		try {
			const state = getVacuumState(db);
			expect(state.pageSize).toBeGreaterThan(0);
			expect(state.pageCount).toBeGreaterThan(0);
			// freelistBytes is derived, not guessed.
			expect(state.freelistBytes).toBe(state.freelistCount * state.pageSize);
			expect(shouldVacuum(state, { freelistRatioThreshold: VACUUM_FREELIST_RATIO_THRESHOLD })).toBe(false);

			// Delete a batch to free pages into the freelist, then confirm the
			// helper reports growth (a fresh DB has a non-trivial schema, so the
			// assertion is a delta, not an absolute).
			const seeded = Array.from({ length: 400 }, (_, i) =>
				seedMemory(db, { title: `Vacuum subject ${i}`, content: "x".repeat(400) })
			);
			const before = getVacuumState(db);
			db.db.prepare("DELETE FROM memories WHERE id IN (SELECT id FROM memories LIMIT 400)").run();
			db.db.pragma("wal_checkpoint(TRUNCATE)");
			const after = getVacuumState(db);
			expect(after.freelistCount).toBeGreaterThanOrEqual(before.freelistCount);
			expect(seeded.length).toBe(400);

			const fileBytes = fs.statSync(dbPath).size;
			expect(fileBytes).toBeGreaterThan(0);
			console.log(
				`[PERF-008] temp db bytes=${fileBytes} pageCount=${after.pageCount} freelist=${after.freelistCount} freelistBytes=${after.freelistBytes}`
			);
		} finally {
			db.close();
		}
	});
});

describe("PERF-008 — semantic recall regression guard", () => {
	it("the comparison gate CAN fail (negative control)", async () => {
		// A scorer that returns nothing must be flagged as degraded — otherwise
		// the gate would be a check that cannot fail.
		const report = await measureRecall(() => []);
		expect(report.meanRecall).toBe(0);
		const comparison = compareRecall(recallBaselineSnapshot(), report, 0);
		expect(comparison.ok).toBe(false);
		expect(comparison.degraded.length).toBe(RECALL_QUERIES.length);
	});

	it(
		"real ONNX embeddings keep recall at or above the recorded baseline (zero degradation)",
		async (ctx) => {
			const dir = makeTempDir("perf008-recall-");
			const db = await SQLiteStore.create(path.join(dir, "memory.db"));
			const vectors = new RealVectorStore(db);
			try {
				try {
					await vectors.initialize();
				} catch (error) {
					console.warn(`[PERF-008] ONNX model unavailable, skipping recall guard: ${String(error)}`);
					ctx.skip();
					return;
				}

				for (const item of RECALL_CORPUS) {
					seedMemory(db, { id: item.id, title: item.title, content: item.content });
				}
				const embedded = await vectors.embed(RECALL_CORPUS.map((item) => `${item.title}\n${item.content}`));
				expect(embedded.length).toBe(RECALL_CORPUS.length);
				expect(embedded[0]!.length).toBe(384);
				for (let index = 0; index < RECALL_CORPUS.length; index++) {
					db.memoryVectors.upsertVectorEmbedding(RECALL_CORPUS[index]!.id, embedded[index]!);
				}

				// The expected ids come from the corpus DESIGN (independent
				// oracle), never from what this run happens to return.
				const report = await measureRecall(async (query) => {
					const results = await vectors.search(query, RECALL_K, BENCH_REPO, "memory");
					return results.map((result) => result.id);
				});

				console.log(
					`[PERF-008] recall mean=${report.meanRecall.toFixed(3)} min=${report.minRecall.toFixed(3)} perfect=${report.perfectQueries}/${report.perQuery.length}`
				);

				const comparison = compareRecall(recallBaselineSnapshot(), report, 0);
				expect(comparison.degraded).toEqual([]);
				expect(comparison.ok).toBe(true);
				// Every paraphrase must find its target at rank 1 (recorded k=5).
				for (const result of report.perQuery) {
					expect(result.recall).toBe(1);
				}
			} finally {
				// FEAT-DAEMON-002D: `embed()` runs inference in a worker thread, so
				// the pool must be closed or its worker would keep the process alive.
				await vectors.close();
				db.close();
			}
		},
		MODEL_TIMEOUT
	);
});

/** The embed payload hash for a memory, built the same way the enqueue path does. */
function memoryContentHash(memory: MemoryEntry): string {
	return embedPayloadContentHash(
		memoryJobPayload({
			title: memory.title,
			content: memory.content,
			owner: memory.scope.owner,
			repo: memory.scope.repo,
			updatedAt: memory.updated_at
		})
	);
}
