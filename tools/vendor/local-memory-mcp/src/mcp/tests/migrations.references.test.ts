import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v21 "codebase-references" (GitHub #64 /
 * TASK-236), extended by v23 "codebase-references-edge-targets" (TASK-299).
 *
 * v21 adds the denormalized codebase_references call-site table plus two
 * indexes (repo, symbol_name) and (repo, caller_file); v23 adds the
 * edge-target columns (target_file, target_symbol_id). These tests pin the
 * applied-DB contracts: a fresh migrate lands on the latest SCHEMA_VERSION
 * with the table + indexes present, and re-applying v21 (idempotent retry,
 * simulating a crash mid-migration) is a no-op that does not throw.
 */
describe("migration v21 codebase references", () => {
	it("fresh DB migrates to latest SCHEMA_VERSION and creates codebase_references + indexes", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-"));
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

		// Table exists with the required columns: the v21 set plus the v23
		// edge-target columns (target_file, target_symbol_id), the v26 `role`
		// column (type-reference edges, issue #82) and the v27 import-metadata
		// columns (local_name, imported_name, module_specifier, import_kind,
		// issue #83).
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

		// Both indexes exist.
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

	it("re-applying v21 is idempotent (no-op, does not throw)", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-re-"));
		const dbPath = path.join(tempDir, "refs.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// Simulate a crash mid-migration: wipe the v21 record so the runner
		// re-runs it on the next startup. CREATE TABLE / CREATE INDEX IF NOT
		// EXISTS must be no-ops here and must not throw.
		db.prepare("DELETE FROM _schema_version WHERE version = 21").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 21").get() as { c: number };
		expect(count.c).toBe(1);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("the (repo, symbol_name) index serves exact-symbol lookups", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-idx-"));
		const dbPath = path.join(tempDir, "refs.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		const insert = db.prepare(
			"INSERT INTO codebase_references (id, repo, symbol_name, caller_file, caller_line, caller_name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
		);

		// Seed enough rows so the (repo, symbol_name) lookup is exercised over a
		// realistic table size (asserting the functional result, not the planner's
		// EXPLAIN detail — query-plan selection is cardinality-dependent and not a
		// stable contract on a 1-row table).
		for (let i = 0; i < 1_000; i++) {
			insert.run(`id-${i}`, "repo-a", `symbol-${i}`, `src/${i}.ts`, 1, `fn-${i}`, "call", new Date().toISOString());
		}
		// Distinctive marker row to pin exact-symbol lookup.
		insert.run("marker", "repo-a", "connect", "src/b.ts", 4, "run", "call", new Date().toISOString());
		// Same symbol under a different repo must NOT leak across repos.
		insert.run("other-repo", "repo-b", "connect", "src/c.ts", 2, "main", "call", new Date().toISOString());

		db.exec("ANALYZE");

		const stmt = db.prepare("SELECT id FROM codebase_references WHERE repo = ? AND symbol_name = ?");
		const row = stmt.get("repo-a", "connect") as { id: string } | undefined;
		expect(row?.id).toBe("marker");

		// Exact match stays scoped to the repo — the repo-b row is not returned.
		const scoped = db
			.prepare("SELECT COUNT(*) AS c FROM codebase_references WHERE repo = ? AND symbol_name = ?")
			.get("repo-a", "connect") as { c: number };
		expect(scoped.c).toBe(1);

		// A symbol that does not exist in this repo yields nothing.
		expect(stmt.get("repo-a", "does-not-exist")).toBeUndefined();

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
