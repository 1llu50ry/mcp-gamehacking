// ============================================================
// Content-addressed SQLite backing for the skills / plugins / agents
// / subagents / prompts trees.
//
// Instead of walking 10,000+ files on every list / search / read, we
// pack them once into a single SQLite file (~20 MiB without source
// blobs, ~3.5 GiB with). Tools then query the DB, which is:
//
//   - A single file to ship (npm, docker, release asset).
//   - Full-text searchable via SQLite's FTS5 (BM25 ranking built in).
//   - Zero-dep — uses Node 22+'s built-in `node:sqlite`.
//   - Backward compatible: when the DB file is missing the server
//     falls back to the on-disk filesystem walk so existing deploys
//     keep working.
//
// Schema (minimum viable; FTS virtual tables mirror each content
// table and are kept in sync by triggers):
//
//   CREATE TABLE skills(
//     name TEXT PRIMARY KEY,
//     description TEXT,
//     type TEXT,
//     topics_json TEXT,          -- JSON array
//     body TEXT,                 -- SKILL.md text
//     source_gz BLOB,            -- gzipped source.txt, NULL when
//                                --   shipping the slim DB
//     source_sha TEXT            -- sha256 of uncompressed source
//   );
//   CREATE VIRTUAL TABLE skills_fts USING fts5(
//     name, description, topics, body, content='skills', content_rowid='rowid'
//   );
//
//   CREATE TABLE plugins(category TEXT, name TEXT, path TEXT, body TEXT, PRIMARY KEY(category, name));
//   CREATE TABLE agents(name PRIMARY KEY, body TEXT);
//   CREATE TABLE subagents(name PRIMARY KEY, body TEXT);
//   CREATE TABLE prompts(category TEXT, name TEXT, body TEXT, PRIMARY KEY(category, name));
//
// The DB file lives at <ROOT>/db/skills.db by default; override with
// MCP_SKILLS_DB=/path/to/file.db. The server opens it read-only; the
// writer (scripts/build-db.mjs) opens it read-write.
// ============================================================

import { DatabaseSync } from "node:sqlite";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export interface SkillRow {
  name: string;
  description: string | null;
  type:        string | null;
  topics:      string[];
  body:        string;
  hasSource:   boolean;
}

export interface SearchHit {
  name: string;
  description: string | null;
  snippet: string;
  rank: number;
}

/** Default DB path for a given project root. */
export function defaultDbPath(root: string): string {
  return process.env.MCP_SKILLS_DB ?? join(root, "db", "skills.db");
}

/** Returns null when the DB doesn't exist (callers degrade to FS). */
export async function openDbIfPresent(path: string): Promise<DatabaseSync | null> {
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
    const db = new DatabaseSync(path, { readOnly: true });
    // sanity probe — a legit skills.db has a `skills` table.
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skills'").get();
    if (!row) { db.close(); return null; }
    return db;
  } catch { return null; }
}

