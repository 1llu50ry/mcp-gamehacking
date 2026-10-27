import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 9,
	name: "embedding-queue-jobs",
	up: (db) => {
		// SQLite-backed outbox for the embedding/KG worker (TASK-013 / MEM-368).
		// One row per entity (LWW coalescing via the partial unique index):
		// re-enqueue upserts the row, replacing the snapshot payload and
		// resetting to `pending` — the worker always processes the newest
		// write. `payload` carries the full enqueue-time snapshot so the
		// worker never re-reads (and races) the entity row.
		db.exec(`
        CREATE TABLE IF NOT EXISTS queue_jobs (
          id TEXT PRIMARY KEY,
          entity_kind TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          entity_repo TEXT NOT NULL DEFAULT '',
          payload TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          lease_until TEXT,
          locked_by TEXT,
          backoff_until TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_jobs_entity ON queue_jobs(entity_kind, entity_id);
        CREATE INDEX IF NOT EXISTS idx_queue_jobs_claim ON queue_jobs(status, backoff_until, created_at);
        CREATE INDEX IF NOT EXISTS idx_queue_jobs_created_at ON queue_jobs(created_at);
      `);

		// Observation idempotency (P2 acceptance: zero duplicate observations).
		// KG extraction can legitimately re-run after a crash-window lease
		// recovery; a unique (entity_name, observation) key + INSERT OR IGNORE
		// (see KnowledgeGraphEntity.insertObservation) makes that idempotent.
		// Dedupe any legacy duplicates first so the unique index can be built.
		const dup = db
			.prepare(
				`SELECT COUNT(*) AS c FROM (
             SELECT entity_name, observation, COUNT(*) AS cnt
             FROM observations
             GROUP BY entity_name, observation
             HAVING cnt > 1
           )`
			)
			.get() as { c: number };
		if (dup.c > 0) {
			const removed = db
				.prepare(
					`DELETE FROM observations
             WHERE id NOT IN (
               SELECT MIN(id) FROM observations GROUP BY entity_name, observation
             )`
				)
				.run();
			logger.info(`[Migration] Deduplicated ${removed.changes} duplicate observation(s) for idempotency`);
		}
		db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_observations_dedup ON observations(entity_name, observation)");

		logger.info("[Migration] Added queue_jobs table + observations dedup index");
	}
};
