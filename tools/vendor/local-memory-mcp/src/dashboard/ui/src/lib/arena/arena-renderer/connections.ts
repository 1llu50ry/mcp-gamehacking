import type { RenderCtx, LODLevel } from "./utils";
import { LOD_SIMPLIFIED } from "./utils";
import type { ArenaScene } from "../arenaTypes";
import type { Point, WorkflowEdge } from "../arena-layout/types";

// ── Claim links (dashed lines from agents to their claimed tasks) ─────────
export function drawClaimLinks(
	rc: RenderCtx,
	scene: ArenaScene,
	matchesAgentFilter: (id: string) => boolean,
	matchesTaskFilter: (id: string) => boolean,
	isFilterActive: () => boolean,
	lod: LODLevel,
	zoneColorForStatus: (status: string) => string
) {
	const { ctx } = rc;
	const hasFilter = isFilterActive();
	const cullBounds = lod < LOD_SIMPLIFIED ? getCullBounds(rc) : undefined;

	for (const a of scene.agents.values()) {
		if (hasFilter && !matchesAgentFilter(a.id)) continue;
		for (const tid of a.claimedTaskIds) {
			const t = scene.tasks.get(tid);
			if (!t) continue;
			if (hasFilter && !matchesTaskFilter(t.id)) continue;
			if (cullBounds && !isInViewport(rc, a.x, a.y, cullBounds) && !isInViewport(rc, t.x, t.y, cullBounds)) continue;
			const grd = ctx.createLinearGradient(a.x, a.y, t.x, t.y);
			grd.addColorStop(0, a.color + "cc");
			// End color comes from the same manager section tokens the rooms use
			// (status → zone → section color); zone-less statuses (completed /
			// canceled) resolve to the resolver's neutral fallback.
			grd.addColorStop(1, zoneColorForStatus(t.status) + "44");
			ctx.strokeStyle = grd;
			ctx.lineWidth = 1.5;
			ctx.setLineDash([5, 5]);
			ctx.lineDashOffset = -(rc.ts * 0.022) % 10;
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(t.x, t.y);
			ctx.stroke();
		}
	}
	ctx.setLineDash([]);
	ctx.lineDashOffset = 0;
}

// ── Handoff beams (dashed amber lines with traveling dot) ────────────────
export function drawHandoffBeams(
	rc: RenderCtx,
	scene: ArenaScene,
	matchesAgentFilter: (id: string) => boolean,
	matchesTaskFilter: (id: string) => boolean,
	isFilterActive: () => boolean,
	lod: LODLevel
) {
	const { ctx, reducedTransparency, ts } = rc;
	const hasFilter = isFilterActive();
	const cullBounds = lod < LOD_SIMPLIFIED ? getCullBounds(rc) : undefined;

	for (const h of scene.handoffs) {
		const from = scene.agents.get(h.fromAgentId);
		if (!from) continue;
		if (hasFilter && !matchesAgentFilter(from.id)) continue;
		let toX: number, toY: number;
		if (h.toAgentId) {
			const to = scene.agents.get(h.toAgentId);
			if (!to) continue;
			if (hasFilter && !matchesAgentFilter(to.id)) continue;
			toX = to.x;
			toY = to.y;
		} else if (h.taskId) {
			const t = scene.tasks.get(h.taskId);
			if (!t) continue;
			if (hasFilter && !matchesTaskFilter(t.id)) continue;
			toX = t.x;
			toY = t.y;
		} else continue;

		if (cullBounds && !isInViewport(rc, from.x, from.y, cullBounds) && !isInViewport(rc, toX, toY, cullBounds))
			continue;

		ctx.strokeStyle = "#f59e0b88";
		ctx.lineWidth = 2.5;
		ctx.setLineDash([8, 5]);
		ctx.lineDashOffset = -(ts * 0.07) % 13;
		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(toX, toY);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.lineDashOffset = 0;

		const t2 = (ts % 1600) / 1600;
		const px = from.x + (toX - from.x) * t2,
			py = from.y + (toY - from.y) * t2;
		ctx.fillStyle = "#f59e0b";
		if (!reducedTransparency) {
			ctx.shadowColor = "#f59e0b";
			ctx.shadowBlur = 8;
		}
		ctx.beginPath();
		ctx.arc(px, py, 4, 0, Math.PI * 2);
		ctx.fill();
		ctx.shadowBlur = 0;
	}
}

