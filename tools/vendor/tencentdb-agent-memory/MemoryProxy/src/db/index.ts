/**
 * SQLite singleton for MemoryProxy.
 *
 * - DB path resolution: `process.env.PROXY_DB_PATH` > `~/.tdai-memory-proxy/proxy.db`.
 * - Directory created with mode 0700; DB file chmod'd to 0600 after creation.
 * - PRAGMA journal_mode=WAL, foreign_keys=ON, busy_timeout=2000.
 * - All callers MUST go through prepared statements (Repos enforce this).
 *
 * Errors during initialization are *not* fatal — callers can opt to disable
 * persistence by checking `getDb()` returning null, in which case the proxy
 * continues to operate in-memory only (degraded mode).
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type Database from "better-sqlite3";

import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

// ESM has no global `require`. We use createRequire here so that getDb()
// can stay synchronous (Repos rely on sync construction).
const _require = createRequire(import.meta.url);

let _db: Database.Database | null = null;
let _dbInitFailed = false;

/** Resolve the DB file path. Caller must ensure parent dir exists. */
export function resolveDbPath(): string {
  const fromEnv = process.env.PROXY_DB_PATH;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return path.join(os.homedir(), ".tdai-memory-proxy", "proxy.db");
}

/** Ensure the parent directory for the DB exists with mode 0700. */
function ensureDbDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdirSync with mode is honored on first creation only; tighten anyway.
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* ignore — non-POSIX FS */
  }
}

/** Run schema creation + meta version bookkeeping. */
function runSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  const row = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get("schema_version") as { value: string } | undefined;
  if (!row) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
      "schema_version",
      String(SCHEMA_VERSION),
    );
  }
  // Future: handle row.value < SCHEMA_VERSION → run migrations.
}

/**
 * Get (or lazily initialize) the singleton DB connection.
 *
 * Returns `null` if initialization fails (e.g. native module missing,
 * disk unwritable). Callers MUST treat null as "persistence disabled,
 * fall back to memory-only behavior".
 */
export function getDb(): Database.Database | null {
  if (_db) return _db;
  if (_dbInitFailed) return null;

  const dbPath = resolveDbPath();
  try {
    ensureDbDir(dbPath);

    // better-sqlite3 is a native CJS module — load it via createRequire so
    // the call stays synchronous (dynamic `import()` would force the whole
    // call chain async and break the Repo-singleton contract).
    const SqliteCtor = _require("better-sqlite3") as typeof Database;
    const db = new SqliteCtor(dbPath);

    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 2000");
    runSchema(db);

    // Tighten file permissions (DB file + WAL/SHM siblings if present).
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        if (fs.existsSync(p)) fs.chmodSync(p, 0o600);
      } catch {
        /* ignore */
      }
    }

    _db = db;
    return _db;
  } catch (err) {
    _dbInitFailed = true;
    console.warn(
      "[session-db] failed to initialize SQLite, persistence disabled:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Close the DB connection. Primarily for tests. */
export function closeDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
    _db = null;
  }
  _dbInitFailed = false;
}

/** Reset internal singleton state. Tests only. */
export function __resetDbForTests(): void {
  closeDb();
}
