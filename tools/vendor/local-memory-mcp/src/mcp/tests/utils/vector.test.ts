import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
	computeVector,
	cosineSimilarity,
	cosineSimilarityArrays,
	createTfVectorCache,
	decodeVector,
	encodeVector
} from "../../utils/vector";
import { tokenize } from "../../utils/normalize";

// Null-prototype accumulator so arbitrary tokens (including Object.prototype
// collisions like "constructor"/"__proto__") become own numeric properties —
// mirrors computeVector's post-TASK-377 semantics.
function buildVector(pairs: readonly (readonly [string, number])[]): Record<string, number> {
	const vector: Record<string, number> = Object.create(null);
	for (const [token, count] of pairs) vector[token] = (vector[token] ?? 0) + count;
	return vector;
}

describe("computeVector", () => {
	it("counts token occurrences with stopwords stripped", () => {
		expect(computeVector("the quick brown fox")).toEqual({ quick: 1, brown: 1, fox: 1 });
	});

	it("lowercases tokens", () => {
		expect(computeVector("Alpha BETA alpha")).toEqual({ alpha: 2, beta: 1 });
	});

	it("counts repeated tokens across the text", () => {
		expect(computeVector("run run run")).toEqual({ run: 3 });
	});

	it("returns an empty vector for empty/stopword-only input", () => {
		expect(computeVector("")).toEqual({});
		expect(computeVector("the and of a an")).toEqual({});
	});

	it("counts 'constructor' as a numeric own property, not the inherited Function (TASK-377)", () => {
		const vector = computeVector("constructor foo constructor");
		expect(typeof vector.constructor).toBe("number");
		expect(vector.constructor).toBe(2);
		expect(vector.foo).toBe(1);
		expect(Object.values(vector).every((n) => typeof n === "number")).toBe(true);
	});

	it("keeps '__proto__' as an own numeric count instead of silently dropping it (TASK-377)", () => {
		const vector = computeVector("__proto__ getter __proto__");
		expect(Object.hasOwn(vector, "__proto__")).toBe(true);
		expect(vector["__proto__"]).toBe(2);
	});

	it("token totals equal the tokenizer output length (property)", () => {
		// Full token domain — no Object.prototype exclusions: computeVector now
		// uses a null-prototype accumulator, so prototype-colliding tokens
		// ("constructor", "__proto__", ...) yield numeric counts and the total
		// invariant holds for every possible string (regression guard TASK-377).
		fc.assert(
			fc.property(fc.string({ minLength: 0, maxLength: 100 }), (text) => {
				const vector = computeVector(text);
				expect(Object.values(vector).every((n) => typeof n === "number")).toBe(true);
				const total = Object.values(vector).reduce((sum, n) => sum + n, 0);
				expect(total).toBe(tokenize(text).length);
			})
		);
	});
});

