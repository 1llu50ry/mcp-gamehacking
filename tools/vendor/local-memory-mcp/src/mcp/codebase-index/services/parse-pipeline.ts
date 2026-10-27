/**
 * parse-pipeline — the incremental 3-phase parse loop.
 *
 * Backward-compatibility shim (TASK-553): the implementation was split into
 * `parse-pipeline/` (constants, types, read-phase, decide-phase,
 * semantic-pass, enrich-parse, batch-persist, orchestrator). All public
 * exports are re-exported through the directory barrel so existing
 * `from "./parse-pipeline"` imports keep resolving unchanged.
 */

export * from "./parse-pipeline/index";
