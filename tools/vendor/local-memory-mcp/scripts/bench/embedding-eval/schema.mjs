import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export function createBenchDb(dbPath) {
	if (dbPath !== ":memory:") {
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	}
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("wal_autocheckpoint = 1000");
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
		CREATE TABLE IF NOT EXISTS queue_jobs (
			id TEXT PRIMARY KEY, entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, entity_repo TEXT NOT NULL DEFAULT '',
			payload TEXT NOT NULL DEFAULT '{}', content_hash TEXT, status TEXT NOT NULL DEFAULT 'pending',
			attempts INTEGER NOT NULL DEFAULT 0, lease_until TEXT, locked_by TEXT, backoff_until TEXT, last_error TEXT,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_jobs_entity ON queue_jobs(entity_kind, entity_id);
		CREATE INDEX IF NOT EXISTS idx_queue_jobs_claim ON queue_jobs(status, backoff_until, created_at);
		CREATE INDEX IF NOT EXISTS idx_queue_jobs_created_at ON queue_jobs(created_at);
		CREATE INDEX IF NOT EXISTS idx_memories_owner_repo ON memories(owner, repo);
	`);
	return db;
}
