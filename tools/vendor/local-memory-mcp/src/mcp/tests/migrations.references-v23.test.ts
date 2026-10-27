import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v23 "codebase-references-edge-targets"
 * (Phase 1.1 / TASK-299).
 *
 * v23 extends the v21 codebase_references table with the two edge-target
 * columns (target_file, target_symbol_id) so heritage edges
 * ('extends' | 'implements') and cross-file import edges can locate their
 * referenced symbol — WITHOUT a new table (decision 2026-08-09). These tests
 * pin the applied-DB contracts: a fresh migrate lands on the latest
 * SCHEMA_VERSION with the new columns present, re-applying v23 (idempotent
 * retry, simulating a crash mid-migration) is a no-op that does not throw,
 * and legacy v21-style rows round-trip with NULL targets.
 */
describe("migration v23 codebase references edge targets", () => {
	it("fresh DB migrates to latest SCHEMA_VERSION with codebase_references extended by edge-target columns", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-v23-"));
		const dbPath = path.join(tempDir, "refs.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// Migration record tracked per-version (new-style _schema_version).
		const applied = db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as {
			version: number;
		}[];
		expect(applied.at(-1)?.version).toBe(SCHEMA_VERSION);
		expect(applied.map((r) => r.version)).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));

		// Table keeps every v21 column AND gains the two v23 edge-target
		// columns, the v26 `role` column (type-reference edges, issue #82) and
		// the v27 import-metadata columns (local_name, imported_name,
		// module_specifier, import_kind, issue #83).
		const cols = db.prepare("PRAGMA table_info(codebase_references)").all() as { name: string; type: string }[];
		const colNames = cols.map((c) => c.name).sort();
		expect(colNames).toEqual([
			"caller_file",
			"caller_line",
			"caller_name",
			"created_at",
			"id",
			"import_kind",
			"imported_name",
			"kind",
			"local_name",
			"module_specifier",
			"repo",
			"role",
			"symbol_name",
			"target_file",
			"target_symbol_id"
		]);

		// The v21 indexes are preserved (no re-creation, no new index).
		const idxNames = (
			db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'codebase_references'").all() as {
				name: string;
			}[]
		)
			.map((r) => r.name)
			.sort();
		expect(idxNames).toContain("idx_refs_repo_symbol");
		expect(idxNames).toContain("idx_refs_repo_file");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("re-applying v23 is idempotent (no-op, does not throw)", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-v23-re-"));
		const dbPath = path.join(tempDir, "refs.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// Simulate a crash mid-migration: wipe the v23 record so the runner
		// re-runs it on the next startup. The PRAGMA table_info guard must make
		// the ALTER TABLE ADD COLUMN statements no-ops here and must not throw.
		db.prepare("DELETE FROM _schema_version WHERE version = 23").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 23").get() as { c: number };
		expect(count.c).toBe(1);

		// Columns still present exactly once.
		const cols = db.prepare("PRAGMA table_info(codebase_references)").all() as { name: string }[];
		expect(cols.filter((c) => c.name === "target_file").length).toBe(1);
		expect(cols.filter((c) => c.name === "target_symbol_id").length).toBe(1);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("legacy v21-style rows round-trip with NULL edge targets", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-v23-legacy-"));
		const dbPath = path.join(tempDir, "refs.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// A row written with ONLY the v21 columns (as pre-v23 code did) inserts
		// cleanly and reads back with NULL targets — the new columns are
		// nullable, so existing index data is not invalidated by the upgrade.
		db.prepare(
			"INSERT INTO codebase_references (id, repo, symbol_name, caller_file, caller_line, caller_name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
		).run("legacy-row", "repo-a", "connect", "src/a.ts", 4, "run", "call", new Date().toISOString());

		const row = db
			.prepare("SELECT target_file, target_symbol_id FROM codebase_references WHERE id = ?")
			.get("legacy-row") as { target_file: string | null; target_symbol_id: string | null };
		expect(row.target_file).toBeNull();
		expect(row.target_symbol_id).toBeNull();

		// A v23 row with targets round-trips non-null.
		db.prepare(
			"INSERT INTO codebase_references (id, repo, symbol_name, caller_file, caller_line, caller_name, kind, target_file, target_symbol_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
		).run(
			"heritage-row",
			"repo-a",
			"Base",
			"src/b.ts",
			1,
			null,
			"extends",
			"src/base.ts",
			"sym-123",
			new Date().toISOString()
		);
		const heritage = db
			.prepare("SELECT target_file, target_symbol_id, kind FROM codebase_references WHERE id = ?")
			.get("heritage-row") as { target_file: string | null; target_symbol_id: string | null; kind: string };
		expect(heritage.target_file).toBe("src/base.ts");
		expect(heritage.target_symbol_id).toBe("sym-123");
		expect(heritage.kind).toBe("extends");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
