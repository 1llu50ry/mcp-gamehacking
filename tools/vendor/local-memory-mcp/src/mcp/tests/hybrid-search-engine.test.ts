/**
 * HybridSearchEngine — engine-level unit tests (OPT-DRY-01).
 *
 * Pure unit tests: no DB required. These pin the orchestration invariants
 * the engine owns — vector+keyword merge (fallback vs supplement), sort by
 * composite score, adaptive threshold on pool size, guarantee-at-least-1,
 * postFilter ordering, and pagination — plus the consolidated canonical
 * vector-only fallback formula (TASK-134 regression).
 *
 * Note: DB-backed integration coverage of the three search handlers lives in
 * hybrid-search.test.ts; this file exercises HybridSearchEngine directly.
 */

import { describe, it, expect, vi } from "vitest";
import { HybridSearchEngine } from "../utils/hybrid-search";
import type { EntityScorer, HybridSearchOptions, HybridSearchResult, ScoredEntity } from "../utils/hybrid-search";
import type { HybridScores } from "../utils/scoring";
import { HYBRID_WEIGHTS } from "../utils/scoring";

// ── Test fixtures ────────────────────────────────────────────────────────

interface Item {
	id: string;
	keyword: number;
	recency: number;
	domain: number;
}

const item = (id: string, keyword = 0, recency = 0, domain = 0): Item => ({ id, keyword, recency, domain });

/** Predictable per-entity scorer: signals come straight from the Item. */
const scorer: EntityScorer<Item> = {
	idOf: (entity) => entity.id,
	scoreCandidate: (entity, similarity) => ({
		similarity,
		keyword: entity.keyword,
		recency: entity.recency,
		domain: entity.domain
	}),
	scoreVectorOnly: (entity, hit) => ({
		similarity: hit.score,
		keyword: entity.keyword,
		recency: entity.recency,
		domain: entity.domain
	}),
	scoreFallback: (entity, similarity) => ({
		similarity,
		keyword: entity.keyword,
		recency: entity.recency,
		domain: entity.domain
	})
};

function runEngine(overrides: Partial<HybridSearchOptions<Item>>): HybridSearchResult<Item> {
	return HybridSearchEngine.run({
		candidates: [],
		queryTerms: ["test"],
		vectorResults: [],
		scorer,
		thresholds: { smallSet: 0.2, largeSet: 0.5 },
		offset: 0,
		limit: 10,
		...overrides
	});
}

// ── Rank + threshold + pagination ────────────────────────────────────────

