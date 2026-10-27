import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v20 "symbols-name-lower-index" (GitHub #63 /
 * TASK-226).
 *
 * v20 adds the expression index idx_symbols_name_lower ON
 * codebase_symbols(LOWER(name), repo, kind) so a case-insensitive PREFIX scan
 * on symbol names (autocomplete, e.g. `getUser*`) can use an index instead of
 * a full table scan. The index is pure DDL (CREATE INDEX IF NOT EXISTS), so
 * these tests pin the contracts that matter for applied-DB determinism: a
 * fresh migrate lands on the latest SCHEMA_VERSION with the v20 index present,
 * and re-applying v20 (idempotent retry) is a no-op that does not throw.
 *
 * The third test pins the index CONSUMPTION contract: SQLite's LIKE
 * optimization needs a plain column on the left-hand side, so
 * `LOWER(name) LIKE 'getu%'` full-scans; the prefix must be expressed as an
 * exclusive range on the lowercased name (`LOWER(name) >= ? AND < ?`, upper
 * bound = prefix + U+FFFF). EXPLAIN QUERY PLAN on that form must report
 * `USING INDEX idx_symbols_name_lower` and the result set must be exactly the
 * case-insensitive prefix matches.
 */
describe("migration v20 symbols name-lower index", () => {
	it("fresh DB migrates to latest SCHEMA_VERSION and creates idx_symbols_name_lower", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-symbols-name-lower-"));
		const dbPath = path.join(tempDir, "symbols.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		// Full v1..latest migration set applies on a fresh DB.
		new MigrationManager(db).migrate();

		// Migration record tracked per-version (new-style _schema_version).
		const applied = db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as {
			version: number;
		}[];
		expect(applied.at(-1)?.version).toBe(SCHEMA_VERSION);
		expect(applied.map((r) => r.version)).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));

		// Index exists and is registered against codebase_symbols as an
		// expression index on LOWER(name) with repo/kind trailing columns.
		const index = db
			.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?")
			.get("idx_symbols_name_lower") as { name: string; tbl_name: string; sql: string } | undefined;
		expect(index).toBeDefined();
		expect(index?.tbl_name).toBe("codebase_symbols");
		expect(index?.sql).toContain("CREATE INDEX idx_symbols_name_lower");
		expect(index?.sql).toContain("LOWER(name)");
		expect(index?.sql).toContain("repo");
		expect(index?.sql).toContain("kind");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("re-applying v20 is idempotent (no-op, does not throw)", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-symbols-name-lower-re-"));
		const dbPath = path.join(tempDir, "symbols.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// Simulate a crash mid-migration: wipe the v20 record so the runner
		// re-runs it on the next startup. CREATE INDEX IF NOT EXISTS must be a
		// no-op here (the index already exists) and the re-run must not throw.
		db.prepare("DELETE FROM _schema_version WHERE version = 20").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 20").get() as {
			c: number;
		};
		expect(count.c).toBe(1);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("prefix range query is served by idx_symbols_name_lower and returns case-insensitive prefix matches", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-symbols-name-lower-pfx-"));
		const dbPath = path.join(tempDir, "symbols.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		const ins = db.prepare(
			"INSERT INTO codebase_symbols (id, repo, file_path, name, kind, start_line) VALUES (?, ?, ?, ?, ?, ?)"
		);
		const symbols: Array<[string, string]> = [
			["getUserProfile", "function"],
			["getUser", "function"],
			["getOrders", "class"],
			["GetUserPermissions", "function"],
			["fetchUser", "function"]
		];
		symbols.forEach(([name, kind], i) => ins.run(String(i), "repo-a", "src/a.ts", name, kind, i));

		// Prefix range form (upper bound = prefix + U+FFFF). The `LOWER(name)
		// LIKE 'getu%'` form is deliberately NOT used — it full-scans.
		const prefix = "getu";
		const prefixUpper = `${prefix}\uffff`;
		const stmt = db.prepare(
			`SELECT cs.name FROM codebase_symbols cs
			 WHERE cs.repo = ? AND LOWER(cs.name) >= ? AND LOWER(cs.name) < ?
			 ORDER BY LOWER(cs.name) ASC`
		);
		const rows = stmt.all("repo-a", prefix, prefixUpper) as { name: string }[];
		expect(rows.map((r) => r.name)).toEqual(["getUser", "GetUserPermissions", "getUserProfile"]);

		// ANALYZE so the planner has index statistics. On a fresh, stat-less DB
		// the planner picks `USING COVERING INDEX idx_cs_repo_name (repo=?)`
		// (also valid); with ANALYZE stats the same query is served by
		// idx_symbols_name_lower. Production DBs run ANALYZE, so this pins the
		// real-world plan.
		db.exec("ANALYZE");

		// The index must actually serve the scan — this is the whole point of
		// the migration (without it, the expression would full-scan).
		const plan = db.prepare("EXPLAIN QUERY PLAN " + stmt.source).all("repo-a", prefix, prefixUpper) as {
			detail: string;
		}[];
		expect(plan.some((r) => r.detail.includes("USING INDEX idx_symbols_name_lower"))).toBe(true);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
