/**
 * Deterministic grid layout + edge styling helpers for the CallGraph DAG
 * (CodebaseCallGraph.svelte). Pure functions only — no Svelte reactivity —
 * so the layout math stays unit-testable and the component stays under the
 * file-size guideline (mirrors symbolDetailUtils.ts style).
 */
import { refKindLabel } from "./symbolDetailUtils";

// ── DAG model ─────────────────────────────────────────────────────────────
// One node per unique caller (groupedByCaller); one edge per (caller, kind)
// with the call-site multiplicity — the DAG is star-shaped: callers → the
// queried symbol. Deterministic order (first-seen from the backend's stable
// reference ordering).

/** Visible-node cap keeps the SVG compact and token-light (typical symbols
 *  have a handful of callers; dense symbols degrade to "+N more hidden"). */
export const MAX_VISIBLE_CALLERS = 30;

export interface CallerNode {
	key: string;
	name: string | null;
	kind: string | null;
	filePath: string;
	count: number;
}

export interface DagEdge {
	callerKey: string;
	kind: string;
	count: number;
}

// ── Layout constants (manual, deterministic — no graph deps) ───────────────
export const NODE_W = 190;
export const NODE_H = 30;
export const COLS = 3;
export const ROW_H = 64;
export const COL_GAP = 22;
export const TARGET_GAP = 64;
export const PAD = 16;
export const LABEL_FONT = 9.5;

/** Geometry of the star DAG derived from the visible caller count. */
export interface CallGraphLayout {
	rows: number;
	callerColWidth: number;
	targetX: number;
	svgWidth: number;
	svgHeight: number;
	targetY: number;
}

/** Compute the full SVG geometry from the number of visible caller nodes. */
export function computeCallGraphLayout(callerCount: number): CallGraphLayout {
	const rows = Math.max(1, Math.ceil(callerCount / COLS));
	const callerColWidth = COLS * NODE_W + (COLS - 1) * COL_GAP;
	const targetX = PAD + callerColWidth + TARGET_GAP;
	const svgWidth = targetX + NODE_W + PAD;
	const svgHeight = PAD * 2 + rows * ROW_H - (ROW_H - NODE_H) + 24;
	const targetY = svgHeight / 2 - NODE_H / 2;
	return { rows, callerColWidth, targetX, svgWidth, svgHeight, targetY };
}

/** Top-left origin of the caller node at grid index `idx` (column-major). */
export function callerXY(idx: number): { x: number; y: number } {
	const col = idx % COLS;
	const row = Math.floor(idx / COLS);
	return { x: PAD + col * (NODE_W + COL_GAP), y: PAD + row * ROW_H };
}

/** Quadratic bezier from a caller's right edge to the target's left edge. */
export function edgePath(layout: CallGraphLayout, callerIdx: number, spread: number): string {
	const c = callerXY(callerIdx);
	const sx = c.x + NODE_W;
	const sy = c.y + NODE_H / 2 + spread;
	const tx = layout.targetX;
	const ty = layout.targetY + NODE_H / 2;
	const mx = (sx + tx) / 2;
	return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
}

/** Midpoint of the edge's bezier — the anchor for the kind label pill. */
export function edgeMid(layout: CallGraphLayout, callerIdx: number, spread: number): { x: number; y: number } {
	const c = callerXY(callerIdx);
	const sx = c.x + NODE_W;
	const sy = c.y + NODE_H / 2 + spread;
	const tx = layout.targetX;
	const ty = layout.targetY + NODE_H / 2;
	return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
}

// ── Edge kind colors (matches the reference-kind palette across the tab) ──
export const KIND_COLORS: Record<string, string> = {
	call: "#0ea5e9",
	instantiation: "#8b5cf6",
	import: "#22c55e",
	extends: "#f59e0b",
	implements: "#ec4899"
};

/** Stroke/fill color for an edge kind; empty string → theme-muted fallback. */
export function kindColor(kind: string): string {
	return KIND_COLORS[kind] ?? "";
}

/** Display label for an edge kind ("call", "instantiation", …). */
export function kindLabel(kind: string): string {
	return refKindLabel(kind);
}

export function basename(filePath: string): string {
	return filePath.split("/").pop() || filePath;
}

/** Truncated node label; module-scope callers fall back to their file. */
export function displayName(node: CallerNode): string {
	const raw = node.name ?? `(module · ${basename(node.filePath)})`;
	return raw.length > 24 ? `${raw.slice(0, 23)}…` : raw;
}

/** Edge label text ("call", "call ×3", …) — used to size the label pill. */
export function edgeLabelText(edge: DagEdge): string {
	return `${kindLabel(edge.kind)}${edge.count > 1 ? ` ×${edge.count}` : ""}`;
}

/** Approximate label pill width (font-size ~9.5px, mono ≈0.62em/char). */
export function edgeLabelWidth(edge: DagEdge): number {
	return Math.max(36, Math.ceil(edgeLabelText(edge).length * 6.4) + 10);
}

/** Per-caller edge spread index — fans multi-kind edges off the same anchor. */
export function edgeSpread(callerIdx: number, edgeIdxInCaller: number, totalForCaller: number): number {
	const offset = totalForCaller > 1 ? edgeIdxInCaller - (totalForCaller - 1) / 2 : 0;
	return offset * 5;
}
