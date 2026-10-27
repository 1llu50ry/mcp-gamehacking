/**
 * HybridSearchEngine — generic hybrid-search orchestration (OPT-DRY-01).
 *
 * Consolidates the steps that were copy-pasted across the memory-read,
 * task-read, and standard-read search engines:
 *
 *   1. vector + keyword merge (vector-only hits entering the scored pool),
 *   2. sort by composite (hybrid) score,
 *   3. adaptive threshold (SPEC-001, small-set vs large-set),
 *   4. guarantee-at-least-1,
 *   5. per-entity post-filter hook (time-tunnel window, phase/priority),
 *   6. pagination (offset/limit).
 *
 * Each entity keeps ONLY its candidate fetch + domain/confidence scoring —
 * the {@link EntityScorer} supplies the four hybrid signals per candidate,
 * and the engine blends them through the shared `scoreHybrid` (SPEC-001):
 *   finalScore = similarity·w_sim + keyword·w_kw + recency·w_rec + domain·w_dom
 * This makes the engine the single place to change hybrid scoring.
 *
 * ────────────────────────────────────────────────────────────────────────
 * FALLBACK-FORMULA CONSOLIDATION (documented decision)
 *
 * The three original engines had diverged on their fallback formulas:
 *
 *   - memory-read vector-only path folded the vector score into the combined
 *     similarity+keyword weight: vr.score * (w_sim + w_kw).
 *   - memory-read error path (no keyword signal) applied the same fold to
 *     the similarity score.
 *   - task-read error path used a constant baseline + recency-only blend:
 *     (w_sim + w_kw) + recency * (w_rec + w_dom) — domain was ignored.
 *   - standard-read vector-only path already matched the canonical formula
 *     (vector score in the similarity slot, remaining weights untouched).
 *
 * The engine consolidates ALL paths onto the canonical SPEC-001 blend:
 * each signal sits in its own slot and absent signals score 0. Main-path
 * output is bit-identical to the old engines (they all used scoreHybrid);
 * only the rare fallback paths change, and they are now consistent with
 * each other and with the main path.
 * ────────────────────────────────────────────────────────────────────────
 */

import { applyThreshold, scoreHybrid, HYBRID_WEIGHTS } from "./scoring";
import type { HybridScores, HybridWeights } from "./scoring";
import type { VectorResult } from "../types";

export type { HybridScores, HybridWeights, VectorResult };

/**
 * A single ranked item produced by the engine: the entity plus the four
 * hybrid signals and the blended `finalScore` (desc-order sort key).
 */
export interface ScoredEntity<E> {
	entity: E;
	similarityScore: number;
	keywordScore: number;
	recencyScore: number;
	domainScore: number;
	finalScore: number;
}

/**
 * Per-entity hybrid-signal computation. The engine calls these for each
 * candidate and blends the returned signals via `scoreHybrid`.
 */
export interface EntityScorer<E> {
	/** Unique entity id — used to match vector hits against candidates. */
	idOf(entity: E): string;
	/** Signals for a keyword/similarity candidate (main path). */
	scoreCandidate(entity: E, similarity: number, queryTerms: string[]): HybridScores;
	/** Signals for a vector-only hit (no keyword candidate for that id). */
	scoreVectorOnly(entity: E, hit: VectorResult, queryTerms: string[]): HybridScores;
	/** Signals for the error fallback path (vector store unavailable). */
	scoreFallback(entity: E, similarity: number, queryTerms: string[]): HybridScores;
}

/**
 * Context passed to {@link HybridSearchOptions.postFilter} — exposes the
 * full pre-threshold scored pool (desc by finalScore) so per-entity filters
 * (e.g. task-read's keyword supplement) can pull additional candidates.
 */
export interface PostFilterContext<E> {
	allScored: Array<ScoredEntity<E>>;
}

/**
 * How vector-only hits (ids present in `vectorResults` but absent from
 * `candidates`) are merged into the scored pool:
 *
 *   - `"fallback"`  — vector results are used ONLY when no keyword/similarity
 *     candidate scored (empty pool). The vector store is a fallback source
 *     when lexical/similarity retrieval misses. (memory-read, standard-read)
 *   - `"supplement"` — vector-only hits are ALWAYS added as extra scored
 *     items, so semantic recall supplements the keyword pool. (task-read)
 */
export type VectorMergeMode = "fallback" | "supplement";

