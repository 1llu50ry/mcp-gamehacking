/**
 * MCP resource surface — barrel (TASK-558 split).
 *
 * Splitting resources/index.ts (was 501 LOC) into per-concern modules:
 *   - resource-catalog.ts  — listResources / listResourceTemplates /
 *                            completeResourceArgument
 *   - resource-reads.ts    — readResource dispatcher
 *   - resource-helpers.ts  — shared envelope/pagination/error helpers
 *
 * This barrel keeps the public contract stable for consumers importing from
 * "./resources" (router, completion, system.service) and "../resources/index"
 * (tests). File names mirror the established helper-sibling convention used
 * by codebase.ts in this directory.
 */

export { listResources, listResourceTemplates, completeResourceArgument } from "./resource-catalog";
export { readResource } from "./resource-reads";
