/**
 * Reference-target helpers for the TypeScriptVisitor (TASK-267 split).
 *
 * Backward-compatibility shim (TASK-552): the implementation was split by
 * emission family into `ts-reference-emission/` (name-helpers, imports,
 * heritage, type-refs). All public exports are re-exported through the
 * directory barrel so existing `from "./ts-reference-emission"` imports keep
 * resolving unchanged.
 */

export * from "./ts-reference-emission/index";
