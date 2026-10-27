import { VectorEntityKind, VectorStore, VectorResult } from "../types";
import { SQLiteStore } from "./sqlite";
import { logger } from "../utils/logger";
import { cosineSimilarityArrays, decodeVector } from "../utils/vector";
import { currentEmbeddingModelVersion } from "./embedding-model";
import {
	applyOnnxThreadConfig,
	createFeatureExtractor,
	loadTransformersModule,
	runFeatureExtraction,
	type FeatureExtractionPipeline,
	type OnnxThreadEnv
} from "./embedding-runtime";
import { WorkerPool, WorkerPoolError } from "../workers/pool";
import { resolveEmbeddingWorkerPath, resolveEmbeddingPoolSize } from "../workers/resolve-embedding-worker";
import type { EmbeddingWorkerRequest } from "../workers/embedding-worker-protocol";

// `applyOnnxThreadConfig` / `OnnxThreadEnv` now live in `./embedding-runtime`
// (FEAT-DAEMON-002D) so the embedding worker can share them WITHOUT importing
// SQLite. Re-exported here so existing importers — notably
// tests/vectors.threads.test.ts — are unchanged.
export { applyOnnxThreadConfig };
export type { OnnxThreadEnv };

export class RealVectorStore implements VectorStore {
	private db: SQLiteStore;
	private extractor: FeatureExtractionPipeline | null = null;
	private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
	private transformersModule: typeof import("@xenova/transformers") | null = null;
	/**
	 * Off-main-thread embedding pool (FEAT-DAEMON-002D). Lazily created on the
	 * first `embed()` call so a store that never embeds a batch (e.g. a test
	 * that only exercises `search`) never spawns a worker thread.
	 */
	private embeddingPool: WorkerPool | null = null;
	/**
	 * Set once the embedding pool is unusable (worker entry missing, pool closed,
	 * or a non-retryable worker error). From then on `embed()` uses the
	 * in-process extractor — the graceful fallback that guarantees backfill
	 * correctness even when the worker path is broken.
	 */
	private embeddingPoolDisabled = false;

	constructor(db: SQLiteStore) {
		this.db = db;
	}

	/**
	 * Triggers background loading of the vector model.
	 * Useful for avoiding timeouts on the first search/upsert request.
	 */
	async initialize(): Promise<void> {
		await this.getExtractor();
	}

	/**
	 * Gracefully stop the embedding worker pool (tests / process teardown).
	 * Idempotent and safe to call when the pool was never created. After
	 * `close()` the store permanently uses the in-process fallback.
	 */
	async close(): Promise<void> {
		const pool = this.embeddingPool;
		this.embeddingPool = null;
		this.embeddingPoolDisabled = true;
		if (pool) await pool.close({ mode: "cancel" });
	}

	/**
	 * Lazily create (or reuse) the embedding worker pool, or `null` when the
	 * worker path is unavailable (the caller then falls back to in-process ONNX).
	 */
	private getEmbeddingPool(): WorkerPool | null {
		if (this.embeddingPoolDisabled) return null;
		if (this.embeddingPool) return this.embeddingPool;
		try {
			this.embeddingPool = new WorkerPool({
				workerPath: resolveEmbeddingWorkerPath(),
				size: resolveEmbeddingPoolSize(),
				// ONNX model load on first use can exceed any fixed ceiling (cold
				// download), so the per-task timeout is DISABLED. The pool still
				// detects a worker crash and respawns; the backfill is sequential,
				// so the queue never accumulates.
				taskTimeoutMs: 0
			});
		} catch (error) {
			logger.warn("[Vectors] embedding worker unavailable — using in-process ONNX", {
				error: String(error)
			});
			this.embeddingPoolDisabled = true;
			return null;
		}
		return this.embeddingPool;
	}

	private async getTransformers(): Promise<typeof import("@xenova/transformers")> {
		if (!this.transformersModule) {
			// PERF-002 wiring (OMP_NUM_THREADS before import + ONNX thread cap) now
			// lives in the shared `./embedding-runtime` module so the worker can
			// reuse it verbatim.
			this.transformersModule = await loadTransformersModule();
		}
		return this.transformersModule;
	}

	private async getExtractor(): Promise<FeatureExtractionPipeline> {
		if (this.extractor) return this.extractor;
		if (this.extractorPromise) return this.extractorPromise;

		// PERF-004: load the pipeline from the shared model constant — this file
		// no longer carries its own copy of the model name.
		this.extractorPromise = createFeatureExtractor()
			.then((extractor) => {
				this.extractor = extractor;
				return extractor;
			})
			.finally(() => {
				this.extractorPromise = null;
			});
		return this.extractorPromise;
	}

