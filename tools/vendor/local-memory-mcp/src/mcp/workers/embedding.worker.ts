/**
 * embedding.worker — off-main-thread ONNX feature-extraction inference
 * (FEAT-DAEMON-002D).
 *
 * Runs the ENTIRE embedding inference inside a `node:worker_threads` worker
 * owned by the generic bounded WorkerPool (`src/mcp/workers/pool.ts`): it loads
 * `@xenova/transformers`, builds the feature-extraction pipeline from the
 * shared `EMBEDDING_MODEL_NAME`, and runs the synchronous ONNX pass. Moving
 * this off the main thread keeps the MCP server's event loop responsive — the
 * embedding backfill previously ran `extractor(texts, …)` on the main thread,
 * blocking the HTTP `initialize` handshake for the duration of each batch.
 *
 * BYTE-IDENTICAL RESULTS: this worker reuses the SAME shared runtime
 * (`storage/embedding-runtime.ts`) as the in-process `RealVectorStore` — the
 * same model name, the same ONNX thread cap, the same `pooling: "mean"` /
 * `normalize: true`, and the same Float32 → Number slicing. Only the input
 * texts are marshalled IN and the `number[][]` OUT, both via structured clone,
 * so the worker output matches the in-process output exactly.
 *
 * Protocol (matches WorkerPool in `pool.ts`):
 *   main  → worker : { id: number, payload: EmbeddingWorkerRequest }
 *   worker → main  : { id, ok: true,  result: number[][] }
 *                  | { id, ok: false, error: { message, name?, stack? } }
 *
 * The pool guarantees one in-flight task per worker, so no intra-worker
 * concurrency is possible; the module-level extractor is loaded once per
 * worker thread and reused for every batch.
 */

import { parentPort } from "node:worker_threads";
import {
	createFeatureExtractor,
	runFeatureExtraction,
	type FeatureExtractionPipeline
} from "../storage/embedding-runtime";
import type { EmbeddingWorkerRequest } from "./embedding-worker-protocol";

const port = parentPort;
if (!port) throw new Error("embedding worker must be started via worker_threads");

// ── Per-worker extractor (loaded lazily, once) ───────────────────────────────

let extractor: FeatureExtractionPipeline | null = null;
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

/** Memoized pipeline load so the model is initialized exactly once per worker. */
function getExtractor(): Promise<FeatureExtractionPipeline> {
	if (extractor) return Promise.resolve(extractor);
	if (!extractorPromise) {
		extractorPromise = createFeatureExtractor()
			.then((pipeline) => {
				extractor = pipeline;
				return pipeline;
			})
			.finally(() => {
				extractorPromise = null;
			});
	}
	return extractorPromise;
}

async function handleEmbed(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];
	const pipeline = await getExtractor();
	return runFeatureExtraction(pipeline, texts);
}

// ── Message loop ─────────────────────────────────────────────────────────────

port.on("message", (message: { id?: number; payload?: EmbeddingWorkerRequest }) => {
	const id = message?.id;
	const payload = message?.payload;

	if (payload?.op !== "embed") {
		port.postMessage({ id, ok: false, error: { message: `unknown op: ${String(payload?.op)}` } });
		return;
	}

	void (async () => {
		try {
			const result = await handleEmbed(Array.isArray(payload.texts) ? payload.texts : []);
			port.postMessage({ id, ok: true, result });
		} catch (error) {
			const err = error as Error;
			port.postMessage({
				id,
				ok: false,
				error: { message: err?.message ?? String(error), name: err?.name, stack: err?.stack }
			});
		}
	})();
});
