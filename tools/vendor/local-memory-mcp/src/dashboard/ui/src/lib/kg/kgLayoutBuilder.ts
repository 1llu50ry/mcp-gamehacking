/**
 * KG layout builder — pure function producing the renderer layout from the
 * fetched graph window (extracted from KGGraph.svelte's initLayout).
 *
 * - Zero-edge repos → `initializeZeroEdgeOverviewLayout` (overview placement).
 * - Otherwise the fetched top-N-by-degree window is capped at `graphLimit`
 *   (TASK-213/214: 'Show more' is a true superset 300 → 600 → 900 → 1000,
 *   MAX_GRAPH_LIMIT is the server-side hard cap — defense in depth).
 * - TASK-330: per-edge confidence is carried through to the renderers
 *   (drives the edge label % + opacity buckets).
 */
import { get } from "svelte/store";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { kgGraphLimit } from "$lib/stores";
import type { KGNode, KGEdge } from "$lib/interfaces";
import { MAX_GRAPH_LIMIT } from "./graphLoader";
import { initializeSphereLayout, initializeZeroEdgeOverviewLayout } from "./KGForceLayout";
import type { LayoutNode, LayoutEdge } from "./KGForceLayout";

export interface KGInitLayoutResult {
	layoutNodes: LayoutNode[];
	layoutEdges: LayoutEdge[];
	isZeroEdgeOverview: boolean;
	hiddenZeroEdgeNodeCount: number;
}

const EMPTY_NODE_LOOKUP = new Map<string, LayoutNode>();

export function buildNodeLookup(layoutNodes: LayoutNode[]): Map<string, LayoutNode> {
	const lookup = new Map<string, LayoutNode>();
	for (const n of layoutNodes) {
		lookup.set(n.id, n);
		lookup.set(n.name, n);
	}
	return lookup;
}

export { EMPTY_NODE_LOOKUP };

function toLayoutNode(n: KGNode): LayoutNode {
	return {
		id: n.id || n.name,
		name: n.name,
		type: n.type,
		description: n.description,
		memoryCount: n.memoryCount,
		x: 0,
		y: 0,
		z: 0,
		vx: 0,
		vy: 0,
		pinned: false
	};
}

export function buildGraphLayout(
	nodes: KGNode[],
	edges: KGEdge[],
	canvasWidth: number,
	canvasHeight: number
): KGInitLayoutResult {
	const isZeroEdgeOverview = edges.length === 0 && nodes.length > 0;

	if (isZeroEdgeOverview) {
		const result = initializeZeroEdgeOverviewLayout(nodes.map(toLayoutNode), canvasWidth, canvasHeight);
		return {
			layoutNodes: result,
			hiddenZeroEdgeNodeCount: Math.max(0, nodes.length - result.length),
			layoutEdges: [],
			isZeroEdgeOverview: true
		};
	}

	// Select top nodes by edge connectivity (degree) to maximize edge coverage
	const degreeMap = new SvelteMap<string, number>();
	for (const e of edges) {
		degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
		degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
	}

	const sortedNodes = [...nodes].sort((a, b) => {
		const degA = degreeMap.get(a.name) ?? 0;
		const degB = degreeMap.get(b.name) ?? 0;
		if (degB !== degA) return degB - degA;
		return a.name.localeCompare(b.name);
	});

	const edgeNodeNames = new SvelteSet<string>();
	for (const e of edges) {
		edgeNodeNames.add(e.source);
		edgeNodeNames.add(e.target);
	}

	// Cap the selection at the fetched top-N window (graphLimit) so 'Show
	// more' renders a true superset 300 → 600 → 900 → 1000 (TASK-214).
	// MAX_GRAPH_LIMIT is the server-side hard cap — defense in depth in
	// case the store ever holds a value above it.
	const layoutNodeCap = Math.min(get(kgGraphLimit), MAX_GRAPH_LIMIT);

	const selectedNames = new SvelteSet<string>();
	const selectedNodes: typeof nodes = [];
	for (const n of sortedNodes) {
		if (selectedNodes.length >= layoutNodeCap) break;
		if (!selectedNames.has(n.name)) {
			selectedNames.add(n.name);
			selectedNodes.push(n);
		}
	}
	for (const n of nodes) {
		if (selectedNodes.length >= layoutNodeCap) break;
		if (edgeNodeNames.has(n.name) && !selectedNames.has(n.name)) {
			selectedNames.add(n.name);
			selectedNodes.push(n);
		}
	}

	const cappedNodes = selectedNodes;
	const cappedNodeNames = selectedNames;

	const layoutEdges: LayoutEdge[] = edges
		.filter((e) => cappedNodeNames.has(e.source) && cappedNodeNames.has(e.target))
		.map((e) => ({
			source: e.source,
			target: e.target,
			relation_type: e.relation_type,
			// TASK-330: carry per-edge confidence (server listGraph) through
			// to the renderers — drives the edge label % + opacity buckets.
			confidence: e.confidence
		}));

	const layoutNodes = initializeSphereLayout(cappedNodes.map(toLayoutNode), layoutEdges, canvasWidth, canvasHeight);

	return {
		layoutNodes,
		hiddenZeroEdgeNodeCount: Math.max(0, nodes.length - cappedNodes.length),
		layoutEdges,
		isZeroEdgeOverview: false
	};
}
