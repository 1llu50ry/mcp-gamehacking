import { logger } from "../../utils/logger";
import type { Migration } from "./index";

/**
 * v22 — Materialized KG degree cache (TASK-268 / audit F2).
 *
 * PROBLEM: the KG dashboard graph queries recomputed a degree CTE over ALL
 * of a repo's relations on EVERY request (`listGraphNodes`/`listGraphEdges`).
 * For edge-heavy repos (e.g. 852k relations) the CTE + full degree-ranked
 * sort ran ~23s warm / ~190s cold on the Node event loop (better-sqlite3 is
 * synchronous), blocking /api/health (408s) while it ran.
 *
 * FIX: persist per-(repo, node) degrees in `kg_degrees`, maintained
 * incrementally by triggers on `relations` INSERT/DELETE, and backfilled
 * once here. Graph reads then become index-driven lookups instead of
 * recomputed aggregates. Write cost: +2 upserts per relation row — a bounded
 * price for turning a pathological read path into O(window) lookups.
 *
 * Backfill strategy (2 passes instead of one UNION ALL):
 *   pass 1: GROUP BY (repo, from_entity)  — out-degree per node
 *   pass 2: GROUP BY (repo, to_entity)    — in-degree UPSERTed into pass 1
 *   (a self-loop counts twice, mirroring the old UNION ALL CTE semantics)
 * One-time cost on a 6.9M-relation DB ≈ 50s at first startup after upgrade.
 */
export const migration: Migration = {
	version: 22,
	name: "kg-degree-cache",
	up: (db) => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS kg_degrees (
				repo TEXT NOT NULL,
				node TEXT NOT NULL,
				degree INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (repo, node)
			) WITHOUT ROWID
		`);

		// Incremental maintenance — covers every write path (MCP tools, KG
		// archivist batches, dashboard CRUD, cascade deletes).
		db.exec(`
			CREATE TRIGGER IF NOT EXISTS trg_kg_degrees_ai AFTER INSERT ON relations BEGIN
				INSERT INTO kg_degrees (repo, node, degree) VALUES (NEW.repo, NEW.from_entity, 1)
					ON CONFLICT(repo, node) DO UPDATE SET degree = kg_degrees.degree + 1;
				INSERT INTO kg_degrees (repo, node, degree) VALUES (NEW.repo, NEW.to_entity, 1)
					ON CONFLICT(repo, node) DO UPDATE SET degree = kg_degrees.degree + 1;
			END;

			CREATE TRIGGER IF NOT EXISTS trg_kg_degrees_ad AFTER DELETE ON relations BEGIN
				UPDATE kg_degrees SET degree = degree - 1
					WHERE repo = OLD.repo AND node = OLD.from_entity AND degree > 0;
				UPDATE kg_degrees SET degree = degree - 1
					WHERE repo = OLD.repo AND node = OLD.to_entity AND degree > 0;
				DELETE FROM kg_degrees
					WHERE repo = OLD.repo AND (node = OLD.from_entity OR node = OLD.to_entity) AND degree = 0;
			END;
		`);

		// Idempotent backfill: only seed rows that are missing (fresh DBs and
		// re-runs are no-ops on the bulk of the work).
		const seeded = db.prepare("SELECT COUNT(*) AS c FROM kg_degrees").get() as { c: number };
		if (seeded.c === 0) {
			db.exec(`
				INSERT INTO kg_degrees (repo, node, degree)
				SELECT repo, from_entity AS node, COUNT(*) AS degree
				FROM relations
				GROUP BY repo, from_entity;

				INSERT INTO kg_degrees (repo, node, degree)
				SELECT repo, to_entity AS node, COUNT(*) AS degree
				FROM relations
				GROUP BY repo, to_entity
				ON CONFLICT(repo, node) DO UPDATE SET degree = kg_degrees.degree + excluded.degree;
			`);
			const backfilled = db.prepare("SELECT COUNT(*) AS c FROM kg_degrees").get() as { c: number };
			logger.info(`[Migration] Backfilled ${backfilled.c} (repo, node) degree row(s) into kg_degrees`);
		}
		logger.info("[Migration] Added kg_degrees degree cache + relations triggers (TASK-268)");
	}
};
