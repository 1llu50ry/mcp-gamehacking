import { TABLE_MEMORIES } from "../../utils/constants";
import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 14,
	name: "normalized-tag-indexes",
	up: (db) => {
		// ──────────────────────────────────────────────
		// OPT-PERF-07: replace unindexable `LIKE '%tag%'` scans for the
		// tag/stack FILTER paths with normalized child tables exposing an
		// indexed equality lookup. The JSON arrays in the parent columns
		// (memories.tags, coding_standards.tags, coding_standards.stack)
		// remain the single source of truth + stored tag representation,
		// so every existing read path that parses them stays intact.
		//
		// `tag`/`stack` are stored `COLLATE NOCASE` so an equality
		// predicate (`t.tag = ?`) is case-insensitive — matching SQLite's
		// default ASCII case-insensitive LIKE that it replaces — AND still
		// hits idx_memory_tags_tag / idx_standard_tags_tag for index-scoped
		// lookups instead of a scan.
		//
		// Sync strategy mirrors the memories_fts / coding_standards_fts
		// (v4/v10) pattern: AFTER INSERT syncs, AFTER UPDATE deletes +
		// recreates (guarded by `WHEN new.tags IS NOT old.tags` so
		// non-tag updates like hit_count/status skip the re-sync), DELETE
		// cascades via the FK (PRAGMA foreign_keys=ON, sqlite.ts). Every
		// write path (create/update/bulk + dashboard import) lands on the
		// parent table through the entities, so the triggers keep the child
		// tables consistent without touching any call site.
		// `json_each`/`json_valid` are stdlib JSON1 functions bundled in
		// better-sqlite3.
		//
		// CONFLICT STRATEGY (TASK-163): child inserts use `INSERT OR
		// IGNORE` — identical to the backfill — because the write path does
		// NOT dedupe tags (zod is `z.array(z.string())`, entities persist
		// `JSON.stringify(tags)` verbatim). The NOCASE child PK therefore
		// dedupes exact duplicates (`["foo","foo"]`) and case-variant
		// duplicates (`["TypeScript","typescript"]`) without failing the
		// parent write. Any duplicate tag is a no-op on the child index.
		//
		// ROLLBACK: DROP the three triggers + the three tables + the three
		// child indexes; the LIKE filters remain as the permanent fallback.
		// ──────────────────────────────────────────────
		db.exec(`
				CREATE TABLE IF NOT EXISTS memory_tags (
					memory_id TEXT NOT NULL,
					tag TEXT NOT NULL COLLATE NOCASE,
					PRIMARY KEY (memory_id, tag),
					FOREIGN KEY (memory_id) REFERENCES ${TABLE_MEMORIES}(id) ON DELETE CASCADE
				);
				CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag);

				CREATE TABLE IF NOT EXISTS standard_tags (
					standard_id TEXT NOT NULL,
					tag TEXT NOT NULL COLLATE NOCASE,
					PRIMARY KEY (standard_id, tag),
					FOREIGN KEY (standard_id) REFERENCES coding_standards(id) ON DELETE CASCADE
				);
				CREATE INDEX IF NOT EXISTS idx_standard_tags_tag ON standard_tags(tag);

				CREATE TABLE IF NOT EXISTS standard_stack (
					standard_id TEXT NOT NULL,
					stack TEXT NOT NULL COLLATE NOCASE,
					PRIMARY KEY (standard_id, stack),
					FOREIGN KEY (standard_id) REFERENCES coding_standards(id) ON DELETE CASCADE
				);
				CREATE INDEX IF NOT EXISTS idx_standard_stack_stack ON standard_stack(stack);

				-- memory_tags sync triggers
				DROP TRIGGER IF EXISTS memory_tags_ai;
				DROP TRIGGER IF EXISTS memory_tags_au;
				CREATE TRIGGER memory_tags_ai AFTER INSERT ON ${TABLE_MEMORIES} BEGIN
					INSERT OR IGNORE INTO memory_tags (memory_id, tag)
					SELECT new.id, j.value FROM json_each(CASE WHEN json_valid(new.tags) THEN new.tags ELSE '[]' END) j
					WHERE j.value IS NOT NULL AND j.value <> '';
				END;
				CREATE TRIGGER memory_tags_au AFTER UPDATE ON ${TABLE_MEMORIES}
					WHEN new.tags IS NOT old.tags BEGIN
					DELETE FROM memory_tags WHERE memory_id = new.id;
					INSERT OR IGNORE INTO memory_tags (memory_id, tag)
					SELECT new.id, j.value FROM json_each(CASE WHEN json_valid(new.tags) THEN new.tags ELSE '[]' END) j
					WHERE j.value IS NOT NULL AND j.value <> '';
				END;

				-- standard_stack + standard_tags sync triggers
				DROP TRIGGER IF EXISTS standard_stack_ai;
				DROP TRIGGER IF EXISTS standard_stack_au;
				DROP TRIGGER IF EXISTS standard_tags_ai;
				DROP TRIGGER IF EXISTS standard_tags_au;
				CREATE TRIGGER standard_stack_ai AFTER INSERT ON coding_standards BEGIN
					INSERT OR IGNORE INTO standard_stack (standard_id, stack)
					SELECT new.id, j.value FROM json_each(CASE WHEN json_valid(new.stack) THEN new.stack ELSE '[]' END) j
					WHERE j.value IS NOT NULL AND j.value <> '';
				END;
				CREATE TRIGGER standard_stack_au AFTER UPDATE ON coding_standards
					WHEN new.stack IS NOT old.stack BEGIN
					DELETE FROM standard_stack WHERE standard_id = new.id;
					INSERT OR IGNORE INTO standard_stack (standard_id, stack)
					SELECT new.id, j.value FROM json_each(CASE WHEN json_valid(new.stack) THEN new.stack ELSE '[]' END) j
					WHERE j.value IS NOT NULL AND j.value <> '';
				END;
				CREATE TRIGGER standard_tags_ai AFTER INSERT ON coding_standards BEGIN
					INSERT OR IGNORE INTO standard_tags (standard_id, tag)
					SELECT new.id, j.value FROM json_each(CASE WHEN json_valid(new.tags) THEN new.tags ELSE '[]' END) j
					WHERE j.value IS NOT NULL AND j.value <> '';
				END;
				CREATE TRIGGER standard_tags_au AFTER UPDATE ON coding_standards
					WHEN new.tags IS NOT old.tags BEGIN
					DELETE FROM standard_tags WHERE standard_id = new.id;
					INSERT OR IGNORE INTO standard_tags (standard_id, tag)
					SELECT new.id, j.value FROM json_each(CASE WHEN json_valid(new.tags) THEN new.tags ELSE '[]' END) j
					WHERE j.value IS NOT NULL AND j.value <> '';
				END;
			`);

		// Backfill pre-existing rows (idempotent — child PK is (parent_id,
		// value); INSERT OR IGNORE skips already-present pairs on re-run).
		const memoriesBackfill = db
			.prepare(
				`INSERT OR IGNORE INTO memory_tags (memory_id, tag)
					 SELECT m.id, j.value FROM ${TABLE_MEMORIES} m
					 CROSS JOIN json_each(CASE WHEN json_valid(m.tags) THEN m.tags ELSE '[]' END) j
					 WHERE j.value IS NOT NULL AND j.value <> ''`
			)
			.run();
		logger.info(`[Migration] Backfilled ${memoriesBackfill.changes} memory_tag row(s)`);

		const standardTagsBackfill = db
			.prepare(
				`INSERT OR IGNORE INTO standard_tags (standard_id, tag)
					 SELECT c.id, j.value FROM coding_standards c
					 CROSS JOIN json_each(CASE WHEN json_valid(c.tags) THEN c.tags ELSE '[]' END) j
					 WHERE j.value IS NOT NULL AND j.value <> ''`
			)
			.run();
		logger.info(`[Migration] Backfilled ${standardTagsBackfill.changes} standard_tag row(s)`);

		const standardStackBackfill = db
			.prepare(
				`INSERT OR IGNORE INTO standard_stack (standard_id, stack)
					 SELECT c.id, j.value FROM coding_standards c
					 CROSS JOIN json_each(CASE WHEN json_valid(c.stack) THEN c.stack ELSE '[]' END) j
					 WHERE j.value IS NOT NULL AND j.value <> ''`
			)
			.run();
		logger.info(`[Migration] Backfilled ${standardStackBackfill.changes} standard_stack row(s)`);

		logger.info("[Migration] Added normalized tag index tables (memory_tags, standard_tags, standard_stack)");
	}
};
