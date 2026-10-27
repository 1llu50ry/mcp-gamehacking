/**
 * Tests for the derived database (DB-shrink L4 / TASK-037).
 *
 * The codebase index family (`codebase_files` / `codebase_symbols` /
 * `codebase_references` + `codebase_symbols_fts`) and every `*_vectors` table
 * live in a separate `codebase.db` attached as schema `derived`, moved out of
 * `memory.db` by a one-time, idempotent, never-throw migration.
 *
 * In-memory stores exercise schema/entity behavior; a temp-dir file store
 * exercises the on-disk artifact and rebuild safety. NEVER touches storage/.
 */

import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { MemoryEntry } from "../types";
import { SQLiteStore, createTestStore } from "../storage/sqlite";
import {
	DERIVED_TABLES,
	ensureDerivedReady,
	ensureDerivedVectorColumns,
	rebuildDerivedFts,
	resolveDerivedDbPath,
	runDerivedMigration
} from "../storage/derived-db";

const tempDirs: string[] = [];

/** Create a temp directory tracked for cleanup. */
function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmm-derived-"));
	tempDirs.push(dir);
	return dir;
}

/** Names of tables present in a schema. */
function tablesIn(store: SQLiteStore, schema: string): Set<string> {
	const rows = store.db.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table'`).all() as Array<{
		name: string;
	}>;
	return new Set(rows.map((r) => r.name));
}

