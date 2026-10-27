import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 11,
	name: "queue-jobs-status-index",
	up: (db) => {
		// Serve the queue_jobs full scans (TASK-068 S4 / TASK-071):
		//   - countByStatus(): SELECT status, COUNT(*) ... GROUP BY status
		//   - purge(): DELETE ... WHERE status = ? AND updated_at < ?
		// idx_queue_jobs_claim(status, backoff_until, created_at) serves
		// claim()'s pending/expired branches but NOT the updated_at-driven
		// purge, so done/poison rows accumulated and every status poll
		// walked the whole table. This composite index covers both.
		db.exec("CREATE INDEX IF NOT EXISTS idx_queue_jobs_status_updated ON queue_jobs(status, updated_at)");
		logger.info("[Migration] Added idx_queue_jobs_status_updated (status, updated_at)");
	}
};
