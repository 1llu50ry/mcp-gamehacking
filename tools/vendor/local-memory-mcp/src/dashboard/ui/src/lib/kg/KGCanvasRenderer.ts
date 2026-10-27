import type { LayoutNode, LayoutEdge } from "./KGForceLayout";
import {
	EDGE_ALPHA_MULTIPLIERS,
	EDGE_BUCKET_COLORS,
	formatEdgeConfidenceLabel,
	getEdgeConfidenceBucket,
	type EdgeConfidenceBucket,
	type EdgeConfidenceColor
} from "./edgeConfidence";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RenderState {
	hoveredNode: LayoutNode | null;
	selectedNode: LayoutNode | null;
	selectedEdge: LayoutEdge | null;
	showTooltip: boolean;
	tooltipPos: { x: number; y: number };
	hiddenNodeCount?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const NODE_RADIUS = 18;

const TYPE_COLORS: Record<string, string> = {
	person: "#22c55e",
	place: "#3b82f6",
	organization: "#f97316",
	concept: "#a855f7",
	unknown: "#6b7280"
};

const TYPE_GLOWS: Record<string, string> = {
	person: "rgba(34,197,94,0.35)",
	place: "rgba(59,130,246,0.35)",
	organization: "rgba(249,115,22,0.35)",
	concept: "rgba(168,85,247,0.35)",
	unknown: "rgba(107,114,128,0.25)"
};

// ─── Color helpers ───────────────────────────────────────────────────────────

function getNodeColor(type: string): string {
	return TYPE_COLORS[type] ?? TYPE_COLORS.unknown;
}

function getNodeGlow(type: string): string {
	return TYPE_GLOWS[type] ?? TYPE_GLOWS.unknown;
}

function lighten(hex: string, amt: number): string {
	const s = hex.replace("#", "");
	const n = parseInt(s.length === 3 ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2] : s, 16);
	const r = Math.min(255, ((n >> 16) & 255) + amt);
	const g = Math.min(255, ((n >> 8) & 255) + amt);
	const b = Math.min(255, (n & 255) + amt);
	return `rgb(${r},${g},${b})`;
}

// ─── Canvas sizing ───────────────────────────────────────────────────────────

export function resizeCanvas(canvas: HTMLCanvasElement): {
	width: number;
	height: number;
	dpr: number;
	ctx: CanvasRenderingContext2D;
} {
	const rect = canvas.parentElement?.getBoundingClientRect();
	const width = rect ? rect.width : 800;
	const height = rect ? rect.height : 600;
	// TASK-271: cap effective DPR — fill cost is quadratic in DPR with no
	// visible benefit for this graph above 1.5 (mirrors the neural renderer).
	const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
	canvas.width = width * dpr;
	canvas.height = height * dpr;
	canvas.style.width = width + "px";
	canvas.style.height = height + "px";
	const ctx = canvas.getContext("2d")!;
	ctx.scale(dpr, dpr);
	return { width, height, dpr, ctx };
}

// ─── Drawing primitives ─────────────────────────────────────────────────────

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	r = Math.min(r, w / 2, h / 2);
	c.beginPath();
	c.moveTo(x + r, y);
	c.lineTo(x + w - r, y);
	c.arcTo(x + w, y, x + w, y + r, r);
	c.lineTo(x + w, y + h - r);
	c.arcTo(x + w, y + h, x + w - r, y + h, r);
	c.lineTo(x + r, y + h);
	c.arcTo(x, y + h, x, y + h - r, r);
	c.lineTo(x, y + r);
	c.arcTo(x, y, x + r, y, r);
	c.closePath();
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, isDark: boolean) {
	ctx.strokeStyle = isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
	ctx.lineWidth = 0.5;
	const gridSpacing = 30;
	for (let x = 0; x < width; x += gridSpacing) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height);
		ctx.stroke();
	}
	for (let y = 0; y < height; y += gridSpacing) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(width, y);
		ctx.stroke();
	}
}

