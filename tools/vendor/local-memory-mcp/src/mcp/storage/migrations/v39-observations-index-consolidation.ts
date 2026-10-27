import { logger } from "../../utils/logger";
import type { Migration } from "./index";

/**
 * v39 — observations index consolidation (PERF-007).
 *
 * ── DROP `idx_observations_entity (entity_name)` — REDUNDANT ─────────────
 *
 * `entity_name` is the LEFTMOST column of `idx_observations_dedup
 * (entity_name, observation, repo)`, a UNIQUE index created in v33 and kept by
 * every later schema version. Any `entity_name = ?` predicate is therefore
 * already served by that composite, including as a COVERING index for the
 * `SELECT 1` / `SELECT DISTINCT entity_name` shapes used by the KG read and
 * retention paths.
 *
 * Verified by dropping it on a COPY of the real 2.76 GB database and re-running
 * `EXPLAIN QUERY PLAN` for every `observations` consumer. No plan changed:
 *
 * ```
 *   getObservationsByName   entity_name=? AND repo=?          dedup
 *   deleteEntityWithObs.    DELETE ... entity_name=? AND repo=? dedup
 *   orphan-entity sweep     NOT EXISTS (... entity_name=? AND repo=?) dedup (covering)
 *   relation-prune probe    NOT EXISTS (... entity_name=? AND repo=?) dedup (covering)
 *   stale-observation anchor NOT EXISTS (... entity_name=? AND repo=?) dedup (covering)
 *   entity-name-only        SELECT 1 ... entity_name=?       dedup (covering)
 *   by-observation          observation=? [AND repo=?]        idx_observations_observation
 *   deleteRepoEntities      repo=?                            idx_observations_repo
 *   age prune               created_at<?                      idx_observations_created_at
 * ```
 *
 * Measured on that copy: the index is 12,824,576 bytes (12.2 MB) of pages.
 * `DROP INDEX` is metadata-only; the freed pages return to the freelist and are
 * reclaimed by the next `VACUUM` (or `incremental_vacuum` once the store is in
 * `auto_vacuum = INCREMENTAL`). A `DROP INDEX; VACUUM;` on the copy moved
 * 1,729,277,952 → 1,716,453,376 bytes (−12.2 MB) with `PRAGMA integrity_check`
 * still `ok` and the row counts unchanged.
 *
 * This mirrors the v29/v36 relation-index consolidations: a single-column index
 * that duplicates the leading column of a composite is pure write amplification
 * (every INSERT/UPDATE/DELETE maintains it) and dead disk.
 *
 * Idempotent: `DROP INDEX IF EXISTS`, so re-running after a crash mid-migration
 * is a no-op. No table rebuild, no data touched.
 */
export const migration: Migration = {
	version: 39,
	name: "observations-index-consolidation",
	up: (db) => {
		// Redundant: `entity_name` is the leftmost column of the UNIQUE
		// idx_observations_dedup (entity_name, observation, repo).
		db.exec("DROP INDEX IF EXISTS idx_observations_entity");
		logger.info("[Migration] Dropped redundant idx_observations_entity (leftmost-prefix of idx_observations_dedup)");
	}
};
