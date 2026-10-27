/**
 * Edge and signal rendering for the Knowledge Graph Neural Renderer.
 */

import { fogFactor } from "./layout";
import type { ProjectedNode } from "./layout";
import {
	EDGE_ALPHA_MULTIPLIERS,
	EDGE_BUCKET_COLORS,
	type EdgeConfidenceBucket,
	type EdgeConfidenceColor
} from "../edgeConfidence";

// ─── Internal Types ──────────────────────────────────────────────────────────

export interface Signal {
	fromIdx: number;
	toIdx: number;
	progress: number;
	createdAt: number;
	color: { r: number; g: number; b: number };
}

// ─── Edge Draw Record (TASK-271 / audit F3) ──────────────────────────────────
// Pooled per-edge draw descriptor filled by the orchestrator's zero-allocation
// frame loop. Confidence bucket index + label are precomputed ONCE per data
// update (TASK-330) and only read here.

export interface EdgeDrawRecord {
	from: ProjectedNode;
	to: ProjectedNode;
	edgeAlpha: number;
	isRelated: boolean;
	avgDepth: number;
	/** Confidence bucket index (0=high, 1=medium, 2=low) — static per data update. */
	bucketIdx: number;
	/** Midpoint label for hovered/selected edges; "" for batched edges. */
	label: string;
}

// ─── Edge Confidence Buckets (TASK-330, KGCONF-2) ────────────────────────────
// The confidence value is static per data update, so bucket index, opacity
// multiplier and label are precomputed ONCE per animEdges change (via
// resetEdgeConfidence/setEdgeConfidence, called from the orchestrator's
// rebuildEdgeIndices) and only READ per frame — the frame loop stays
// zero-allocation. Bucket 0 (high) uses the renderer's default edge color
// (BUCKET_COLORS[0] === null); 1=amber, 2=red.
const BUCKET_COLORS: (EdgeConfidenceColor | null)[] = [
	EDGE_BUCKET_COLORS.high,
	EDGE_BUCKET_COLORS.medium,
	EDGE_BUCKET_COLORS.low
];

export const BUCKET_ALPHA: number[] = [
	EDGE_ALPHA_MULTIPLIERS.high,
	EDGE_ALPHA_MULTIPLIERS.medium,
	EDGE_ALPHA_MULTIPLIERS.low
];

export const BUCKET_IDX: Record<EdgeConfidenceBucket, number> = { high: 0, medium: 1, low: 2 };

// Mutable confidence state owned here so the draw-pass helpers read the same
// arrays the orchestrator precomputes. The frame loop snapshots the arrays via
// the getters below once per render — direct array reads, zero allocation.
let edgeConfBucket = new Uint8Array(0);
let edgeConfAlpha = new Float32Array(0);
let edgeLabels: string[] = [];

export function resetEdgeConfidence(count: number): void {
	edgeConfBucket = new Uint8Array(count);
	edgeConfAlpha = new Float32Array(count);
	edgeLabels = new Array(count);
}

export function setEdgeConfidence(i: number, bucketIdx: number, alpha: number, label: string): void {
	edgeConfBucket[i] = bucketIdx;
	edgeConfAlpha[i] = alpha;
	edgeLabels[i] = label;
}

export function getEdgeConfBucket(): Uint8Array {
	return edgeConfBucket;
}

export function getEdgeConfAlpha(): Float32Array {
	return edgeConfAlpha;
}

export function getEdgeConfLabels(): string[] {
	return edgeLabels;
}

// ─── Edge Drawing — Very Thin, Semi-Transparent ──────────────────────────────

export function drawEdge3D(
	ctx: CanvasRenderingContext2D,
	from: { sx: number; sy: number; depth: number },
	to: { sx: number; sy: number; depth: number },
	edgeAlpha: number,
	isActive: boolean,
	time: number,
	dark: boolean,
	bucketColor: EdgeConfidenceColor | null = null
) {
	const avgDepth = (from.depth + to.depth) / 2;
	const fog = fogFactor(avgDepth);
	const alpha = dark ? Math.min(0.8, edgeAlpha * fog) : Math.min(0.9, Math.max(0.08, edgeAlpha * fog));

	if (alpha < 0.01) return;

	const edgeWidth = dark ? 1.5 : 1.8;
	// Dark mode: cyan glow; Light mode: deeper indigo for contrast. A
	// confidence bucket color (amber/red, TASK-330) overrides the tint while
	// keeping the glow/shadow driven by the same rgb — so the active-edge
	// highlight also communicates the confidence visual language.
	const r = bucketColor ? bucketColor.r : dark ? 0 : 55;
	const g = bucketColor ? bucketColor.g : dark ? 212 : 48;
	const b = bucketColor ? bucketColor.b : dark ? 255 : 163;

	ctx.save();
	ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
	ctx.lineWidth = isActive ? edgeWidth * 1.6 : edgeWidth;
	ctx.lineCap = "round";

	if (isActive) {
		ctx.setLineDash([6, 6]);
		ctx.lineDashOffset = -time * 0.04;
		ctx.shadowColor = `rgba(${r},${g},${b},0.6)`;
		ctx.shadowBlur = 6;
	}

	ctx.beginPath();
	ctx.moveTo(from.sx, from.sy);
	ctx.lineTo(to.sx, to.sy);
	ctx.stroke();
	ctx.restore();
}