function drawEdge(
	ctx: CanvasRenderingContext2D,
	edge: LayoutEdge,
	from: LayoutNode,
	to: LayoutNode,
	isSelected: boolean,
	isDark: boolean
) {
	// Confidence opacity bucket (TASK-330): high = solid default stroke,
	// medium/low = amber/red tint at reduced opacity. Selection keeps its
	// highlight — it wins over the confidence tint so the focused edge stays
	// unambiguous.
	const bucket = getEdgeConfidenceBucket(edge.confidence);
	const bucketColor = EDGE_BUCKET_COLORS[bucket];
	if (isSelected) {
		ctx.strokeStyle = "#f59e0b";
		ctx.lineWidth = 2.5;
	} else if (bucketColor) {
		const baseAlpha = isDark ? 0.4 : 0.35;
		ctx.strokeStyle = `rgba(${bucketColor.r},${bucketColor.g},${bucketColor.b},${baseAlpha * EDGE_ALPHA_MULTIPLIERS[bucket]})`;
		ctx.lineWidth = 1.5;
	} else {
		ctx.strokeStyle = isDark ? "rgba(148,163,184,0.4)" : "rgba(100,116,139,0.35)";
		ctx.lineWidth = 1.5;
	}
	ctx.beginPath();
	ctx.moveTo(from.x, from.y);
	ctx.lineTo(to.x, to.y);
	ctx.stroke();

	// Edge label (midpoint)
	if (edge.relation_type) {
		const mx = (from.x + to.x) / 2;
		const my = (from.y + to.y) / 2;
		const label = formatEdgeConfidenceLabel(edge.relation_type, edge.confidence);
		ctx.font = "9px system-ui,sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "bottom";
		const tw = ctx.measureText(label).width;
		ctx.fillStyle = isDark ? "rgba(10,14,26,0.8)" : "rgba(240,244,255,0.85)";
		ctx.fillRect(mx - tw / 2 - 3, my - 10, tw + 6, 14);
		// Label text carries the confidence bucket color (medium/low) so the
		// % is readable without relying on stroke alpha alone.
		ctx.fillStyle = labelTextColor(bucket, bucketColor, isDark);
		ctx.fillText(label, mx, my);
	}
}

function labelTextColor(
	bucket: EdgeConfidenceBucket,
	bucketColor: EdgeConfidenceColor | null,
	isDark: boolean
): string {
	if (bucketColor) return `rgba(${bucketColor.r},${bucketColor.g},${bucketColor.b},0.95)`;
	return isDark ? "rgba(148,163,184,0.8)" : "rgba(71,85,105,0.8)";
}

function drawNode(
	ctx: CanvasRenderingContext2D,
	node: LayoutNode,
	isHovered: boolean,
	isSelected: boolean,
	isDark: boolean
) {
	const color = getNodeColor(node.type);
	const glow = getNodeGlow(node.type);
	const radius = isHovered || isSelected ? NODE_RADIUS + 4 : NODE_RADIUS;

	// Glow
	if (isHovered || isSelected) {
		ctx.shadowColor = glow;
		ctx.shadowBlur = 20;
	}

	// Node circle with gradient
	const gradient = ctx.createRadialGradient(node.x - 4, node.y - 4, 2, node.x, node.y, radius);
	gradient.addColorStop(0, isDark ? lighten(color, 40) : lighten(color, 60));
	gradient.addColorStop(1, color);
	ctx.fillStyle = gradient;
	ctx.beginPath();
	ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
	ctx.fill();

	ctx.shadowBlur = 0;

	// Border
	ctx.strokeStyle = isSelected ? "#f59e0b" : isDark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.6)";
	ctx.lineWidth = isSelected ? 2.5 : 1.5;
	ctx.stroke();

	// Memory count badge
	if (node.memoryCount && node.memoryCount > 0) {
		ctx.fillStyle = isDark ? "#1e293b" : "#ffffff";
		ctx.beginPath();
		ctx.arc(node.x + radius - 6, node.y - radius + 6, 9, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = getNodeColor(node.type);
		ctx.font = "bold 8px system-ui,sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(String(node.memoryCount), node.x + radius - 6, node.y - radius + 6);
	}

	// Label
	ctx.fillStyle = isDark ? "#e2e8f0" : "#1e293b";
	ctx.font = "bold 11px system-ui,sans-serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "top";
	ctx.fillText(node.name, node.x, node.y + radius + 4);

	// Description subtitle
	if (node.description) {
		ctx.fillStyle = isDark ? "rgba(148,163,184,0.6)" : "rgba(100,116,139,0.6)";
		ctx.font = "8px system-ui,sans-serif";
		const desc = node.description.length > 18 ? node.description.slice(0, 18) + "..." : node.description;
		ctx.fillText(desc, node.x, node.y + radius + 16);
	}
}

