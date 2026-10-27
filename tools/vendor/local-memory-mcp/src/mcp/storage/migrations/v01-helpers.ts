/**
 * Module-private idempotent schema helpers used by the v01 migration.
 *
 * Split out of `v01-initial-schema.ts` to keep that file under the 700-line
 * rule while preserving the byte-identical call sites in `up()`.
 */
import Database from "better-sqlite3";
import { logger } from "../../utils/logger";
import { TABLE_MEMORIES, TABLE_TASKS } from "../../utils/constants";

// ──────────────────────────────────────────────
// Helper functions (used by migrations)
// ──────────────────────────────────────────────

function dropObsoleteMemoriesFts(db: Database.Database): void {
	try {
		const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'").get();
		if (!exists) return;

		db.exec("DROP TRIGGER IF EXISTS memories_ai");
		db.exec("DROP TRIGGER IF EXISTS memories_ad");
		db.exec("DROP TRIGGER IF EXISTS memories_au");
		db.exec("DROP TABLE IF EXISTS memories_fts");

		logger.info("[Migration] Dropped obsolete memories_fts FTS5 table and sync triggers");
	} catch (err) {
		logger.warn("[Migration] Failed to drop memories_fts — may have been dropped already", {
			error: String(err)
		});
	}
}

function ensureMemoryTypeConstraint(db: Database.Database): void {
	const tableInfo = db
		.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${TABLE_MEMORIES}'`)
		.get() as { sql: string } | undefined;
	if (!tableInfo?.sql || !String(tableInfo.sql).includes("CHECK (type IN")) {
		return;
	}

	db.exec(`
    CREATE TABLE memories__migrated (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      owner TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
      folder TEXT,
      language TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      expires_at TEXT,
      supersedes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      is_global INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      metadata TEXT,
      agent TEXT NOT NULL DEFAULT 'unknown',
      role TEXT NOT NULL DEFAULT 'unknown',
      model TEXT NOT NULL DEFAULT 'unknown',
      completed_at TEXT
    );

    INSERT INTO memories__migrated (
      id, repo, owner, type, title, content, importance, folder, language,
      created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
      supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
    )
    SELECT
      id, repo, owner, type, title, content, importance, folder, language,
      created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
      supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
    FROM ${TABLE_MEMORIES};

    DROP TABLE ${TABLE_MEMORIES};
    ALTER TABLE memories__migrated RENAME TO ${TABLE_MEMORIES};
  `);
}

function ensureTaskStatusConstraintRemoved(db: Database.Database): void {
	const tableInfo = db
		.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${TABLE_TASKS}'`)
		.get() as { sql: string } | undefined;

	if (
		!tableInfo?.sql ||
		(!String(tableInfo.sql).includes("CHECK (status IN") && !String(tableInfo.sql).includes("DEFAULT 'pending'"))
	) {
		return;
	}

	db.exec(`
    CREATE TABLE tasks__migrated (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      owner TEXT NOT NULL DEFAULT '',
      task_code TEXT NOT NULL,
      phase TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'backlog',
      priority INTEGER NOT NULL DEFAULT 3,
      agent TEXT NOT NULL DEFAULT 'unknown',
      role TEXT NOT NULL DEFAULT 'unknown',
      doc_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      canceled_at TEXT,
      tags TEXT,
      metadata TEXT,
      parent_id TEXT,
      depends_on TEXT,
      est_tokens INTEGER NOT NULL DEFAULT 0,
      in_progress_at TEXT,
      commit_id TEXT,
      changed_files TEXT,
      FOREIGN KEY (parent_id) REFERENCES ${TABLE_TASKS}(id) ON DELETE SET NULL,
      FOREIGN KEY (depends_on) REFERENCES ${TABLE_TASKS}(id) ON DELETE SET NULL
    );

    INSERT INTO tasks__migrated (
      id, repo, owner, task_code, phase, title, description, status, priority,
      agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at,
      commit_id, changed_files
    )
    SELECT
      id, repo, owner, task_code, phase, title, description, status, priority,
      agent, role, doc_path, created_at, updated_at, finished_at, canceled_at, tags, metadata, parent_id, depends_on, est_tokens, in_progress_at,
      commit_id, changed_files
    FROM ${TABLE_TASKS};

    DROP TABLE ${TABLE_TASKS};
    ALTER TABLE tasks__migrated RENAME TO ${TABLE_TASKS};
  `);
}

function ensureMemoryStatusConstraintRemoved(db: Database.Database): void {
	const tableInfo = db
		.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${TABLE_MEMORIES}'`)
		.get() as { sql: string } | undefined;
	if (!tableInfo?.sql || !String(tableInfo.sql).includes("CHECK (status IN")) {
		return;
	}

	db.exec(`
    CREATE TABLE memories__migrated (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      owner TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
      folder TEXT,
      language TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      expires_at TEXT,
      supersedes TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      is_global INTEGER NOT NULL DEFAULT 0,
      tags TEXT,
      metadata TEXT,
      agent TEXT NOT NULL DEFAULT 'unknown',
      role TEXT NOT NULL DEFAULT 'unknown',
      model TEXT NOT NULL DEFAULT 'unknown',
      completed_at TEXT
    );

    INSERT INTO memories__migrated (
      id, repo, owner, type, title, content, importance, folder, language,
      created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
      supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
    )
    SELECT
      id, repo, owner, type, title, content, importance, folder, language,
      created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
      supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
    FROM ${TABLE_MEMORIES};

    DROP TABLE ${TABLE_MEMORIES};
    ALTER TABLE memories__migrated RENAME TO ${TABLE_MEMORIES};
  `);
}

export {
	dropObsoleteMemoriesFts,
	ensureMemoryTypeConstraint,
	ensureTaskStatusConstraintRemoved,
	ensureMemoryStatusConstraintRemoved
};
