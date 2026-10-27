import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v40 "memories-code-owner-repo-unique"
 * (FIX-OWNER-CODEBASE).
 *
 * `tasks` has enforced `UNIQUE (owner, repo, task_code)` since v2, but
 * `memories` never got the equivalent. `memories.code` is allocated per
 * (owner, repo) by `generateNextCode`, yet nothing at the storage layer stopped
 * a duplicate from landing — which is exactly how the 2026-10-03 favori-app
 * owner-merge produced `MEM-001`×9 in `(vheins, favori-app)` and made every
 * later memory unreachable via `getByCode` (which returns the oldest row).
 *
 * v40 restores parity, but conditionally: a `CREATE UNIQUE INDEX` aborts on a
 * table that still holds a duplicate, which would roll back the migration and
 * fail daemon startup. So the migration probes for duplicate groups first and
 * skips (with a warning) when any remain. These tests pin all three contracts:
 * the index is built on a clean DB, it is skipped on a dirty DB, and the
 * statement is idempotent.
 */
describe("migration v40 memories code unique index", () => {
	const INDEX = "idx_memories_code_owner_repo";

	function freshDb(label: string): { db: Database.Database; tempDir: string } {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lmcp-v40-${label}-`));
		const db = new Database(path.join(tempDir, "mem.db"));
		db.pragma("foreign_keys = ON");
		new MigrationManager(db).migrate();
		return { db, tempDir };
	}

	function indexSql(db: Database.Database): string | null {
		const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(INDEX) as
			| { sql: string }
			| undefined;
		return row?.sql ?? null;
	}

	function insertMemory(db: Database.Database, id: string, owner: string, repo: string, code: string | null): void {
		const now = new Date().toISOString();
		db.prepare(
			`INSERT INTO memories (id, repo, owner, type, content, importance, created_at, updated_at, code)
			 VALUES (?, ?, ?, 'note', 'x', 3, ?, ?, ?)`
		).run(id, repo, owner, now, now, code);
	}

	it("fresh DB lands on SCHEMA_VERSION 40 with the unique index present", () => {
		const { db, tempDir } = freshDb("fresh");

		const applied = (db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as { version: number }[]).map(
			(r) => r.version
		);
		expect(applied.at(-1)).toBe(SCHEMA_VERSION);
		expect(SCHEMA_VERSION).toBe(40);
		expect(applied).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));

		expect(indexSql(db)).toContain("UNIQUE INDEX");
		expect(indexSql(db)).toContain("memories(owner, repo, code)");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("rejects a duplicate (owner, repo, code) within one scope", () => {
		const { db, tempDir } = freshDb("reject");

		insertMemory(db, "id-1", "vheins", "favori-app", "MEM-001");
		expect(() => insertMemory(db, "id-2", "vheins", "favori-app", "MEM-001")).toThrow(/UNIQUE/i);

		// The same code in a DIFFERENT scope is allowed (parity with tasks).
		expect(() => insertMemory(db, "id-3", "vheins", "other-repo", "MEM-001")).not.toThrow();
		expect(() => insertMemory(db, "id-4", "other-owner", "favori-app", "MEM-001")).not.toThrow();

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("treats NULL codes as distinct (legacy rows never collide)", () => {
		const { db, tempDir } = freshDb("nulls");

		expect(() => {
			insertMemory(db, "n-1", "vheins", "favori-app", null);
			insertMemory(db, "n-2", "vheins", "favori-app", null);
		}).not.toThrow();
		expect(db.prepare("SELECT COUNT(*) AS c FROM memories").get()).toEqual({ c: 2 });

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("SKIPS index creation (does not throw) when legacy duplicates remain", () => {
		const { db, tempDir } = freshDb("dirty");

		// Simulate a pre-v40 DB: drop the index, re-create the collision, wipe
		// the v40 record so the runner re-runs the migration on next start.
		db.exec(`DROP INDEX IF EXISTS ${INDEX}`);
		db.prepare("DELETE FROM _schema_version WHERE version = 40").run();
		insertMemory(db, "dup-1", "vheins", "favori-app", "MEM-001");
		insertMemory(db, "dup-2", "vheins", "favori-app", "MEM-001");

		// Must NOT throw — a hard failure here would brick daemon startup.
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		// The migration is still recorded as applied (so it isn't retried in a
		// loop) but the index is absent while the collision persists.
		const recorded = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 40").get() as { c: number };
		expect(recorded.c).toBe(1);
		expect(indexSql(db)).toBeNull();
		expect(db.prepare("SELECT COUNT(*) AS c FROM memories").get()).toEqual({ c: 2 });

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("builds the index on the next run once the duplicates are repaired", () => {
		const { db, tempDir } = freshDb("repair");

		db.exec(`DROP INDEX IF EXISTS ${INDEX}`);
		db.prepare("DELETE FROM _schema_version WHERE version = 40").run();
		insertMemory(db, "dup-1", "vheins", "favori-app", "MEM-001");
		insertMemory(db, "dup-2", "vheins", "favori-app", "MEM-001");
		new MigrationManager(db).migrate();
		expect(indexSql(db)).toBeNull();

		// Operator repairs the losing duplicate, then restarts.
		db.prepare("UPDATE memories SET code = 'MEM-1620' WHERE id = 'dup-2'").run();
		db.prepare("DELETE FROM _schema_version WHERE version = 40").run();
		new MigrationManager(db).migrate();

		expect(indexSql(db)).toContain("UNIQUE INDEX");
		expect(db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 40").get()).toEqual({ c: 1 });

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("re-applying v40 is idempotent (no-op, does not throw)", () => {
		const { db, tempDir } = freshDb("idempotent");

		db.prepare("DELETE FROM _schema_version WHERE version = 40").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();
		expect(db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 40").get()).toEqual({ c: 1 });
		expect(indexSql(db)).toContain("UNIQUE INDEX");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
