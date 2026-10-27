/**
 * Shared hybrid scoring utilities (SPEC-001) used by the memory-read,
 * task-read, and standard-read search engines.
 *
 * Single scorer: final = similarity·w_sim + keyword·w_kw + recency·w_rec + domain·w_dom
 * with per-entity weights configurable via {@link HybridWeights}.
 *
 * NOTE (intentional divergence): agent-context deliberately does NOT use this
 * scorer — it ranks context memories by vector + importance (see
 * AGENT_CONTEXT_BLEND in tools/agent-context.ts).
 */

import { HYBRID_WEIGHTS, RECENCY_HALF_LIFE_MS } from "./constants";
import {
	DEFAULT_CONFIDENCE_THRESHOLDS,
	STANDARD_CONFIDENCE_THRESHOLDS,
	STANDARD_KEYWORD_CONFIDENCE_THRESHOLDS,
	STANDARD_RECENCY_HALF_LIFE_MS
} from "./constants";
import type { CodingStandardEntry, MemoryEntry, Task } from "../types";

export { HYBRID_WEIGHTS, RECENCY_HALF_LIFE_MS };

export interface HybridWeights {
	readonly similarity: number;
	readonly keyword: number;
	readonly recency: number;
	readonly domain: number;
}

export interface HybridScores {
	similarity: number;
	keyword: number;
	recency: number;
	domain: number;
}

/**
 * Weighted blend of the four hybrid signals. All three search engines compute
 * their final score through this function with the SPEC-001 weights.
 */
export function scoreHybrid<T extends HybridScores>(scores: T, weights: HybridWeights = HYBRID_WEIGHTS): number {
	return (
		scores.similarity * weights.similarity +
		scores.keyword * weights.keyword +
		scores.recency * weights.recency +
		scores.domain * weights.domain
	);
}

/**
 * Exponential decay on an age (ms): 1 for age <= 0, decaying toward 0 with
 * half-life `halfLifeMs` at the given `decayBase` (2 = classic half-life
 * halving, Math.E = natural exponential). Shared by {@link computeRecencyScore}
 * (base 2) and STANDARD_SCORING.recency (base Math.E).
 */
export function exponentialDecay(ageMs: number, halfLifeMs: number, decayBase: number = Math.E): number {
	if (ageMs <= 0) return 1;
	return Math.max(0, Math.min(1, Math.pow(decayBase, -ageMs / halfLifeMs)));
}

/**
 * Exponential recency decay: 1 for brand-new entries, halving every
 * `halfLifeMs` (default 30 days). Shared by memory-read and task-read.
 */
export function computeRecencyScore(createdAt: string, halfLifeMs: number = RECENCY_HALF_LIFE_MS): number {
	return exponentialDecay(Date.now() - new Date(createdAt).getTime(), halfLifeMs, 2);
}

/**
 * Term-overlap count between normalized query terms and a list of searchable
 * tokens (e.g. memory tags). Used as the base of domain scoring.
 */
export function countTermOverlap(queryTerms: string[], searchable: string[]): number {
	if (queryTerms.length === 0 || searchable.length === 0) return 0;
	const querySet = new Set(queryTerms.map((t: string) => t.toLowerCase()));
	return searchable.filter((t: string) => querySet.has(t.toLowerCase())).length;
}

/**
 * Domain score as a ratio of matching searchable items (e.g. tags) over the
 * total searchable items. Returns 0 when there is nothing to match against.
 */
export function computeDomainScore(queryTerms: string[], searchable: string[]): number {
	if (queryTerms.length === 0 || searchable.length === 0) return 0;
	return countTermOverlap(queryTerms, searchable) / Math.max(searchable.length, 1);
}

/**
 * Adaptive threshold filter (SPEC-001): small candidate sets use the lenient
 * threshold so sparse corpora still return results; larger sets use the
 * stricter one. Returns whether the score clears the threshold.
 */
export function applyThreshold(
	score: number,
	candidateCount: number,
	thresholds: { smallSet: number; largeSet: number }
): boolean {
	const threshold = candidateCount <= 5 ? thresholds.smallSet : thresholds.largeSet;
	return score >= threshold;
}

// ── Per-entity-kind scoring strategies (OPT-DRY-04) ──────────────────────
// The three search engines each had their own private domain/recency/
// confidence implementations with subtly different semantics:
//
//   domain     — memory: tag-overlap ratio (denominator = tags);
//                task: query-coverage of text fields (denominator = query
//                terms — a long description would dilute the ratio to ~0);
//                standard: match ratio against request FILTERS (stack/tags/
//                language/context), neutral 0.5 with no filters.
//   recency    — memory/task: 2^(-age/30d) on created_at;
//                standard: e^(-age/180d) on last_used_at ?? updated_at.
//   confidence — memory/task: buckets on final score (0.7/0.4);
//                standard: buckets on final score (0.72/0.42) OR keyword
//                relevance (0.85/0.45).
//
// These strategy objects are the SINGLE home for that per-kind divergence
// (OPT-DRY-04): each search engine selects its kind's strategy instead of
// re-implementing the signals, so same-named concepts stay consistent and
// any tuning happens in one file. The generic primitives above
// (countTermOverlap, computeDomainScore, exponentialDecay /
// computeRecencyScore, bucketConfidence) remain shared.
// ─────────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low";