describe("HybridSearchEngine — rank, threshold, pagination", () => {
	it("sorts by finalScore desc, applies the threshold, and paginates", () => {
		const result = runEngine({
			candidates: [
				{ entity: item("low", 0, 0, 0), similarity: 0.1 }, // final 0.04
				{ entity: item("high", 1, 0, 0), similarity: 1 }, // final 0.70
				{ entity: item("mid", 0.8, 0, 0), similarity: 0 } // final 0.24
			],
			thresholds: { smallSet: 0.2, largeSet: 0.5 }, // 3 candidates → smallSet
			offset: 0,
			limit: 1
		});
		expect(result.total).toBe(2); // high + mid clear 0.2; low filtered
		expect(result.items.map((s) => s.entity.id)).toEqual(["high"]);
		expect(result.items[0].finalScore).toBeCloseTo(0.7);
	});

	it("uses the lenient threshold for small pools and the strict one for large pools", () => {
		const half = (id: string) => ({ entity: item(id, 0, 0, 0), similarity: 0.625 }); // final 0.25
		const strong = (id: string) => ({ entity: item(id, 1, 1, 0), similarity: 1 }); // final 0.85

		const small = runEngine({
			candidates: [half("a"), half("b"), half("c")],
			thresholds: { smallSet: 0.2, largeSet: 0.5 } // 3 → smallSet 0.2 → all pass
		});
		expect(small.total).toBe(3);

		const large = runEngine({
			candidates: [half("a"), half("b"), half("c"), half("d"), strong("e"), strong("f")],
			thresholds: { smallSet: 0.2, largeSet: 0.5 } // 6 → largeSet 0.5 → only 0.85 passes
		});
		expect(large.total).toBe(2);
		expect(large.items.map((s) => s.entity.id).sort()).toEqual(["e", "f"]);
	});

	it("guarantees at least one result — the highest-scored item — when the threshold filters everything", () => {
		const result = runEngine({
			candidates: [
				{ entity: item("low", 0, 0, 0), similarity: 0.05 }, // final 0.02
				{ entity: item("high", 0, 0, 0), similarity: 0.1 } // final 0.04
			],
			thresholds: { smallSet: 0.9, largeSet: 0.9 }
		});
		expect(result.total).toBe(1);
		// Input order [low, high]; guarantee must pick the SORTED top item.
		expect(result.items.map((s) => s.entity.id)).toEqual(["high"]);
	});

	it("paginates with offset/limit over the post-filtered list", () => {
		const result = runEngine({
			candidates: ["a", "b", "c", "d", "e"].map((id) => ({ entity: item(id, 1, 0, 0), similarity: 0 })),
			thresholds: { smallSet: 0, largeSet: 0 },
			offset: 1,
			limit: 2
		});
		expect(result.total).toBe(5);
		// All tied at 0.30 → stable sort preserves insertion order.
		expect(result.items.map((s) => s.entity.id)).toEqual(["b", "c"]);
	});

	it("exposes the FULL post-filtered pool via eligible, independent of pagination (TASK-421)", () => {
		const result = runEngine({
			candidates: ["a", "b", "c", "d"].map((id) => ({ entity: item(id, 1, 0, 0), similarity: 0 })),
			thresholds: { smallSet: 0, largeSet: 0 },
			offset: 1,
			limit: 2
		});
		// Paginated page is only [b, c]…
		expect(result.items.map((s) => s.entity.id)).toEqual(["b", "c"]);
		// …but eligible carries the WHOLE match set (same length as total).
		expect(result.eligible.map((s) => s.entity.id)).toEqual(["a", "b", "c", "d"]);
		expect(result.eligible).toHaveLength(result.total);
		// items is always eligible.slice(offset, offset + limit)
		expect(result.items).toEqual(result.eligible.slice(1, 3));
	});
});

// ── Vector + keyword merge modes ─────────────────────────────────────────

describe("HybridSearchEngine — vector + keyword merge", () => {
	it('merge "fallback": vector results replace an empty candidate pool', () => {
		const result = runEngine({
			candidates: [],
			vectorResults: [{ id: "v1", score: 0.8 }],
			vectorEntities: new Map([["v1", item("v1", 0, 0, 0)]]),
			thresholds: { smallSet: 0, largeSet: 0 }
		});
		expect(result.items.map((s) => s.entity.id)).toEqual(["v1"]);
		expect(result.items[0].similarityScore).toBe(0.8);
		expect(result.items[0].finalScore).toBeCloseTo(0.8 * HYBRID_WEIGHTS.similarity);
	});

	it('merge "fallback": vector results are ignored when candidates exist', () => {
		const result = runEngine({
			candidates: [{ entity: item("a", 1, 0, 0), similarity: 0 }],
			vectorResults: [{ id: "v1", score: 0.9 }],
			vectorEntities: new Map([["v1", item("v1", 0, 0, 0)]]),
			thresholds: { smallSet: 0, largeSet: 0 }
		});
		expect(result.items.map((s) => s.entity.id)).toEqual(["a"]);
	});

	it('merge "supplement": vector-only hits are added alongside candidates, without duplicating candidate ids', () => {
		const result = runEngine({
			candidates: [{ entity: item("a", 1, 0, 0), similarity: 0 }],
			vectorResults: [
				{ id: "a", score: 0.5 }, // matches a candidate → skipped
				{ id: "v1", score: 0.9 } // vector-only → added
			],
			vectorEntities: new Map([["v1", item("v1", 0, 0, 0)]]),
			merge: "supplement",
			thresholds: { smallSet: 0, largeSet: 0 }
		});
		expect(new Set(result.items.map((s) => s.entity.id))).toEqual(new Set(["a", "v1"]));
	});

	it("null vectorResults (vector-store failure) scores candidates via the fallback scorer", () => {
		const fallbackSpy = vi.fn((_entity: Item, _similarity: number): HybridScores => ({
			similarity: 0,
			keyword: 1,
			recency: 0,
			domain: 0
		}));
		const result = runEngine({
			candidates: [{ entity: item("a", 0, 0, 0), similarity: 0.4 }],
			vectorResults: null,
			scorer: { ...scorer, scoreFallback: fallbackSpy },
			thresholds: { smallSet: 0, largeSet: 0 }
		});
		expect(fallbackSpy).toHaveBeenCalledTimes(1);
		expect(result.items[0].similarityScore).toBe(0);
		expect(result.items[0].finalScore).toBeCloseTo(HYBRID_WEIGHTS.keyword); // keyword 1 → 0.3
	});
});

