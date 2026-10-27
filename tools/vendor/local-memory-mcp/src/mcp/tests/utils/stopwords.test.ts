import { describe, it, expect } from "vitest";
import { STOPWORDS } from "../../utils/stopwords";

describe("STOPWORDS", () => {
	it("contains common English stopwords", () => {
		for (const word of ["the", "and", "of", "is", "in", "with", "for"]) {
			expect(STOPWORDS.has(word)).toBe(true);
		}
	});

	it("contains common Indonesian stopwords", () => {
		for (const word of ["yang", "dan", "di", "untuk", "dengan", "adalah", "tidak"]) {
			expect(STOPWORDS.has(word)).toBe(true);
		}
	});

	it("does not contain meaningful search tokens", () => {
		expect(STOPWORDS.has("database")).toBe(false);
		expect(STOPWORDS.has("vector")).toBe(false);
		expect(STOPWORDS.has("apple")).toBe(false);
	});

	it("is a non-empty set", () => {
		expect(STOPWORDS.size).toBeGreaterThan(0);
	});

	it("contains only non-empty words without spaces (property)", () => {
		for (const word of STOPWORDS) {
			expect(word.length).toBeGreaterThan(0);
			expect(word).not.toContain(" ");
		}
	});

	it("contains only lowercase words (property)", () => {
		for (const word of STOPWORDS) {
			expect(word).toBe(word.toLowerCase());
		}
	});
});
