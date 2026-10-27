/**
 * Office and ambient drawing functions for room decorations.
 */

import { rr } from "./utils";

// ── Reception desk ───────────────────────────────────────────────────────
export function drawReceptionDesk(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, isDark: boolean) {
	ctx.fillStyle = isDark ? "#1a2535" : "#9aafcc";
	rr(ctx, x, y, w, 14, 4);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#2a3a50" : "#7a94b0";
	ctx.lineWidth = 1;
	rr(ctx, x, y, w, 14, 4);
	ctx.stroke();
	ctx.fillStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.35)";
	rr(ctx, x + 2, y + 2, w - 4, 4, 2);
	ctx.fill();
	ctx.fillStyle = isDark ? "#0f172a" : "#1e2535";
	rr(ctx, x + w / 2 - 8, y - 10, 16, 10, 2);
	ctx.fill();
	ctx.fillStyle = isDark ? "#1e40af" : "#3b82f6";
	rr(ctx, x + w / 2 - 7, y - 9, 14, 8, 1);
	ctx.fill();
}

// ── Whiteboard ────────────────────────────────────────────────────────────
export function drawWhiteboard(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean) {
	ctx.fillStyle = isDark ? "#1e2840" : "#f8fafc";
	rr(ctx, x, y, 28, 22, 2);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#3a4a60" : "#b0bac8";
	ctx.lineWidth = 1;
	rr(ctx, x, y, 28, 22, 2);
	ctx.stroke();
	const lines = [isDark ? "#4ade80" : "#16a34a", isDark ? "#60a5fa" : "#2563eb", isDark ? "#f472b6" : "#db2777"];
	lines.forEach((c, i) => {
		ctx.strokeStyle = c;
		ctx.lineWidth = 0.75;
		ctx.beginPath();
		ctx.moveTo(x + 3, y + 5 + i * 5);
		ctx.lineTo(x + 3 + 8 + i * 4, y + 5 + i * 5);
		ctx.stroke();
	});
}

// ── Letter sorter ────────────────────────────────────────────────────────
export function drawLetterSorter(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean) {
	const base = isDark ? "#2d3a50" : "#8faac0";
	ctx.fillStyle = base;
	rr(ctx, x, y, 22, 28, 2);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#3a4a60" : "#7090a8";
	ctx.lineWidth = 0.75;
	[0, 7, 14, 21].forEach((dy) => {
		ctx.beginPath();
		ctx.moveTo(x + 1, y + dy);
		ctx.lineTo(x + 21, y + dy);
		ctx.stroke();
	});
	["#ef4444", "#f59e0b", "#3b82f6", "#10b981"].forEach((c, i) => {
		ctx.fillStyle = c + "aa";
		rr(ctx, x + 2, y + i * 7 + 1, 18, 5, 1);
		ctx.fill();
	});
}

// ── Ceiling lamp ──────────────────────────────────────────────────────────
export function drawCeilingLamp(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean, ts: number) {
	ctx.strokeStyle = isDark ? "#3a4555" : "#6b7a8a";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(x, y - 8);
	ctx.lineTo(x, y + 2);
	ctx.stroke();
	ctx.fillStyle = isDark ? "#2a3040" : "#e8d870";
	ctx.beginPath();
	ctx.moveTo(x - 10, y + 2);
	ctx.lineTo(x + 10, y + 2);
	ctx.lineTo(x + 8, y + 10);
	ctx.lineTo(x - 8, y + 10);
	ctx.closePath();
	ctx.fill();
	const pulse = 0.5 + 0.5 * Math.sin(ts * 0.0015);
	const lg = ctx.createRadialGradient(x, y + 10, 0, x, y + 10, 35 + pulse * 5);
	lg.addColorStop(0, isDark ? `rgba(255,240,180,${0.15 + pulse * 0.05})` : `rgba(255,240,180,${0.2 + pulse * 0.05})`);
	lg.addColorStop(1, "rgba(0,0,0,0)");
	ctx.fillStyle = lg;
	ctx.fillRect(x - 40, y + 10, 80, 45);
}

// ── Clock ─────────────────────────────────────────────────────────────────
export function drawClock(ctx: CanvasRenderingContext2D, cx: number, cy: number, isDark: boolean) {
	const r2 = 9;
	ctx.fillStyle = isDark ? "#1e2840" : "#f0f4fc";
	ctx.beginPath();
	ctx.arc(cx, cy, r2, 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#3a4a60" : "#8898b0";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.arc(cx, cy, r2, 0, Math.PI * 2);
	ctx.stroke();
	ctx.strokeStyle = isDark ? "#5a6a80" : "#8898b0";
	ctx.lineWidth = 0.75;
	for (let i = 0; i < 12; i++) {
		const a = (i * Math.PI) / 6,
			r3 = r2 - 1.5;
		ctx.beginPath();
		ctx.moveTo(cx + Math.cos(a) * r3, cy + Math.sin(a) * r3);
		ctx.lineTo(cx + Math.cos(a) * (r3 - 2), cy + Math.sin(a) * (r3 - 2));
		ctx.stroke();
	}
	const now = new Date();
	const minA = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
	const hrA = ((now.getHours() % 12) / 12) * Math.PI * 2 + ((now.getMinutes() / 60) * Math.PI) / 6 - Math.PI / 2;
	ctx.strokeStyle = isDark ? "#e2e8f0" : "#1e2840";
	ctx.lineWidth = 1.5;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo(cx, cy);
	ctx.lineTo(cx + Math.cos(hrA) * 5, cy + Math.sin(hrA) * 5);
	ctx.stroke();
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(cx, cy);
	ctx.lineTo(cx + Math.cos(minA) * 7, cy + Math.sin(minA) * 7);
	ctx.stroke();
	ctx.fillStyle = "#ef4444";
	ctx.beginPath();
	ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
	ctx.fill();
}

// ── Power strip ───────────────────────────────────────────────────────────
export function drawPowerStrip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, isDark: boolean) {
	ctx.fillStyle = isDark ? "#1a1a1a" : "#2d2d2d";
	rr(ctx, x, y, w, 6, 3);
	ctx.fill();
	ctx.fillStyle = isDark ? "#3a3a3a" : "#4a4a4a";
	for (let ox = 6; ox < w - 4; ox += 10) {
		rr(ctx, x + ox, y + 1, 6, 4, 2);
		ctx.fill();
	}
}

// ── Water dispenser ───────────────────────────────────────────────────────
export function drawWaterDispenser(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean) {
	ctx.fillStyle = isDark ? "#1e293b" : "#e2e8f0";
	rr(ctx, x, y, 14, 24, 2);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#334155" : "#cbd5e1";
	ctx.lineWidth = 1;
	rr(ctx, x, y, 14, 24, 2);
	ctx.stroke();
	ctx.fillStyle = isDark ? "#0ea5e955" : "#38bdf855";
	rr(ctx, x + 2, y - 12, 10, 12, 3);
	ctx.fill();
	ctx.fillStyle = "#ef4444";
	ctx.fillRect(x + 3, y + 8, 2, 3);
	ctx.fillStyle = "#3b82f6";
	ctx.fillRect(x + 9, y + 8, 2, 3);
	ctx.fillStyle = isDark ? "#0f172a" : "#94a3b8";
	rr(ctx, x + 2, y + 14, 10, 3, 1);
	ctx.fill();
}
