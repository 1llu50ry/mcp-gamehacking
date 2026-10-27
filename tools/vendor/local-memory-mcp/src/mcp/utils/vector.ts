// Vector computation & similarity utilities shared across entities and stores.
// Single source of truth for TF frequency vectors, cosine similarity, and the
// in-memory TF vector cache used by similarity searches.

import { tokenize } from "./normalize";

/**
 * Build a term-frequency vector from raw text.
 *
 * Tokenizes via the shared normalizer (lowercase; keeps alphanumeric plus
 * underscore/hyphen/dot; strips stopwords) and counts token occurrences.
 * Returns a sparse Record keyed by token.
 *
 * The accumulator is a null-prototype object: with a plain `{}`, tokens that
 * collide with `Object.prototype` members defeat the `vector[token] || 0`
 * guard — `vector["constructor"]` reads the inherited Function (truthy) so the
 * count becomes a string, and `vector["__proto__"] = n` hits the inherited
 * setter and is silently dropped. Both corrupt downstream cosine similarity
 * into NaN. A null-prototype accumulator reads only own properties and
 * creates genuine own keys for every token.
 */
export function computeVector(text: string): Record<string, number> {
	const tokens = tokenize(text);
	const vector: Record<string, number> = Object.create(null);
	tokens.forEach((token) => {
		vector[token] = (vector[token] || 0) + 1;
	});
	return vector;
}

/**
 * Cosine similarity between two sparse term-frequency vectors.
 * Returns 0 when either vector is empty.
 *
 * Cross-vector reads are guarded with `Object.hasOwn`: a sparse vector can
 * arrive as a plain object (e.g. JSON.parse round-trip in the stub vector
 * store), where a missing key like "constructor" would otherwise resolve to
 * the inherited Object.prototype member and produce NaN in the dot product.
 */
export function cosineSimilarity(v1: Record<string, number>, v2: Record<string, number>): number {
	const keys1 = Object.keys(v1);
	const keys2 = Object.keys(v2);
	if (!keys1.length || !keys2.length) return 0;

	let dotProduct = 0;
	for (const key of keys1) {
		if (Object.hasOwn(v2, key)) dotProduct += v1[key] * v2[key];
	}

	let mag1 = 0;
	for (const key of keys1) mag1 += v1[key] * v1[key];

	let mag2 = 0;
	for (const key of keys2) mag2 += v2[key] * v2[key];

	const mag = Math.sqrt(mag1) * Math.sqrt(mag2);
	return mag === 0 ? 0 : dotProduct / mag;
}

/**
 * Cosine similarity between two dense equal-length vectors (e.g. fixed-dim
 * model embeddings). Returns 0 when lengths differ or either vector has zero
 * norm. Identical math to {@link cosineSimilarity} but for positional vectors.
 *
 * Accepts any positional `ArrayLike<number>` (plain `number[]`, `Float32Array`,
 * ...) so decoded BLOB vectors can be scored without first copying them into a
 * JS array (TASK-038).
 */
export function cosineSimilarityArrays(a: ArrayLike<number>, b: ArrayLike<number>): number {
	if (a.length !== b.length) return 0;
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		const va = a[i];
		const vb = b[i] ?? 0;
		dot += va * vb;
		magA += va * va;
		magB += vb * vb;
	}
	if (magA === 0 || magB === 0) return 0;
	return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Encode a vector for storage in a `*_vectors.vector` column (TASK-038).
 *
 * - Dense embeddings (`Float32Array` or `number[]`, e.g. the 384-dim
 *   all-MiniLM-L6-v2 output) are stored as a **float32 little-endian BLOB**
 *   (384 * 4 = 1,536 bytes) instead of a ~8 KB JSON decimal array — 5.24x
 *   smaller with zero recall loss (no quantization) and no JSON.parse on the
 *   search hot path.
 * - Sparse term-frequency maps (plain objects, written by `StubVectorStore`)
 *   keep the legacy JSON TEXT encoding; they have no fixed dimension and
 *   cannot be represented as a dense float32 array.
 *
 * `Buffer.from(f32.buffer, byteOffset, byteLength)` is a zero-copy view over
 * the float32 bytes; better-sqlite3 binds it as a SQLite BLOB. The returned
 * `Buffer` shares the source `Float32Array`'s memory, so callers must not
 * mutate the array afterwards.
 */
export function encodeVector(value: unknown): Buffer | string {
	if (value instanceof Float32Array) {
		return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	}
	if (Array.isArray(value)) {
		const f32 = Float32Array.from(value as number[]);
		return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
	}
	// Sparse TF vector (plain object) — keep the legacy JSON encoding.
	return JSON.stringify(value);
}

/**
 * Decode a `*_vectors.vector` column value into a dense `Float32Array`
 * (TASK-038). Dual-format on purpose so a partially-migrated database never
 * crashes during rollout:
 *
 * - BLOB (`Buffer` / `Uint8Array`) → zero-copy `Float32Array` view when the
 *   byte offset is 4-byte aligned (the common case); otherwise a one-time
 *   realigning copy.
 * - Legacy JSON TEXT (a `number[]` decimal array) → `Float32Array.from`.
 *
 * Non-array JSON (a sparse TF map) and any unrecognized value decode to an
 * empty vector; those are only ever produced/consumed by `StubVectorStore`,
 * which keeps its own sparse JSON read path.
 */
export function decodeVector(value: unknown): Float32Array {
	if (value == null) return new Float32Array(0);
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (Array.isArray(parsed)) return Float32Array.from(parsed as number[]);
		} catch {
			// Malformed legacy JSON — fall through to an empty vector.
		}
		return new Float32Array(0);
	}
	if (value instanceof Uint8Array) {
		// `Buffer` is a `Uint8Array`, so this also covers better-sqlite3 BLOBs.
		const bytes = value;
		if (bytes.byteOffset % 4 === 0 && bytes.byteLength % 4 === 0) {
			return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
		}
		const aligned = new Uint8Array(bytes.byteLength);
		aligned.set(bytes);
		return new Float32Array(aligned.buffer, 0, Math.floor(aligned.byteLength / 4));
	}
	return new Float32Array(0);
}

export interface TfVectorCache {
	/**
	 * Return the cached term-frequency vector for `id`, recomputing from
	 * `text` when the entry is absent or `updatedAt` differs.
	 */
	get(id: string, text: string, updatedAt: string | null): Record<string, number>;
}

/**
 * Create an in-memory TF vector cache keyed by entity id and validated
 * against the row's `updated_at`. Because freshness is checked against the
 * DB value on every read, the cache self-invalidates on writes without any
 * write-path hooks. When the entry cap is reached the cache is cleared to
 * bound memory usage.
 */
export function createTfVectorCache(maxEntries = 1024): TfVectorCache {
	const cache = new Map<string, { vector: Record<string, number>; updatedAt: string | null }>();
	return {
		get(id, text, updatedAt) {
			const cached = cache.get(id);
			if (cached && cached.updatedAt === updatedAt) return cached.vector;
			const vector = computeVector(text);
			if (cache.size >= maxEntries) cache.clear();
			cache.set(id, { vector, updatedAt });
			return vector;
		}
	};
}
