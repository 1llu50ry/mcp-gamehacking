import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager } from "../storage/migrations";

describe("coding_standards migrations", () => {
	it("upgrades legacy coding_standards tables before creating hit_count index", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-standards-migrate-"));
		const dbPath = path.join(tempDir, "legacy.db");
		const db = new Database(dbPath);

		db.exec(`
			CREATE TABLE coding_standards (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				content TEXT NOT NULL,
				context TEXT,
				version TEXT,
				language TEXT,
				stack TEXT,
				is_global INTEGER NOT NULL DEFAULT 0,
				repo TEXT,
				tags TEXT,
				metadata TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				agent TEXT NOT NULL DEFAULT 'unknown',
				model TEXT NOT NULL DEFAULT 'unknown'
			);
		`);

		const migrator = new MigrationManager(db);
		expect(() => migrator.migrate()).not.toThrow();

		const columns = db.prepare("PRAGMA table_info(coding_standards)").all() as Array<{ name: string }>;
		const columnNames = columns.map((column) => column.name);
		expect(columnNames).toContain("hit_count");
		expect(columnNames).toContain("last_used_at");
		expect(columnNames).toContain("parent_id");

		const indexes = db.prepare("PRAGMA index_list(coding_standards)").all() as Array<{ name: string }>;
		expect(indexes.some((index) => index.name === "idx_coding_standards_hit_count")).toBe(true);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
