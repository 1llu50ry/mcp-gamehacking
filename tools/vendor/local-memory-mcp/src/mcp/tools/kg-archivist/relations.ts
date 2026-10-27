// ---------------------------------------------------------------------------
// Relation confidence heuristics ([KGCONF-1] / TASK-325, migration v24)
// Re-exported from relations-conf.ts (TASK-430 split: domain-specific
// relation writers live in relations-task.ts / relations-standard.ts /
// relations-codebase.ts).
// ---------------------------------------------------------------------------

export { KG_RELATION_CONFIDENCE_SEMANTIC, KG_RELATION_CONFIDENCE_CODEBASE } from "./relations-conf";

/**
 * Task semantic relations (parent_id → depends_on, decision_refs → inspired_by).
 */
export { saveTaskRelations } from "./relations-task";

/**
 * Standard semantic relations (parent_id → extends, similarity → related_to).
 */
export { saveStandardRelations } from "./relations-standard";

/**
 * Codebase relations (symbol entities + reference edges for one indexed file).
 */
export { saveCodebaseRelations } from "./relations-codebase";
