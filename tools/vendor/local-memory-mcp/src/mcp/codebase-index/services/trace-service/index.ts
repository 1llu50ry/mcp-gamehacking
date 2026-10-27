/**
 * trace-service barrel — public API surface for symbol tracing.
 *
 * Split of the former trace-service.ts monolith (TASK-551). Consumers import
 * from `../trace-service` and resolve here; behavior is unchanged.
 *
 * Module map:
 *   - types.ts           → TraceResult, ReexportChainEntry, TraceReference
 *   - constants.ts       → shared traversal/packing bounds + tier constants
 *   - errors.ts          → SymbolNotFoundError, AmbiguousSymbolError
 *   - resolve.ts         → shared reference-row resolution helpers
 *   - related-types.ts   → collectRelatedTypes (issue #84 graph traversal)
 *   - context-packing.ts → estimateSymbolTokens + packContext (issue #85)
 *   - trace-core.ts      → traceSymbol + buildReexportChain orchestration
 */

export type { ReexportChainEntry, TraceReference, TraceResult } from "./types";
export {
	EDGE_KIND_TIER,
	MAX_PACK_EDGES_PER_LEVEL,
	MAX_TYPE_EDGES_PER_LEVEL,
	STRUCTURAL_EDGE_KINDS,
	TIER_LABELS,
	TIER_ORDER
} from "./constants";
export type { ContextPackTierLabel } from "./constants";
export { AmbiguousSymbolError, SymbolNotFoundError } from "./errors";
export { collectRelatedTypes } from "./related-types";
export { estimateSymbolTokens, packContext } from "./context-packing";
export { buildReexportChain, traceSymbol } from "./trace-core";
