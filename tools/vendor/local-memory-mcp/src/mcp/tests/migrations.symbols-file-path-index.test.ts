import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v19 "symbols-file-path-index" (GitHub #75 /
 * TASK-224).
 *
 * v19 adds a plain single-column index on codebase_symbols(file_path) for
 * un-scoped filters. The existing idx_cs_repo_file(repo, file_path) only
 * covers repo-scoped queries — a bare `WHERE file_path = ?` can't use it.
 * The index is pure DDL (CREATE INDEX IF NOT EXISTS), so these tests pin the
 * two contracts that matter for applied-DB determinism: a fresh migrate lands
 * on the latest SCHEMA_VERSION with the v19 index present, and re-applying v19
 * (idempotent retry) is a no-op that does not throw.
 */
describe("migration v19 symbols file-path index", () => {
	it("fresh DB migrates to latest SCHEMA_VERSION and creates idx_symbols_file_path", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-symbols-fp-idx-"));
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

		// Index exists and is registered against codebase_symbols as a plain
		// single-column index on file_path.
		const index = db
			.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?")
			.get("idx_symbols_file_path") as { name: string; tbl_name: string; sql: string } | undefined;
		expect(index).toBeDefined();
		expect(index?.tbl_name).toBe("codebase_symbols");
		expect(index?.sql).toContain("CREATE INDEX idx_symbols_file_path");
		expect(index?.sql).toContain("(file_path)");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("re-applying v19 is idempotent (no-op, does not throw)", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-symbols-fp-idx-re-"));
		const dbPath = path.join(tempDir, "symbols.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// Simulate a crash mid-migration: wipe the v19 record so the runner
		// re-runs it on the next startup. CREATE INDEX IF NOT EXISTS must be a
		// no-op here (the index already exists) and the re-run must not throw.
		db.prepare("DELETE FROM _schema_version WHERE version = 19").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 19").get() as {
			c: number;
		};
		expect(count.c).toBe(1);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
