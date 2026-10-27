import type { RenderCtx } from "./utils";
import { arenaFont, ARENA_TEXT_BODY, ARENA_TEXT_LABEL, rr, rgba, darken, LOD_SIMPLIFIED, LOD_AGGREGATE } from "./utils";
import type { SectionVisual, ZoneRect } from "../arenaTypes";
import type { ArenaLayoutManager } from "../arena-layout/ArenaLayoutManager";
import { SECTION_PAD, LABEL_HEIGHT, STATS_HEIGHT } from "../arena-layout/grid";
import {
	drawPlazaFloor,
	drawDirtFloor,
	drawCleanTileFloor,
	drawGrassFloor,
	drawWoodPlankFloor,
	drawCarpetFloor,
	drawConcreteFloor,
	drawCrackedTileFloor
} from "./floors";
import { drawRoomDecor } from "./decorations";

// ── Wall (top of room) ─────────────────────────────────────────────────────
export function drawWall(rc: RenderCtx, x: number, y: number, w: number, color: string) {
	const { ctx, isDark } = rc;
	const wH = 11;
	ctx.fillStyle = isDark ? "#1c2130" : "#c4cad6";
	rr(ctx, x, y, w, wH, 0);
	ctx.fill();
	ctx.strokeStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
	ctx.lineWidth = 0.75;
	for (let px = x + 24; px < x + w; px += 24) {
		ctx.beginPath();
		ctx.moveTo(px, y);
		ctx.lineTo(px, y + wH);
		ctx.stroke();
	}
	ctx.fillStyle = rgba(color, 0.4);
	ctx.fillRect(x, y, w, 2.5);
	const sGrd = ctx.createLinearGradient(x, y + wH, x, y + wH + 8);
	sGrd.addColorStop(0, "rgba(0,0,0,0.28)");
	sGrd.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = sGrd;
	ctx.fillRect(x, y + wH, w, 8);
	ctx.fillStyle = isDark ? "#253040" : "#b8bfc9";
	ctx.fillRect(x, y, 6, wH);
	ctx.fillRect(x + w - 6, y, 6, wH);
}

// ── Zone label sign ───────────────────────────────────────────────────────
export function drawZoneLabel(rc: RenderCtx, zone: ZoneRect) {
	const { ctx } = rc;
	const { x, y, w, color, label } = zone;
	const bw = Math.min(w - 16, 92),
		bh = 16,
		bx = x + 9,
		by = y + 3;
	ctx.fillStyle = rgba(color, rc.isDark ? 0.25 : 0.18);
	rr(ctx, bx, by, bw, bh, 5);
	ctx.fill();
	ctx.strokeStyle = rgba(color, 0.6);
	ctx.lineWidth = 0.75;
	rr(ctx, bx, by, bw, bh, 5);
	ctx.stroke();
	ctx.fillStyle = color;
	ctx.font = arenaFont(ARENA_TEXT_BODY, "bold");
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.fillText(label.toUpperCase(), bx + 6, by + bh / 2);
}

// ── Zone stats strip ──────────────────────────────────────────────────────
export interface ZoneStats {
	tasks: number;
	agents: number;
}

/**
 * Stats line drawn in every section's reserved stats band (STATS_HEIGHT just
 * below the LABEL_HEIGHT band — the same offset the manager's contentRect
 * uses, so the strip never collides with workstations). All offsets derive
 * from the manager's single-source layout constants.
 */
export function drawZoneStats(rc: RenderCtx, zone: ZoneRect, stats: ZoneStats) {
	const { ctx, isDark } = rc;
	const { x, y, w } = zone;
	const sy = y + SECTION_PAD + LABEL_HEIGHT;
	ctx.font = arenaFont(ARENA_TEXT_LABEL);
	ctx.textBaseline = "top";
	ctx.textAlign = "left";
	ctx.fillStyle = isDark ? "rgba(148,163,184,0.75)" : "rgba(71,85,105,0.75)";
	ctx.fillText(`${stats.tasks} tasks`, x + SECTION_PAD, sy + (STATS_HEIGHT - 7) / 2);
	ctx.textAlign = "right";
	ctx.fillText(`${stats.agents} agents`, x + w - SECTION_PAD, sy + (STATS_HEIGHT - 7) / 2);
	ctx.textAlign = "left";
}

// ── Room ────────────────────────────────────────────────────────────────────
export function drawRoom(
	rc: RenderCtx,
	zone: ZoneRect,
	visual: SectionVisual,
	stats: ZoneStats | undefined,
	layoutManager: ArenaLayoutManager
) {
	const { ctx, isDark } = rc;
	const { x, y, w, h } = zone;

	ctx.save();
	rr(ctx, x, y, w, h, 10);
	ctx.clip();

	// Floor style + colors come from the manager's visual tokens — the
	// renderer no longer owns per-zone floor choices.
	switch (visual.floorStyle) {
		case "plaza":
			drawPlazaFloor(rc, x, y, w, h);
			break;
		case "dirt":
			drawDirtFloor(rc, x, y, w, h, darken(visual.color, 55));
			break;
		case "grass":
			drawGrassFloor(rc, x, y, w, h);
			break;
		case "wood":
			drawWoodPlankFloor(rc, x, y, w, h);
			break;
		case "carpet":
			drawCarpetFloor(rc, x, y, w, h, visual.color);
			break;
		case "concrete":
			drawConcreteFloor(rc, x, y, w, h);
			break;
		case "tile":
			drawCleanTileFloor(rc, x, y, w, h);
			break;
		case "cracked":
			drawCrackedTileFloor(rc, x, y, w, h);
			break;
		default:
			drawWoodPlankFloor(rc, x, y, w, h);
			break;
	}

	const lx = x + w / 2,
		ly = y + h * 0.35;
	const grd = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.85);
	grd.addColorStop(0, rgba(visual.color, isDark ? 0.12 : 0.08));
	grd.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = grd;
	ctx.fillRect(x, y, w, h);
	ctx.restore();

	drawWall(rc, x, y, w, visual.color);

	ctx.strokeStyle = rgba(visual.color, isDark ? 0.45 : 0.35);
	ctx.lineWidth = 1.5;
	rr(ctx, x, y, w, h, 10);
	ctx.stroke();

	drawRoomDecor(rc, zone, visual, layoutManager);

	if (rc.lod !== LOD_SIMPLIFIED && rc.lod !== LOD_AGGREGATE) {
		drawZoneLabel(rc, zone);
		// Every section draws its stats strip at the same manager-derived
		// offset (below the label band, above the workstation content rect).
		if (stats) drawZoneStats(rc, zone, stats);
	}
}
