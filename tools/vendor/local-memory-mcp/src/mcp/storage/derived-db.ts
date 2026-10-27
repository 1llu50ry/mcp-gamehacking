import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger";
import { DERIVED_DB_FILENAME, DERIVED_SCHEMA, MEMORY_DB_BUSY_TIMEOUT_MS } from "../utils/constants";

/**
 * Derived-database management (DB-shrink L4 / TASK-037).
 *
 * The knowledge DB (`memory.db`) historically held BOTH durable knowledge
 * (memories, standards, tasks) AND regenerable derived data (the codebase
 * index + every `*_vectors` table). The derived data dominates the file yet
 * can be rebuilt from source, so it now lives in a SEPARATE SQLite database
 * (`codebase.db`) attached to the SAME connection as schema `derived`.
 *
 * FTS5 constraint (MEM-132): an external-content FTS table's shadow tables and
 * its `content=` target MUST live in the SAME database, so `codebase_symbols_fts`
 * moves TOGETHER with the codebase family as one atomic unit. `memories_fts`,
 * `coding_standards_fts` and `entity_names_fts` stay in `memory.db`.
 *
 * Cross-database foreign keys are omitted (SQLite rejects an FK whose target
 * lives in another database); the affected vector tables therefore carry no
 * FK. Cleanup that used to rely on FK cascade is explicit where it matters
 * (see `StandardEntity.delete`).
 *
 * The same-schema self-FK on `codebase_symbols.parent_symbol_id` is KEPT (it
 * is a real integrity guard: an unknown parent id must be rejected, not
 * silently stored). Because the one-time copy inserts rows in arbitrary order,
 * {@link runDerivedMigration} disables FK enforcement for the copy window and
 * restores it afterwards.
 */

/** Tables physically moved from `memory.db` into the derived database. */
export const DERIVED_TABLES = [
	"codebase_files",
	"codebase_symbols",
	"codebase_references",
	"memory_vectors",
	"task_vectors",
	"standard_vectors"
] as const;

export type DerivedTable = (typeof DERIVED_TABLES)[number];

/** Primary-key column of each moved table (used for copy verification). */
const DERIVED_PK: Record<DerivedTable, string> = {
	codebase_files: "id",
	codebase_symbols: "id",
	codebase_references: "id",
	memory_vectors: "memory_id",
	task_vectors: "task_id",
	standard_vectors: "standard_id"
};

/** External-content FTS virtual table (same schema as its content table). */
const FTS_TABLE = "codebase_symbols_fts";
const FTS_TRIGGER_INSERT = "codebase_symbols_ai";
const FTS_TRIGGER_DELETE = "codebase_symbols_ad";
const FTS_TRIGGER_UPDATE = "codebase_symbols_au";

/** Result of {@link runDerivedMigration}. */
export interface DerivedMigrationResult {
	/** True when at least one table was physically moved this run. */
	moved: boolean;
	/** Rows moved per table (only for tables moved this run). */
	copiedRows: Record<string, number>;
}

/**
 * Derive the derived-database path that sits alongside the hot memory DB.
 *
 * `:memory:` maps to `:memory:` so tests attach a distinct in-memory database
 * and never touch disk.
 */
export function resolveDerivedDbPath(memoryDbPath: string): string {
	if (memoryDbPath === ":memory:") return ":memory:";
	return path.join(path.dirname(memoryDbPath), DERIVED_DB_FILENAME);
}

/** True when `schema` is already present on the connection (PRAGMA database_list). */
function isSchemaAttached(db: Database.Database, schema: string): boolean {
	const rows = db.prepare("PRAGMA database_list").all() as Array<{ name: string }>;
	return rows.some((row) => row.name === schema);
}

/**
 * Attach the derived database to the existing connection as schema `derived`.
 *
 * Idempotent: a second call is a no-op once the schema is attached. WAL +
 * synchronous=NORMAL + busy_timeout mirror the hot store; an in-memory derived
 * database silently keeps its memory journal (`journal_mode=WAL` returns
 * "memory"), which is fine for tests.
 *
 * @returns The resolved derived path (`:memory:` for tests).
 */
