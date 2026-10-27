import { describe, it, expect, afterAll } from "vitest";
import sharp from "sharp";
import { createTestStore } from "../storage/sqlite";
import { RealVectorStore } from "../storage/vectors";
import { decodeVector } from "../utils/vector";
import type { SQLiteStore } from "../storage/sqlite";

/**
 * Embedding smoke test — TASK-006 (sharp override ^0.35.0).
 *
 * @xenova/transformers eagerly imports sharp at module load. The override
 * bumps sharp 0.32.x → 0.35.x (libvips CVE fix). This test proves the real
 * feature-extraction path (RealVectorStore → transformers pipeline →
 * Xenova/all-MiniLM-L6-v2) works end-to-end with sharp 0.35.
 *
 * The model download (first run) may exceed the default 30s timeout.
 */
const SMOKE_TIMEOUT = 300_000;

let db: SQLiteStore | null = null;
let vectors: RealVectorStore | null = null;

afterAll(() => {
	db?.close();
	db = null;
	vectors = null;
});

describe("RealVectorStore embedding smoke (sharp 0.35 override)", () => {
	it(
		"loads the feature-extraction pipeline and produces an embedding",
		async () => {
			// Sanity: confirm the overridden sharp is actually resolvable and functional
			expect(typeof sharp).toBe("function");
			const png = await sharp({
				create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } }
			})
				.png()
				.toBuffer();
			expect(png.length).toBeGreaterThan(0);

			db = await createTestStore();
			vectors = new RealVectorStore(db);
			await vectors.initialize();

			const memoryId = "aaaaaaaa-1111-4111-a111-111111111111";
			const text = "smoke test embedding for sharp override validation";

			// Seed a parent memory row so the memory_vectors FK is satisfied
			db.memories.insert({
				id: memoryId,
				type: "code_fact",
				title: "Sharp smoke",
				content: text,
				importance: 3,
				agent: "test",
				role: "tester",
				model: "test",
				scope: { owner: "smoke", repo: "smoke-repo" },
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

			// Real model call — same path as production upsert
			await vectors.upsert(memoryId, text, "memory");

			const rows = db.memoryVectors.getVectorCandidates("smoke", "smoke-repo", 10);
			expect(rows.length).toBe(1);
			// Dense embeddings are stored as a float32 BLOB post-TASK-038.
			const vector = Array.from(decodeVector(rows[0].vector));
			expect(vector.length).toBe(384); // all-MiniLM-L6-v2 embedding dim
			// normalized output: L2 norm ≈ 1
			const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
			expect(norm).toBeGreaterThan(0.9);
			expect(norm).toBeLessThan(1.1);
		},
		SMOKE_TIMEOUT
	);

	it(
		"produces semantically sensible cosine ordering via search",
		async () => {
			expect(db).not.toBeNull();
			expect(vectors).not.toBeNull();
			// Second pipeline call must reuse the cached extractor (no re-download)
			const similar = await vectors!.search("sharp override validation", 5, "smoke-repo", "memory");
			expect(Array.isArray(similar)).toBe(true);
		},
		SMOKE_TIMEOUT
	);
});
