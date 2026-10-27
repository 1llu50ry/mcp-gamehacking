import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v26 "codebase-references-role"
 * (TASK-008 / issue #82, semantic-graph epic P0).
 *
 * v26 extends the v21 codebase_references table with one nullable `role`
 * column so type-only dependency edges (kind='type') can distinguish HOW a
 * symbol is used as a type: parameter / return / property / field / alias /
 * generic / constraint / union / intersection. These tests pin the applied-DB
 * contracts: a fresh migrate lands on the latest SCHEMA_VERSION with the new
 * column present, re-applying v26 (idempotent retry, simulating a crash
 * mid-migration) is a no-op that does not throw, legacy rows round-trip with
 * NULL role, and a v26 type row round-trips its role.
 */
describe("migration v26 codebase references role", () => {
	it("fresh DB migrates to latest SCHEMA_VERSION with codebase_references extended by the role column", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-v26-"));
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

		// Table keeps every prior column AND gains the role column (v26) plus
		// the v27 import-metadata columns (local_name, imported_name,
		// module_specifier, import_kind, issue #83).
		const cols = db.prepare("PRAGMA table_info(codebase_references)").all() as {
			name: string;
			type: string;
			notnull: number;
		}[];
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

		const roleCol = cols.find((c) => c.name === "role");
		expect(roleCol?.type).toBe("TEXT");
		// Nullable — legacy kinds and unresolved type edges store NULL.
		expect(roleCol?.notnull).toBe(0);

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

	it("re-applying v26 is idempotent (no-op, does not throw)", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-v26-re-"));
		const dbPath = path.join(tempDir, "refs.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// Simulate a crash mid-migration: wipe the v26 record so the runner
		// re-runs it on the next startup. The PRAGMA table_info guard must make
		// the ALTER TABLE ADD COLUMN a no-op here and must not throw.
		db.prepare("DELETE FROM _schema_version WHERE version = 26").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 26").get() as { c: number };
		expect(count.c).toBe(1);

		// Column still present exactly once.
		const cols = db.prepare("PRAGMA table_info(codebase_references)").all() as { name: string }[];
		expect(cols.filter((c) => c.name === "role").length).toBe(1);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("legacy rows round-trip with NULL role; v26 type rows round-trip their role", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-v26-legacy-"));
		const dbPath = path.join(tempDir, "refs.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// A row written with ONLY the pre-v26 columns (as pre-v26 code did)
		// inserts cleanly and reads back with NULL role — the new column is
		// nullable, so existing index data is not invalidated by the upgrade.
		db.prepare(
			"INSERT INTO codebase_references (id, repo, symbol_name, caller_file, caller_line, caller_name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
		).run("legacy-row", "repo-a", "connect", "src/a.ts", 4, "run", "call", new Date().toISOString());

		const row = db.prepare("SELECT role FROM codebase_references WHERE id = ?").get("legacy-row") as {
			role: string | null;
		};
		expect(row.role).toBeNull();

		// A v26 type row with a role round-trips non-null.
		db.prepare(
			"INSERT INTO codebase_references (id, repo, symbol_name, caller_file, caller_line, caller_name, kind, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
		).run(
			"type-row",
			"repo-a",
			"CreateOrderDto",
			"src/orders.ts",
			1,
			"createOrder",
			"type",
			"parameter",
			new Date().toISOString()
		);
		const typeRow = db.prepare("SELECT kind, role FROM codebase_references WHERE id = ?").get("type-row") as {
			kind: string;
			role: string | null;
		};
		expect(typeRow.kind).toBe("type");
		expect(typeRow.role).toBe("parameter");

		// A v26 type row WITHOUT a role (unresolvable at parse time) is NULL.
		db.prepare(
			"INSERT INTO codebase_references (id, repo, symbol_name, caller_file, caller_line, caller_name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
		).run("type-norole", "repo-a", "SomeFnType", "src/a.ts", 2, null, "type", new Date().toISOString());
		const noRole = db.prepare("SELECT role FROM codebase_references WHERE id = ?").get("type-norole") as {
			role: string | null;
		};
		expect(noRole.role).toBeNull();

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