export interface HybridSearchOptions<E> {
	/** Keyword/similarity candidates fetched by the entity (per-entity step). */
	candidates: Array<{ entity: E; similarity: number }>;
	/** Normalized query terms (space-split, non-empty) — forwarded to the scorer. */
	queryTerms: string[];
	/**
	 * Raw vector-store hits. Pass `null` when the vector store is unavailable
	 * (failed search) — the engine then scores candidates via
	 * {@link EntityScorer.scoreFallback} and skips the vector merge.
	 */
	vectorResults: VectorResult[] | null;
	/** Entities for vector-only hits (fetched by the entity; id → entity). */
	vectorEntities?: ReadonlyMap<string, E>;
	/** Per-entity scorer (candidate fetch + domain/confidence scoring live here). */
	scorer: EntityScorer<E>;
	/** Adaptive thresholds (SEARCH_THRESHOLDS.<entity>). */
	thresholds: { smallSet: number; largeSet: number };
	/** Hybrid weights (defaults to SPEC-001 HYBRID_WEIGHTS). */
	weights?: HybridWeights;
	/** Vector-merge mode (default `"fallback"`). */
	merge?: VectorMergeMode;
	offset: number;
	limit: number;
	/**
	 * Optional per-entity post-filter applied AFTER threshold + guarantee,
	 * BEFORE pagination (e.g. memory-read's time-tunnel window, task-read's
	 * phase/priority filters). Returned array determines `total`.
	 */
	postFilter?: (eligible: Array<ScoredEntity<E>>, context: PostFilterContext<E>) => Array<ScoredEntity<E>>;
}

export interface HybridSearchResult<E> {
	/** Paginated scored entities (engine-owned `.slice(offset, offset + limit)`). */
	items: Array<ScoredEntity<E>>;
	/**
	 * FULL post-filtered pool (before pagination) — every entity that cleared
	 * threshold/guarantee/postFilter, sorted by finalScore desc. Lets renderers
	 * group the whole match set (e.g. all status groups) instead of only the
	 * current page. Same length as `total`; `items` is `eligible.slice(offset, offset + limit)`.
	 */
	eligible: Array<ScoredEntity<E>>;
	/** Count before pagination, after threshold/guarantee/postFilter. */
	total: number;
	offset: number;
	limit: number;
}

/**
 * Stateless hybrid-search orchestrator (OPT-DRY-01). See module docstring
 * for the pipeline and the fallback-formula consolidation decision.
 */
export class HybridSearchEngine {
	static run<E>(options: HybridSearchOptions<E>): HybridSearchResult<E> {
		const {
			candidates,
			queryTerms,
			vectorResults,
			vectorEntities = new Map<string, E>(),
			scorer,
			thresholds,
			weights = HYBRID_WEIGHTS,
			merge = "fallback",
			offset,
			limit,
			postFilter
		} = options;

		const candidateIds = new Set(candidates.map((c) => scorer.idOf(c.entity)));
		const scored: Array<ScoredEntity<E>> = [];

		if (vectorResults === null) {
			// Vector store unavailable — error fallback path: re-score the
			// keyword/similarity candidates via the per-entity fallback scorer.
			for (const candidate of candidates) {
				const signals = scorer.scoreFallback(candidate.entity, candidate.similarity, queryTerms);
				scored.push(HybridSearchEngine.assemble(candidate.entity, signals, weights));
			}
		} else {
			// Main path: score all keyword/similarity candidates.
			for (const candidate of candidates) {
				const signals = scorer.scoreCandidate(candidate.entity, candidate.similarity, queryTerms);
				scored.push(HybridSearchEngine.assemble(candidate.entity, signals, weights));
			}

			// Vector + keyword merge: score vector-only hits (semantic matches
			// with no keyword candidate).
			const vectorOnly: Array<ScoredEntity<E>> = [];
			for (const hit of vectorResults) {
				if (candidateIds.has(hit.id)) continue;
				const entity = vectorEntities.get(hit.id);
				if (!entity) continue;
				const signals = scorer.scoreVectorOnly(entity, hit, queryTerms);
				vectorOnly.push(HybridSearchEngine.assemble(entity, signals, weights));
			}

			if (merge === "supplement") {
				scored.push(...vectorOnly);
			} else if (scored.length === 0) {
				// "fallback" merge: vector results replace an empty candidate pool.
				scored.push(...vectorOnly);
			}
		}

		// Rank by composite score, adaptive threshold, guarantee-at-least-1.
		scored.sort((a, b) => b.finalScore - a.finalScore);
		let eligible = scored.filter((s) => applyThreshold(s.finalScore, scored.length, thresholds));
		if (eligible.length === 0 && scored.length > 0) eligible = [scored[0]];

		// Per-entity post-filter (e.g. time-tunnel window, phase/priority filters).
		if (postFilter) eligible = postFilter(eligible, { allScored: scored });

		// Dedup by entity id before pagination/grouping (issue #108): a candidate
		// and a vector-only supplement can resolve to the same entity id when the
		// keyword fetch and the vector store disagree on scope, which would render
		// the same entity twice (once keyword-scored, once vector-scored) at two
		// different scores. The pool is sorted desc, so keeping the first
		// occurrence keeps the higher score.
		{
			const seenIds = new Set<string>();
			eligible = eligible.filter((s) => {
				const id = scorer.idOf(s.entity);
				if (seenIds.has(id)) return false;
				seenIds.add(id);
				return true;
			});
		}

		return {
			items: eligible.slice(offset, offset + limit),
			eligible,
			total: eligible.length,
			offset,
			limit
		};
	}

	private static assemble<E>(entity: E, signals: HybridScores, weights: HybridWeights): ScoredEntity<E> {
		return {
			entity,
			similarityScore: signals.similarity,
			keywordScore: signals.keyword,
			recencyScore: signals.recency,
			domainScore: signals.domain,
			finalScore: scoreHybrid(signals, weights)
		};
	}
}
