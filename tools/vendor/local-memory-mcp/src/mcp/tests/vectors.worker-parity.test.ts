/**
 * FEAT-DAEMON-002D — embedding worker parity + resolution + non-blocking proof.
 *
 * Proves the off-main-thread embedding path (`src/mcp/workers/embedding.worker.ts`,
 * driven by the generic WorkerPool) produces embeddings BYTE-IDENTICAL to the
 * in-process path, degrades gracefully to in-process when the worker is
 * unavailable, and — the point of the task — keeps the main event loop
 * responsive during a batch.
 *
 * The in-process reference is built from the SAME shared runtime
 * (`storage/embedding-runtime.ts`) the worker uses, so this test pins the whole
 * contract end to end: real ONNX in a worker thread vs. real ONNX on the main
 * thread.
 *
 * The model download (first run) can exceed the default timeout — hence the
 * long per-test timeout. If ONNX cannot load at all (offline CI), the
 * ONNX-dependent tests SKIP rather than fail, mirroring `lightness.perf.test.ts`.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { RealVectorStore } from "../storage/vectors";
import { createFeatureExtractor, runFeatureExtraction } from "../storage/embedding-runtime";
import { resolveEmbeddingWorkerPath, resolveEmbeddingPoolSize } from "../workers/resolve-embedding-worker";

const PARITY_TIMEOUT = 300_000;

const SAMPLE_TEXTS = [
	"The daemon offloads ONNX embedding inference to a worker thread.",
	"Semantic search recall must remain unchanged after the change.",
	"Alice deployed the retrieval service to production on Friday."
];

/**
 * REL-051 memory safety valve. This file loads a real ONNX/ORT session BOTH
 * in-process AND inside the embedding worker, and a runner under memory
 * pressure can abort the whole fork with SIGABRT (a native ORT abort, not a JS
 * throw) — the failure that broke the Release gate. The primary fix is
 * isolation + serialization (the `onnx` vitest project, `vitest.config.ts`);
 * this is the belt-and-braces guard: when the host is already critically low on
 * memory, SKIP (mirroring the ONNX-unavailable skip) instead of risking an
 * abort. Set `EMBEDDING_PARITY_SKIP_MEMORY_GUARD=1` to force the check off.
 */
const MIN_FREE_MEMORY_BYTES = 256 * 1024 * 1024; // 256 MiB — genuinely critical

function hasCriticalMemoryPressure(): boolean {
	if (process.env.EMBEDDING_PARITY_SKIP_MEMORY_GUARD === "1") return false;
	const free = os.freemem();
	if (free >= MIN_FREE_MEMORY_BYTES) return false;
	console.warn(
		`[FEAT-DAEMON-002D] only ${(free / 1024 / 1024).toFixed(0)} MiB free (< ${MIN_FREE_MEMORY_BYTES / 1024 / 1024} MiB); ` +
			"skipping real-ONNX parity test to avoid a native abort"
	);
	return true;
}

/** Load the in-process reference embeddings, or `null` when ONNX is unavailable. */
async function loadInProcessReference(texts: string[]): Promise<number[][] | null> {
	if (hasCriticalMemoryPressure()) return null;
	try {
		const extractor = await createFeatureExtractor();
		return await runFeatureExtraction(extractor, texts);
	} catch (error) {
		console.warn(`[FEAT-DAEMON-002D] ONNX unavailable, skipping: ${String(error)}`);
		return null;
	}
}

describe("resolveEmbeddingWorkerPath / resolveEmbeddingPoolSize", () => {
	it("resolves an existing worker entry for the current runtime", () => {
		const resolved = resolveEmbeddingWorkerPath();
		const fsPath = resolved instanceof URL ? fileURLToPath(resolved) : resolved;
		expect(fs.existsSync(fsPath)).toBe(true);
	});

	it("defaults the embedding pool to a single worker (backfill is sequential)", () => {
		delete process.env.EMBEDDING_WORKER_POOL_SIZE;
		expect(resolveEmbeddingPoolSize()).toBe(1);
		process.env.EMBEDDING_WORKER_POOL_SIZE = "3";
		expect(resolveEmbeddingPoolSize()).toBe(3);
		delete process.env.EMBEDDING_WORKER_POOL_SIZE;
	});
});

