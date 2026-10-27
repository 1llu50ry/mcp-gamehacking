/**
 * TraceService — traces a symbol's definition and usage across the codebase.
 *
 * Backward-compatibility shim (TASK-551): the implementation was split into
 * `trace-service/` (types, constants, errors, resolve, related-types,
 * context-packing, trace-core). All public exports are re-exported through the
 * directory barrel so existing `from "../codebase-index/services/trace-service"`
 * imports keep resolving unchanged.
 */

export * from "./trace-service/index";
