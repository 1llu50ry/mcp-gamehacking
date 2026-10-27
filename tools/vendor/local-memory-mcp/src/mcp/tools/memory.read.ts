/**
 * memory.read — thin re-exporter.
 *
 * All implementation moved to `memory-read/` sub-modules (orchestrator in
 * memory-read/index.ts, mode handlers in search.ts / detail.ts / recap.ts,
 * shared helpers in shared.ts / kg.ts). This file exists for backward
 * compatibility so existing `./memory.read` importers (tools/index.ts,
 * memory.synthesize.ts, test suites) keep their path — the dispatcher
 * contract (`handleMemoryRead`) is unchanged.
 */

export { handleMemoryRead } from "./memory-read";
