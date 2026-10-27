import { TABLE_MEMORIES, TABLE_TASKS, TABLE_ACTION_LOG } from "../../utils/constants";
import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 5,
	name: "composite-owner-repo-indexes",
	up: (db) => {
		db.exec(`
				CREATE INDEX IF NOT EXISTS idx_memories_owner_repo ON ${TABLE_MEMORIES}(owner, repo);
				CREATE INDEX IF NOT EXISTS idx_memories_owner_repo_type ON ${TABLE_MEMORIES}(owner, repo, type);
				CREATE INDEX IF NOT EXISTS idx_memories_owner_repo_importance ON ${TABLE_MEMORIES}(owner, repo, importance);
				CREATE INDEX IF NOT EXISTS idx_tasks_owner_repo ON ${TABLE_TASKS}(owner, repo);
				CREATE INDEX IF NOT EXISTS idx_tasks_owner_repo_status ON ${TABLE_TASKS}(owner, repo, status);
				CREATE INDEX IF NOT EXISTS idx_action_log_owner_repo ON ${TABLE_ACTION_LOG}(owner, repo);
			`);
		logger.info("[Migration] Added composite (owner, repo) indexes for memories, tasks, action_log");
	}
};