// ─── Edge Label — Midpoint Pill (TASK-330) ───────────────────────────────────
// Rendered only for hovered/selected edges (the active set), so the
// zero-allocation batched path and the uncluttered overview stay untouched.

export function drawEdgeLabel3D(
	ctx: CanvasRenderingContext2D,
	from: { sx: number; sy: number; depth: number },
	to: { sx: number; sy: number; depth: number },
	label: string,
	dark: boolean,
	bucketColor: EdgeConfidenceColor | null
) {
	const mx = (from.sx + to.sx) / 2;
	const my = (from.sy + to.sy) / 2;

	ctx.font = "9px system-ui,sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";
	const tw = ctx.measureText(label).width;
	const pillW = tw + 6;
	const pillH = 14;
	ctx.fillStyle = dark ? "rgba(10,14,26,0.85)" : "rgba(240,244,255,0.9)";
	ctx.fillRect(mx - pillW / 2, my - pillH + 2, pillW, pillH);
	// Confidence bucket color tints the label text (medium=amber, low=red);
	// high keeps the neutral slate.
	ctx.fillStyle = bucketColor
		? `rgba(${bucketColor.r},${bucketColor.g},${bucketColor.b},0.95)`
		: dark
			? "rgba(148,163,184,0.9)"
			: "rgba(71,85,105,0.9)";
	ctx.fillText(label, mx, my);
}

// ─── Batched Edge Draw (per-confidence-bucket paths) ─────────────────────────
// Inactive edges are batched into per-confidence-bucket paths (≤3
// save/stroke/restore — no per-edge object arrays); active edges draw
// individually with the animated dash/shadow effects. Alpha for each bucket
// batch uses its FIRST (farthest) edge. Bucket colors (TASK-330): 0=high →
// default edge color, 1=medium amber, 2=low red.
//
// Depth layering artifact (TASK-384): far-to-near ordering applies WITHIN each
// bucket only, not across buckets — the batch flush groups edges by bucket, so
// a far medium/low edge drawn in a later path can overlay nearer high-bucket
// edges. The high bucket (dominant case — default confidence 1.0) renders
// exactly as the pre-TASK-330 single batch; mixed-bucket crossings are an
// accepted ~1.5px alpha-faded stroke artifact.
export function drawEdgeBatches(
	ctx: CanvasRenderingContext2D,
	records: EdgeDrawRecord[],
	count: number,
	edgeColor: string,
	dark: boolean,
	time: number
): void {
	let batchBucket: number | null = null;
	for (let i = 0; i < count; i++) {
		const re = records[i];
		if (re.isRelated) {
			if (batchBucket !== null) {
				ctx.stroke();
				ctx.restore();
				batchBucket = null;
			}
			drawEdge3D(ctx, re.from, re.to, re.edgeAlpha, true, time, dark, BUCKET_COLORS[re.bucketIdx]);
			continue;
		}
		if (batchBucket !== re.bucketIdx) {
			if (batchBucket !== null) {
				ctx.stroke();
				ctx.restore();
			}
			batchBucket = re.bucketIdx;
			const fog = fogFactor(re.avgDepth);
			const alpha = dark ? Math.min(0.8, re.edgeAlpha * fog) : Math.min(0.9, Math.max(0.08, re.edgeAlpha * fog));
			if (alpha < 0.01) {
				batchBucket = null;
				continue;
			}
			ctx.save();
			const bucketColor = BUCKET_COLORS[re.bucketIdx];
			ctx.strokeStyle = bucketColor
				? `rgba(${bucketColor.r},${bucketColor.g},${bucketColor.b},${alpha})`
				: `rgba(${edgeColor},${alpha})`;
			ctx.lineWidth = dark ? 1.5 : 1.8;
			ctx.lineCap = "round";
			ctx.beginPath();
		}
		ctx.moveTo(re.from.sx, re.from.sy);
		ctx.lineTo(re.to.sx, re.to.sy);
	}
	if (batchBucket !== null) {
		ctx.stroke();
		ctx.restore();
	}
}

// ─── Edge Confidence Labels — Midpoint Post-Pass (TASK-330) ──────────────────
// Active set (hovered/selected) only. Drawn in a post-pass so labels always
// overlay the strokes; the loop is bounded by count (array reads only) and
// fillText runs only for the few labeled edges.

export function drawEdgeLabels3D(
	ctx: CanvasRenderingContext2D,
	records: EdgeDrawRecord[],
	count: number,
	dark: boolean
): void {
	for (let i = 0; i < count; i++) {
		const re = records[i];
		if (!re.label) continue;
		drawEdgeLabel3D(ctx, re.from, re.to, re.label, dark, BUCKET_COLORS[re.bucketIdx]);
	}
}
