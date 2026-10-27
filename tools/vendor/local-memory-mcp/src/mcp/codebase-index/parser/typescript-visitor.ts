/**
 * TypeScriptVisitor — visitor walkers + symbol construction for the
 * TypeScript/JavaScript tree-sitter parser (TASK-267 → TASK-556 split).
 *
 * Backward-compatibility shim (TASK-556): the implementation was split into
 * `typescript-visitor/` (ts-visitor class, ts-symbol-walker, ts-reference-
 * walker, ts-symbol-builder). All public exports are re-exported through the
 * directory barrel so existing `from "./typescript-visitor"` imports keep
 * resolving unchanged.
 */

export * from "./typescript-visitor/index";