	/**
	 * Batched embedding for the outbox worker (TASK-013).
	 *
	 * FEAT-DAEMON-002D: the single ONNX pass runs in a worker thread so a
	 * backfill batch can never block the main event loop (the HTTP `initialize`
	 * handshake in particular). The result is byte-identical to the in-process
	 * path because the worker reuses the SAME `./embedding-runtime` code. If the
	 * worker pool cannot be created or a non-retryable worker error occurs, the
	 * method transparently falls back to in-process inference, so correctness is
	 * never sacrificed for offloading.
	 *
	 * `upsert`/`search` intentionally stay in-process: they are single-text
	 * passes on the request path and share the process-wide extractor, and
	 * routing them through the pool would needlessly duplicate the model. Only
	 * the backfill batch (`embed`) — the historical blocker — is offloaded.
	 */
	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		const pool = this.getEmbeddingPool();
		if (pool) {
			try {
				return await pool.run<EmbeddingWorkerRequest, number[][]>({ op: "embed", texts });
			} catch (error) {
				// Retryable faults (crash / timeout) are self-healing — the pool
				// respawns its worker, so keep using it. A non-retryable fault
				// (application error in the worker, or a closed pool) disables the
				// pool permanently and degrades to in-process for this and all
				// subsequent batches.
				const retryable = error instanceof WorkerPoolError && error.retryable;
				logger.warn("[Vectors] embedding worker task failed — falling back to in-process ONNX", {
					retryable,
					error: String(error)
				});
				if (!retryable) this.embeddingPoolDisabled = true;
			}
		}

		const extractor = await this.getExtractor();
		return runFeatureExtraction(extractor, texts);
	}

	async upsert(id: string, text: string, kind: VectorEntityKind = "memory"): Promise<void> {
		try {
			const extractor = await this.getExtractor();
			const output = await extractor(text, { pooling: "mean", normalize: true });
			const vector = Array.from(output.data as Float32Array);

			// PERF-003: stamp the embedding-model identity so the startup backfill
			// re-embeds when the model changes. `content_hash` is deliberately NOT
			// written here: this method only receives the embed `text`, while the
			// enqueue-time hash covers the whole payload (title/content/parentId/
			// decisionRefs/context/stack) — a text-only hash would NOT be
			// comparable and would wrongly suppress a needed re-embed. The
			// authoritative producer of BOTH columns is the worker path
			// (`writeVector` in embedding-queue/worker-jobs.ts), which has the
			// payload. A row written here keeps `content_hash` NULL, so the next
			// backfill re-embeds it ONCE through the worker and stamps the hash.
			const meta = { modelVersion: currentEmbeddingModelVersion() };
			if (kind === "standard") {
				this.db.standards.upsertVectorEmbedding(id, vector, meta);
			} else if (kind === "task") {
				this.db.tasks.upsertTaskVectorEmbedding(id, vector, meta);
			} else {
				this.db.memoryVectors.upsertVectorEmbedding(id, vector, meta);
			}
		} catch (error) {
			logger.error("[Vectors] Error during upsert", { id, kind, error: String(error) });
			throw error;
		}
	}

	async remove(id: string, kind: VectorEntityKind = "memory"): Promise<void> {
		if (!id) return;
		if (kind === "memory") {
			// Handled by SQL CASCADE on memories(id)
		} else if (kind === "standard") {
			// Handled by SQL CASCADE on coding_standards(id)
		} else if (kind === "task") {
			this.db.tasks.removeTaskVector(id);
		}
	}

	async search(
		query: string,
		limit: number,
		repo?: string,
		kind: VectorEntityKind = "memory"
	): Promise<VectorResult[]> {
		try {
			// codebase_symbol vectors are not persisted by any production path:
			// the write is an intentional NO-OP (TASK-293) and the dead
			// `codebase_symbol_vectors` table was dropped in migration v35. There
			// is therefore no candidate source — return no vector results so
			// blendVectorRanking falls back to text-only ranking. The explicit
			// early return also keeps codebase_symbol from falling through to the
			// memory branch below.
			if (kind === "codebase_symbol") return [];

			const extractor = await this.getExtractor();
			const output = await extractor(query, { pooling: "mean", normalize: true });
			const queryVector = Array.from(output.data as Float32Array);

			let rows: { id: string; vector: string | Uint8Array }[];
			if (kind === "standard") {
				rows = this.db.standards
					.getVectorCandidates(repo, 100)
					.map((row) => ({ id: row.standard_id, vector: row.vector }));
			} else if (kind === "task") {
				rows = this.db.tasks.getTaskVectorCandidates(repo, 100).map((row) => ({ id: row.task_id, vector: row.vector }));
			} else {
				// Owner is deliberately omitted (audit F7): memories carry a real
				// owner, so passing the hardcoded empty string here produced
				// `WHERE m.owner = ''` and excluded 46% of vectorized memories on
				// a real database. `getVectorCandidates` now treats a falsy owner
				// as "any owner", matching the standard/task stores which take no
				// owner argument at all.
				rows = this.db.memoryVectors
					.getVectorCandidates(undefined, repo, 100)
					.map((row) => ({ id: row.memory_id, vector: row.vector }));
			}

			const results: VectorResult[] = rows.map((row) => {
				// Dual-format read (TASK-038): decodeVector accepts both the new
				// float32 BLOB and the legacy JSON TEXT so a partially-migrated
				// database never crashes mid-rollout.
				const memoryVector = decodeVector(row.vector);
				return {
					id: row.id,
					score: cosineSimilarityArrays(queryVector, memoryVector)
				};
			});

			return results.sort((a, b) => b.score - a.score).slice(0, limit);
		} catch (error) {
			logger.error("[Vectors] Error during search", { kind, error: String(error) });
			return [];
		}
	}
}
