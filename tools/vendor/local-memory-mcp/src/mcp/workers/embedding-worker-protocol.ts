/**
 * embedding-worker-protocol — request/response shapes for the off-main-thread
 * embedding worker (FEAT-DAEMON-002D).
 *
 * Kept in its own dependency-free module so `storage/vectors.ts` can import the
 * request TYPE without pulling the worker implementation into the server
 * bundle (`import type` is erased at compile time, but a dedicated module makes
 * the boundary explicit and impossible to break by accident).
 *
 * The envelopes mirror the generic WorkerPool (`src/mcp/workers/pool.ts`):
 *   main  → worker : { id: number, payload: EmbeddingWorkerRequest }
 *   worker → main  : { id, ok: true,  result: number[][] }
 *                  | { id, ok: false, error: { message, name?, stack? } }
 */

/** A request to embed a batch of texts with the shared feature-extraction model. */
export interface EmbeddingWorkerRequest {
	op: "embed";
	/** Texts to embed (structured-cloned). Empty arrays are rejected by the caller. */
	texts: string[];
}

/**
 * A successful response: one embedding row (`number[]`, length = model dim)
 * per input text, in the SAME order. Structured-clone-safe (plain arrays), so
 * the worker result is byte-identical to the in-process `number[][]`.
 */
export type EmbeddingWorkerResult = number[][];
