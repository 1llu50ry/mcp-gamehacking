import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { chunksOf } from "../../utils/chunk";

describe("chunksOf", () => {
	it("splits exactly at the chunk size", () => {
		expect(chunksOf([1, 2, 3, 4], 2)).toEqual([
			[1, 2],
			[3, 4]
		]);
	});

	it("keeps the remainder in a final smaller chunk", () => {
		expect(chunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});

	it("returns a single chunk when size exceeds the array length", () => {
		expect(chunksOf([1, 2], 10)).toEqual([[1, 2]]);
	});

	it("returns an empty array for an empty input", () => {
		expect(chunksOf([], 10)).toEqual([]);
	});

	it("throws RangeError for size=0 instead of looping forever (regression TASK-378)", () => {
		// size=0 previously made the loop advance by 0, pushing empty chunks
		// indefinitely (OOM); negative sizes walk the index backwards the same
		// way. The size is invalid regardless of the item count.
		expect(() => chunksOf([1, 2, 3], 0)).toThrow(RangeError);
		expect(() => chunksOf([1, 2, 3], -1)).toThrow(RangeError);
		expect(() => chunksOf([], 0)).toThrow(RangeError);
	});

	it("throws RangeError for non-finite sizes", () => {
		expect(() => chunksOf([1, 2, 3], Number.NaN)).toThrow(RangeError);
		expect(() => chunksOf([1, 2, 3], Number.POSITIVE_INFINITY)).toThrow(RangeError);
	});

	it("handles a size of 1", () => {
		expect(chunksOf(["a", "b", "c"], 1)).toEqual([["a"], ["b"], ["c"]]);
	});

	it("preserves order, covers every item and bounds chunk sizes (property)", () => {
		// Non-positive and non-finite sizes (0, negatives, NaN, Infinity) are
		// outside the contract domain: chunksOf throws RangeError for them (see
		// negative tests above), so the property samples the valid domain only.
		fc.assert(
			fc.property(fc.array(fc.integer()), fc.integer({ min: 1, max: 50 }), (items, size) => {
				const chunks = chunksOf(items, size);
				expect(chunks.flat()).toEqual(items);
				expect(chunks.length).toBe(items.length === 0 ? 0 : Math.ceil(items.length / size));
				for (const chunk of chunks) {
					expect(chunk.length).toBeGreaterThan(0);
					expect(chunk.length).toBeLessThanOrEqual(size);
				}
			})
		);
	});

	it("never produces an empty chunk for non-empty input (boundary)", () => {
		fc.assert(
			fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 30 }), (items) => {
				const chunks = chunksOf(items, 500);
				expect(chunks.length).toBe(1);
				expect(chunks[0]).toEqual(items);
			})
		);
	});
});
