import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v17 "symbols-repo-exported-parent-index"
 * (GitHub #78 / TASK-223).
 *
 * v17 adds the composite covering index for
 * CodebaseSymbolEntity.getTopLevelExportsByRepo:
 *   WHERE repo = ? AND exported = 1 AND parent_symbol_id IS NULL
 *   ORDER BY file_path, start_line LIMIT ?
 * The index is pure DDL (CREATE INDEX IF NOT EXISTS), so these tests pin the
 * two contracts that matter for applied-DB determinism: a fresh migrate lands
 * on the latest SCHEMA_VERSION with the v17 index present, and re-applying v17
 * (idempotent retry) is a no-op that does not throw.
 */
describe("migration v17 symbols repo-exported-parent index", () => {
	it("fresh DB migrates to latest SCHEMA_VERSION and creates idx_cs_repo_exported_parent", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-symbols-idx-"));
		const dbPath = path.join(tempDir, "symbols.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		// Full v1..latest migration set applies on a fresh DB.
		new MigrationManager(db).migrate();

		// Migration record tracked per-version (new-style _schema_version).
		const applied = db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as { version: number }[];
		expect(applied.at(-1)?.version).toBe(SCHEMA_VERSION);
		expect(applied.map((r) => r.version)).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));

		// Index exists and is registered against codebase_symbols.
		const index = db
			.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?")
			.get("idx_cs_repo_exported_parent") as { name: string; tbl_name: string; sql: string } | undefined;
		expect(index).toBeDefined();
		expect(index?.tbl_name).toBe("codebase_symbols");
		expect(index?.sql).toContain("CREATE INDEX idx_cs_repo_exported_parent");
		expect(index?.sql).toContain("(repo, exported, parent_symbol_id)");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("re-applying v17 is idempotent (no-op, does not throw)", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-symbols-idx-re-"));
		const dbPath = path.join(tempDir, "symbols.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// Simulate a crash mid-migration: wipe the v17 record so the runner
		// re-runs it on the next startup. CREATE INDEX IF NOT EXISTS must be a
		// no-op here (the index already exists) and the re-run must not throw.
		db.prepare("DELETE FROM _schema_version WHERE version = 17").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 17").get() as { c: number };
		expect(count.c).toBe(1);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