/** Minimal active memory row for vector cross-DB join tests. */
function makeMemory(id: string, repo: string): MemoryEntry {
	const now = new Date().toISOString();
	return {
		id,
		type: "code_fact",
		title: "derived test memory",
		content: "derived database vector round-trip",
		importance: 3,
		agent: "test",
		role: "tester",
		model: "test",
		scope: { owner: "acme", repo },
		created_at: now,
		updated_at: now,
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
}

/** Column names of a derived table. */
function columnsIn(store: SQLiteStore, table: string): Set<string> {
	const rows = store.db.prepare(`PRAGMA derived.table_info(${table})`).all() as Array<{ name: string }>;
	return new Set(rows.map((r) => r.name));
}

afterEach(() => {
	while (tempDirs.length > 0) {
		fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

describe("resolveDerivedDbPath", () => {
	it("co-locates codebase.db next to memory.db", () => {
		expect(resolveDerivedDbPath(path.join("/data", "memory.db"))).toBe(path.join("/data", "codebase.db"));
	});

	it("maps :memory: to :memory: so tests stay off disk", () => {
		expect(resolveDerivedDbPath(":memory:")).toBe(":memory:");
	});
});

describe("SQLiteStore derived schema", () => {
	it("attaches derived and moves every derived table out of main", async () => {
		const store = await createTestStore();
		try {
			expect(store.getDerivedDbPath()).toBe(":memory:");

			const mainTables = tablesIn(store, "main");
			const derivedTables = tablesIn(store, "derived");

			for (const table of DERIVED_TABLES) {
				expect(mainTables.has(table)).toBe(false);
				expect(derivedTables.has(table)).toBe(true);
			}
			expect(derivedTables.has("codebase_symbols_fts")).toBe(true);

			// Durable knowledge stays in the hot DB.
			expect(mainTables.has("memories")).toBe(true);
			expect(mainTables.has("coding_standards")).toBe(true);
		} finally {
			store.close();
		}
	});
});

describe("derived entities", () => {
	it("stores codebase files/symbols in derived and FTS-searches them", async () => {
		const store = await createTestStore();
		try {
			const repo = "acme/widget";
			store.codebaseFiles.upsertFile({ repo, file_path: "src/a.ts", language: "typescript" });
			store.codebaseSymbols.bulkUpsertSymbols([
				{ repo, file_path: "src/a.ts", name: "computeWidget", kind: "function", exported: true }
			]);

			expect(store.codebaseFiles.getFileCountByRepo(repo)).toBe(1);

			// FTS lives in the derived schema (TVF form) — proves the moved
			// virtual table is queried through the attached database.
			const result = store.codebaseSymbols.searchSymbols({ repo, query: "computeWidget" });
			expect(result.symbols.some((s) => s.name === "computeWidget")).toBe(true);
		} finally {
			store.close();
		}
	});

	it("stores vectors in derived and reads them via a cross-DB join", async () => {
		const store = await createTestStore();
		try {
			const repo = "acme/widget";
			const memoryId = "aaaaaaaa-1111-4111-a111-111111111111";
			store.memories.insert(makeMemory(memoryId, repo));
			store.memoryVectors.upsertVectorEmbedding(memoryId, [0.1, 0.2, 0.3]);

			// `derived.memory_vectors` JOIN `main.memories` — the cross-DB join
			// that the single-connection ATTACH mechanism preserves.
			const candidates = store.memoryVectors.getVectorCandidates(undefined, repo);
			expect(candidates.map((c) => c.memory_id)).toContain(memoryId);
		} finally {
			store.close();
		}
	});
});

describe("runDerivedMigration", () => {
	it("moves legacy main tables into derived, then is a no-op", async () => {
		const store = await createTestStore();
		try {
			// Simulate a pre-split DB: recreate a legacy main-side table + row
			// (the constructor already moved/dropped the real one).
			store.db.exec(
				`CREATE TABLE main.memory_vectors (
					memory_id TEXT PRIMARY KEY, vector TEXT NOT NULL, updated_at TEXT NOT NULL,
					vector_version INTEGER NOT NULL DEFAULT 1
				)`
			);
			store.db
				.prepare("INSERT INTO main.memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?)")
				.run("legacy-1", "v1", "2020-01-01T00:00:00.000Z");

			const first = runDerivedMigration(store.db);
			expect(first.moved).toBe(true);
			expect(first.copiedRows.memory_vectors).toBe(1);
			expect(tablesIn(store, "main").has("memory_vectors")).toBe(false);

			const derivedCount = store.db.prepare("SELECT COUNT(*) AS c FROM derived.memory_vectors").get() as {
				c: number;
			};
			expect(derivedCount.c).toBe(1);

			// Idempotent: nothing left to move.
			expect(runDerivedMigration(store.db)).toEqual({ moved: false, copiedRows: {} });
		} finally {
			store.close();
		}
	});

	it("moves codebase_symbols and repopulates the derived FTS index", async () => {
		const store = await createTestStore();
		try {
			store.db.exec(
				`CREATE TABLE main.codebase_symbols (
					id TEXT PRIMARY KEY, repo TEXT NOT NULL, file_path TEXT NOT NULL, name TEXT NOT NULL,
					kind TEXT NOT NULL, exported INTEGER NOT NULL DEFAULT 0, default_export INTEGER NOT NULL DEFAULT 0,
					start_line INTEGER, start_col INTEGER, end_line INTEGER, end_col INTEGER, signature TEXT,
					doc_comment TEXT, parent_symbol_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
					updated_at TEXT NOT NULL DEFAULT (datetime('now'))
				)`
			);
			store.db
				.prepare("INSERT INTO main.codebase_symbols (id, repo, file_path, name, kind) VALUES (?, ?, ?, ?, ?)")
				.run("sym-1", "acme/widget", "src/a.ts", "computeWidget", "function");

			const result = runDerivedMigration(store.db);
			expect(result.moved).toBe(true);
			expect(result.copiedRows.codebase_symbols).toBe(1);

			// Rebuild explicitly so the assertion does not depend on trigger timing.
			rebuildDerivedFts(store.db);

			const found = store.codebaseSymbols.searchSymbols({ repo: "acme/widget", query: "computeWidget" });
			expect(found.symbols.some((s) => s.name === "computeWidget")).toBe(true);
		} finally {
			store.close();
		}
	});
});

describe("ensureDerivedReady", () => {
	it("never throws on schema drift and preserves the main tables", async () => {
		const store = await createTestStore();
		try {
			// A main table with an EXTRA column the derived schema lacks triggers
			// the copyTable drift guard.
			store.db.exec(
				`CREATE TABLE main.task_vectors (
					task_id TEXT PRIMARY KEY, vector TEXT NOT NULL, updated_at TEXT NOT NULL, extra_col TEXT
				)`
			);
			store.db
				.prepare("INSERT INTO main.task_vectors (task_id, vector, updated_at) VALUES (?, ?, ?)")
				.run("t1", "v", "2020");

			expect(ensureDerivedReady(store.db, ":memory:")).toBeNull();
			// Main table preserved for a later retry.
			expect(tablesIn(store, "main").has("task_vectors")).toBe(true);
		} finally {
			store.close();
		}
	});
});

describe("ensureDerivedVectorColumns (PERF-003)", () => {
	it("adds content_hash + model_version to all three vector tables on a fresh DB", async () => {
		const store = await createTestStore();
		try {
			for (const table of ["memory_vectors", "task_vectors", "standard_vectors"]) {
				const cols = columnsIn(store, table);
				expect(cols.has("content_hash")).toBe(true);
				expect(cols.has("model_version")).toBe(true);
			}
		} finally {
			store.close();
		}
	});

	it("is idempotent — a second apply is a no-op and the columns still exist", async () => {
		const store = await createTestStore();
		try {
			// Simulate a pre-PERF-003 derived DB: drop the two columns by
			// recreating a table without them, then run the upgrade twice.
			for (const [table, pk] of [
				["memory_vectors", "memory_id"],
				["task_vectors", "task_id"],
				["standard_vectors", "standard_id"]
			] as const) {
				store.db.exec(`DROP TABLE derived.${table}`);
				store.db.exec(
					`CREATE TABLE derived.${table} (${pk} TEXT PRIMARY KEY, vector TEXT NOT NULL, updated_at TEXT NOT NULL)`
				);
				expect(columnsIn(store, table).has("content_hash")).toBe(false);
			}

			ensureDerivedVectorColumns(store.db);
			for (const table of ["memory_vectors", "task_vectors", "standard_vectors"]) {
				expect(columnsIn(store, table).has("content_hash")).toBe(true);
				expect(columnsIn(store, table).has("model_version")).toBe(true);
			}

			// Second run: every column already present → no-op, never throws.
			expect(() => ensureDerivedVectorColumns(store.db)).not.toThrow();
			for (const table of ["memory_vectors", "task_vectors", "standard_vectors"]) {
				expect(columnsIn(store, table).has("content_hash")).toBe(true);
			}
		} finally {
			store.close();
		}
	});

	it("preserves existing vector rows when adding the columns (metadata-only ALTER)", async () => {
		const store = await createTestStore();
		try {
			store.memories.insert(makeMemory("mem-perf-003", "acme/widget"));
			store.db.exec(`DROP TABLE derived.memory_vectors`);
			store.db.exec(
				`CREATE TABLE derived.memory_vectors (memory_id TEXT PRIMARY KEY, vector TEXT NOT NULL, updated_at TEXT NOT NULL)`
			);
			store.db
				.prepare("INSERT INTO derived.memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?)")
				.run("mem-perf-003", "v", "2020-01-01T00:00:00.000Z");

			ensureDerivedVectorColumns(store.db);

			const row = store.db
				.prepare("SELECT content_hash, model_version FROM derived.memory_vectors WHERE memory_id = ?")
				.get("mem-perf-003") as { content_hash: string | null; model_version: number | null };
			expect(row).toBeDefined();
			// The pre-existing row survives; the new columns default to NULL
			// (= "unknown" → one re-embed to stamp them).
			expect(row.content_hash).toBeNull();
			expect(row.model_version).toBeNull();
		} finally {
			store.close();
		}
	});
});

describe("file-backed derived database", () => {
	it("creates codebase.db alongside memory.db and survives reopen", () => {
		const dir = makeTempDir();
		const memoryPath = path.join(dir, "memory.db");
		const derivedPath = path.join(dir, "codebase.db");

		const store = new SQLiteStore(memoryPath);
		try {
			expect(fs.existsSync(derivedPath)).toBe(true);
			expect(store.getDerivedDbPath()).toBe(derivedPath);
			store.codebaseFiles.upsertFile({ repo: "acme/widget", file_path: "src/a.ts", language: "typescript" });
			store.memories.insert(makeMemory("mem-1", "acme/widget"));
		} finally {
			store.close();
		}

		const reopened = new SQLiteStore(memoryPath);
		try {
			expect(reopened.codebaseFiles.getFileCountByRepo("acme/widget")).toBe(1);
			expect(reopened.memories.getById("mem-1")).not.toBeNull();
		} finally {
			reopened.close();
		}

		// Rebuild safety (Phase F): deleting the derived DB loses only codebase
		// data — durable memories are untouched and the derived schema is recreated.
		fs.rmSync(derivedPath, { force: true });
		fs.rmSync(`${derivedPath}-wal`, { force: true });
		fs.rmSync(`${derivedPath}-shm`, { force: true });

		const rebuilt = new SQLiteStore(memoryPath);
		try {
			expect(rebuilt.codebaseFiles.getFileCountByRepo("acme/widget")).toBe(0);
			expect(rebuilt.memories.getById("mem-1")).not.toBeNull();
		} finally {
			rebuilt.close();
		}
	});
});