/** Inputs for the confidence bucketing — every kind gets the blended final
 * score; standard additionally considers keyword relevance. */
export interface ConfidenceInput {
	finalScore: number;
	keywordScore: number;
}

/** Context passed to a strategy's `domain` scorer (memory/task: query terms). */
export interface QueryTermContext {
	queryTerms: string[];
}

/** Filter context passed to STANDARD_SCORING.domain (standard-read request filters). */
export interface StandardDomainFilters {
	stack?: string[];
	tags?: string[];
	language?: string;
	context?: string;
}

/**
 * Per-entity-kind scoring strategy: bundles the three hybrid signals
 * (domain, recency, confidence) for one search engine. Engines call the
 * signal functions instead of implementing them inline.
 */
export interface EntityScoringStrategy<TEntity, TDomainContext> {
	/** Domain-match signal: how well the entity's metadata matches the query/filters. */
	domain: (entity: TEntity, context: TDomainContext) => number;
	/** Recency signal: exponential decay on entity age. */
	recency: (entity: TEntity) => number;
	/** Confidence label derived from the blended final score (and, for standards, keyword relevance). */
	confidence: (input: ConfidenceInput) => ConfidenceLevel;
}

/** Maps a score to a confidence label using per-kind high/medium thresholds. */
export function bucketConfidence(score: number, highThreshold: number, mediumThreshold: number): ConfidenceLevel {
	if (score >= highThreshold) return "high";
	if (score >= mediumThreshold) return "medium";
	return "low";
}

export const MEMORY_SCORING: EntityScoringStrategy<MemoryEntry, QueryTermContext> = {
	domain: (memory, { queryTerms }) => computeDomainScore(queryTerms, memory.tags),
	recency: (memory) => computeRecencyScore(memory.created_at),
	confidence: ({ finalScore }) =>
		bucketConfidence(finalScore, DEFAULT_CONFIDENCE_THRESHOLDS.high, DEFAULT_CONFIDENCE_THRESHOLDS.medium)
};

export const TASK_SCORING: EntityScoringStrategy<Task, QueryTermContext> = {
	// Tasks have no tag list, so the domain signal is query-coverage of the
	// task's text fields; the denominator is the QUERY term count (not the
	// word count) — behavior preserved from the original task engine.
	domain: (task, { queryTerms }) => {
		if (queryTerms.length === 0) return 0;
		const textFields = [task.title, task.description, task.task_code, task.phase]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
		const words = textFields.split(/\s+/);
		return Math.min(1, countTermOverlap(queryTerms, words) / Math.max(queryTerms.length, 1));
	},
	recency: (task) => computeRecencyScore(task.created_at),
	confidence: ({ finalScore }) =>
		bucketConfidence(finalScore, DEFAULT_CONFIDENCE_THRESHOLDS.high, DEFAULT_CONFIDENCE_THRESHOLDS.medium)
};

export const STANDARD_SCORING: EntityScoringStrategy<CodingStandardEntry, StandardDomainFilters> = {
	// Standards have no query-term text overlap in the domain slot; the domain
	// signal is how well the standard's metadata matches the request FILTERS.
	// Neutral (0.5) when no filters are present.
	domain: (standard, filters) => {
		let matches = 0;
		let total = 0;

		const normalizedCtx = filters.context?.toLowerCase();
		const stdContext = standard.context?.toLowerCase() ?? "";

		if (filters.stack && filters.stack.length > 0) {
			total++;
			if (filters.stack.some((s) => standard.stack.includes(s))) matches++;
		}
		if (filters.tags && filters.tags.length > 0) {
			total++;
			if (filters.tags.some((t) => standard.tags.includes(t))) matches++;
		}
		if (filters.language) {
			total++;
			if (standard.language === filters.language) matches++;
		}
		if (normalizedCtx) {
			total++;
			if (stdContext.includes(normalizedCtx)) matches++;
		}

		if (total === 0) return 0.5;
		return matches / total;
	},
	// Standards age slower than memories/tasks: e^(-age/180d) on
	// last_used_at ?? updated_at (half-life ≈ 125 days), neutral 0.5 when
	// no timestamp is available.
	recency: (standard) => {
		const dateStr = standard.last_used_at ?? standard.updated_at;
		if (!dateStr) return 0.5;
		return exponentialDecay(Date.now() - new Date(dateStr).getTime(), STANDARD_RECENCY_HALF_LIFE_MS, Math.E);
	},
	confidence: ({ finalScore, keywordScore }) => {
		if (
			finalScore >= STANDARD_CONFIDENCE_THRESHOLDS.high ||
			keywordScore >= STANDARD_KEYWORD_CONFIDENCE_THRESHOLDS.high
		) {
			return "high";
		}
		if (
			finalScore >= STANDARD_CONFIDENCE_THRESHOLDS.medium ||
			keywordScore >= STANDARD_KEYWORD_CONFIDENCE_THRESHOLDS.medium
		) {
			return "medium";
		}
		return "low";
	}
};