function drawTooltip(
	ctx: CanvasRenderingContext2D,
	node: LayoutNode,
	pos: { x: number; y: number },
	canvasWidth: number,
	canvasHeight: number,
	isDark: boolean
) {
	const lines = [
		node.name,
		`Type: ${node.type}`,
		node.description ?? "",
		node.memoryCount != null ? `Memories: ${node.memoryCount}` : ""
	].filter(Boolean);

	ctx.font = "11px system-ui,sans-serif";
	const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
	const pad = 10;
	const lh = 16;
	const tw = maxW + pad * 2;
	const th = lines.length * lh + pad * 2;

	let tx = pos.x + 12;
	let ty = pos.y - 12;
	if (tx + tw > canvasWidth) tx = pos.x - tw - 12;
	if (ty + th > canvasHeight) ty = canvasHeight - th - 4;
	if (ty < 4) ty = 4;

	ctx.fillStyle = isDark ? "rgba(2,6,23,0.92)" : "rgba(255,255,255,0.95)";
	ctx.shadowColor = "rgba(0,0,0,0.2)";
	ctx.shadowBlur = 12;
	roundRect(ctx, tx, ty, tw, th, 8);
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.strokeStyle = isDark ? "rgba(148,163,184,0.2)" : "rgba(0,0,0,0.08)";
	ctx.lineWidth = 1;
	roundRect(ctx, tx, ty, tw, th, 8);
	ctx.stroke();

	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	for (let i = 0; i < lines.length; i++) {
		const isTitle = i === 0;
		ctx.font = isTitle ? "bold 12px system-ui,sans-serif" : "10px system-ui,sans-serif";
		ctx.fillStyle = isDark ? "#e2e8f0" : "#1e293b";
		ctx.fillText(lines[i], tx + pad, ty + pad + i * lh);
	}
}

function drawOverflowNotice(ctx: CanvasRenderingContext2D, width: number, hiddenNodeCount: number, isDark: boolean) {
	const label = `+${hiddenNodeCount} hidden`;
	ctx.font = "bold 11px system-ui,sans-serif";
	ctx.textAlign = "right";
	ctx.textBaseline = "top";
	const padX = 10;
	const padY = 7;
	const noticeWidth = ctx.measureText(label).width + padX * 2;
	const noticeHeight = 26;
	const x = Math.max(8, width - noticeWidth - 12);
	const y = 12;

	ctx.fillStyle = isDark ? "rgba(15,23,42,0.88)" : "rgba(255,255,255,0.9)";
	roundRect(ctx, x, y, noticeWidth, noticeHeight, 999);
	ctx.fill();
	ctx.strokeStyle = isDark ? "rgba(148,163,184,0.28)" : "rgba(59,130,246,0.22)";
	ctx.lineWidth = 1;
	roundRect(ctx, x, y, noticeWidth, noticeHeight, 999);
	ctx.stroke();
	ctx.fillStyle = isDark ? "#bfdbfe" : "#1d4ed8";
	ctx.fillText(label, x + noticeWidth - padX, y + padY);
}

// ─── Full render pass ────────────────────────────────────────────────────────

export function renderGraph(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	state: RenderState
) {
	const isDark = document.documentElement.classList.contains("dark");

	ctx.clearRect(0, 0, width, height);

	// Background
	ctx.fillStyle = isDark ? "#0a0e1a" : "#f0f4ff";
	ctx.fillRect(0, 0, width, height);

	// Grid
	drawGrid(ctx, width, height, isDark);

	// Build O(1) Map for edge endpoint lookup
	const nodeMap = new Map<string, LayoutNode>();
	for (const n of nodes) {
		nodeMap.set(n.id, n);
		nodeMap.set(n.name, n);
	}

	// Draw edges
	for (const e of edges) {
		const a = nodeMap.get(e.source);
		const b = nodeMap.get(e.target);
		if (!a || !b) continue;
		drawEdge(ctx, e, a, b, state.selectedEdge === e, isDark);
	}

	// Draw nodes
	for (const n of nodes) {
		const isHovered = state.hoveredNode === n;
		const isSelected = state.selectedNode === n;
		drawNode(ctx, n, isHovered, isSelected, isDark);
	}

	if (state.hiddenNodeCount && state.hiddenNodeCount > 0) {
		drawOverflowNotice(ctx, width, state.hiddenNodeCount, isDark);
	}

	// Tooltip
	if (state.showTooltip && state.selectedNode) {
		drawTooltip(ctx, state.selectedNode, state.tooltipPos, width, height, isDark);
	}
}
