/**
 * Shared constants for the trace service (related-types traversal #84 and
 * context packing #85). Single source of truth — consumers import from here,
 * never redeclare.
 */

export const MAX_TYPE_EDGES_PER_LEVEL = 200;

export const MAX_PACK_EDGES_PER_LEVEL = 400;

export const EDGE_KIND_TIER: Record<string, 2 | 3 | 4 | 5> = {
	type: 2,
	extends: 4,
	implements: 4,
	call: 4,
	instantiation: 4,
	import: 5
};

/** Edge kinds that carry a high-confidence structural relationship. */
export const STRUCTURAL_EDGE_KINDS = new Set(["type", "extends", "implements", "call", "instantiation"]);

/** Packing tier numeric order — ascending value, packed in this order. */
export const TIER_ORDER = [1, 2, 3, 4, 5] as const;

export type ContextPackTierLabel = "root" | "api" | "direct" | "calls" | "imports";

export const TIER_LABELS: ContextPackTierLabel[] = ["root", "api", "direct", "calls", "imports"];
