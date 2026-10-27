/**
 * Unit tests for the PERF-008 semantic recall regression guard.
 *
 * The guard's value depends on its oracle being independent: the expected ids
 * come from the corpus design, and the comparison must be able to FAIL. These
 * tests pin both properties, plus the corpus/query invariants that keep the
 * guard meaningful (every expected id exists, every query targets something).
 *
 * The real-ONNX half runs in `src/mcp/tests/lightness.perf.test.ts`; here every
 * scorer is a stub, so this file needs no model and no network.
 */

import { describe, expect, it } from "vitest";
import {
	RECALL_BASELINE,
	RECALL_CORPUS,
	RECALL_K,
	RECALL_QUERIES,
	compareRecall,
	measureRecall,
	recallBaselineSnapshot,
	recallForQuery
} from "../../bench/recall-guard";

describe("recall corpus invariants", () => {
	it("gives every record a unique id", () => {
		const ids = RECALL_CORPUS.map((item) => item.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("targets an existing corpus record for every query", () => {
		const ids = new Set(RECALL_CORPUS.map((item) => item.id));
		for (const query of RECALL_QUERIES) {
			expect(query.expectedIds.length).toBeGreaterThan(0);
			for (const id of query.expectedIds) expect(ids.has(id)).toBe(true);
		}
	});

	it("keeps the recall window smaller than the corpus (the guard must be able to fail)", () => {
		expect(RECALL_K).toBeGreaterThan(0);
		expect(RECALL_K).toBeLessThan(RECALL_CORPUS.length);
	});
});

describe("recallForQuery", () => {
	it("returns 1 when the expected id is inside the window", () => {
		expect(recallForQuery(["a"], ["a", "b"], 2)).toBe(1);
	});

	it("returns 0 when the expected id falls outside the window", () => {
		expect(recallForQuery(["c"], ["a", "b"], 2)).toBe(0);
	});

	it("handles a partial multi-target expectation", () => {
		expect(recallForQuery(["a", "b"], ["a", "z"], 2)).toBe(0.5);
	});

	it("treats an empty expectation as fully satisfied", () => {
		expect(recallForQuery([], ["a"], 2)).toBe(1);
	});
});

describe("measureRecall", () => {
	it("scores a perfect scorer at 1 across every query", async () => {
		const report = await measureRecall(async (query) => {
			const entry = RECALL_QUERIES.find((candidate) => candidate.query === query)!;
			return entry.expectedIds;
		});
		expect(report.meanRecall).toBe(1);
		expect(report.minRecall).toBe(1);
		expect(report.perfectQueries).toBe(RECALL_QUERIES.length);
	});

	it("scores an empty scorer at 0 (the negative control)", async () => {
		const report = await measureRecall(() => []);
		expect(report.meanRecall).toBe(0);
		expect(report.minRecall).toBe(0);
		expect(report.perfectQueries).toBe(0);
		expect(report.perQuery.every((result) => result.recall === 0)).toBe(true);
	});

	it("records misses with the ids that were not surfaced", async () => {
		const report = await measureRecall(() => [], [RECALL_QUERIES[0]!], RECALL_K);
		expect(report.perQuery[0]!.misses).toEqual(RECALL_QUERIES[0]!.expectedIds);
	});
});

describe("compareRecall", () => {
	it("passes when nothing degrades (zero tolerance)", async () => {
		const report = await measureRecall(async (query) => {
			const entry = RECALL_QUERIES.find((candidate) => candidate.query === query)!;
			return entry.expectedIds;
		});
		const comparison = compareRecall(recallBaselineSnapshot(), report, 0);
		expect(comparison.ok).toBe(true);
		expect(comparison.degraded).toEqual([]);
	});

	it("fails when a query drops below the baseline", async () => {
		const report = await measureRecall(() => []);
		const comparison = compareRecall(recallBaselineSnapshot(), report, 0);
		expect(comparison.ok).toBe(false);
		expect(comparison.degraded.length).toBe(RECALL_QUERIES.length);
	});

	it("allows a drop within an explicit tolerance", async () => {
		const report = await measureRecall(() => [], [RECALL_QUERIES[0]!], RECALL_K);
		// A 1.0 drop is within a tolerance of 1.0.
		expect(compareRecall(recallBaselineSnapshot(), report, 1).ok).toBe(true);
	});

	it("ignores queries absent from the baseline", async () => {
		const report = await measureRecall(() => []);
		expect(compareRecall({}, report, 0).ok).toBe(true);
	});
});

describe("recorded baseline", () => {
	it("covers every query at full recall", () => {
		for (const query of RECALL_QUERIES) expect(RECALL_BASELINE[query.query]).toBe(1);
	});

	it("is frozen and snapshot-copyable", () => {
		expect(Object.isFrozen(RECALL_BASELINE)).toBe(true);
		const copy = recallBaselineSnapshot();
		expect(copy).toEqual({ ...RECALL_BASELINE });
		expect(copy).not.toBe(RECALL_BASELINE);
	});
});
