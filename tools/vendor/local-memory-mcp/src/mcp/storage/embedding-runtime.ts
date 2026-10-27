/**
 * Shared embedding runtime (FEAT-DAEMON-002D).
 *
 * The SINGLE implementation of the ONNX feature-extraction pass, used by BOTH
 * the in-process `RealVectorStore` and the off-main-thread embedding worker
 * (`src/mcp/workers/embedding.worker.ts`). Centralizing the model name, the
 * ONNX thread cap, the pipeline construction, and the per-row slicing
 * guarantees the worker path is BYTE-IDENTICAL to the in-process path: same
 * checkpoint (`EMBEDDING_MODEL_NAME`), same `pooling: "mean"`, same
 * `normalize: true`, and the same Float32 → Number conversion.
 *
 * This module deliberately imports ONLY dependency-free modules
 * (`utils/constants.ts` and `storage/embedding-model.ts`) so the worker bundle
 * stays lean — it must never drag `SQLiteStore` / the logger into the worker
 * thread. The previous home of `applyOnnxThreadConfig` was `storage/vectors.ts`
 * (which does import SQLite); the function is moved here and RE-EXPORTED from
 * `vectors.ts` so existing importers/tests are unchanged.
 */

import { EMBEDDING_ONNX_THREADS } from "../utils/constants";
import { EMBEDDING_MODEL_NAME } from "./embedding-model";

/** The transformers module namespace (dynamic import result). */
export type TransformersModule = typeof import("@xenova/transformers");

/** The feature-extraction pipeline type (mirrors `RealVectorStore.extractor`). */
export type FeatureExtractionPipeline = import("@xenova/transformers").FeatureExtractionPipeline;

/**
 * Minimal structural view of the ONNX `env` object needed to cap its thread
 * pools (PERF-002). `@xenova/transformers` exposes it as
 * `env.backends.onnx` (typed as onnxruntime-common's `Env`), which carries
 * `wasm.numThreads` for the wasm backend and the native-session
 * `intraOpNumThreads` / `interOpNumThreads` knobs. The index signature keeps
 * the helper tolerant of the native runtime, where `intraOpNumThreads` /
 * `interOpNumThreads` are read straight off the env object (not declared on
 * `Env`) — we touch only the fields that are actually present.
 */
export interface OnnxThreadEnv {
	wasm?: { numThreads?: number };
	intraOpNumThreads?: number;
	interOpNumThreads?: number;
	[name: string]: unknown;
}

/**
 * Apply the ONNX thread cap to a transformers `env.backends.onnx` object.
 *
 * Thread count affects only ORT's scheduling, never embedding values, so this
 * is output-neutral. Defensive by construction: it sets `wasm.numThreads` only
 * when a `wasm` object is present and only touches `interOpNumThreads` when the
 * native runtime already exposes that field, so it never throws on an env shape
 * that lacks either. Exported (pure) so it is directly unit-testable without
 * loading ONNX (see tests/vectors.threads.test.ts).
 */
export function applyOnnxThreadConfig(env: OnnxThreadEnv, threads: number): void {
	const n = Math.max(1, Math.floor(threads));
	if (env.wasm && typeof env.wasm === "object") {
		env.wasm.numThreads = n;
	}
	env.intraOpNumThreads = n;
	if ("interOpNumThreads" in env) {
		env.interOpNumThreads = 1;
	}
}

/**
 * Import `@xenova/transformers` and apply the process-wide ONNX thread cap.
 *
 * PERF-002: the native ONNX thread pool is capped BEFORE the module is
 * imported. onnxruntime-node loads its native binding (and reads
 * `OMP_NUM_THREADS`) at import time, so setting it after the dynamic import
 * would be too late. An operator-provided `OMP_NUM_THREADS` is respected.
 * The wasm backend and the native session options are also capped via
 * {@link applyOnnxThreadConfig}.
 *
 * The import itself is cached by Node, so calling this repeatedly is cheap;
 * the caller (RealVectorStore) additionally memoizes the result per instance.
 */
export async function loadTransformersModule(): Promise<TransformersModule> {
	if (!process.env.OMP_NUM_THREADS) {
		process.env.OMP_NUM_THREADS = String(EMBEDDING_ONNX_THREADS);
	}
	const tf = await import("@xenova/transformers");
	if (process.env.MCP_SERVER === "true") {
		tf.env.backends.onnx.logLevel = "error";
	}
	// Cover the wasm backend and the native session options too (the env var
	// above only reaches the native OpenMP pool).
	applyOnnxThreadConfig(tf.env.backends.onnx, EMBEDDING_ONNX_THREADS);
	return tf;
}

/**
 * Load the feature-extraction pipeline from the shared model constant
 * (PERF-004 — no second hardcoded model name).
 */
export async function createFeatureExtractor(): Promise<FeatureExtractionPipeline> {
	const tf = await loadTransformersModule();
	return tf.pipeline("feature-extraction", EMBEDDING_MODEL_NAME);
}

/**
 * Run ONE batched ONNX inference pass over `texts` and slice the flat
 * Float32Array output into one `number[]` per input row. This is the exact
 * logic the former inline `RealVectorStore.embed` used, now shared verbatim
 * with the worker so the two paths cannot drift.
 */
export async function runFeatureExtraction(extractor: FeatureExtractionPipeline, texts: string[]): Promise<number[][]> {
	const output = await extractor(texts, { pooling: "mean", normalize: true });
	const data = output.data as Float32Array;
	const dims = output.dims;
	const perRow =
		Array.isArray(dims) && dims.length > 1 && typeof dims[1] === "number"
			? dims[1]
			: Math.floor(data.length / texts.length);
	const result: number[][] = [];
	for (let i = 0; i < texts.length; i++) {
		const start = i * perRow;
		result.push(Array.from(data.subarray(start, start + perRow)));
	}
	return result;
}
