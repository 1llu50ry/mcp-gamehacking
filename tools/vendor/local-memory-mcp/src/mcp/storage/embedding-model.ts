/**
 * Embedding-model identity (PERF-003, PERF-004).
 *
 * Single source of truth for the embedding MODEL NAME and the integer
 * `model_version` stamped onto every `*_vectors` row. `RealVectorStore` loads
 * its feature-extraction pipeline from `EMBEDDING_MODEL_NAME`; the startup
 * backfill compares a vector's stored `model_version` against
 * `currentEmbeddingModelVersion()` and re-embeds every mismatched row, so a
 * model change can never leave semantic search silently serving vectors from
 * the previous model.
 *
 * ## Upgrading the embedding model
 *
 * ANY change to the model's output MUST bump `EMBEDDING_MODEL_VERSION`:
 * a new checkpoint (also change `EMBEDDING_MODEL_NAME`), retrained weights
 * behind the same name, a tokenizer/pooling change, or an output-dimension
 * change. The name alone cannot detect a weight/tokenizer swap at an unchanged
 * name, so the explicit version is the authoritative signal. Procedure:
 *
 *   1. Change `EMBEDDING_MODEL_NAME` and/or increment `EMBEDDING_MODEL_VERSION`.
 *   2. On the next startup, `backfillMissingVectors` (embedding-queue/enqueue.ts)
 *      detects `stored model_version !== currentEmbeddingModelVersion()` and
 *      enqueues EVERY affected row for re-embedding — exactly once.
 *   3. Subsequent restarts enqueue 0: every row now carries the new version.
 *
 * The refresh is bounded and does not flood: the backfill honors
 * `EMBEDDING_QUEUE_BACKFILL_CAP` (default 2000 rows per startup) and is gated
 * by `EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE`, so a full refresh drains in capped
 * batches across restarts. ONNX inference stays capped by
 * `EMBEDDING_ONNX_THREADS` (PERF-002).
 *
 * ## Dimension changes
 *
 * The current model emits 384-dim vectors. A future model with a different
 * dimension requires the SAME `EMBEDDING_MODEL_VERSION` bump; no extra column
 * is needed. The version bump already forces every row to be re-embedded with
 * the new dimension, and `cosineSimilarityArrays` returns 0 (never a wrong
 * score) when a stale vector's length differs from the query vector, so a
 * partially-refreshed corpus degrades to "no semantic match" instead of
 * mismatched math.
 *
 * The pre-PERF-004 FNV-1a-of-name derivation was removed: it could not detect
 * a weight/tokenizer change at an unchanged name and added a collision surface
 * for no benefit. The explicit constant supersedes it.
 */

/** Canonical embedding-model name — the ONE definition `RealVectorStore` uses. */
export const EMBEDDING_MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

/**
 * Canonical embedding-model version. Bump on ANY change to the model's output
 * (new checkpoint, retrained weights, tokenizer/pooling change, or
 * output-dimension change) even when `EMBEDDING_MODEL_NAME` is unchanged.
 * Persisted as `model_version` on every vector row; the startup backfill
 * re-embeds exactly the rows whose stored value differs. See the upgrade
 * procedure in the module header.
 */
export const EMBEDDING_MODEL_VERSION = 1;

/**
 * Stable integer version of the current embedding model. The single public
 * accessor callers use, so the storage detail (constant today, derivation
 * possible later) stays encapsulated and every call site is bump-safe.
 */
export function currentEmbeddingModelVersion(): number {
	return EMBEDDING_MODEL_VERSION;
}
