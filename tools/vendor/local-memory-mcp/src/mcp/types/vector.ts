export type VectorResult = {
	id: string;
	score: number;
};

export type VectorEntityKind = "memory" | "standard" | "task" | "codebase_symbol";

/**
 * PERF-003 — provenance stamped alongside a vector row so the startup backfill
 * can decide IDEMPOTENTLY whether a re-embed is needed (instead of comparing
 * the vector's `updated_at` against the entity's, which any metadata-only
 * touch defeats).
 *
 * Both fields are optional: callers that cannot supply them (e.g. the TF
 * `StubVectorStore`) leave the columns untouched, and the `ON CONFLICT`
 * upserts COALESCE them so an existing hash/version is never clobbered with
 * NULL.
 */
export interface VectorWriteMeta {
	/** sha256 of the embed/KG-relevant payload fields — see `embedPayloadContentHash`. */
	contentHash?: string;
	/** Embedding-model identity version — see `currentEmbeddingModelVersion`. */
	modelVersion?: number;
}

export interface VectorStore {
	initialize?(): Promise<void>;
	embed?(texts: string[]): Promise<number[][]>;
	upsert(id: string, text: string, kind?: VectorEntityKind): Promise<void>;
	remove(id: string, kind?: VectorEntityKind): Promise<void>;
	search(query: string, limit: number, repo?: string, kind?: VectorEntityKind): Promise<VectorResult[]>;
	/**
	 * Release any process-owned resources (e.g. the off-main-thread embedding
	 * worker pool). Optional and idempotent; called on graceful shutdown
	 * (C1, FEAT-DAEMON-002 review). Safe to omit for stores that own nothing.
	 */
	close?(): Promise<void>;
}
