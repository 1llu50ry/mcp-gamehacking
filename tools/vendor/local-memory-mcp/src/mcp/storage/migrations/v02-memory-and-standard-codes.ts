import { TABLE_MEMORIES } from "../../utils/constants";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 2,
	name: "memory-and-standard-codes",
	up: (db) => {
		// code column on memories
		const memoriesCols = db.prepare(`PRAGMA table_info(${TABLE_MEMORIES})`).all() as Array<{ name: string }>;
		if (!memoriesCols.some((col) => col.name === "code")) {
			db.prepare(`ALTER TABLE ${TABLE_MEMORIES} ADD COLUMN code TEXT`).run();
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_memories_code ON ${TABLE_MEMORIES}(code)`).run();
			db.prepare(`CREATE INDEX IF NOT EXISTS idx_memories_repo_code ON ${TABLE_MEMORIES}(repo, code)`).run();
		}

		// code column on coding_standards
		const standardsCols = db.prepare("PRAGMA table_info(coding_standards)").all() as Array<{ name: string }>;
		if (!standardsCols.some((col) => col.name === "code")) {
			db.prepare("ALTER TABLE coding_standards ADD COLUMN code TEXT").run();
			db.prepare("CREATE INDEX IF NOT EXISTS idx_coding_standards_code ON coding_standards(code)").run();
			db.prepare("CREATE INDEX IF NOT EXISTS idx_coding_standards_repo_code ON coding_standards(repo, code)").run();
		}
	}
};
