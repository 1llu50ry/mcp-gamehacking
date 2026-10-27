/**
 * Scoring strategy contracts — per-kind divergence pinned (OPT-DRY-04 NIT).
 *
 * Pure unit tests: no DB required. These pin the SHARED primitives
 * (exponentialDecay, computeRecencyScore, bucketConfidence) and the three
 * per-entity-kind strategy objects (MEMORY_SCORING / TASK_SCORING /
 * STANDARD_SCORING) that the search engines select from:
 *
 *   decay at t=0        → 1 (and any age <= 0, incl. future timestamps)
 *   decay at half-life  → 1/base (base 2 → 0.5, base Math.E → ~0.3679)
 *   bucket boundaries   → 0.7/0.4 (memory/task), 0.72/0.42 (standard final),
 *                         0.85/0.45 (standard keyword) — inclusive-exclusive
 *   standard keyword-OR → keyword relevance can lift the confidence label
 *                         independently of the blended final score
 *   future-date clamp   → recency of a future-dated entity is 1
 *
 * The recency paths call `Date.now()` internally, so every timestamp-based
 * assertion runs under `vi.useFakeTimers({ now: FIXED_REF_MS })` — ages are
 * computed against a fixed reference, never the wall clock (no flakiness).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	exponentialDecay,
	computeRecencyScore,
	bucketConfidence,
	MEMORY_SCORING,
	TASK_SCORING,
	STANDARD_SCORING
} from "../utils/scoring";
import {
	RECENCY_HALF_LIFE_MS,
	STANDARD_RECENCY_HALF_LIFE_MS,
	DEFAULT_CONFIDENCE_THRESHOLDS,
	STANDARD_CONFIDENCE_THRESHOLDS,
	STANDARD_KEYWORD_CONFIDENCE_THRESHOLDS
} from "../utils/constants";
import type { MemoryEntry, Task, CodingStandardEntry } from "../types";

// ── Fixed reference clock ────────────────────────────────────────────────

const FIXED_REF_MS = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
const REF_NOW = new Date(FIXED_REF_MS).toISOString();
const REF_FUTURE = new Date(FIXED_REF_MS + 24 * 60 * 60 * 1000).toISOString();
const REF_PAST_HALF_LIFE = new Date(FIXED_REF_MS - RECENCY_HALF_LIFE_MS).toISOString();
const REF_STANDARD_HALF_LIFE = new Date(FIXED_REF_MS - STANDARD_RECENCY_HALF_LIFE_MS).toISOString();

// ── Fixtures ────────────────────────────────────────────────────────────

const memoryFixture = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
	id: "mem-1",
	code: "MEM1",
	type: "code_fact",
	title: "Fixture memory",
	content: "Fixture content",
	importance: 3,
	agent: "test",
	role: "tester",
	model: "test-model",
	scope: { owner: "test", repo: "repo" },
	created_at: REF_NOW,
	updated_at: REF_NOW,
	completed_at: null,
	hit_count: 0,
	recall_count: 0,
	last_used_at: null,
	expires_at: null,
	supersedes: null,
	status: "active",
	tags: [],
	metadata: {},
	is_global: false,
	...overrides
});

const taskFixture = (overrides: Partial<Task> = {}): Task => ({
	id: "task-1",
	owner: "test",
	repo: "repo",
	task_code: "T1",
	phase: "phase",
	title: "Fixture task",
	description: null,
	status: "pending",
	priority: 3,
	agent: "test",
	role: "backend",
	doc_path: null,
	created_at: REF_NOW,
	updated_at: REF_NOW,
	in_progress_at: null,
	finished_at: null,
	canceled_at: null,
	est_tokens: 0,
	commit_id: null,
	changed_files: [],
	tags: [],
	suggested_skills: [],
	metadata: {},
	parent_id: null,
	depends_on: null,
	...overrides
});

const standardFixture = (overrides: Partial<CodingStandardEntry> = {}): CodingStandardEntry => ({
	id: "std-1",
	code: "STD1",
	title: "Fixture standard",
	content: "Fixture content",
	parent_id: null,
	context: "",
	version: "1.0.0",
	language: "typescript",
	stack: [],
	is_global: false,
	owner: "test",
	repo: "repo",
	tags: [],
	metadata: {},
	created_at: REF_NOW,
	updated_at: REF_NOW,
	hit_count: 0,
	last_used_at: null,
	agent: "test",
	model: "test-model",
	...overrides
});

beforeEach(() => {
	// Pin Date.now() to a fixed reference so recency ages are deterministic.
	vi.useFakeTimers({ now: FIXED_REF_MS });
});

afterEach(() => {
	vi.useRealTimers();
});

// ── Shared primitives ───────────────────────────────────────────────────

describe("exponentialDecay", () => {
	it("returns 1 for age 0 (brand-new entry)", () => {
		expect(exponentialDecay(0, RECENCY_HALF_LIFE_MS, 2)).toBe(1);
		expect(exponentialDecay(0, STANDARD_RECENCY_HALF_LIFE_MS, Math.E)).toBe(1);
	});

	it("clamps negative age (future timestamp) to 1", () => {
		expect(exponentialDecay(-1, RECENCY_HALF_LIFE_MS, 2)).toBe(1);
		expect(exponentialDecay(-1000 * 60 * 60 * 24, RECENCY_HALF_LIFE_MS, 2)).toBe(1);
	});

	it("returns exactly 1/base at the half-life", () => {
		// Base 2 (memory/task): halving every 30 days → 0.5 at exactly one half-life.
		expect(exponentialDecay(RECENCY_HALF_LIFE_MS, RECENCY_HALF_LIFE_MS, 2)).toBe(0.5);
		// Base Math.E (standard): e^(-180d/180d) = e^-1.
		expect(exponentialDecay(STANDARD_RECENCY_HALF_LIFE_MS, STANDARD_RECENCY_HALF_LIFE_MS, Math.E)).toBeCloseTo(
			1 / Math.E,
			10
		);
	});

	it("is bounded to [0, 1] for extreme ages", () => {
		expect(exponentialDecay(Number.POSITIVE_INFINITY, RECENCY_HALF_LIFE_MS, 2)).toBe(0);
		expect(exponentialDecay(RECENCY_HALF_LIFE_MS * 1000, RECENCY_HALF_LIFE_MS, 2)).toBeLessThan(0.001);
		expect(exponentialDecay(0, RECENCY_HALF_LIFE_MS, 2)).toBeGreaterThanOrEqual(0);
	});
});

describe("computeRecencyScore", () => {
	it("returns 1 for a brand-new entry (age ~0)", () => {
		expect(computeRecencyScore(REF_NOW)).toBe(1);
	});

	it("clamps a future-dated entry to 1 (future-date clamp)", () => {
		expect(computeRecencyScore(REF_FUTURE)).toBe(1);
	});

	it("halves at the configured half-life for base-2 decay", () => {
		// Age = exactly RECENCY_HALF_LIFE_MS against the fixed reference clock.
		expect(computeRecencyScore(REF_PAST_HALF_LIFE)).toBe(0.5);
	});

	it("is exactly 1 for a just-created entry at t=0", () => {
		expect(computeRecencyScore(new Date(FIXED_REF_MS).toISOString())).toBe(1);
	});
});

describe("bucketConfidence", () => {
	it("uses inclusive high / exclusive medium boundaries", () => {
		// 0.7/0.4 (memory/task): score >= 0.7 → high, >= 0.4 → medium, else low.
		expect(bucketConfidence(0.7, 0.7, 0.4)).toBe("high");
		expect(bucketConfidence(0.699999, 0.7, 0.4)).toBe("medium");
		expect(bucketConfidence(0.4, 0.7, 0.4)).toBe("medium");
		expect(bucketConfidence(0.399999, 0.7, 0.4)).toBe("low");
	});
});

// ── Memory strategy (0.7/0.4) ───────────────────────────────────────────

describe("MEMORY_SCORING", () => {
	it("maps 0.7 → high and 0.4 → medium (inclusive boundaries)", () => {
		expect(MEMORY_SCORING.confidence({ finalScore: 0.7, keywordScore: 0 })).toBe("high");
		expect(MEMORY_SCORING.confidence({ finalScore: 0.4, keywordScore: 0 })).toBe("medium");
	});

	it("maps just-below thresholds to the next bucket (exclusive boundaries)", () => {
		expect(MEMORY_SCORING.confidence({ finalScore: 0.699999, keywordScore: 0 })).toBe("medium");
		expect(MEMORY_SCORING.confidence({ finalScore: 0.399999, keywordScore: 0 })).toBe("low");
	});

	it("computes domain as tag-overlap ratio over the tag count", () => {
		const memory = memoryFixture({ tags: ["sqlite", "typescript", "mcp"] });
		// 2 of 3 tags match → 2/3.
		expect(MEMORY_SCORING.domain(memory, { queryTerms: ["sqlite", "typescript", "unrelated"] })).toBeCloseTo(2 / 3, 10);
		// No tags to match against → 0 (never NaN).
		expect(MEMORY_SCORING.domain(memoryFixture({ tags: [] }), { queryTerms: ["sqlite", "unrelated"] })).toBe(0);
	});

	it("recency is 1 for a future-dated memory (clamp)", () => {
		expect(MEMORY_SCORING.recency(memoryFixture({ created_at: REF_FUTURE }))).toBe(1);
	});

	it("recency is 0.5 for a memory created exactly one half-life ago", () => {
		expect(MEMORY_SCORING.recency(memoryFixture({ created_at: REF_PAST_HALF_LIFE }))).toBe(0.5);
	});
});

// ── Task strategy (0.7/0.4) ─────────────────────────────────────────────

describe("TASK_SCORING", () => {
	it("uses the same 0.7/0.4 confidence buckets as memory", () => {
		expect(TASK_SCORING.confidence({ finalScore: 0.7, keywordScore: 0 })).toBe("high");
		expect(TASK_SCORING.confidence({ finalScore: 0.4, keywordScore: 0 })).toBe("medium");
		expect(TASK_SCORING.confidence({ finalScore: 0.399999, keywordScore: 0 })).toBe("low");
	});

	it("computes domain as query-coverage ratio over query term count", () => {
		const task = taskFixture({
			title: "Fix chunk helper",
			description: "Route loops through chunksOf",
			phase: "tech-debt"
		});
		// "fix" and "chunk" appear in the searchable text → 2 of 3 query terms.
		expect(TASK_SCORING.domain(task, { queryTerms: ["fix", "chunk", "nonexistent"] })).toBeCloseTo(2 / 3, 10);
		// Empty query → 0 (never NaN).
		expect(TASK_SCORING.domain(task, { queryTerms: [] })).toBe(0);
	});

	it("recency is 1 for a future-dated task (clamp)", () => {
		expect(TASK_SCORING.recency(taskFixture({ created_at: REF_FUTURE }))).toBe(1);
	});

	it("recency is 0.5 for a task created exactly one half-life ago", () => {
		expect(TASK_SCORING.recency(taskFixture({ created_at: REF_PAST_HALF_LIFE }))).toBe(0.5);
	});
});

// ── Standard strategy (0.72/0.42 + keyword 0.85/0.45 OR) ────────────────

describe("STANDARD_SCORING", () => {
	it("maps final-score buckets 0.72/0.42 (inclusive-exclusive)", () => {
		expect(STANDARD_SCORING.confidence({ finalScore: 0.72, keywordScore: 0 })).toBe("high");
		expect(STANDARD_SCORING.confidence({ finalScore: 0.719999, keywordScore: 0 })).toBe("medium");
		expect(STANDARD_SCORING.confidence({ finalScore: 0.42, keywordScore: 0 })).toBe("medium");
		expect(STANDARD_SCORING.confidence({ finalScore: 0.419999, keywordScore: 0 })).toBe("low");
	});

	it("applies keyword-OR semantics: high keyword lifts the label independently", () => {
		// Keyword relevance alone (low final score) can still reach high/medium.
		expect(STANDARD_SCORING.confidence({ finalScore: 0.1, keywordScore: 0.85 })).toBe("high");
		expect(STANDARD_SCORING.confidence({ finalScore: 0.1, keywordScore: 0.45 })).toBe("medium");
		expect(STANDARD_SCORING.confidence({ finalScore: 0.1, keywordScore: 0.449999 })).toBe("low");
	});

	it("treats the keyword branch as OR — both signals contribute", () => {
		// Medium via final score even with zero keyword relevance.
		expect(STANDARD_SCORING.confidence({ finalScore: 0.5, keywordScore: 0 })).toBe("medium");
		// High via either signal.
		expect(STANDARD_SCORING.confidence({ finalScore: 0.72, keywordScore: 0.84 })).toBe("high");
		expect(STANDARD_SCORING.confidence({ finalScore: 0.71, keywordScore: 0.85 })).toBe("high");
		// Low only when BOTH signals are below their medium thresholds.
		expect(STANDARD_SCORING.confidence({ finalScore: 0.41, keywordScore: 0.44 })).toBe("low");
	});

	it("pins the exact standard thresholds from constants", () => {
		expect(DEFAULT_CONFIDENCE_THRESHOLDS).toEqual({ high: 0.7, medium: 0.4 });
		expect(STANDARD_CONFIDENCE_THRESHOLDS).toEqual({ high: 0.72, medium: 0.42 });
		expect(STANDARD_KEYWORD_CONFIDENCE_THRESHOLDS).toEqual({ high: 0.85, medium: 0.45 });
	});

	it("returns neutral 0.5 domain when no filters are present", () => {
		expect(STANDARD_SCORING.domain(standardFixture(), {})).toBe(0.5);
	});

	it("scores domain by filter match ratio", () => {
		const standard = standardFixture({ stack: ["node"], tags: ["sqlite"], language: "typescript", context: "testing" });
		const filters = { stack: ["node", "go"], tags: ["mcp"], language: "typescript", context: "TEST" };
		// stack + language + context match; tags do not → 3 of 4 filters.
		expect(STANDARD_SCORING.domain(standard, filters)).toBeCloseTo(0.75, 10);
	});

	it("scores domain 0 when filters are present but nothing matches", () => {
		const standard = standardFixture({ stack: ["python"], language: "python", context: "x" });
		const filters = { stack: ["node"], tags: ["mcp"], language: "typescript" };
		expect(STANDARD_SCORING.domain(standard, filters)).toBe(0);
	});

	it("recency is neutral 0.5 when no timestamp exists", () => {
		expect(STANDARD_SCORING.recency(standardFixture({ last_used_at: null, updated_at: "" }))).toBe(0.5);
	});

	it("recency uses last_used_at ?? updated_at and clamps future dates to 1", () => {
		expect(STANDARD_SCORING.recency(standardFixture({ last_used_at: REF_FUTURE }))).toBe(1);
		// Falls back to updated_at when last_used_at is null.
		expect(STANDARD_SCORING.recency(standardFixture({ last_used_at: null, updated_at: REF_NOW }))).toBe(1);
	});

	it("decays standards at the e-base half-life (180d → e^-1)", () => {
		expect(STANDARD_SCORING.recency(standardFixture({ last_used_at: REF_STANDARD_HALF_LIFE }))).toBeCloseTo(
			1 / Math.E,
			12
		);
	});
});
