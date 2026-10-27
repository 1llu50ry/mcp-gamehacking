/**
 * Edge draw-pass: viewport pre-filter → pooled record collection → depth sort
 * → confidence-bucket batch raster.
 *
 * The per-frame edge records come from a module-level pool (zero allocations,
 * TASK-271). Endpoint indices are precomputed per data update (derived.ts),
 * so the frame loop is two array reads + Map lookups instead of 8000+
 * Map.get(...) calls.
 */
import type { LayoutEdge } from "../KGForceLayout";
import type { ProjectedNode } from "./layout";
import { FOG_FAR } from "./layout";
import { drawEdgeBatches, drawEdgeLabels3D, type EdgeDrawRecord } from "./edges";
import type { NeuralRenderState } from "./nodes";

const edgeRecordPool: EdgeDrawRecord[] = [];
const edgeWorking: EdgeDrawRecord[] = [];

export interface EdgeViewport {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface CollectEdgesInput {
	edges: LayoutEdge[];
	edgeSrcIdx: (number | undefined)[];
	edgeTgtIdx: (number | undefined)[];
	projByIndex: Map<number, ProjectedNode>;
	edgeConfBucket: Uint8Array<ArrayBufferLike>;
	edgeConfAlpha: Float32Array<ArrayBufferLike>;
	edgeLabels: string[];
	state: NeuralRenderState;
	hasFocus: boolean;
	dragging: boolean;
	viewport: EdgeViewport;
	maxEdges: number;
}

/**
 * Pre-filters edges (both endpoints in viewport, valid projection scale),
 * fills pooled draw records with per-edge alpha/confidence/label, and depth
 * sorts the working view far→near. Returns the record count to draw.
 */
export function collectAndSortEdges(input: CollectEdgesInput): number {
	const { edges, edgeSrcIdx, edgeTgtIdx, projByIndex, edgeConfBucket, edgeConfAlpha, edgeLabels, state } = input;
	const { hasFocus, viewport, maxEdges } = input;
	const { left: viewLeft, right: viewRight, top: viewTop, bottom: viewBottom } = viewport;

	let edgeCount = 0;
	for (let ei = 0; ei < edges.length && edgeCount < maxEdges; ei++) {
		const e = edges[ei];
		const srcIdx = edgeSrcIdx[ei];
		const tgtIdx = edgeTgtIdx[ei];
		if (srcIdx === undefined || tgtIdx === undefined) continue;
		const fromP = projByIndex.get(srcIdx);
		const toP = projByIndex.get(tgtIdx);
		if (!fromP || !toP) continue;
		if (fromP.scale < 0.02 || toP.scale < 0.02) continue;

		// Viewport frustum culling — skip edges entirely outside viewport
		if (
			(fromP.sx < viewLeft && toP.sx < viewLeft) ||
			(fromP.sx > viewRight && toP.sx > viewRight) ||
			(fromP.sy < viewTop && toP.sy < viewTop) ||
			(fromP.sy > viewBottom && toP.sy > viewBottom)
		) {
			continue;
		}

		const isHovered =
			state.hoveredNode &&
			(e.source === state.hoveredNode.id ||
				e.source === state.hoveredNode.name ||
				e.target === state.hoveredNode.id ||
				e.target === state.hoveredNode.name);
		const isSelected =
			state.selectedNode &&
			(e.source === state.selectedNode.id ||
				e.source === state.selectedNode.name ||
				e.target === state.selectedNode.id ||
				e.target === state.selectedNode.name);
		const isRelated = !!(isHovered || isSelected);

		let alphaMultiplier: number;
		if (hasFocus) {
			alphaMultiplier = isRelated ? 1.0 : 0.05;
		} else {
			alphaMultiplier = 0.2; // lower default opacity when no hover to avoid cluttered look
		}

		const avgZ = (fromP.depth + toP.depth) / 2;
		const maxZ = FOG_FAR * 1.5;
		const baseAlpha = Math.max(0.1, Math.min(0.7, (avgZ + maxZ) / (maxZ * 2)));
		// Confidence opacity bucket folds into the alpha (TASK-330): high
		// keeps the full value, medium/low dim the stroke. bucketIdx/label
		// are precomputed per data update — only read here.
		const bucketIdx = edgeConfBucket[ei];
		const edgeAlpha = baseAlpha * alphaMultiplier * edgeConfAlpha[ei];
		const edgeIsSelected = state.selectedEdge === e;

		let rec = edgeRecordPool[edgeCount];
		if (!rec) {
			rec = { from: null!, to: null!, edgeAlpha: 0, isRelated: false, avgDepth: 0, bucketIdx: 0, label: "" };
			edgeRecordPool[edgeCount] = rec;
		}
		rec.from = fromP;
		rec.to = toP;
		rec.edgeAlpha = edgeAlpha;
		rec.isRelated = isRelated;
		rec.avgDepth = avgZ;
		rec.bucketIdx = bucketIdx;
		// Midpoint label only for the active set (hovered/selected) — the
		// overview stays uncluttered and fillText cost stays bounded.
		rec.label = isRelated || edgeIsSelected ? edgeLabels[ei] : "";
		edgeCount++;
	}

	// Sort edges by depth (far to near) — in place on the pooled view; the
	// records are re-filled by index next frame, so mutated order is fine.
	edgeWorking.length = edgeCount;
	for (let i = 0; i < edgeCount; i++) edgeWorking[i] = edgeRecordPool[i];
	if (edgeCount > 1) edgeWorking.sort((a, b) => b.avgDepth - a.avgDepth);

	return edgeCount;
}

/**
 * Rasters the collected edge records: inactive edges batched per-confidence-
 * bucket path, active edges individually (see drawEdgeBatches for the
 * cross-bucket z-order note), then confidence labels for the active set.
 */
export function drawCollectedEdges(
	ctx: CanvasRenderingContext2D,
	edgeColor: string,
	dark: boolean,
	totalElapsed: number
): void {
	const edgeCount = edgeWorking.length;
	drawEdgeBatches(ctx, edgeWorking, edgeCount, edgeColor, dark, totalElapsed);
	// Edge confidence labels (TASK-330): midpoint pills for the active set.
	drawEdgeLabels3D(ctx, edgeWorking, edgeCount, dark);
}