/** Fresh read-write DB with the schema applied. */
export function createEmptyDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS skills (
      name        TEXT PRIMARY KEY,
      description TEXT,
      type        TEXT,
      topics_json TEXT,
      body        TEXT,
      source_gz   BLOB,
      source_sha  TEXT
    );
    -- Standalone FTS5 index (not external-content): stores its own
    -- copy of the searchable text and tokenises with porter stemming
    -- over unicode61. Keeping it standalone means we don't have to
    -- maintain triggers for every write path and the virtual column
    -- names are decoupled from the backing table's physical schema.
    CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
      name, description, topics, body,
      tokenize='porter unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
      INSERT INTO skills_fts(rowid, name, description, topics, body)
      VALUES (new.rowid, new.name, COALESCE(new.description, ''), COALESCE(new.topics_json, ''), COALESCE(new.body, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
      DELETE FROM skills_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
      DELETE FROM skills_fts WHERE rowid = old.rowid;
      INSERT INTO skills_fts(rowid, name, description, topics, body)
      VALUES (new.rowid, new.name, COALESCE(new.description, ''), COALESCE(new.topics_json, ''), COALESCE(new.body, ''));
    END;

    CREATE TABLE IF NOT EXISTS plugins (
      category TEXT NOT NULL,
      name     TEXT NOT NULL,
      path     TEXT,
      body     TEXT,
      PRIMARY KEY (category, name)
    );
    CREATE INDEX IF NOT EXISTS plugins_by_name ON plugins(name);

    CREATE TABLE IF NOT EXISTS agents     (name TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE IF NOT EXISTS subagents  (name TEXT PRIMARY KEY, body TEXT);
    CREATE TABLE IF NOT EXISTS prompts (
      category TEXT NOT NULL,
      name     TEXT NOT NULL,
      body     TEXT,
      PRIMARY KEY (category, name)
    );

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  return db;
}

// ---- read side ----

export function listSkills(db: DatabaseSync, limit = 50, offset = 0): SkillRow[] {
  const rows = db.prepare(
    "SELECT name, description, type, topics_json, body, (source_gz IS NOT NULL) AS has_source FROM skills ORDER BY name LIMIT ? OFFSET ?"
  ).all(limit, offset) as Array<{
    name: string; description: string | null; type: string | null;
    topics_json: string | null; body: string; has_source: number;
  }>;
  return rows.map(r => ({
    name: r.name,
    description: r.description,
    type: r.type,
    topics: r.topics_json ? JSON.parse(r.topics_json) : [],
    body: r.body,
    hasSource: !!r.has_source,
  }));
}

export function getSkill(db: DatabaseSync, name: string): SkillRow | null {
  const r = db.prepare(
    "SELECT name, description, type, topics_json, body, (source_gz IS NOT NULL) AS has_source FROM skills WHERE name = ?"
  ).get(name) as {
    name: string; description: string | null; type: string | null;
    topics_json: string | null; body: string; has_source: number;
  } | undefined;
  if (!r) return null;
  return {
    name: r.name,
    description: r.description,
    type: r.type,
    topics: r.topics_json ? JSON.parse(r.topics_json) : [],
    body: r.body,
    hasSource: !!r.has_source,
  };
}

export function getSkillSource(db: DatabaseSync, name: string): string | null {
  const r = db.prepare("SELECT source_gz FROM skills WHERE name = ?").get(name) as { source_gz: Uint8Array | null } | undefined;
  if (!r?.source_gz) return null;
  try { return gunzipSync(Buffer.from(r.source_gz)).toString("utf-8"); }
  catch { return null; }
}

/**
 * FTS5 search. Returns up to `limit` hits ranked by bm25().
 * The query is sanitised: FTS5 operators (AND/OR/NOT/NEAR/*) survive,
 * but bare punctuation is replaced with spaces so a free-form query
 * like "battleye kernel" works as expected.
 */
export function searchSkills(db: DatabaseSync, query: string, limit = 20): SearchHit[] {
  const clean = query.replace(/["();:]/g, " ").trim();
  if (!clean) return [];
  const rows = db.prepare(
    `SELECT skills_fts.name AS name,
            skills_fts.description AS description,
            snippet(skills_fts, 3, '[', ']', '…', 10) AS snip,
            bm25(skills_fts) AS rnk
       FROM skills_fts
      WHERE skills_fts MATCH ?
      ORDER BY rnk
      LIMIT ?`,
  ).all(clean, limit) as Array<{ name: string; description: string | null; snip: string; rnk: number }>;
  return rows.map(r => ({ name: r.name, description: r.description, snippet: r.snip, rank: r.rnk }));
}

export function stats(db: DatabaseSync): Record<string, number | string> {
  const q = <T>(sql: string) => db.prepare(sql).get() as T;
  const asInt = (v: { c: number } | undefined) => v?.c ?? 0;
  return {
    skills:      asInt(q("SELECT COUNT(*) c FROM skills")),
    with_source: asInt(q("SELECT COUNT(*) c FROM skills WHERE source_gz IS NOT NULL")),
    plugins:     asInt(q("SELECT COUNT(*) c FROM plugins")),
    agents:      asInt(q("SELECT COUNT(*) c FROM agents")),
    subagents:   asInt(q("SELECT COUNT(*) c FROM subagents")),
    prompts:     asInt(q("SELECT COUNT(*) c FROM prompts")),
    built_at:    (q("SELECT value FROM meta WHERE key='built_at'") as { value: string } | undefined)?.value ?? "unknown",
  };
}

export function listPlugins(db: DatabaseSync, category?: string): Array<{ category: string; name: string; path: string | null }> {
  const sql = category
    ? "SELECT category, name, path FROM plugins WHERE category = ? ORDER BY name"
    : "SELECT category, name, path FROM plugins ORDER BY category, name";
  return (category ? db.prepare(sql).all(category) : db.prepare(sql).all()) as Array<{ category: string; name: string; path: string | null }>;
}

export function getPlugin(db: DatabaseSync, category: string, name: string): { path: string | null; body: string } | null {
  const r = db.prepare("SELECT path, body FROM plugins WHERE category = ? AND name = ?").get(category, name) as { path: string | null; body: string } | undefined;
  return r ?? null;
}

export function listAgents(db: DatabaseSync, table: "agents" | "subagents"): string[] {
  const rows = db.prepare(`SELECT name FROM ${table} ORDER BY name`).all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

export function getAgentBody(db: DatabaseSync, table: "agents" | "subagents", name: string): string | null {
  const r = db.prepare(`SELECT body FROM ${table} WHERE name = ?`).get(name) as { body: string } | undefined;
  return r?.body ?? null;
}

export function listPrompts(db: DatabaseSync, category?: string): Array<{ category: string; name: string }> {
  const sql = category
    ? "SELECT category, name FROM prompts WHERE category = ? ORDER BY name"
    : "SELECT category, name FROM prompts ORDER BY category, name";
  return (category ? db.prepare(sql).all(category) : db.prepare(sql).all()) as Array<{ category: string; name: string }>;
}

export function getPromptBody(db: DatabaseSync, category: string, name: string): string | null {
  const r = db.prepare("SELECT body FROM prompts WHERE category = ? AND name = ?").get(category, name) as { body: string } | undefined;
  return r?.body ?? null;
}

// ---- write side (used by scripts/build-db.mjs via dynamic import) ----

export function insertSkill(db: DatabaseSync, s: {
  name: string; description: string | null; type: string | null;
  topics: string[]; body: string;
  source_gz?: Uint8Array | null; source_sha?: string | null;
}): void {
  db.prepare(
    "INSERT OR REPLACE INTO skills(name, description, type, topics_json, body, source_gz, source_sha) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(
    s.name, s.description, s.type, JSON.stringify(s.topics ?? []), s.body,
    s.source_gz ?? null, s.source_sha ?? null,
  );
}

export function insertPlugin(db: DatabaseSync, p: { category: string; name: string; path: string | null; body: string }): void {
  db.prepare("INSERT OR REPLACE INTO plugins(category, name, path, body) VALUES (?, ?, ?, ?)")
    .run(p.category, p.name, p.path, p.body);
}

export function insertAgent(db: DatabaseSync, table: "agents" | "subagents", name: string, body: string): void {
  db.prepare(`INSERT OR REPLACE INTO ${table}(name, body) VALUES (?, ?)`).run(name, body);
}

export function insertPrompt(db: DatabaseSync, category: string, name: string, body: string): void {
  db.prepare("INSERT OR REPLACE INTO prompts(category, name, body) VALUES (?, ?, ?)").run(category, name, body);
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(key, value);
}