describe("embedding worker parity (FEAT-DAEMON-002D)", () => {
	/** Create a store bound to a fresh in-memory DB and always close its pool. */
	async function withStore<T>(run: (store: RealVectorStore, db: SQLiteStore) => Promise<T>): Promise<T> {
		const db = await createTestStore();
		const store = new RealVectorStore(db);
		try {
			return await run(store, db);
		} finally {
			await store.close();
			db.close();
		}
	}

	it(
		"worker embeddings are byte-identical to the in-process path",
		async (ctx) => {
			const inProcess = await loadInProcessReference(SAMPLE_TEXTS);
			if (!inProcess) return ctx.skip();

			await withStore(async (store) => {
				const viaWorker = await store.embed(SAMPLE_TEXTS);

				// The worker path MUST have been used: the pool exists and is not
				// disabled, and the in-process extractor was NEVER loaded (a silent
				// fallback would have populated it). This guards against a false pass
				// where the fallback happens to produce the same numbers.
				expect((store as unknown as { embeddingPool: unknown }).embeddingPool).not.toBeNull();
				expect((store as unknown as { embeddingPoolDisabled: boolean }).embeddingPoolDisabled).toBe(false);
				expect((store as unknown as { extractor: unknown }).extractor).toBeNull();

				expect(viaWorker).toHaveLength(SAMPLE_TEXTS.length);
				expect(viaWorker[0]).toHaveLength(inProcess[0]!.length);
				// Byte-identical: same checkpoint, pooling, normalize, Float32→Number.
				expect(viaWorker).toEqual(inProcess);
			});
		},
		PARITY_TIMEOUT
	);

	it(
		"keeps the main thread responsive during a worker batch (does not block the event loop)",
		async (ctx) => {
			const inProcess = await loadInProcessReference(SAMPLE_TEXTS);
			if (!inProcess) return ctx.skip();

			await withStore(async (store) => {
				// Warm the worker so the timed window is inference, not model load.
				await store.embed(["warm-up"]);

				const batch = Array.from({ length: 64 }, (_, i) => `${SAMPLE_TEXTS[i % SAMPLE_TEXTS.length]} #${i}`);
				let ticks = 0;
				const timer = setInterval(() => {
					ticks++;
				}, 1);
				const started = Date.now();
				const out = await store.embed(batch);
				const elapsedMs = Date.now() - started;
				clearInterval(timer);

				expect(out).toHaveLength(batch.length);

				// If the batch finished too fast to observe scheduling, the tick count
				// is not meaningful — skip the empirical assertion rather than flake.
				if (elapsedMs < 15) {
					console.warn(`[FEAT-DAEMON-002D] embed too fast to observe (${elapsedMs}ms); skipping tick assert`);
					return ctx.skip();
				}
				// Inference ran in the worker, so the main-thread timer kept firing.
				// (On the pre-002D in-process path this would be 0: a synchronous ONNX
				// pass blocks the event loop for the whole call.)
				expect(ticks).toBeGreaterThan(0);
			});
		},
		PARITY_TIMEOUT
	);

	it(
		"falls back to in-process embeddings (identical results) when the pool is disabled",
		async (ctx) => {
			const inProcess = await loadInProcessReference(SAMPLE_TEXTS);
			if (!inProcess) return ctx.skip();

			await withStore(async (store) => {
				// Force the documented fallback: no worker pool, in-process only.
				(store as unknown as { embeddingPoolDisabled: boolean }).embeddingPoolDisabled = true;

				const fallback = await store.embed(SAMPLE_TEXTS);
				expect(fallback).toEqual(inProcess);
			});
		},
		PARITY_TIMEOUT
	);
});