// ── Workflow arrows (section → section pipeline edges) ────────────────────
// Drawn as subtle infrastructure between rooms: solid thin lines with an
// arrowhead for primary/exception edges, a dashed quadratic curve for the
// recovery→pending return edge. Anchors come from the shared layout manager
// (getWorkflow()), so arrows always land on the correct section edges.

/** Control point for the return curve: midpoint offset perpendicular to the chord. */
function workflowControlPoint(from: Point, to: Point): Point {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const len = Math.hypot(dx, dy) || 1;
	// Modest perpendicular bow; capped relative to the chord length so the
	// curve stays inside the canvas (anchors are ≥ OUTER_MARGIN from edges).
	const off = Math.min(22, len * 0.25);
	return { x: (from.x + to.x) / 2 - (dy / len) * off, y: (from.y + to.y) / 2 + (dx / len) * off };
}

function drawArrowHead(ctx: CanvasRenderingContext2D, tip: Point, dirX: number, dirY: number, fill: string) {
	const angle = Math.atan2(dirY, dirX);
	const size = 6;
	ctx.fillStyle = fill;
	ctx.beginPath();
	ctx.moveTo(tip.x, tip.y);
	ctx.lineTo(tip.x - size * Math.cos(angle - 0.42), tip.y - size * Math.sin(angle - 0.42));
	ctx.lineTo(tip.x - size * Math.cos(angle + 0.42), tip.y - size * Math.sin(angle + 0.42));
	ctx.closePath();
	ctx.fill();
}

export function drawWorkflowArrows(rc: RenderCtx, edges: WorkflowEdge[]) {
	const { ctx, isDark } = rc;
	if (edges.length === 0) return;
	// Neutral gray-white infrastructure lines: white in dark mode, slate in
	// light mode, ~0.35 alpha so arrows never read as content.
	const stroke = isDark ? "rgba(226,232,240,0.35)" : "rgba(51,65,85,0.35)";
	const dash = [5, 5];

	ctx.save();
	for (const edge of edges) {
		const { fromAnchor, toAnchor, kind } = edge;
		const isReturn = kind === "return";
		ctx.strokeStyle = stroke;
		ctx.lineWidth = 1.5;
		ctx.setLineDash(isReturn ? dash : []);
		ctx.beginPath();
		ctx.moveTo(fromAnchor.x, fromAnchor.y);
		if (isReturn) {
			const control = workflowControlPoint(fromAnchor, toAnchor);
			ctx.quadraticCurveTo(control.x, control.y, toAnchor.x, toAnchor.y);
			ctx.stroke();
			ctx.setLineDash([]);
			// Arrowhead tangent at the curve end: 2 * (P2 − P1).
			drawArrowHead(ctx, toAnchor, toAnchor.x - control.x, toAnchor.y - control.y, stroke);
		} else {
			ctx.lineTo(toAnchor.x, toAnchor.y);
			ctx.stroke();
			ctx.setLineDash([]);
			drawArrowHead(ctx, toAnchor, toAnchor.x - fromAnchor.x, toAnchor.y - fromAnchor.y, stroke);
		}
	}
	ctx.setLineDash([]);
	ctx.restore();
}

// ── Internal helpers ─────────────────────────────────────────────────────
function getCullBounds(rc: RenderCtx): { left: number; top: number; right: number; bottom: number } {
	const z = rc.zoom || 1;
	const margin = z < 0.5 ? 100 : 50;
	const left = -rc.panX / z;
	const top = -rc.panY / z;
	return {
		left: left - margin,
		top: top - margin,
		right: left + rc.canvasW / z + margin,
		bottom: top + rc.canvasH / z + margin
	};
}

function isInViewport(
	rc: RenderCtx,
	x: number,
	y: number,
	bounds: { left: number; top: number; right: number; bottom: number }
): boolean {
	return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}