describe("cosineSimilarity", () => {
	it("returns 1 for identical vectors", () => {
		expect(cosineSimilarity({ a: 1, b: 2 }, { a: 1, b: 2 })).toBeCloseTo(1, 10);
	});

	it("returns 0 for disjoint vectors", () => {
		expect(cosineSimilarity({ a: 1 }, { z: 1 })).toBe(0);
	});

	it("returns a value between 0 and 1 for partially overlapping vectors", () => {
		const sim = cosineSimilarity({ a: 1, b: 2 }, { a: 3, c: 4 });
		expect(sim).toBeGreaterThan(0);
		expect(sim).toBeLessThan(1);
	});

	it("returns 0 when either vector is empty", () => {
		expect(cosineSimilarity({}, { a: 1 })).toBe(0);
		expect(cosineSimilarity({ a: 1 }, {})).toBe(0);
		expect(cosineSimilarity({}, {})).toBe(0);
	});

	it("stays finite in [0, 1] for vectors with prototype-colliding tokens (TASK-377)", () => {
		const sim = cosineSimilarity(computeVector("constructor foo constructor"), computeVector("constructor foo"));
		expect(Number.isFinite(sim)).toBe(true);
		expect(sim).toBeGreaterThan(0);
		expect(sim).toBeLessThanOrEqual(1);
	});

	it("does not read inherited Object.prototype members when one vector lacks the key (TASK-377)", () => {
		// Plain-object vectors: v2 has no own "constructor", so the pre-fix
		// `if (v2[key])` read the inherited Function and computed NaN.
		const sim = cosineSimilarity({ constructor: 1, foo: 1 }, { foo: 1 });
		expect(Number.isFinite(sim)).toBe(true);
		expect(sim).toBeGreaterThan(0);
		expect(sim).toBeLessThan(1);
	});

	it("is symmetric and bounded in [0, 1] for arbitrary sparse vectors (property)", () => {
		// No token exclusions: cosineSimilarity guards cross-vector reads with
		// Object.hasOwn, so inherited Object.prototype members can never leak
		// into the math regardless of vector shape (regression guard TASK-377).
		fc.assert(
			fc.property(
				fc.array(fc.tuple(fc.string(), fc.integer({ min: 1, max: 10 }))),
				fc.array(fc.tuple(fc.string(), fc.integer({ min: 1, max: 10 }))),
				(pairs1, pairs2) => {
					const v1 = buildVector(pairs1);
					const v2 = buildVector(pairs2);
					const sim = cosineSimilarity(v1, v2);
					expect(sim).toBeGreaterThanOrEqual(0);
					expect(sim).toBeLessThanOrEqual(1);
					expect(sim).toBeCloseTo(cosineSimilarity(v2, v1), 10);
					if (Object.keys(v1).length > 0) {
						expect(cosineSimilarity(v1, v1)).toBeCloseTo(1, 10);
					}
				}
			)
		);
	});
});

