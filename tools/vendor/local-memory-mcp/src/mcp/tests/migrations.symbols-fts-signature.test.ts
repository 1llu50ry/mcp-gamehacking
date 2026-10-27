import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v18 "symbols-fts-signature" (GitHub #79 /
 * TASK-227).
 *
 * v18 rebuilds the content-backed `codebase_symbols_fts` FTS5 table to index
 * `signature` in addition to `name` + `doc_comment` (FTS5 has no ALTER for
 * external-content tables). The rebuild is a drop-and-recreate via a `_v2`
 * staging table + rename; the ai/ad/au triggers are recreated AFTER the rename
 * targeting the final table name.
 *
 * These tests pin the contracts that matter for applied-DB determinism:
 *  1. fresh migrate lands on SCHEMA_VERSION 18 with the signature column,
 *     all three triggers present, and no `_v2` staging leftovers;
 *  2. an existing pre-v18 DB (v1-shape FTS layer) upgrades cleanly — existing
 *     symbols are backfilled and their signature tokens become searchable,
 *     and the rebuilt triggers keep indexing signatures on new writes;
 *  3. re-applying v18 (simulated crash-retry) is a no-op that does not throw
 *     or corrupt the index.
 */
describe("migration v18 symbols-fts-signature", () => {
	it("fresh DB migrates to SCHEMA_VERSION 18 with signature column + triggers", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-symbols-fts-sig-"));
		const dbPath = path.join(tempDir, "symbols.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		// Full v1..v18 apply on a fresh DB.
		new MigrationManager(db).migrate();

		const applied = db.prepare("SELECT version FROM _schema_version ORDER BY version").all() as {
			version: number;
		}[];
		expect(applied.at(-1)?.version).toBe(SCHEMA_VERSION);
		expect(applied.map((r) => r.version)).toEqual(Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));

		// The rebuilt FTS table exposes the signature column.
		const cols = db.prepare("PRAGMA table_info(codebase_symbols_fts)").all() as Array<{ name: string }>;
		const colNames = cols.map((c) => c.name);
		expect(colNames).toEqual(expect.arrayContaining(["name", "doc_comment", "signature"]));

		// The _v2 staging table must not survive the rename.
		const v2Leftover = db.prepare("SELECT name FROM sqlite_master WHERE name = 'codebase_symbols_fts_v2'").get();
		expect(v2Leftover).toBeUndefined();

		// All three triggers exist, index the signature column, and do not hold
		// dangling references to the dropped _v2 table. (Other migrations add
		// their own FTS triggers, so scope to codebase_symbols_*.)
		const triggers = db
			.prepare(
				"SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'codebase_symbols_%' ORDER BY name"
			)
			.all() as Array<{ name: string; sql: string }>;
		expect(triggers.map((t) => t.name).sort()).toEqual([
			"codebase_symbols_ad",
			"codebase_symbols_ai",
			"codebase_symbols_au"
		]);
		for (const t of triggers) {
			expect(t.sql).toContain("signature");
			expect(t.sql).not.toContain("codebase_symbols_fts_v2");
		}

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("upgrades a pre-v18 DB: backfills signature rows and makes them searchable", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-symbols-fts-sig-up-"));
		const dbPath = path.join(tempDir, "symbols.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		// Fresh migrate to build the full schema, then revert ONLY the FTS layer
		// to the pre-v18 (v1) shape and drop the v18 record — simulating an
		// existing v17 DB that is about to upgrade.
		new MigrationManager(db).migrate();
		db.exec(V1_FTS_DDL);
		db.prepare("DELETE FROM _schema_version WHERE version = 18").run();

		const fooId = randomUUID();
		const barId = randomUUID();
		insertSymbol(db, {
			id: fooId,
			repo: "test-repo",
			file_path: "src/foo.ts",
			name: "foo",
			kind: "function",
			signature: "fn foo(x: u32) -> bool"
		});
		insertSymbol(db, {
			id: barId,
			repo: "test-repo",
			file_path: "src/bar.ts",
			name: "bar",
			kind: "function",
			signature: "fn bar(y: string)"
		});

		// Pre-upgrade: signature is NOT searchable (v1 FTS lacks the column).
		const preUpgrade = searchBySignatureToken(db, "u32");
		expect(preUpgrade).toEqual([]);

		// Upgrade must not throw.
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const applied = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 18").get() as {
			c: number;
		};
		expect(applied.c).toBe(1);

		// Backfill populated the rebuilt index with the pre-existing rows.
		const ftsCount = db.prepare("SELECT COUNT(*) AS c FROM codebase_symbols_fts").get() as { c: number };
		const contentCount = db.prepare("SELECT COUNT(*) AS c FROM codebase_symbols").get() as { c: number };
		expect(ftsCount.c).toBe(contentCount.c);
		expect(ftsCount.c).toBe(2);

		// Signature tokens are searchable after the upgrade.
		const hits = searchBySignatureToken(db, "u32");
		expect(hits.map((h) => h.id)).toContain(fooId);

		// The rebuilt (post-rename) triggers keep indexing signatures on new writes.
		const bazId = randomUUID();
		insertSymbol(db, {
			id: bazId,
			repo: "test-repo",
			file_path: "src/baz.ts",
			name: "baz",
			kind: "function",
			signature: "fn baz(q: u64) -> u64"
		});
		const afterInsert = searchBySignatureToken(db, "u64");
		expect(afterInsert.map((h) => h.id)).toContain(bazId);

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("re-applying v18 is idempotent (crash-retry does not throw or corrupt)", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-symbols-fts-sig-re-"));
		const dbPath = path.join(tempDir, "symbols.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		const fooId = randomUUID();
		insertSymbol(db, {
			id: fooId,
			repo: "test-repo",
			file_path: "src/foo.ts",
			name: "foo",
			kind: "function",
			signature: "fn foo(x: u32) -> bool"
		});

		// Simulate a crash mid-migration: wipe the v18 record so the runner
		// re-runs it on the next startup. The rebuild (DROP ... IF EXISTS +
		// recreate) must be a no-op here and must not throw.
		db.prepare("DELETE FROM _schema_version WHERE version = 18").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 18").get() as {
			c: number;
		};
		expect(count.c).toBe(1);

		// Signature search still resolves after the re-run (index not corrupted).
		const hits = searchBySignatureToken(db, "u32");
		expect(hits.map((h) => h.id)).toContain(fooId);

		// And no staging leftovers from the re-run.
		const v2Leftover = db.prepare("SELECT name FROM sqlite_master WHERE name = 'codebase_symbols_fts_v2'").get();
		expect(v2Leftover).toBeUndefined();

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});

// ── Helpers ──────────────────────────────────────────────────────────────

/** v01's original (pre-v18) FTS5 layer — name + doc_comment only, no signature. */
const V1_FTS_DDL = `
	DROP TRIGGER IF EXISTS codebase_symbols_ai;
	DROP TRIGGER IF EXISTS codebase_symbols_ad;
	DROP TRIGGER IF EXISTS codebase_symbols_au;
	DROP TABLE IF EXISTS codebase_symbols_fts;

	CREATE VIRTUAL TABLE codebase_symbols_fts USING fts5(
		name, doc_comment, content='codebase_symbols', content_rowid='rowid'
	);

	CREATE TRIGGER codebase_symbols_ai AFTER INSERT ON codebase_symbols BEGIN
		INSERT INTO codebase_symbols_fts(rowid, name, doc_comment)
		VALUES (new.rowid, new.name, new.doc_comment);
	END;

	CREATE TRIGGER codebase_symbols_ad AFTER DELETE ON codebase_symbols BEGIN
		INSERT INTO codebase_symbols_fts(codebase_symbols_fts, rowid, name, doc_comment)
		VALUES('delete', old.rowid, old.name, old.doc_comment);
	END;

	CREATE TRIGGER codebase_symbols_au AFTER UPDATE ON codebase_symbols BEGIN
		INSERT INTO codebase_symbols_fts(codebase_symbols_fts, rowid, name, doc_comment)
		VALUES('delete', old.rowid, old.name, old.doc_comment);
		INSERT INTO codebase_symbols_fts(rowid, name, doc_comment)
		VALUES (new.rowid, new.name, new.doc_comment);
	END;
`;

function insertSymbol(
	db: Database.Database,
	symbol: {
		id: string;
		repo: string;
		file_path: string;
		name: string;
		kind: string;
		signature: string | null;
	}
): void {
	db.prepare(
		`INSERT INTO codebase_symbols (id, repo, file_path, name, kind, exported, default_export, signature, doc_comment)
		 VALUES (?, ?, ?, ?, ?, 0, 0, ?, NULL)`
	).run(symbol.id, symbol.repo, symbol.file_path, symbol.name, symbol.kind, symbol.signature);
}

function searchBySignatureToken(db: Database.Database, token: string): Array<{ id: string }> {
	return db
		.prepare(
			`SELECT cs.id FROM codebase_symbols_fts f
			 JOIN codebase_symbols cs ON cs.rowid = f.rowid
			 WHERE codebase_symbols_fts MATCH ?`
		)
		.all(token) as Array<{ id: string }>;
}
