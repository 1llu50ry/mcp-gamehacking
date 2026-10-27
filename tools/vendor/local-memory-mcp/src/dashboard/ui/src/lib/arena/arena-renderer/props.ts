/**
 * Props and miscellaneous drawing functions for room decorations.
 */

import { arenaFont, ARENA_TEXT_BODY, rr } from "./utils";

// ── Hazard sign ───────────────────────────────────────────────────────────
export function drawHazardSign(ctx: CanvasRenderingContext2D, x: number, y: number) {
	ctx.fillStyle = "#f59e0b";
	ctx.beginPath();
	ctx.moveTo(x + 10, y);
	ctx.lineTo(x + 20, y + 16);
	ctx.lineTo(x, y + 16);
	ctx.closePath();
	ctx.fill();
	ctx.strokeStyle = "#1a1a1a";
	ctx.lineWidth = 1;
	ctx.stroke();
	ctx.fillStyle = "#1a1a1a";
	ctx.font = arenaFont(ARENA_TEXT_BODY, "bold");
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";
	ctx.fillText("!", x + 10, y + 15);
}

// ── Trophy shelf ──────────────────────────────────────────────────────────
export function drawTrophyShelf(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean, ts: number) {
	ctx.fillStyle = isDark ? "#2d1a08" : "#c4825a";
	rr(ctx, x, y + 20, 50, 5, 2);
	ctx.fill();
	[
		["#f59e0b", x + 5],
		["#94a3b8", x + 20],
		["#cd7f32", x + 35]
	].forEach(([c, tx]) => {
		ctx.fillStyle = c as string;
		ctx.beginPath();
		ctx.arc((tx as number) + 5, y + 13, 5, Math.PI, 0);
		ctx.fill();
		ctx.fillRect((tx as number) + 3, y + 13, 4, 8);
		rr(ctx, tx as number, y + 20, 10, 4, 2);
		ctx.fill();
	});
	const p = 0.5 + 0.5 * Math.sin(ts * 0.002);
	ctx.fillStyle = `rgba(245,158,11,${0.08 + p * 0.06})`;
	ctx.beginPath();
	ctx.ellipse(x + 10, y + 18, 12, 6, 0, 0, Math.PI * 2);
	ctx.fill();
}

// ── Medical cross ─────────────────────────────────────────────────────────
export function drawMedicalCross(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean) {
	ctx.save();
	ctx.translate(x, y);
	ctx.fillStyle = `rgba(20,184,166,${isDark ? 0.5 : 0.35})`;
	rr(ctx, -9, -8, 18, 16, 3);
	ctx.fill();
	ctx.strokeStyle = `rgba(20,184,166,0.7)`;
	ctx.lineWidth = 0.75;
	rr(ctx, -9, -8, 18, 16, 3);
	ctx.stroke();
	ctx.fillStyle = isDark ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.9)";
	ctx.fillRect(-2, -6, 4, 12);
	ctx.fillRect(-6, -2, 12, 4);
	ctx.restore();
}