// ── postFilter ordering ──────────────────────────────────────────────────

describe("HybridSearchEngine — postFilter ordering", () => {
	it("applies postFilter after threshold/guarantee and before pagination; total reflects it", () => {
		const postFilter = vi.fn((eligible: Array<ScoredEntity<Item>>) => eligible.filter((s) => s.entity.id !== "drop"));
		const result = runEngine({
			candidates: [
				{ entity: item("keep-1", 1, 0, 0), similarity: 0 }, // final 0.30
				{ entity: item("drop", 0.9, 0, 0), similarity: 0 }, // final 0.27
				{ entity: item("keep-2", 0.7, 0, 0), similarity: 0 } // final 0.21
			],
			thresholds: { smallSet: 0.2, largeSet: 0.2 },
			postFilter,
			offset: 0,
			limit: 1
		});
		expect(postFilter).toHaveBeenCalledTimes(1);
		expect(result.total).toBe(2); // post-filtered count, pre-pagination
		expect(result.items.map((s) => s.entity.id)).toEqual(["keep-1"]);
	});

	it("passes the full pre-threshold pool (desc by finalScore) to the postFilter context", () => {
		let seen: string[] = [];
		const result = runEngine({
			candidates: [
				{ entity: item("low", 0.1, 0, 0), similarity: 0 }, // final 0.03
				{ entity: item("mid", 0.5, 0, 0), similarity: 0 }, // final 0.15
				{ entity: item("high", 1, 0, 0), similarity: 0 } // final 0.30
			],
			thresholds: { smallSet: 0.2, largeSet: 0.2 }, // only "high" clears
			postFilter: (eligible, context) => {
				seen = context.allScored.map((s) => s.entity.id);
				return eligible;
			}
		});
		expect(seen).toEqual(["high", "mid", "low"]);
		expect(result.total).toBe(1);
	});
});

// ── Canonical vector-only fallback formula (TASK-134) ────────────────────

describe("HybridSearchEngine — vector-only fallback formula (TASK-134)", () => {
	it("pins the canonical SPEC-001 blend: vector score in the similarity slot (w_sim = 0.4)", () => {
		const result = runEngine({
			candidates: [],
			vectorResults: [{ id: "v1", score: 0.75 }],
			vectorEntities: new Map([["v1", item("v1", 0.5, 0.25, 0.1)]]),
			thresholds: { smallSet: 0, largeSet: 0 }
		});
		const scored = result.items[0];
		expect(scored.similarityScore).toBe(0.75);
		expect(scored.keywordScore).toBe(0.5);
		expect(scored.recencyScore).toBe(0.25);
		expect(scored.domainScore).toBe(0.1);
		expect(scored.finalScore).toBeCloseTo(
			0.75 * HYBRID_WEIGHTS.similarity +
				0.5 * HYBRID_WEIGHTS.keyword +
				0.25 * HYBRID_WEIGHTS.recency +
				0.1 * HYBRID_WEIGHTS.domain
		);
	});

	it("locks the consolidation: the legacy weight fold vr.score * (w_sim + w_kw) is gone", () => {
		const result = runEngine({
			candidates: [],
			vectorResults: [{ id: "v1", score: 0.75 }],
			vectorEntities: new Map([["v1", item("v1", 0, 0, 0)]]),
			thresholds: { smallSet: 0, largeSet: 0 }
		});
		expect(result.items[0].finalScore).toBeCloseTo(0.75 * HYBRID_WEIGHTS.similarity); // 0.30
		expect(result.items[0].finalScore).not.toBeCloseTo(
			0.75 * (HYBRID_WEIGHTS.similarity + HYBRID_WEIGHTS.keyword) // legacy fold 0.525
		);
	});
});
