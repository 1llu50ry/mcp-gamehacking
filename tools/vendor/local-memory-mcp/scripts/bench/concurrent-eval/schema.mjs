import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export function createConcurrentBenchDb(dbPath, opts = {}) {
	const busyTimeoutMs = opts.busyTimeoutMs ?? 2000;
	if (dbPath !== ":memory:") {
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	}
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma(`busy_timeout = ${busyTimeoutMs}`);
	db.pragma("wal_autocheckpoint = 1000");
	db.pragma("foreign_keys = ON");
	db.exec(`
		CREATE TABLE IF NOT EXISTS memories (
			id TEXT PRIMARY KEY, code TEXT, repo TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL, title TEXT, content TEXT NOT NULL, importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
			folder TEXT, language TEXT, branch TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
			hit_count INTEGER NOT NULL DEFAULT 0, recall_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT,
			agent TEXT NOT NULL DEFAULT 'unknown', role TEXT NOT NULL DEFAULT 'unknown', model TEXT NOT NULL DEFAULT 'unknown',
			completed_at TEXT, expires_at TEXT, supersedes TEXT, status TEXT NOT NULL DEFAULT 'active',
			is_global INTEGER NOT NULL DEFAULT 0, tags TEXT, metadata TEXT
		);
		CREATE TABLE IF NOT EXISTS memory_vectors (memory_id TEXT PRIMARY KEY, vector TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE);
		CREATE TABLE IF NOT EXISTS memory_tags (memory_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (memory_id, tag), FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE);
		CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag COLLATE NOCASE);
		CREATE INDEX IF NOT EXISTS idx_memories_repo ON memories(repo);
		CREATE INDEX IF NOT EXISTS idx_memories_owner_repo ON memories(owner, repo);
	`);
	const ftsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'").get();
	if (!ftsExists) {
		db.exec(`
			CREATE VIRTUAL TABLE memories_fts USING fts5(title, content, tags, content='memories', content_rowid='rowid', tokenize='unicode61');
			CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags); END;
			CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags); END;
			CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags); INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags); END;
		`);
	}
	return db;
}

export function buildFtsMatchQuery(raw) {
	if (!raw) return "";
	const trimmed = raw.trim();
	if (!trimmed) return "";
	const phrases = [];
	const phraseRanges = [];
	const re = /"([^"]+)"/g;
	let m;
	while ((m = re.exec(trimmed)) !== null) {
		const sanitized = (m[1] || "")
			.replace(/[^\p{L}\p{N}_\s]/gu, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (sanitized.length > 0) phrases.push(`"${sanitized}"`);
		phraseRanges.push({ start: m.index, end: m.index + m[0].length });
	}
	let remaining = "";
	let cursor = 0;
	for (const r of phraseRanges) {
		remaining += trimmed.slice(cursor, r.start) + " ";
		cursor = r.end;
	}
	remaining += trimmed.slice(cursor);
	const cleaned = remaining
		.replace(/["()*:~^+-]/g, " ")
		.replace(/[^\p{L}\p{N}_\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	const terms = cleaned
		.split(" ")
		.filter(Boolean)
		.map((t) => `${t}*`);
	const all = [...phrases, ...terms];
	if (all.length === 0) return "";
	return all.slice(0, 8).join(" AND ");
}