export function attachDerivedDb(db: Database.Database, memoryDbPath: string): string {
	const derivedPath = resolveDerivedDbPath(memoryDbPath);

	if (derivedPath !== ":memory:") {
		const dir = path.dirname(derivedPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	}

	if (!isSchemaAttached(db, DERIVED_SCHEMA)) {
		db.prepare(`ATTACH DATABASE ? AS ${DERIVED_SCHEMA}`).run(derivedPath);
		db.pragma(`${DERIVED_SCHEMA}.journal_mode = WAL`);
		db.pragma(`${DERIVED_SCHEMA}.synchronous = NORMAL`);
		// busy_timeout is CONNECTION-scoped, not per-schema: a schema-qualified
		// `derived.busy_timeout` rewrites the SHARED connection's timeout. Setting
		// it to a fixed 5000 here silently downgraded the hot store's configured
		// MEMORY_DB_BUSY_TIMEOUT_MS (default 30s) to 5s, so contention the operator
		// had tuned for still surfaced as raw `database is locked` (FIX-032). Use
		// the shared value so attaching the derived schema never weakens hot-store
		// contention handling.
		db.pragma(`${DERIVED_SCHEMA}.busy_timeout = ${MEMORY_DB_BUSY_TIMEOUT_MS}`);
	}

	return derivedPath;
}

/**
 * Create the derived tables, indexes and external-content FTS table.
 *
 * Idempotent by construction (`IF NOT EXISTS`) so every process that opens the
 * derived database can call it safely (N8S0U8). Index names are schema-qualified
 * (`derived.<name>`) while their target table is UNQUALIFIED — SQLite resolves
 * the table inside the index's schema, which is what we want even while the
 * same-named `main` table still exists during the one-time migration.
 *
 * Triggers are NOT created here; {@link createDerivedTriggers} runs after the
 * migration so the unqualified FTS body is never ambiguous with `main`.
 */
export function initDerivedSchema(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS ${DERIVED_SCHEMA}.codebase_files (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			file_path TEXT NOT NULL,
			language TEXT,
			checksum TEXT,
			lines INTEGER DEFAULT 0,
			size_bytes INTEGER DEFAULT 0,
			last_indexed_at TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS ${DERIVED_SCHEMA}.codebase_symbols (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			file_path TEXT NOT NULL,
			name TEXT NOT NULL,
			kind TEXT NOT NULL,
			exported INTEGER NOT NULL DEFAULT 0,
			default_export INTEGER NOT NULL DEFAULT 0,
			start_line INTEGER,
			start_col INTEGER,
			end_line INTEGER,
			end_col INTEGER,
			signature TEXT,
			doc_comment TEXT,
			parent_symbol_id TEXT,
			semantic_signature TEXT,
			semantic_source TEXT,
			semantic_updated_at TEXT,
			source_fingerprint TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			FOREIGN KEY (parent_symbol_id) REFERENCES codebase_symbols(id)
		);

		CREATE TABLE IF NOT EXISTS ${DERIVED_SCHEMA}.codebase_references (
			id TEXT PRIMARY KEY,
			repo TEXT NOT NULL,
			symbol_name TEXT NOT NULL,
			caller_file TEXT NOT NULL,
			caller_line INTEGER,
			caller_name TEXT,
			kind TEXT NOT NULL,
			created_at TEXT,
			target_file TEXT,
			target_symbol_id TEXT,
			role TEXT,
			local_name TEXT,
			imported_name TEXT,
			module_specifier TEXT,
			import_kind TEXT
		);

		CREATE TABLE IF NOT EXISTS ${DERIVED_SCHEMA}.memory_vectors (
			memory_id TEXT PRIMARY KEY,
			vector TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			vector_version INTEGER NOT NULL DEFAULT 1,
			content_hash TEXT,
			model_version INTEGER
		);

		CREATE TABLE IF NOT EXISTS ${DERIVED_SCHEMA}.task_vectors (
			task_id TEXT PRIMARY KEY,
			vector TEXT NOT NULL,
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			content_hash TEXT,
			model_version INTEGER
		);

		CREATE TABLE IF NOT EXISTS ${DERIVED_SCHEMA}.standard_vectors (
			standard_id TEXT PRIMARY KEY,
			vector TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			vector_version INTEGER NOT NULL DEFAULT 1,
			content_hash TEXT,
			model_version INTEGER
		);

		CREATE UNIQUE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_codebase_files_repo_path ON codebase_files(repo, file_path);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_codebase_files_repo_indexed ON codebase_files(repo, last_indexed_at);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_cs_repo_name ON codebase_symbols(repo, name);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_cs_repo_file ON codebase_symbols(repo, file_path);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_cs_repo_kind ON codebase_symbols(repo, kind);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_cs_name ON codebase_symbols(name);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_cs_parent ON codebase_symbols(parent_symbol_id);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_cs_repo_exported_parent ON codebase_symbols(repo, exported, parent_symbol_id);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_symbols_file_path ON codebase_symbols(file_path);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_symbols_name_lower ON codebase_symbols(LOWER(name), repo, kind);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_refs_repo_symbol ON codebase_references(repo, symbol_name);
		CREATE INDEX IF NOT EXISTS ${DERIVED_SCHEMA}.idx_refs_repo_file ON codebase_references(repo, caller_file);

		CREATE VIRTUAL TABLE IF NOT EXISTS ${DERIVED_SCHEMA}.${FTS_TABLE} USING fts5(
			name, doc_comment, signature,
			content='codebase_symbols', content_rowid='rowid'
		);
	`);
}

/** Vector tables that carry the PERF-003 idempotency columns. */
const VECTOR_TABLES = ["memory_vectors", "task_vectors", "standard_vectors"] as const;

/**
 * PERF-003 — idempotently add `content_hash` + `model_version` to the three
 * derived vector tables.
 *
 * `initDerivedSchema` only creates tables (`IF NOT EXISTS`), so on an EXISTING
 * database the new columns are never added by the DDL. SQLite has no
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so we probe
 * `PRAGMA derived.table_info(<table>)` and add only the missing columns.
 *
 * Why a `content_hash` column (not `vector_version`): the vector tables
 * already had a dead `vector_version` column (always 1) — reusing it would
 * conflate "embedding format version" with the model identity PERF-004 will
 * promote, and `task_vectors` never had it at all. Adding two nullable columns
 * is the least-invasive correct choice and keeps `vector_version` untouched for
 * its original (future) purpose. `content_hash` stores the SAME
 * `embedPayloadContentHash` the enqueue path computes, so backfill can compare
 * a vector's embedded content against the entity's current payload; a NULL
 * (pre-PERF-003 row) is treated as "unknown" and forces one re-embed to
 * stamp it, after which restarts are idempotent.
 *
 * Cost/safety: `ALTER TABLE ADD COLUMN` is O(1) metadata-only in SQLite — it
 * does NOT rewrite the table, so it is safe on the 2.6 GB memory.db / 516 MB
 * derived store. Each ALTER is wrapped so a failure is logged and retried on
 * the next startup instead of aborting derived setup (never-throw style,
 * mirroring the move in {@link runDerivedMigration}); the DDL is atomic so a
 * partial failure can never corrupt the table.
 */
export function ensureDerivedVectorColumns(db: Database.Database): void {
	const wanted = [
		{ name: "content_hash", type: "TEXT" },
		{ name: "model_version", type: "INTEGER" }
	] as const;
	for (const table of VECTOR_TABLES) {
		const existing = new Set(tableColumns(db, DERIVED_SCHEMA, table));
		for (const col of wanted) {
			if (existing.has(col.name)) continue;
			try {
				db.exec(`ALTER TABLE ${DERIVED_SCHEMA}.${table} ADD COLUMN ${col.name} ${col.type}`);
				logger.info("[DerivedDb] Added vector column (PERF-003)", { table, column: col.name });
			} catch (err) {
				logger.warn("[DerivedDb] Failed to add vector column; will retry next startup", {
					table,
					column: col.name,
					error: String(err)
				});
			}
		}
	}
}

/**
 * Create the codebase_symbols ↔ codebase_symbols_fts sync triggers inside the
 * derived schema. Trigger NAMES are schema-qualified but the `ON` table and the
 * trigger BODY must stay UNQUALIFIED: SQLite forbids a qualified table name on
 * an INSERT/UPDATE/DELETE inside a trigger, and a trigger created as
 * `derived.<name>` resolves unqualified references to the derived schema.
 *
 * Idempotent (DROP IF EXISTS + CREATE), so it is safe to call on every startup.
 */
export function createDerivedTriggers(db: Database.Database): void {
	db.exec(`
		DROP TRIGGER IF EXISTS ${DERIVED_SCHEMA}.${FTS_TRIGGER_INSERT};
		DROP TRIGGER IF EXISTS ${DERIVED_SCHEMA}.${FTS_TRIGGER_DELETE};
		DROP TRIGGER IF EXISTS ${DERIVED_SCHEMA}.${FTS_TRIGGER_UPDATE};

		CREATE TRIGGER ${DERIVED_SCHEMA}.${FTS_TRIGGER_INSERT} AFTER INSERT ON codebase_symbols BEGIN
			INSERT INTO ${FTS_TABLE}(rowid, name, doc_comment, signature)
			VALUES (new.rowid, new.name, new.doc_comment, new.signature);
		END;

		CREATE TRIGGER ${DERIVED_SCHEMA}.${FTS_TRIGGER_DELETE} AFTER DELETE ON codebase_symbols BEGIN
			INSERT INTO ${FTS_TABLE}(${FTS_TABLE}, rowid, name, doc_comment, signature)
			VALUES('delete', old.rowid, old.name, old.doc_comment, old.signature);
		END;

		CREATE TRIGGER ${DERIVED_SCHEMA}.${FTS_TRIGGER_UPDATE} AFTER UPDATE ON codebase_symbols BEGIN
			INSERT INTO ${FTS_TABLE}(${FTS_TABLE}, rowid, name, doc_comment, signature)
			VALUES('delete', old.rowid, old.name, old.doc_comment, old.signature);
			INSERT INTO ${FTS_TABLE}(rowid, name, doc_comment, signature)
			VALUES (new.rowid, new.name, new.doc_comment, new.signature);
		END;
	`);
}

/** Rebuild the derived FTS index from its content table (post-copy backfill). */
export function rebuildDerivedFts(db: Database.Database): void {
	db.exec(`INSERT INTO ${DERIVED_SCHEMA}.${FTS_TABLE}(${FTS_TABLE}) VALUES('rebuild')`);
}

/** True when `table` physically exists in `schema`. */
function tableExists(db: Database.Database, schema: string, table: string): boolean {
	const row = db
		.prepare(`SELECT 1 AS present FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
		.get(table);
	return row !== undefined;
}

/** Column names of `schema.table` in declaration order (empty when absent). */
function tableColumns(db: Database.Database, schema: string, table: string): string[] {
	return (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as Array<{ name: string }>).map((col) => col.name);
}

/** Row count of `schema.table`. */
function countRows(db: Database.Database, schema: string, table: string): number {
	return (db.prepare(`SELECT COUNT(*) AS c FROM ${schema}.${table}`).get() as { c: number }).c;
}

/** Quote an identifier for use in SQL (defensive — names come from PRAGMA). */
function quoteIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Copy one table `main.T` → `derived.T` with an explicit column list (the
 * intersection of both schemas), then verify every main row is present.
 *
 * Returns the number of rows copied. Throws when the derived schema is missing
 * a main column (schema drift) or when verification fails — the caller then
 * aborts the whole move BEFORE any `main` table is dropped, so a failed copy
 * never loses data.
 */
function copyTable(db: Database.Database, table: DerivedTable): number {
	const mainCols = tableColumns(db, "main", table);
	const derivedSet = new Set(tableColumns(db, DERIVED_SCHEMA, table));
	const missing = mainCols.filter((col) => !derivedSet.has(col));
	if (missing.length > 0) {
		throw new Error(`derived schema is missing columns for ${table}: ${missing.join(", ")}`);
	}

	const colList = mainCols.map(quoteIdent).join(", ");
	db.exec(`INSERT OR REPLACE INTO ${DERIVED_SCHEMA}.${table} (${colList}) SELECT ${colList} FROM main.${table}`);

	const pk = DERIVED_PK[table];
	const notCopied = (
		db
			.prepare(
				`SELECT COUNT(*) AS c FROM main.${table} m
				 WHERE NOT EXISTS (SELECT 1 FROM ${DERIVED_SCHEMA}.${table} d WHERE d.${quoteIdent(pk)} = m.${quoteIdent(pk)})`
			)
			.get() as { c: number }
	).c;
	if (notCopied > 0) {
		throw new Error(`${table}: ${notCopied} row(s) missing in derived after copy`);
	}

	return countRows(db, "main", table);
}

/**
 * One-time (idempotent) move of the derived tables from `main` into `derived`.
 *
 * Copy ALL tables first, verify ALL, and only then drop the `main` tables — so
 * a failure mid-way leaves every main table intact (the connection keeps
 * serving the un-moved `main` tables until a later retry succeeds). The copy
 * uses `INSERT OR REPLACE` keyed on each table's PK, so a retried run after a
 * crash is a no-op for already-copied rows.
 *
 * A no-op once every moved table is absent from `main`. Never wraps the
 * cross-file work in a transaction (WAL makes cross-file transactions
 * non-atomic — see MEM-132).
 */
export function runDerivedMigration(db: Database.Database): DerivedMigrationResult {
	const toMove = DERIVED_TABLES.filter((table) => tableExists(db, "main", table));
	if (toMove.length === 0) return { moved: false, copiedRows: {} };

	const copiedRows: Record<string, number> = {};
	// The codebase_symbols self-FK is kept, but the copy inserts rows in
	// arbitrary order (a child may precede its parent), so FK enforcement is
	// suspended for the copy window and restored immediately afterwards. The
	// source rows are already consistent, so no orphan can be introduced.
	// `PRAGMA foreign_keys` is a no-op inside a transaction — this function
	// deliberately runs outside one (MEM-132).
	const fkWasOn = (db.pragma("foreign_keys", { simple: true }) as number) === 1;
	if (fkWasOn) db.pragma("foreign_keys = OFF");
	try {
		for (const table of toMove) {
			copiedRows[table] = copyTable(db, table);
		}
	} finally {
		if (fkWasOn) db.pragma("foreign_keys = ON");
	}

	// Copy verified for every table — now retire the main-side objects.
	db.exec(`
		DROP TRIGGER IF EXISTS main.${FTS_TRIGGER_INSERT};
		DROP TRIGGER IF EXISTS main.${FTS_TRIGGER_DELETE};
		DROP TRIGGER IF EXISTS main.${FTS_TRIGGER_UPDATE};
	`);
	if (tableExists(db, "main", FTS_TABLE)) {
		db.exec(`DROP TABLE main.${FTS_TABLE}`);
	}
	for (const table of toMove) {
		db.exec(`DROP TABLE main.${table}`);
	}

	logger.info("[DerivedDb] Moved derived tables into codebase.db", { tables: toMove, copiedRows });
	return { moved: true, copiedRows };
}

/**
 * Bring the derived database to a ready state: attach it, ensure its schema,
 * run the one-time move from `main`, and (re)create the FTS triggers.
 *
 * The move itself is never-throw (mirrors the TASK-036 cold-archive offload):
 * a failed move is logged and the main tables are left untouched. Attach and
 * schema creation are deterministic and allowed to throw — a broken derived
 * store must fail fast rather than silently serve stale data.
 *
 * @returns The migration outcome, or `null` when the move failed.
 */
export function ensureDerivedReady(db: Database.Database, memoryDbPath: string): DerivedMigrationResult | null {
	attachDerivedDb(db, memoryDbPath);
	initDerivedSchema(db);
	// PERF-003: evolve the vector tables on an EXISTING derived DB (the
	// CREATE TABLE IF NOT EXISTS above is a no-op there). Runs before the move
	// so a legacy main-side copy lands in an already-upgraded schema.
	ensureDerivedVectorColumns(db);

	let migration: DerivedMigrationResult | null = null;
	try {
		migration = runDerivedMigration(db);
	} catch (err) {
		logger.error("[DerivedDb] Migration failed; main tables preserved for retry", { error: String(err) });
	}

	createDerivedTriggers(db);

	if (migration?.moved) {
		try {
			rebuildDerivedFts(db);
		} catch (err) {
			logger.warn("[DerivedDb] FTS rebuild after move failed", { error: String(err) });
		}
	}

	return migration;
}
