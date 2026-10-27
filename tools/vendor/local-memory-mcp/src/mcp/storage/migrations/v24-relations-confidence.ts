import { logger } from "../../utils/logger";
import type { Migration } from "./index";

export const migration: Migration = {
	version: 24,
	name: "relations-confidence",
	up: (db) => {
		// [KGCONF-1] (TASK-325, decision 2026-08-10): per-edge confidence
		// labels for the KG graph (R-18). EXACTLY ONE column, display-only:
		//   ALTER TABLE relations ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0
		//
		// - Additive SQLite ALTER — the DEFAULT 1.0 backfills every EXISTING
		//   row at migration time, so pre-v24 edges read 1.0 (explicit-grade)
		//   with zero data migration. No index is created: confidence is a
		//   display/label field, deliberately NOT used in any query, filter,
		//   scan, or ORDER BY (a filter would need an index and is deferred —
		//   see the "full-confidence computation from observations" note).
		// - The relations PK (from_entity, to_entity, relation_type) is
		//   untouched; the v22 kg_degrees triggers reference no column list,
		//   so they are unaffected by the additive column.
		//
		// Confidence is an INSERT-TIME constant chosen per caller site (the
		// relations table has no source/creator column — the writer that
		// creates the row IS the provenance). Documented mapping (single
		// source of truth: this comment + entity.ts method docs + the
		// kg-archivist writers):
		//   1.0  — explicit/manual + default when omitted (backward compat):
		//          dashboard createRelation, any insert site not passing a value.
		//   0.9  — parser-deterministic codebase edges (saveCodebaseRelations):
		//          call/instantiation/import/extends/implements derived from
		//          indexed code — no NLP extraction noise, but target
		//          resolution is name-based best-effort (ADR-002) and refs can
		//          lag the code, so just below explicit.
		//   0.8  — structured semantic metadata (saveTaskRelations
		//          depends_on/inspired_by, saveStandardRelations
		//          extends/related_to): built from explicit fields
		//          (parent_id, decision_refs) or similarity search — more
		//          reliable than free-text co-occurrence, less than code.
		//   0.55 — NLP auto-extraction co-occurrence (saveExtractions
		//          co_mentioned, the embedding worker's KG step): the entity
		//          extractor may misidentify names/relations, so the heaviest
		//          discount (spec anchor).
		//
		// INSERT OR IGNORE first-write-wins: a later writer re-attempting an
		// already-present edge is a no-op, so the FIRST writer's confidence
		// sticks. Within one worker cycle saveExtractions (0.55) runs BEFORE
		// the semantic writers, so a colliding co_mentioned pair keeps 0.55 —
		// accepted trade-off (spec: "INSERT OR IGNORE retains existing row
		// confidence (first-write wins) — note").
		//
		// Full-confidence recomputation from observations (scoring edges from
		// the source documents instead of insert-time constants) is deferred:
		// it would need a backfill job + a per-row update path, out of scope
		// for the minimal one-column decision. UI rendering of the label
		// (opacity buckets) ships separately in TASK-330.
		//
		// Idempotency mirrors the v13 branch-column / v23 edge-target
		// pattern: PRAGMA table_info guard before ALTER so re-running after
		// a crash mid-migration is a no-op (the runner wraps up() in a
		// transaction, so a crash rolls back cleanly).
		const relationsCols = db.prepare("PRAGMA table_info(relations)").all() as Array<{ name: string }>;
		if (!relationsCols.some((col) => col.name === "confidence")) {
			db.prepare("ALTER TABLE relations ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0").run();
		}
		logger.info("[Migration] Added relations.confidence (REAL NOT NULL DEFAULT 1.0) — per-edge KG confidence label");
	}
};
