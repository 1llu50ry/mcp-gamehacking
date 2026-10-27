import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { RealVectorStore } from "../storage/vectors";
import { cosineSimilarityArrays, decodeVector, encodeVector } from "../utils/vector";
import type { MemoryEntry } from "../types";

/**
 * TASK-038 — dense embeddings are persisted as a float32 little-endian BLOB
 * (384 * 4 = 1,536 bytes) instead of a JSON decimal TEXT array (~8 KB), while
 * the read path stays dual-format so a partially-migrated DB never crashes.
 *
 * These tests pin the write→read round-trip, the legacy-JSON dual-read, and
 * score parity between the BLOB and JSON representations of the same vector.
 */
const DIM = 384;
const REPO = "blob-format-test";
const NOW = new Date().toISOString();

function makeVector(seed: number): number[] {
	return Array.from({ length: DIM }, (_, i) => Math.sin(seed + i * 0.01) * 0.5);
}

function insertMemory(db: SQLiteStore, id: string): void {
	const memory: MemoryEntry = {
		id,
		type: "code_fact",
		title: `Memory ${id}`,
		content: "blob format fixture",
		importance: 3,
		agent: "test",
		role: "backend",
		model: "test",
		scope: { owner: "test", repo: REPO },
		created_at: NOW,
		updated_at: NOW,
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
	};
	db.memories.insert(memory);
}

/** Read the raw stored `vector` value for `memory_id` straight from SQLite. */
function rawVector(db: SQLiteStore, memoryId: string): unknown {
	return (db.db.prepare("SELECT vector FROM memory_vectors WHERE memory_id = ?").get(memoryId) as { vector: unknown })
		.vector;
}

describe("vector BLOB format (TASK-038)", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => db.close());

	it("stores a dense Float32Array embedding as a float32 BLOB of 384*4 bytes", () => {
		const id = randomUUID();
		insertMemory(db, id);
		const vec = makeVector(1);

		db.memoryVectors.upsertVectorEmbedding(id, Float32Array.from(vec));

		const raw = rawVector(db, id);
		expect(raw).toBeInstanceOf(Buffer);
		expect((raw as Buffer).byteLength).toBe(DIM * 4);
		// Legacy JSON would have been a string — assert the regression is gone.
		expect(typeof raw).not.toBe("string");
	});

	it("stores a dense number[] embedding as a BLOB too", () => {
		const id = randomUUID();
		insertMemory(db, id);

		db.memoryVectors.upsertVectorEmbedding(id, makeVector(2));

		const raw = rawVector(db, id);
		expect(raw).toBeInstanceOf(Buffer);
		expect((raw as Buffer).byteLength).toBe(DIM * 4);
	});

	it("round-trips the exact vector through write→read (float32 parity)", () => {
		const id = randomUUID();
		insertMemory(db, id);
		const vec = makeVector(3);
		const f32 = Float32Array.from(vec);

		db.memoryVectors.upsertVectorEmbedding(id, f32);

		const row = db.memoryVectors.getVectorCandidates(undefined, REPO, 10).find((r) => r.memory_id === id);
		expect(row).toBeDefined();
		const decoded = decodeVector(row!.vector);
		expect(decoded.length).toBe(DIM);
		for (let i = 0; i < DIM; i++) {
			// The stored value is the float32 rounding of the input; compare
			// against the same float32 cast, not the float64 original.
			expect(decoded[i]).toBe(f32[i]);
		}
	});

	it("dual-read still parses a legacy JSON string vector", () => {
		const id = randomUUID();
		insertMemory(db, id);
		const vec = makeVector(4);
		// Simulate a pre-v37 row: JSON decimal array in a TEXT column.
		db.db
			.prepare("INSERT INTO memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?)")
			.run(id, JSON.stringify(vec), NOW);

		const row = db.memoryVectors.getVectorCandidates(undefined, REPO, 10).find((r) => r.memory_id === id);
		expect(row).toBeDefined();
		expect(typeof row!.vector).toBe("string");
		const decoded = decodeVector(row!.vector);
		expect(decoded.length).toBe(DIM);
		for (let i = 0; i < DIM; i++) {
			expect(decoded[i]).toBeCloseTo(vec[i], 5);
		}
	});

	it("keeps sparse TF maps (StubVectorStore) as JSON TEXT", () => {
		const id = randomUUID();
		insertMemory(db, id);

		db.memoryVectors.upsertVectorEmbedding(id, { constructor: 2, pattern: 1 });

		const raw = rawVector(db, id);
		expect(typeof raw).toBe("string");
		expect(JSON.parse(raw as string)).toEqual({ constructor: 2, pattern: 1 });
	});

	it("score parity: cosine from a BLOB equals cosine from the JSON representation", () => {
		const id = randomUUID();
		insertMemory(db, id);
		const stored = makeVector(5);
		const query = Float32Array.from(makeVector(6));

		db.memoryVectors.upsertVectorEmbedding(id, Float32Array.from(stored));

		const blobRow = db.memoryVectors.getVectorCandidates(undefined, REPO, 10).find((r) => r.memory_id === id)!;
		const blobScore = cosineSimilarityArrays(query, decodeVector(blobRow.vector));

		// Same vector encoded as legacy JSON → decoded via the same helper.
		const jsonScore = cosineSimilarityArrays(query, decodeVector(JSON.stringify(stored)));

		expect(blobScore).toBeCloseTo(jsonScore, 6);
		// Sanity: identical to scoring the float32 source directly.
		expect(blobScore).toBeCloseTo(cosineSimilarityArrays(query, Float32Array.from(stored)), 10);
	});

	it("encodeVector/decodeVector round-trip for Float32Array and number[]", () => {
		const vec = makeVector(7);
		const fromArray = decodeVector(encodeVector(vec));
		const fromF32 = decodeVector(encodeVector(Float32Array.from(vec)));
		const f32 = Float32Array.from(vec);
		expect(Array.from(fromArray)).toEqual(Array.from(f32));
		expect(Array.from(fromF32)).toEqual(Array.from(f32));
	});

	it("RealVectorStore.search scores a stored BLOB via the dual-format read path", async () => {
		const id = randomUUID();
		insertMemory(db, id);
		const stored = makeVector(8);
		db.memoryVectors.upsertVectorEmbedding(id, Float32Array.from(stored));

		const vectors = new RealVectorStore(db);
		// Inject a fake extractor so the test never loads ONNX: the query vector
		// is the stored vector itself → cosine 1.
		const fakeExtractor = async () => ({ data: Float32Array.from(stored), dims: [1, DIM] });
		(vectors as unknown as { extractor: unknown }).extractor = fakeExtractor;

		const results = await vectors.search("anything", 5, REPO, "memory");
		const hit = results.find((r) => r.id === id);
		expect(hit).toBeDefined();
		expect(hit!.score).toBeCloseTo(1, 5);
	});
});
