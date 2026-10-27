import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MigrationManager, SCHEMA_VERSION } from "../storage/migrations";

/**
 * Regression net for migration v27 "codebase-references-import-metadata"
 * (TASK-009 / issue #83, semantic-graph epic P0).
 *
 * v27 extends the v21 codebase_references table with four nullable columns —
 * `local_name`, `imported_name`, `module_specifier`, `import_kind` — so an
 * 'import' edge can map a LOCAL BINDING back to its canonical exported
 * symbol/file (`import { User as DomainUser } from '@/domain/user'` records
 * localName 'DomainUser', importedName 'User', moduleSpecifier '@/domain/user').
 * These tests pin the applied-DB contracts: a fresh migrate lands on the
 * latest SCHEMA_VERSION with all four columns present, re-applying v27
 * (idempotent retry, simulating a crash mid-migration) is a no-op that does
 * not throw, legacy rows round-trip with NULL metadata, and a v27 import row
 * round-trips all four values.
 */
describe("migration v27 codebase references import metadata", () => {
	it("fresh DB migrates to latest SCHEMA_VERSION with the four import-metadata columns", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-v27-"));
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

		// Table keeps every prior column AND gains the four import columns.
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

		for (const colName of ["local_name", "imported_name", "module_specifier", "import_kind"]) {
			const col = cols.find((c) => c.name === colName);
			expect(col?.type).toBe("TEXT");
			// Nullable — non-import kinds and unresolved imports store NULL.
			expect(col?.notnull).toBe(0);
		}

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

	it("re-applying v27 is idempotent (no-op, does not throw)", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-v27-re-"));
		const dbPath = path.join(tempDir, "refs.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// Simulate a crash mid-migration: wipe the v27 record so the runner
		// re-runs it on the next startup. The PRAGMA table_info guard must make
		// the ALTER TABLE ADD COLUMN a no-op here and must not throw.
		db.prepare("DELETE FROM _schema_version WHERE version = 27").run();
		expect(() => new MigrationManager(db).migrate()).not.toThrow();

		const count = db.prepare("SELECT COUNT(*) AS c FROM _schema_version WHERE version = 27").get() as { c: number };
		expect(count.c).toBe(1);

		// Each column still present exactly once.
		const cols = db.prepare("PRAGMA table_info(codebase_references)").all() as { name: string }[];
		for (const colName of ["local_name", "imported_name", "module_specifier", "import_kind"]) {
			expect(cols.filter((c) => c.name === colName).length).toBe(1);
		}

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("legacy rows round-trip NULL import metadata; v27 import rows round-trip all four values", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lmcp-refs-v27-legacy-"));
		const dbPath = path.join(tempDir, "refs.db");
		const db = new Database(dbPath);
		db.pragma("foreign_keys = ON");

		new MigrationManager(db).migrate();

		// A row written with ONLY the pre-v27 columns (as pre-v27 code did)
		// inserts cleanly and reads back with NULL metadata — the new columns
		// are nullable, so existing index data is not invalidated by the upgrade.
		db.prepare(
			"INSERT INTO codebase_references (id, repo, symbol_name, caller_file, caller_line, caller_name, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
		).run("legacy-row", "repo-a", "connect", "src/a.ts", 4, "run", "call", new Date().toISOString());

		const legacy = db.prepare("SELECT * FROM codebase_references WHERE id = ?").get("legacy-row") as {
			local_name: string | null;
			imported_name: string | null;
			module_specifier: string | null;
			import_kind: string | null;
		};
		expect(legacy.local_name).toBeNull();
		expect(legacy.imported_name).toBeNull();
		expect(legacy.module_specifier).toBeNull();
		expect(legacy.import_kind).toBeNull();

		// A v27 aliased named import row round-trips all four values.
		db.prepare(
			"INSERT INTO codebase_references (id, repo, symbol_name, caller_file, caller_line, caller_name, kind, local_name, imported_name, module_specifier, import_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
		).run(
			"import-row",
			"repo-a",
			"User",
			"src/app.ts",
			1,
			null,
			"import",
			"DomainUser",
			"User",
			"@/domain/user",
			"named",
			new Date().toISOString()
		);
		const importRow = db.prepare("SELECT * FROM codebase_references WHERE id = ?").get("import-row") as {
			kind: string;
			local_name: string | null;
			imported_name: string | null;
			module_specifier: string | null;
			import_kind: string | null;
		};
		expect(importRow.kind).toBe("import");
		expect(importRow.local_name).toBe("DomainUser");
		expect(importRow.imported_name).toBe("User");
		expect(importRow.module_specifier).toBe("@/domain/user");
		expect(importRow.import_kind).toBe("named");

		// A v27 side-effect import row round-trips with NULL imported_name
		// (no binding) but a module specifier + side-effect kind.
		db.prepare(
			"INSERT INTO codebase_references (id, repo, symbol_name, caller_file, caller_line, caller_name, kind, local_name, imported_name, module_specifier, import_kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
		).run(
			"side-effect-row",
			"repo-a",
			"./styles.css",
			"src/app.ts",
			2,
			null,
			"import",
			"./styles.css",
			null,
			"./styles.css",
			"side-effect",
			new Date().toISOString()
		);
		const sideEffect = db.prepare("SELECT * FROM codebase_references WHERE id = ?").get("side-effect-row") as {
			imported_name: string | null;
			import_kind: string | null;
		};
		expect(sideEffect.imported_name).toBeNull();
		expect(sideEffect.import_kind).toBe("side-effect");

		db.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});
});
