/**
 * Thin re-exporter — implementation lives in src/mcp/tools/task-read/.
 *
 * Splits:
 *   - task-read/index.ts   — orchestrator (auto-infer detail/search/list)
 *   - task-read/detail.ts  — single/bulk detail with children + depended_by resolution
 *   - task-read/search.ts  — hybrid vector + keyword + recency + domain scoring
 *   - task-read/list.ts    — paginated listing with status/phase filters
 *   - task-read/shared.ts  — shared helpers (capitalize, describeStatusFilter)
 */

export { handleTaskRead } from "./task-read";
