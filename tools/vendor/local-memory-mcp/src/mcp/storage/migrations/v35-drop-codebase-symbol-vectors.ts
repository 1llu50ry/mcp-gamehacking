import { logger } from "../../utils/logger";
import type { Migration } from "./index";

/**
 * Drop the dead `codebase_symbol_vectors` table (TASK-042).
 *
 * The table was created in v06 for a codebase-symbol vector index, but it was
 * never populated: `upsertSymbolVector`/`deleteSymbolVectorsByFile` had zero
 * callers, the embedding-queue write path is an intentional NO-OP for
 * codebase_symbol jobs (TASK-293), and the only read (`getSymbolVectorsByRepo`)
 * served a guard that always observed an empty table. The symbol vector stage
 * now returns no candidates, so the table (and its implicit PK index) is pure
 * dead weight.
 *
 * Defensive by design: when the table is absent this is a no-op, and when it
 * somehow HOLDS rows the drop is skipped with a warning rather than destroying
 * unexpected data. Only the expected empty table is removed, via a plain
 * `DROP TABLE IF EXISTS`. Idempotent — safe on fresh DBs and after a crash
 * mid-migration (the runner re-runs unapplied versions).
 */
export const migration: Migration = {
	version: 35,
	name: "drop-codebase-symbol-vectors",
	up: (db) => {
		const exists = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codebase_symbol_vectors'")
			.get();
		if (!exists) {
			logger.debug("[Migration] codebase_symbol_vectors absent, nothing to drop");
			return;
		}

		const { rows } = db.prepare("SELECT COUNT(*) AS rows FROM codebase_symbol_vectors").get() as { rows: number };
		if (rows > 0) {
			logger.warn("[Migration] codebase_symbol_vectors is unexpectedly non-empty; skipping drop to avoid data loss", {
				rows
			});
			return;
		}

		db.exec("DROP TABLE IF EXISTS codebase_symbol_vectors");
		logger.info("[Migration] Dropped dead codebase_symbol_vectors table");
	}
};
