import { TABLE_MEMORIES } from "../../utils/constants";
import { logger } from "../../utils/logger";
import type { Migration } from "./index";

/**
 * v40 — UNIQUE (owner, repo, code) on memories (FIX-OWNER-CODEBASE).
 *
 * ── WHY ──────────────────────────────────────────────────────────────────
 *
 * `tasks` has carried `idx_tasks_code_owner_repo ON tasks(owner, repo,
 * task_code)` since v2, so a duplicate task code within one scope is rejected
 * at the storage layer. `memories` never got the equivalent: `memories.code`
 * is allocated per (owner, repo) by `generateNextCode`, and `resolveEntityCode`
 * *probes* for a clash via `getByCode`, but nothing at the storage layer stops
 * a duplicate from landing. On 2026-10-03 that gap bit the `favori-app` scope:
 * an out-of-band owner-merge script collapsed several owner variants onto
 * `vheins`, which left `MEM-001`×9 / `MEM-002`×4 / `MEM-003`×3 in
 * `(vheins, favori-app)`. `getByCode` is a `runner.get` on
 * `WHERE code=? AND ((owner=? AND repo=?) OR is_global=1)`, so it silently
 * returned the OLDEST row and every later memory became unreachable by code
 * (addressable only by UUID).
 *
 * This index restores parity with `tasks`: within a single `(owner, repo)`
 * scope a code is unique. It is defense-in-depth — the write path already
 * allocates distinct codes — but it turns a silent read-corruption class into
 * a hard constraint violation at the write that would cause it.
 *
 * ── SAFETY: NEVER BRICK STARTUP ──────────────────────────────────────────
 *
 * A `CREATE UNIQUE INDEX` on a table that still holds a duplicate aborts the
 * statement, which would roll back the whole migration transaction and fail
 * daemon startup for any user who ran a similar owner-merge. So this migration
 * is *conditional*: it counts duplicate `(owner, repo, code)` groups first and
 * only builds the index when that count is zero. When duplicates remain it
 * logs a warning (with the count) and skips — the DB stays usable and the
 * pre-existing collision is no worse than before. Operators repair the rows
 * (rename the losing duplicates) and the index is built on the next startup.
 *
 * NULL/empty codes are exempt by construction: SQLite treats NULLs as distinct
 * in a UNIQUE index, and rows with `code IS NULL` (legacy / non-sequential
 * writes) therefore never collide. `code = ''` is excluded from the dup probe
 * for the same reason a blank code is not a real identity.
 *
 * Idempotent: `CREATE UNIQUE INDEX IF NOT EXISTS` and a read-only dup probe, so
 * re-running after a crash mid-migration is a no-op.
 */
export const migration: Migration = {
	version: 40,
	name: "memories-code-owner-repo-unique",
	up: (db) => {
		const dup = db
			.prepare(
				`SELECT COUNT(*) AS groups, IFNULL(SUM(n), 0) AS rows FROM (
					SELECT COUNT(*) AS n FROM ${TABLE_MEMORIES}
					WHERE code IS NOT NULL AND code <> ''
					GROUP BY owner, repo, code
					HAVING COUNT(*) > 1
				)`
			)
			.get() as { groups: number; rows: number };

		if (dup.groups > 0) {
			logger.warn(
				`[Migration] Skipped UNIQUE idx_memories_code_owner_repo — ${dup.groups} duplicate (owner, repo, code) group(s) / ${dup.rows} row(s) still present. Rename the losing duplicates, then restart to build the index.`,
				{ groups: dup.groups, rows: dup.rows }
			);
			return;
		}

		db.exec(
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_code_owner_repo ON ${TABLE_MEMORIES}(owner, repo, code)`
		);
		logger.info("[Migration] Added UNIQUE idx_memories_code_owner_repo (owner, repo, code) — memories/tasks code parity");
	}
};
