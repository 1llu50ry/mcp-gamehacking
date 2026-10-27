import { describe, it, expect } from "vitest";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorResult } from "../types";

/**
 * Regression tests for StubVectorStore.computeFrequencyVector (TASK-381).
 *
 * Pre-fix, computeFrequencyVector built the TF dictionary with a plain `{}`:
 * - "constructor" (kept by generateTextVector's lowercase tokenizer — real
 *   content mentioning "constructor" hits this) read the INHERITED
 *   Object.prototype Function, so `vector[token] || 0` started from a truthy
 *   function and the count became a string. That vector is JSON.stringify'd
 *   into memory_vectors and JSON.parse'd back in search(), where
 *   cosineSimilarity received a STRING own-value → `number * string` → NaN →
 *   corrupted/re-ranked results.
 * - "__proto__" writes were silently dropped by the inherited setter (count
 *   lost entirely).
 *
 * Fix (mirrors TASK-377): null-prototype accumulator Object.create(null).
 * The stored vector is the serialized computeFrequencyVector output, so
 * inspecting the DB row asserts the write path; search() asserts the
 * read + scoring path end-to-end.
 */

const VALID_UUID_1 = "11111111-1111-4111-a111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-a222-222222222222";
const REPO = "stub-vector-repo";

async function setup(): Promise<{ db: SQLiteStore; vectors: StubVectorStore }> {
	const db = await createTestStore();
	const vectors = new StubVectorStore(db);
	return { db, vectors };
}

function insertMemory(db: SQLiteStore, id: string, content: string): void {
	db.memories.insert({
		id,
		type: "code_fact",
		title: `Memory ${id}`,
		content,
		importance: 3,
		agent: "test",
		role: "developer",
		model: "test",
		scope: { owner: "test", repo: REPO },
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: null,
		supersedes: null,
		status: "active",
		tags: [],
		metadata: {},
		is_global: false
	});
}

/** The stored vector for `id` = JSON.parse of the serialized computeFrequencyVector output. */
function storedVector(db: SQLiteStore, id: string): Record<string, unknown> {
	const row = db.memoryVectors.getVectorCandidates().find((c) => c.memory_id === id);
	expect(row).toBeDefined();
	// StubVectorStore persists sparse TF maps as JSON TEXT (dense embeddings are
	// the float32 BLOB written by RealVectorStore — TASK-038).
	expect(typeof row!.vector).toBe("string");
	return JSON.parse(row!.vector as string) as Record<string, unknown>;
}

describe("StubVectorStore prototype-key token corruption (TASK-381)", () => {
	it("stores a numeric count for 'constructor' instead of the inherited Function string", async () => {
		const { db, vectors } = await setup();
		insertMemory(db, VALID_UUID_1, "constructor pattern constructor");
		await vectors.upsert(VALID_UUID_1, "constructor pattern constructor");

		const stored = storedVector(db, VALID_UUID_1);
		expect(typeof stored.constructor).toBe("number");
		expect(stored.constructor).toBe(2);
		expect(stored.pattern).toBe(1);
		// No inherited/own value may escape computeFrequencyVector as a string.
		expect(Object.values(stored).every((v) => typeof v === "number")).toBe(true);

		await db.close();
	});

	it("keeps '__proto__' as an own numeric count instead of silently dropping it", async () => {
		const { db, vectors } = await setup();
		insertMemory(db, VALID_UUID_1, "constructor __proto__ constructor __proto__");
		await vectors.upsert(VALID_UUID_1, "constructor __proto__ constructor __proto__");

		const stored = storedVector(db, VALID_UUID_1);
		expect(Object.hasOwn(stored, "__proto__")).toBe(true);
		expect(stored["__proto__"]).toBe(2);
		expect(stored.constructor).toBe(2);

		await db.close();
	});

	it("returns finite scores in [0,1] for search over vectors with prototype-colliding tokens", async () => {
		const { db, vectors } = await setup();
		insertMemory(db, VALID_UUID_1, "the class constructor pattern drives object lifecycle");
		insertMemory(db, VALID_UUID_2, "gardening tips for tropical plants in summer");
		await vectors.upsert(VALID_UUID_1, "the class constructor pattern drives object lifecycle");
		await vectors.upsert(VALID_UUID_2, "gardening tips for tropical plants in summer");

		const results = (await vectors.search("constructor pattern", 5)) as VectorResult[];
		expect(results.length).toBeGreaterThan(0);
		for (const r of results) {
			expect(Number.isFinite(r.score)).toBe(true);
			expect(r.score).toBeGreaterThanOrEqual(0);
			expect(r.score).toBeLessThanOrEqual(1);
		}

		// The constructor-bearing memory must rank first with a positive score
		// (pre-fix its score was NaN, corrupting the ranking).
		expect(results[0]?.id).toBe(VALID_UUID_1);
		expect(results[0]?.score).toBeGreaterThan(0);

		await db.close();
	});

	it("keeps '__proto__' query tokens in the scoring instead of dropping them", async () => {
		const { db, vectors } = await setup();
		insertMemory(db, VALID_UUID_1, "prototype pollution through __proto__ assignment is dangerous");
		insertMemory(db, VALID_UUID_2, "banana bread recipe with walnuts and honey");
		await vectors.upsert(VALID_UUID_1, "prototype pollution through __proto__ assignment is dangerous");
		await vectors.upsert(VALID_UUID_2, "banana bread recipe with walnuts and honey");

		// Query on "__proto__" ALONE: pre-fix the token was silently dropped
		// from the query vector (inherited setter), leaving an empty vector →
		// every score 0 → the match below is indistinguishable from noise.
		const results = (await vectors.search("__proto__", 5)) as VectorResult[];
		expect(results.length).toBeGreaterThan(0);
		for (const r of results) {
			expect(Number.isFinite(r.score)).toBe(true);
		}
		expect(results[0]?.id).toBe(VALID_UUID_1);
		expect(results[0]?.score).toBeGreaterThan(0);

		await db.close();
	});
});
