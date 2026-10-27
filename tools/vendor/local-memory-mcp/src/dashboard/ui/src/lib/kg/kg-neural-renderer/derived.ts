/**
 * Derived 3D animation data, rebuilt only when nodes/edges change.
 *
 * Everything the frame loop reads that depends on the data set (degree map,
 * Node3D records, node index, precomputed edge endpoint indices, edge
 * confidence buckets) is built here — once per data update, never per frame
 * (TASK-271 / TASK-330).
 */
import type { LayoutNode, LayoutEdge } from "../KGForceLayout";
import type { Node3D } from "./layout";
import { getNodeColor } from "./layout";
import { BUCKET_ALPHA, BUCKET_IDX, resetEdgeConfidence, setEdgeConfidence } from "./edges";
import { getEdgeConfidenceBucket, formatEdgeConfidenceLabel } from "../edgeConfidence";

export interface DerivedData {
	degreeMap: Map<string, number>;
	nodes3d: Node3D[];
	nodeIndexById: Map<string, number>;
	/** Precomputed animEdges→nodeIndexById endpoint indices (TASK-271). */
	edgeSrcIdx: (number | undefined)[];
	edgeTgtIdx: (number | undefined)[];
}

/**
 * Builds all derived structures for the current node/edge set. Must be called
 * (or re-called) whenever the graph data changes — never inside the frame loop.
 */
export function buildDerivedData(nodes: LayoutNode[], edges: LayoutEdge[]): DerivedData {
	const degreeMap = new Map<string, number>();
	for (const e of edges) {
		degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
		degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
	}

	const nodes3d: Node3D[] = nodes.map((node) => ({
		node,
		x: node.x,
		y: node.y,
		z: node.z, // use actual 3D position from sphere layout
		phaseOffset: Math.random() * Math.PI * 2,
		isHub: (degreeMap.get(node.id) ?? 0) >= 5,
		degree: degreeMap.get(node.id) ?? 0,
		color: getNodeColor(node.type),
		firing: false,
		fireTimer: Math.random() * 2000 + 500,
		fireStartTime: 0
	}));

	const nodeIndexById = new Map<string, number>();
	nodes.forEach((n, i) => {
		if (n.id) nodeIndexById.set(n.id, i);
		if (n.name) nodeIndexById.set(n.name, i);
	});

	// Precomputed edge endpoint indices — animEdges only change when data
	// updates, so the 8000 Map.get(...) calls/frame become two array reads
	// per edge (TASK-271).
	const edgeSrcIdx: (number | undefined)[] = new Array(edges.length);
	const edgeTgtIdx: (number | undefined)[] = new Array(edges.length);
	// Confidence bucket arrays + labels — static per data update, so
	// precompute here (once) and only read in the frame loop (TASK-330).
	resetEdgeConfidence(edges.length);
	for (let i = 0; i < edges.length; i++) {
		const e = edges[i];
		edgeSrcIdx[i] = nodeIndexById.get(e.source);
		edgeTgtIdx[i] = nodeIndexById.get(e.target);
		const bucketIdx = BUCKET_IDX[getEdgeConfidenceBucket(e.confidence)];
		setEdgeConfidence(i, bucketIdx, BUCKET_ALPHA[bucketIdx], formatEdgeConfidenceLabel(e.relation_type, e.confidence));
	}

	return { degreeMap, nodes3d, nodeIndexById, edgeSrcIdx, edgeTgtIdx };
}
