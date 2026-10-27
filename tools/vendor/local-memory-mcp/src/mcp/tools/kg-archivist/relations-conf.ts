// ---------------------------------------------------------------------------
// Relation confidence heuristics ([KGCONF-1] / TASK-325, migration v24)
// Shared by the per-domain relation writers (TASK-430 split) and re-exported
// from `relations.ts` for backward compatibility.
// ---------------------------------------------------------------------------

/**
 * Confidence for structured SEMANTIC relations ([KGCONF-1] / TASK-325): edges
 * built from explicit metadata (task parent_id → depends_on, decision refs →
 * inspired_by, standard parent_id → extends) or vector-similarity search
 * (related_to). More reliable than free-text co-occurrence (0.55), less than
 * parser-deterministic codebase edges (0.9) — spec anchor ~0.8. Full mapping
 * documented in the v24 migration.
 */
export const KG_RELATION_CONFIDENCE_SEMANTIC = 0.8;

/**
 * Confidence for parser-deterministic codebase relation edges ([KGCONF-1] /
 * TASK-325): reference rows (call/instantiation/import/extends/implements)
 * derived from indexed code — no NLP extraction noise, so just below the 1.0
 * explicit grade; target resolution is name-based best-effort (ADR-002) and
 * refs can lag the code, so not full 1.0 (spec anchor 1.0/0.8/0.55 ladder,
 * codebase sits between semantic 0.8 and explicit 1.0).
 */
export const KG_RELATION_CONFIDENCE_CODEBASE = 0.9;
