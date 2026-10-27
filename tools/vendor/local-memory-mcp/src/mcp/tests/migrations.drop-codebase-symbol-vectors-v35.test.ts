import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v35 "drop-codebase-symbol-vectors" (TASK-042).
 *
 * v35 removes the dead `codebase_symbol_vectors` table created in v06. The
 * table was never populated by any production path (the embedding-queue write
 * is an intentional NO-OP, TASK-293), so the migration drops it defensively:
 * absent → no-op; empty → DROP; non-empty → skip with a warning (never destroy
 * unexpected data). These tests pin the applied-DB contract, the defensive
 * skip, and idempotent re-application after a simulated crash.
 */
describe("migration v35 drop codebase_symbol_vectors", () => {
	const TABLE_EXISTS = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codebase_symbol_vectors'";

	function freshDb(label: string): { db: Database.Database; tempDir: string } {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lmcp-v35-${label}-`));
		const db = new Database(path.join(tempDir, "sym.db"));
		db.pragma("foreign_keys = ON");
		new MigrationManager(db).migrate();
		return { db, tempDir };
	}

	it("fresh DB migrates to latest SCHEMA_VERSION with the dead table absent", () => {
		const { db, tempDir } = freshDb("fresh");

		const applied = (
			db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as { version: number }[]
		).map((r) => r.version);
		expect(applied.at(-1)).toBe(SCHEMA_VERSION);
		expect(applied).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));
		expect(db.prepare(TABLE_EXISTS).get()).toBeUndefined();

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("drops an existing empty codebase_symbol_vectors table and re-apply is idempotent", () => {
		const { db, tempDir } = freshDb("empty");

		// Simulate a DB that still carries the v06 table: recreate it, then wipe
		// the v35 record so the runner re-runs the drop on the next startup.
		db.exec(`
			CREATE TABLE codebase_symbol_vectors (
				symbol_id TEXT NOT NULL REFERENCES codebase_symbols(id) ON DELETE CASCADE,
				vector TEXT NOT NULL,
				updated_at TEXT NOT NULL DEFAULT (datetime('now')),
				PRIMARY KEY (symbol_id)
			);
		`);
		db.prepare("DELETE FROM _schema_version WHERE version = 35").run();
		expect(db.prepare(TABLE_EXISTS).get()).toBeDefined();

		expect(() => new MigrationManager(db).migrate()).not.toThrow();
		expect(db.prepare(TABLE_EXISTS).get()).toBeUndefined();
		expect(db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 35").get()).toEqual({ c: 1 });

		// Re-applying v35 (crash retry) is a no-op that does not throw.
		db.prepare("DELETE FROM _schema_version WHERE version = 35").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();
		expect(db.prepare(TABLE_EXISTS).get()).toBeUndefined();

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("skips the drop when the table unexpectedly holds rows (never destroys data)", () => {
		const { db, tempDir } = freshDb("nonempty");

		db.exec(`
			CREATE TABLE codebase_symbol_vectors (
				symbol_id TEXT NOT NULL REFERENCES codebase_symbols(id) ON DELETE CASCADE,
				vector TEXT NOT NULL,
				updated_at TEXT NOT NULL DEFAULT (datetime('now')),
				PRIMARY KEY (symbol_id)
			);
		`);
		db.prepare("INSERT INTO codebase_symbols (id, repo, file_path, name, kind) VALUES (?, ?, ?, ?, ?)").run(
			"sym-1",
			"repo",
			"a.ts",
			"foo",
			"function"
		);
		db.prepare("INSERT INTO codebase_symbol_vectors (symbol_id, vector) VALUES (?, ?)").run("sym-1", "[1,2]");
		db.prepare("DELETE FROM _schema_version WHERE version = 35").run();

		expect(() => new MigrationManager(db).migrate()).not.toThrow();
		// Table + row preserved; the version still advances (the skip is final).
		expect(db.prepare(TABLE_EXISTS).get()).toBeDefined();
		expect(db.prepare("SELECT COUNT(*) AS c FROM codebase_symbol_vectors").get()).toEqual({ c: 1 });
		expect(db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 35").get()).toEqual({ c: 1 });

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
