/**
 * Canvas drawing functions for room decorations.
 *
 * Composite decor functions that dispatch to specialized drawing modules.
 */

import type { RenderCtx } from "./utils";
import { arenaFont, ARENA_TEXT_MICRO, rgba } from "./utils";
import type { SectionVisual, ZoneRect } from "../arenaTypes";
import type { ArenaLayoutManager } from "../arena-layout/ArenaLayoutManager";
import {
	drawSofa,
	drawCoffeeTable,
	drawPotPlant,
	drawHospitalBed,
	drawFilingCabinet,
	drawFlowerVase
} from "./furniture";
import { drawReceptionDesk, drawWhiteboard, drawCeilingLamp, drawPowerStrip, drawWaterDispenser } from "./office";
import { drawHazardSign, drawMedicalCross } from "./props";

// ── Cooldown ring ─────────────────────────────────────────────────────────
export function drawCooldownRing(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	progress: number,
	_ts: number,
	color: string
) {
	const radius = 18;
	const strokeWidth = 3;
	ctx.strokeStyle = rgba(color, 0.12);
	ctx.lineWidth = strokeWidth;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	ctx.stroke();
	const clamped = Math.max(0, Math.min(1, progress));
	const startAngle = -Math.PI / 2;
	const endAngle = startAngle + clamped * Math.PI * 2;
	ctx.save();
	ctx.shadowColor = color;
	ctx.shadowBlur = 8;
	ctx.strokeStyle = color;
	ctx.lineWidth = strokeWidth;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.arc(x, y, radius, startAngle, endAngle);
	ctx.stroke();
	ctx.restore();
	ctx.fillStyle = color;
	ctx.globalAlpha = 0.8;
	ctx.font = arenaFont(ARENA_TEXT_MICRO, "bold", true);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(`${Math.round(clamped * 100)}%`, x, y + 1);
	ctx.globalAlpha = 1;
}

// ── Lobby decor ───────────────────────────────────────────────────────────
function drawLobbyDecor(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	isDark: boolean,
	ts: number
) {
	const sx = x + w / 2 - 28,
		sy = y + h - 55;
	drawSofa(ctx, sx, sy, 56, isDark);
	drawCoffeeTable(ctx, x + w / 2 - 14, y + h - 32, isDark);
	drawPotPlant(ctx, x + 8, y + h - 18, isDark);
	drawPotPlant(ctx, x + w - 18, y + h - 18, isDark);
	drawPotPlant(ctx, x + 8, y + 28, isDark);
	const rw = Math.min(w - 20, 70);
	drawReceptionDesk(ctx, x + w / 2 - rw / 2, y + 24, rw, isDark);
	drawCeilingLamp(ctx, x + w / 2, y + 14, isDark, ts);
}

// ── Workspace decor ────────────────────────────────────────────────────────
function drawWorkspaceDecor(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	isDark: boolean,
	ts: number
) {
	drawPowerStrip(ctx, x + 12, y + h - 16, Math.min(w - 24, 60), isDark);
	drawWhiteboard(ctx, x + w - 36, y + 18, isDark);
	drawWaterDispenser(ctx, x + 20, y + 12, isDark);
	drawFlowerVase(ctx, x + w / 2, y + 24, isDark);
	// Desk lamps — the active floor reads as a lit workspace.
	drawCeilingLamp(ctx, x + w / 2, y + 12, isDark, ts);
}

// ── Issues decor ──────────────────────────────────────────────────────────
function drawIssuesDecor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
	ctx.save();
	ctx.globalAlpha = 0.25;
	ctx.strokeStyle = "#f59e0b";
	ctx.lineWidth = 4;
	ctx.setLineDash([8, 8]);
	ctx.beginPath();
	ctx.moveTo(x, y + h - 8);
	ctx.lineTo(x + w, y + h - 8);
	ctx.stroke();
	ctx.setLineDash([]);
	ctx.restore();
	drawHazardSign(ctx, x + w / 2 - 10, y + 16);
}

// ── Archive decor ─────────────────────────────────────────────────────────
function drawArchiveDecor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, isDark: boolean) {
	for (let fx = x + 10; fx < x + w - 22; fx += 26) {
		drawFilingCabinet(ctx, fx, y + 18, isDark);
	}
	drawPotPlant(ctx, x + w - 15, y + h - 20, isDark);
}

// ── Room decor dispatch ───────────────────────────────────────────────────
export function drawRoomDecor(rc: RenderCtx, zone: ZoneRect, visual: SectionVisual, layoutManager: ArenaLayoutManager) {
	const { ctx, isDark, ts } = rc;
	const { x, y, w, h } = zone;
	// Decor style comes from the manager's visual tokens — no per-zone
	// hardcoded dispatch in the renderer.
	switch (visual.decorStyle) {
		case "waiting":
			drawLobbyDecor(ctx, x, y, w, h, isDark, ts);
			break;
		case "storage":
			drawArchiveDecor(ctx, x, y, w, h, isDark);
			break;
		case "active":
			drawWorkspaceDecor(ctx, x, y, w, h, isDark, ts);
			break;
		case "warning":
			drawIssuesDecor(ctx, x, y, w, h);
			break;
		case "repair":
			drawRecoveryDecor(rc, zone, layoutManager);
			break;
		default:
			// Unknown decor style — a consistent neutral room so a custom
			// section never renders bare (pot plants in the corners).
			drawPotPlant(ctx, x + 10, y + h - 18, isDark);
			drawPotPlant(ctx, x + w - 12, y + h - 18, isDark);
			break;
	}
}

// ── Recovery decor ────────────────────────────────────────────────────────
export function drawRecoveryDecor(rc: RenderCtx, zone: ZoneRect, layoutManager: ArenaLayoutManager) {
	const { ctx, isDark, ts } = rc;
	const { x, y, w } = zone;
	// Beds align with this section's own workstations — both come from the
	// same manager instance the renderer was given (no singleton access), keyed
	// by the current zone id so a custom "repair" section gets its own grid.
	const beds = layoutManager.getWorkstationPositions(zone.id, 6);
	for (let idx = 0; idx < beds.length; idx++) {
		const bed = beds[idx];
		drawHospitalBed(ctx, bed.x, bed.y, isDark);
		drawCooldownRing(ctx, bed.x, bed.y - 2, 0.5 + 0.5 * Math.sin(ts * 0.001 + idx * 1.2), ts, zone.color);
	}
	drawPotPlant(ctx, x + w - 20, y + 20, isDark);
	drawFlowerVase(ctx, x + 20, y + 20, isDark);
	drawMedicalCross(ctx, x + w / 2, y + 12, isDark);
}
