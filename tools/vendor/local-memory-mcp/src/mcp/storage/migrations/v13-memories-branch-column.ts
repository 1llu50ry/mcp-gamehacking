import { TABLE_MEMORIES } from "../../utils/constants";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 13,
	name: "memories-branch-column",
	up: (db) => {
		// Complete the MemoryScope.branch round-trip (TASK-121 / review
		// finding): memory-write accepts scope.branch and memory.read boosts
		// same-branch matches, but the column never existed, so branch was
		// silently dropped at write and rowToMemoryEntry's mapping could
		// never produce a value. Mirrors the code-column migration (v2)
		// idempotency pattern: PRAGMA table_info guard before ALTER so the
		// migration is safe to re-run and on fresh DBs (v1 creates the
		// table without branch, v13 adds it).
		const memoriesCols = db.prepare(`PRAGMA table_info(${TABLE_MEMORIES})`).all() as Array<{ name: string }>;
		if (!memoriesCols.some((col) => col.name === "branch")) {
			db.prepare(`ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN branch TEXT`).run();
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_memories_branch ON ${TABLE_MEMORIES}(branch)`).run();
		}
	}
};
