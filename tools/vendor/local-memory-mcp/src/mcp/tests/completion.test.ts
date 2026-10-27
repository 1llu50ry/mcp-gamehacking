import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { rankCompletionValues } from "../utils/completion.js";

describe("rankCompletionValues()", () => {
	it("returns up to 100 unique non-empty candidates when input is empty", () => {
		const candidates = Array.from({ length: 150 }, (_, i) => `item-${i % 120}`);
		// i % 120 means we have 120 unique items: item-0 to item-119
		// item-0...item-119, then item-0...item-29
		const result = rankCompletionValues(candidates, "");

		expect(result).toHaveLength(100);
		expect(new Set(result).size).toBe(100);
		expect(result[0]).toBe("item-0");
	});

	it("filters out falsy and duplicate candidates", () => {
		const candidates = ["a", "b", "", "a", null as any, "c", "b"];
		const result = rankCompletionValues(candidates, "");
		expect(result).toEqual(["a", "b", "c"]);
	});

	it("ranks exact matches highest (score 100)", () => {
		const candidates = ["testing", "test", "tester"];
		const result = rankCompletionValues(candidates, "test");
		// "test" is exact match (100)
		// "tester" starts with "test" (75)
		// "testing" starts with "test" (75)
		// Alphabetical tie-break: "tester" < "testing"
		expect(result[0]).toBe("test");
	});

	it("ranks 'starts with' matches second (score 75)", () => {
		const candidates = ["atest", "test-item", "test"];
		const result = rankCompletionValues(candidates, "test");
		// "test" (100)
		// "test-item" (75)
		// "atest" (50 - includes)
		expect(result).toEqual(["test", "test-item", "atest"]);
	});

	it("ranks 'includes' matches third (score 50)", () => {
		const candidates = ["prefix-test-suffix", "test-start", "other"];
		const result = rankCompletionValues(candidates, "test");
		// "test-start" (75)
		// "prefix-test-suffix" (50)
		// "other" (0 - filtered out)
		expect(result).toEqual(["test-start", "prefix-test-suffix"]);
	});

	it("ranks 'compact' matches fourth (score 25)", () => {
		const candidates = ["t_e_s_t", "test", "t e s t"];
		const result = rankCompletionValues(candidates, "test");
		// "test" (100)
		// "t e s t" (25)
		// "t_e_s_t" (25)
		// alphabetical tie-break: "t e s t" < "t_e_s_t"
		expect(result).toEqual(["test", "t e s t", "t_e_s_t"]);
	});

	it("uses alphabetical tie-breaking for same scores", () => {
		const candidates = ["zebra-test", "apple-test", "test-zebra", "test-apple"];
		const result = rankCompletionValues(candidates, "test");
		// test-apple: 75
		// test-zebra: 75
		// apple-test: 50
		// zebra-test: 50
		expect(result).toEqual(["test-apple", "test-zebra", "apple-test", "zebra-test"]);
	});

	it("is case-insensitive for matching and sorts by localeCompare for same scores", () => {
		const candidates = ["TEST", "test", "TeSt"];
		const result = rankCompletionValues(candidates, "tEsT");
		// All are exact matches (after lowercase)
		// They all get score 100.
		// Sort order for score 100: a.localeCompare(b)
		// In this environment, "test" < "TeSt" < "TEST"
		expect(result).toEqual(["test", "TeSt", "TEST"]);
	});

	it("handles whitespace in input", () => {
		const candidates = ["hello world", "helloworld"];
		const result = rankCompletionValues(candidates, "  hello  ");
		expect(result).toContain("hello world");
		expect(result).toContain("helloworld");
	});

	it("returns empty array when no matches found", () => {
		const candidates = ["apple", "banana", "cherry"];
		const result = rankCompletionValues(candidates, "date");
		expect(result).toEqual([]);
	});
});

describe("rankCompletionValues() — property tests", () => {
	it("always returns unique values", () => {
		fc.assert(
			fc.property(fc.array(fc.string()), fc.string(), (candidates, input) => {
				const result = rankCompletionValues(candidates, input);
				expect(new Set(result).size).toBe(result.length);
			})
		);
	});

	it("never returns falsy values", () => {
		fc.assert(
			fc.property(
				fc.array(fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined))),
				fc.string(),
				(candidates, input) => {
					const result = rankCompletionValues(candidates as string[], input);
					for (const val of result) {
						expect(val).toBeTruthy();
					}
				}
			)
		);
	});

	it("if input is empty, result length is <= 100", () => {
		fc.assert(
			fc.property(fc.array(fc.string()), (candidates) => {
				const result = rankCompletionValues(candidates, "");
				expect(result.length).toBeLessThanOrEqual(100);
			})
		);
	});

	it("result values are always from the original candidates", () => {
		fc.assert(
			fc.property(fc.array(fc.string()), fc.string(), (candidates, input) => {
				const result = rankCompletionValues(candidates, input);
				const candidateSet = new Set(candidates);
				for (const val of result) {
					expect(candidateSet.has(val)).toBe(true);
				}
			})
		);
	});
});