describe("cosineSimilarityArrays", () => {
	it("returns 1 for identical dense vectors", () => {
		expect(cosineSimilarityArrays([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
	});

	it("returns 0 for orthogonal dense vectors", () => {
		expect(cosineSimilarityArrays([1, 0], [0, 1])).toBe(0);
	});

	it("returns 0 when lengths differ", () => {
		expect(cosineSimilarityArrays([1, 2], [1, 2, 3])).toBe(0);
	});

	it("returns 0 when either vector has zero norm", () => {
		expect(cosineSimilarityArrays([0, 0], [1, 2])).toBe(0);
		expect(cosineSimilarityArrays([1, 2], [0, 0])).toBe(0);
	});

	it("is symmetric and bounded for equal-length dense vectors (property)", () => {
		fc.assert(
			fc.property(fc.array(fc.integer({ min: 0, max: 100 })), fc.array(fc.integer({ min: 0, max: 100 })), (a, b) => {
				const sim = cosineSimilarityArrays(a, b);
				expect(sim).toBeGreaterThanOrEqual(0);
				expect(sim).toBeLessThanOrEqual(1);
				if (a.length !== b.length) {
					expect(sim).toBe(0);
				} else {
					expect(sim).toBeCloseTo(cosineSimilarityArrays(b, a), 10);
				}
			})
		);
	});
});

describe("createTfVectorCache", () => {
	it("returns the cached vector for an unchanged updatedAt", () => {
		const cache = createTfVectorCache();
		const first = cache.get("id-1", "the quick fox", "2026-01-01");
		const second = cache.get("id-1", "the quick fox", "2026-01-01");
		expect(second).toBe(first);
	});

	it("recomputes when updatedAt changes", () => {
		const cache = createTfVectorCache();
		const first = cache.get("id-1", "the quick fox", "2026-01-01");
		const second = cache.get("id-1", "the quick fox", "2026-01-02");
		expect(second).not.toBe(first);
		expect(second).toEqual(first);
	});

	it("caches entries with a null updatedAt", () => {
		const cache = createTfVectorCache();
		const first = cache.get("id-1", "hello world", null);
		const second = cache.get("id-1", "hello world", null);
		expect(second).toBe(first);
	});

	it("returns the stale cached vector when text differs but updatedAt is unchanged", () => {
		const cache = createTfVectorCache();
		const first = cache.get("id-1", "alpha", "t");
		const second = cache.get("id-1", "beta", "t");
		expect(second).toBe(first);
		expect(second).toEqual({ alpha: 1 });
	});

	it("clears the whole cache when the entry cap is reached", () => {
		const cache = createTfVectorCache(2);
		const a1 = cache.get("a", "alpha", "t1");
		cache.get("b", "beta", "t2");
		cache.get("c", "gamma", "t3"); // pushes size past 2 → clears
		const a2 = cache.get("a", "alpha", "t1");
		expect(a2).not.toBe(a1);
		expect(a2).toEqual({ alpha: 1 });
	});
});

describe("encodeVector", () => {
	it("encodes a Float32Array as a float32 BLOB", () => {
		const encoded = encodeVector(Float32Array.from([1, 2, 3]));
		expect(encoded).toBeInstanceOf(Buffer);
		expect((encoded as Buffer).byteLength).toBe(3 * 4);
	});

	it("encodes a number[] as a float32 BLOB", () => {
		const encoded = encodeVector([1.5, 2.5]);
		expect(encoded).toBeInstanceOf(Buffer);
		expect((encoded as Buffer).byteLength).toBe(2 * 4);
	});

	it("keeps sparse term-frequency maps (plain objects) as legacy JSON TEXT", () => {
		const encoded = encodeVector({ constructor: 2, pattern: 1 });
		expect(typeof encoded).toBe("string");
		expect(JSON.parse(encoded as string)).toEqual({ constructor: 2, pattern: 1 });
	});

	it("keeps primitives as legacy JSON TEXT", () => {
		expect(encodeVector(42)).toBe("42");
		expect(encodeVector(null)).toBe("null");
	});
});

describe("decodeVector", () => {
	it("decodes a float32 BLOB back into a Float32Array", () => {
		const decoded = decodeVector(encodeVector(Float32Array.from([1, 2, 3])));
		expect(decoded).toBeInstanceOf(Float32Array);
		expect(Array.from(decoded)).toEqual([1, 2, 3]);
	});

	it("decodes a legacy JSON number[] string", () => {
		const decoded = decodeVector("[1.5, 2.5, 3]");
		expect(decoded).toBeInstanceOf(Float32Array);
		expect(Array.from(decoded)).toEqual([1.5, 2.5, 3]);
	});

	it("realigns an unaligned BLOB view via a one-time copy", () => {
		const source = Float32Array.from([1, 2, 3]);
		const raw = Buffer.from(source.buffer, source.byteOffset, source.byteLength);
		// Back the same bytes with a 1-byte leading pad so the Uint8Array view
		// has a byteOffset that is not 4-byte aligned.
		const misaligned = new Uint8Array(new ArrayBuffer(raw.byteLength + 1), 1, raw.byteLength);
		misaligned.set(raw);
		expect(misaligned.byteOffset % 4).not.toBe(0);

		const decoded = decodeVector(misaligned);
		expect(decoded).toBeInstanceOf(Float32Array);
		expect(Array.from(decoded)).toEqual([1, 2, 3]);
	});

	it("returns an empty Float32Array for null/undefined", () => {
		expect(Array.from(decodeVector(null))).toEqual([]);
		expect(Array.from(decodeVector(undefined))).toEqual([]);
	});

	it("returns an empty Float32Array for malformed JSON", () => {
		expect(Array.from(decodeVector("{not json"))).toEqual([]);
	});

	it("returns an empty Float32Array for non-array JSON", () => {
		expect(Array.from(decodeVector('{"a":1}'))).toEqual([]);
		expect(Array.from(decodeVector("42"))).toEqual([]);
	});

	it("returns an empty Float32Array for unrecognized value types", () => {
		expect(Array.from(decodeVector(123))).toEqual([]);
		expect(Array.from(decodeVector({ a: 1 }))).toEqual([]);
	});
});
