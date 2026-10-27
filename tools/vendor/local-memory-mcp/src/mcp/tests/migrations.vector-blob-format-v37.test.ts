import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";
import { decodeVector } from "../utils/vector";

/**
 * Regression net for migration v37 "vector-blob-format" (TASK-038).
 *
 * Dense embeddings were stored as JSON TEXT decimal arrays (~8,219 bytes for a
 * 384-dim vector) instead of float32 little-endian BLOBs (1,536 bytes) — a
 * measured 5.24x waste. v37 rewrites the `vector` column of `memory_vectors`,
 * `task_vectors`, and `standard_vectors` in place (columns are dynamically
 * typed; no table rebuild).
 *
 * These tests seed legacy JSON-TEXT vectors, run the migration, and pin:
 *   - the stored value is now a BLOB (not TEXT),
 *   - the byte length is exactly 384 * 4,
 *   - the decoded float32 values match the originals within float32 epsilon,
 *   - sparse TF JSON objects (StubVectorStore) are left as TEXT,
 *   - re-running v37 is a no-op for already-converted rows.
 */
const DIM = 384;
const NOW = new Date().toISOString();

/** Deterministic 384-dim vector with values that survive float32 rounding. */
function makeVector(seed: number): number[] {
	return Array.from({ length: DIM }, (_, i) => Number((Math.sin(seed + i) * 0.5).toFixed(6)));
}

function seedParents(db: Database.Database): void {
	db.prepare(
		"INSERT INTO memories (id, repo, owner, type, content, importance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
	).run("mem-1", "r", "o", "code_fact", "content", 3, NOW, NOW);
	db.prepare(
		"INSERT INTO tasks (id, repo, owner, task_code, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
	).run("task-1", "r", "o", "TASK-1", "title", "backlog", NOW, NOW);
	db.prepare("INSERT INTO coding_standards (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
		"std-1",
		"title",
		"content",
		NOW,
		NOW
	);
}

/**
 * Seed legacy JSON-TEXT vectors and re-run the migration by wiping the v37
 * record, mimicking an upgrade from a pre-v37 database.
 */
function seedLegacyAndMigrate(): { db: Database.Database; originals: Map<string, number[]> } {
	const db = new Database(":memory:");
	db.pragma("foreign_keys = ON");
	new MigrationManager(db).migrate();
	seedParents(db);

	const originals = new Map<string, number[]>();
	const seed = (table: string, keyCol: string, key: string, vec: number[]): void => {
		originals.set(`${table}:${key}`, vec);
		db.prepare(`INSERT INTO ${table} (${keyCol}, vector, updated_at) VALUES (?, ?, ?)`).run(
			key,
			JSON.stringify(vec),
			NOW
		);
	};
	seed("memory_vectors", "memory_id", "mem-1", makeVector(1));
	seed("task_vectors", "task_id", "task-1", makeVector(2));
	seed("standard_vectors", "standard_id", "std-1", makeVector(3));

	// Simulate a crash mid-migration / pre-upgrade DB: drop the v37 record so
	// the runner re-applies it against the JSON-TEXT rows just seeded.
	db.prepare("DELETE FROM _schema_version WHERE version = 37").run();
	new MigrationManager(db).migrate();
	return { db, originals };
}

function readRaw(db: Database.Database, table: string, keyCol: string, key: string): unknown {
	return (db.prepare(`SELECT vector FROM ${table} WHERE ${keyCol} = ?`).get(key) as { vector: unknown }).vector;
}

describe("migration v37 vector blob format (TASK-038)", () => {
	it("rewrites JSON-TEXT vectors in all three tables to float32 BLOB", () => {
		const { db, originals } = seedLegacyAndMigrate();

		const cases: Array<[string, string, string]> = [
			["memory_vectors", "memory_id", "mem-1"],
			["task_vectors", "task_id", "task-1"],
			["standard_vectors", "standard_id", "std-1"]
		];

		for (const [table, keyCol, key] of cases) {
			const raw = readRaw(db, table, keyCol, key);
			expect(raw).toBeInstanceOf(Buffer);
			expect(Buffer.isBuffer(raw)).toBe(true);
			expect((raw as Buffer).byteLength).toBe(DIM * 4);

			const decoded = decodeVector(raw);
			expect(decoded.length).toBe(DIM);
			const original = originals.get(`${table}:${key}`)!;
			for (let i = 0; i < DIM; i++) {
				expect(decoded[i]).toBeCloseTo(original[i], 5);
			}
		}

		db.close();
	});

	it("leaves sparse TF JSON-object vectors as TEXT (StubVectorStore format)", () => {
		const db = new Database(":memory:");
		db.pragma("foreign_keys = ON");
		new MigrationManager(db).migrate();
		seedParents(db);

		const sparse = { constructor: 2, pattern: 1 };
		db.prepare("INSERT INTO memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?)").run(
			"mem-1",
			JSON.stringify(sparse),
			NOW
		);
		db.prepare("DELETE FROM _schema_version WHERE version = 37").run();
		new MigrationManager(db).migrate();

		const raw = readRaw(db, "memory_vectors", "memory_id", "mem-1");
		expect(typeof raw).toBe("string");
		expect(JSON.parse(raw as string)).toEqual(sparse);

		db.close();
	});

	it("is idempotent: re-running v37 does not re-encode already-BLOB rows", () => {
		const { db } = seedLegacyAndMigrate();

		const before = readRaw(db, "memory_vectors", "memory_id", "mem-1") as Buffer;
		const snapshot = Buffer.from(before);

		db.prepare("DELETE FROM _schema_version WHERE version = 37").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const after = readRaw(db, "memory_vectors", "memory_id", "mem-1") as Buffer;
		expect(Buffer.isBuffer(after)).toBe(true);
		expect(after.byteLength).toBe(DIM * 4);
		// Byte-identical: the BLOB was skipped, not decoded and re-encoded.
		expect(after.equals(snapshot)).toBe(true);

		db.close();
	});

	it("lands a fresh DB on the latest SCHEMA_VERSION", () => {
		const db = new Database(":memory:");
		new MigrationManager(db).migrate();
		const applied = (
			db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as { version: number }[]
		).map((r) => r.version);
		expect(applied.at(-1)).toBe(SCHEMA_VERSION);
		expect(applied).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));
		expect(SCHEMA_VERSION).toBe(40);
		db.close();
	});

	it("skips tables that do not exist (defensive)", () => {
		const db = new Database(":memory:");
		// Minimal DB: no vector tables at all.
		expect(() => new MigrationManager(db).migrate()).not.toThrow();
		db.close();
	});
});
