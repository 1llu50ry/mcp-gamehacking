import { logger } from "../../utils/logger";
import {
	TABLE_MEMORIES,
	TABLE_TASKS,
	TABLE_HANDOFFS,
	TABLE_CLAIMS,
	TABLE_ACTION_LOG,
	TABLE_MEMORY_SUMMARY
} from "../../utils/constants";
import type { Migration } from "./index";
import {
	dropObsoleteMemoriesFts,
	ensureMemoryTypeConstraint,
	ensureMemoryStatusConstraintRemoved,
	ensureTaskStatusConstraintRemoved
} from "./v01-helpers";

export const migration: Migration = {
	version: 1,
	name: "initial-schema",
	up: (db) => {
		// ──────────────────────────────────────────────
		// All base tables + indexes
		// ──────────────────────────────────────────────
		db.exec(`
        CREATE TABLE IF NOT EXISTS ${TABLE_MEMORIES} (
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
          agent TEXT NOT NULL DEFAULT 'unknown',
          role TEXT NOT NULL DEFAULT 'unknown',
          model TEXT NOT NULL DEFAULT 'unknown',
          completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_memories_repo ON ${TABLE_MEMORIES}(repo);
        CREATE INDEX IF NOT EXISTS idx_memories_type ON ${TABLE_MEMORIES}(type);
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON ${TABLE_MEMORIES}(importance);
        CREATE INDEX IF NOT EXISTS idx_memories_hit_count ON ${TABLE_MEMORIES}(hit_count);
        CREATE INDEX IF NOT EXISTS idx_memories_created_at ON ${TABLE_MEMORIES}(created_at);
        CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON ${TABLE_MEMORIES}(updated_at);
        CREATE INDEX IF NOT EXISTS idx_memories_repo_created_at ON ${TABLE_MEMORIES}(repo, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_repo_hit_count ON ${TABLE_MEMORIES}(repo, hit_count DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_title ON ${TABLE_MEMORIES}(title);

        CREATE TABLE IF NOT EXISTS ${TABLE_MEMORY_SUMMARY} (
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (owner, repo)
        );

        CREATE TABLE IF NOT EXISTS memory_vectors (
          memory_id TEXT PRIMARY KEY,
          vector TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES ${TABLE_MEMORIES}(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ${TABLE_TASKS} (
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

        CREATE INDEX IF NOT EXISTS idx_tasks_repo ON ${TABLE_TASKS}(repo);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON ${TABLE_TASKS}(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_phase ON ${TABLE_TASKS}(phase);
        CREATE INDEX IF NOT EXISTS idx_tasks_priority ON ${TABLE_TASKS}(priority);
        CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON ${TABLE_TASKS}(created_at);

        CREATE TABLE IF NOT EXISTS task_comments (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          comment TEXT NOT NULL,
          agent TEXT NOT NULL DEFAULT 'unknown',
          role TEXT NOT NULL DEFAULT 'unknown',
          model TEXT NOT NULL DEFAULT 'unknown',
          previous_status TEXT,
          next_status TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (task_id) REFERENCES ${TABLE_TASKS}(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_comments_repo ON task_comments(repo);
        CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at DESC);

        CREATE TABLE IF NOT EXISTS coding_standards (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          parent_id TEXT,
          context TEXT,
          version TEXT,
          language TEXT,
          stack TEXT,
          is_global INTEGER NOT NULL DEFAULT 0,
          repo TEXT,
          owner TEXT NOT NULL DEFAULT '',
          tags TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          agent TEXT NOT NULL DEFAULT 'unknown',
          model TEXT NOT NULL DEFAULT 'unknown',
          FOREIGN KEY (parent_id) REFERENCES coding_standards(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_coding_standards_repo ON coding_standards(repo);
        CREATE INDEX IF NOT EXISTS idx_coding_standards_is_global ON coding_standards(is_global);
        CREATE INDEX IF NOT EXISTS idx_coding_standards_language ON coding_standards(language);

        CREATE TABLE IF NOT EXISTS standard_vectors (
          standard_id TEXT PRIMARY KEY,
          vector TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          vector_version INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (standard_id) REFERENCES coding_standards(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memories_archive (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          importance INTEGER NOT NULL,
          folder TEXT,
          language TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 0,
          recall_count INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          expires_at TEXT,
          archived_at TEXT NOT NULL,
          agent TEXT NOT NULL DEFAULT 'unknown',
          role TEXT NOT NULL DEFAULT 'unknown',
          model TEXT NOT NULL DEFAULT 'unknown',
          completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS ${TABLE_ACTION_LOG} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          query TEXT,
          response TEXT,
          memory_id TEXT,
          task_id TEXT,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          result_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_action_log_repo ON ${TABLE_ACTION_LOG}(repo);
        CREATE INDEX IF NOT EXISTS idx_action_log_created_at ON ${TABLE_ACTION_LOG}(created_at);

        CREATE TABLE IF NOT EXISTS ${TABLE_HANDOFFS} (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          from_agent TEXT NOT NULL,
          to_agent TEXT,
          task_id TEXT,
          summary TEXT NOT NULL,
          context TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT,
          FOREIGN KEY (task_id) REFERENCES ${TABLE_TASKS}(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_handoffs_repo ON ${TABLE_HANDOFFS}(repo);
        CREATE INDEX IF NOT EXISTS idx_handoffs_status ON ${TABLE_HANDOFFS}(status);
        CREATE INDEX IF NOT EXISTS idx_handoffs_from_agent ON ${TABLE_HANDOFFS}(from_agent);
        CREATE INDEX IF NOT EXISTS idx_handoffs_to_agent ON ${TABLE_HANDOFFS}(to_agent);
        CREATE INDEX IF NOT EXISTS idx_handoffs_task_id ON ${TABLE_HANDOFFS}(task_id);
        CREATE INDEX IF NOT EXISTS idx_handoffs_created_at ON ${TABLE_HANDOFFS}(created_at);

        CREATE TABLE IF NOT EXISTS ${TABLE_CLAIMS} (
          id TEXT PRIMARY KEY,
          repo TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          task_id TEXT NOT NULL,
          agent TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'unknown',
          claimed_at TEXT NOT NULL,
          released_at TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY (task_id) REFERENCES ${TABLE_TASKS}(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_claims_repo ON ${TABLE_CLAIMS}(repo);
        CREATE INDEX IF NOT EXISTS idx_claims_task_id ON ${TABLE_CLAIMS}(task_id);
        CREATE INDEX IF NOT EXISTS idx_claims_agent ON ${TABLE_CLAIMS}(agent);
        CREATE INDEX IF NOT EXISTS idx_claims_claimed_at ON ${TABLE_CLAIMS}(claimed_at);

        CREATE TABLE IF NOT EXISTS entities (
          name TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'unknown',
          description TEXT,
          repo TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
        CREATE INDEX IF NOT EXISTS idx_entities_repo ON entities(repo);

        CREATE TABLE IF NOT EXISTS relations (
          from_entity TEXT NOT NULL,
          to_entity TEXT NOT NULL,
          relation_type TEXT NOT NULL,
          repo TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          PRIMARY KEY (from_entity, to_entity, relation_type),
          FOREIGN KEY (from_entity) REFERENCES entities(name) ON DELETE CASCADE,
          FOREIGN KEY (to_entity) REFERENCES entities(name) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity);
        CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity);
        CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);
        CREATE INDEX IF NOT EXISTS idx_relations_repo ON relations(repo);

        CREATE TABLE IF NOT EXISTS observations (
          id TEXT PRIMARY KEY,
          entity_name TEXT NOT NULL,
          observation TEXT NOT NULL,
          repo TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY (entity_name) REFERENCES entities(name) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_observations_entity ON observations(entity_name);
        CREATE INDEX IF NOT EXISTS idx_observations_repo ON observations(repo);
        CREATE INDEX IF NOT EXISTS idx_observations_created_at ON observations(created_at);

        CREATE TABLE IF NOT EXISTS codebase_files (
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

        CREATE UNIQUE INDEX IF NOT EXISTS idx_codebase_files_repo_path ON codebase_files(repo, file_path);
        CREATE INDEX IF NOT EXISTS idx_codebase_files_repo_indexed ON codebase_files(repo, last_indexed_at);

        CREATE TABLE IF NOT EXISTS codebase_symbols (
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
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (parent_symbol_id) REFERENCES codebase_symbols(id)
        );

        CREATE INDEX IF NOT EXISTS idx_cs_repo_name ON codebase_symbols(repo, name);
        CREATE INDEX IF NOT EXISTS idx_cs_repo_file ON codebase_symbols(repo, file_path);
        CREATE INDEX IF NOT EXISTS idx_cs_repo_kind ON codebase_symbols(repo, kind);
        CREATE INDEX IF NOT EXISTS idx_cs_name ON codebase_symbols(name);
        CREATE INDEX IF NOT EXISTS idx_cs_parent ON codebase_symbols(parent_symbol_id);
      `);

		// ──────────────────────────────────────────────
		// FTS5 for codebase_symbols
		// ──────────────────────────────────────────────
		const ftsExists = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='codebase_symbols_fts'")
			.get();
		if (!ftsExists) {
			db.exec(`
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
        `);
		}

		// ──────────────────────────────────────────────
		// Legacy column additions (idempotent)
		// ──────────────────────────────────────────────
		const columnsToAdd: Array<{ name: string; table: string; definition: string }> = [
			{ name: "title", table: TABLE_MEMORIES, definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN title TEXT` },
			{
				name: "hit_count",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0`
			},
			{
				name: "recall_count",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0`
			},
			{
				name: "last_used_at",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN last_used_at TEXT`
			},
			{
				name: "expires_at",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN expires_at TEXT`
			},
			{
				name: "supersedes",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN supersedes TEXT`
			},
			{
				name: "status",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`
			},
			{
				name: "is_global",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN is_global INTEGER NOT NULL DEFAULT 0`
			},
			{ name: "tags", table: TABLE_MEMORIES, definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN tags TEXT` },
			{
				name: "metadata",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN metadata TEXT`
			},
			{
				name: "vector_version",
				table: "memory_vectors",
				definition: "ALTER TABLE memory_vectors ADD COLUMN vector_version INTEGER NOT NULL DEFAULT 1"
			},
			{
				name: "parent_id",
				table: "coding_standards",
				definition: "ALTER TABLE coding_standards ADD COLUMN parent_id TEXT"
			},
			{
				name: "hit_count",
				table: "coding_standards",
				definition: "ALTER TABLE coding_standards ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0"
			},
			{
				name: "last_used_at",
				table: "coding_standards",
				definition: "ALTER TABLE coding_standards ADD COLUMN last_used_at TEXT"
			},
			{
				name: "depends_on",
				table: TABLE_TASKS,
				definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN depends_on TEXT`
			},
			{
				name: "est_tokens",
				table: TABLE_TASKS,
				definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN est_tokens INTEGER NOT NULL DEFAULT 0`
			},
			{
				name: "in_progress_at",
				table: TABLE_TASKS,
				definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN in_progress_at TEXT`
			},
			{ name: "task_code", table: TABLE_TASKS, definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN task_code TEXT` },
			{
				name: "task_id",
				table: TABLE_ACTION_LOG,
				definition: `ALTER TABLE ${TABLE_ACTION_LOG} ADD COLUMN task_id TEXT`
			},
			{
				name: "agent",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN agent TEXT NOT NULL DEFAULT 'unknown'`
			},
			{
				name: "role",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN role TEXT NOT NULL DEFAULT 'unknown'`
			},
			{
				name: "model",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN model TEXT NOT NULL DEFAULT 'unknown'`
			},
			{
				name: "completed_at",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN completed_at TEXT`
			},
			{
				name: "agent",
				table: TABLE_TASKS,
				definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN agent TEXT NOT NULL DEFAULT 'unknown'`
			},
			{
				name: "role",
				table: TABLE_TASKS,
				definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN role TEXT NOT NULL DEFAULT 'unknown'`
			},
			{ name: "doc_path", table: TABLE_TASKS, definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN doc_path TEXT` },
			{
				name: "response",
				table: TABLE_ACTION_LOG,
				definition: `ALTER TABLE ${TABLE_ACTION_LOG} ADD COLUMN response TEXT`
			},
			{
				name: "commit_id",
				table: TABLE_TASKS,
				definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN commit_id TEXT`
			},
			{
				name: "changed_files",
				table: TABLE_TASKS,
				definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN changed_files TEXT`
			},
			{
				name: "suggested_skills",
				table: TABLE_TASKS,
				definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN suggested_skills TEXT`
			},
			{
				name: "owner",
				table: TABLE_MEMORIES,
				definition: `ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN owner TEXT NOT NULL DEFAULT ''`
			},
			{
				name: "owner",
				table: TABLE_TASKS,
				definition: `ALTER TABLE ${TABLE_TASKS} ADD COLUMN owner TEXT NOT NULL DEFAULT ''`
			},
			{
				name: "owner",
				table: "task_comments",
				definition: "ALTER TABLE task_comments ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
			},
			{
				name: "owner",
				table: "coding_standards",
				definition: "ALTER TABLE coding_standards ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
			},
			{
				name: "owner",
				table: "memories_archive",
				definition: "ALTER TABLE memories_archive ADD COLUMN owner TEXT NOT NULL DEFAULT ''"
			},
			{
				name: "owner",
				table: TABLE_ACTION_LOG,
				definition: `ALTER TABLE ${TABLE_ACTION_LOG} ADD COLUMN owner TEXT NOT NULL DEFAULT ''`
			},
			{
				name: "owner",
				table: TABLE_HANDOFFS,
				definition: `ALTER TABLE ${TABLE_HANDOFFS} ADD COLUMN owner TEXT NOT NULL DEFAULT ''`
			},
			{
				name: "owner",
				table: TABLE_CLAIMS,
				definition: `ALTER TABLE ${TABLE_CLAIMS} ADD COLUMN owner TEXT NOT NULL DEFAULT ''`
			},
			{
				name: "owner",
				table: TABLE_MEMORY_SUMMARY,
				definition: `ALTER TABLE ${TABLE_MEMORY_SUMMARY} ADD COLUMN owner TEXT NOT NULL DEFAULT ''`
			}
		];

		for (const col of columnsToAdd) {
			try {
				const tableInfo = db.prepare(`PRAGMA table_info(${col.table})`).all() as Array<{ name: string }>;
				const existingTableColumns = tableInfo.map((c) => c.name);

				if (tableInfo.length > 0 && !existingTableColumns.includes(col.name)) {
					db.exec(col.definition);
				}
			} catch {
				// Ignore errors - column might already exist or table doesn't exist
			}
		}

		// ──────────────────────────────────────────────
		// Constraint migrations
		// ──────────────────────────────────────────────
		ensureMemoryTypeConstraint(db);
		ensureTaskStatusConstraintRemoved(db);
		ensureMemoryStatusConstraintRemoved(db);

		// ──────────────────────────────────────────────
		// Additional indexes
		// ──────────────────────────────────────────────
		db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memories_status ON ${TABLE_MEMORIES}(status);
        CREATE INDEX IF NOT EXISTS idx_memories_supersedes ON ${TABLE_MEMORIES}(supersedes);
        CREATE INDEX IF NOT EXISTS idx_memories_is_global ON ${TABLE_MEMORIES}(is_global);
        CREATE INDEX IF NOT EXISTS idx_coding_standards_hit_count ON coding_standards(hit_count);
      `);

		// ──────────────────────────────────────────────
		// Task code deduplication + unique index
		// ──────────────────────────────────────────────
		const dupRows = db
			.prepare(
				`SELECT owner, repo, task_code, COUNT(*) as cnt
           FROM ${TABLE_TASKS}
           GROUP BY owner, repo, task_code
           HAVING cnt > 1`
			)
			.all() as Array<{ owner: string; repo: string; task_code: string; cnt: number }>;

		if (dupRows.length > 0) {
			logger.info(`Found ${dupRows.length} duplicate task_code(s). Deduplicating by suffix...`);
			for (const dup of dupRows) {
				const rows = db
					.prepare(
						`SELECT id, task_code, created_at FROM ${TABLE_TASKS}
               WHERE owner = ? AND repo = ? AND task_code = ?
               ORDER BY created_at ASC, id ASC`
					)
					.all(dup.owner, dup.repo, dup.task_code) as Array<{
					id: string;
					task_code: string;
					created_at: string;
				}>;

				for (let i = 1; i < rows.length; i++) {
					const newCode = `${dup.task_code}-${i + 1}`;
					db.prepare(`UPDATE ${TABLE_TASKS} SET task_code = ? WHERE id = ?`).run(newCode, rows[i].id);
				}
				logger.info(`  Deduplicated ${dup.task_code}: kept 1 (${rows[0].id}), renamed ${rows.length - 1} rows`);
			}
		}

		db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_code_owner_repo ON ${TABLE_TASKS}(owner, repo, task_code);`);
		db.exec("DROP INDEX IF EXISTS idx_tasks_code;");

		try {
			db.prepare(`UPDATE ${TABLE_TASKS} SET task_code = substr(id, 1, 8) WHERE task_code IS NULL`).run();
		} catch {
			// Ignore if column doesn't exist
		}

		// ──────────────────────────────────────────────
		// Drop obsolete memories_fts
		// ──────────────────────────────────────────────
		dropObsoleteMemoriesFts(db);
	}
};
