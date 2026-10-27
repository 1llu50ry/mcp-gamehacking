/**
 * Furniture drawing functions for room decorations.
 */

import { rr } from "./utils";

// ── Sofa ──────────────────────────────────────────────────────────────────
export function drawSofa(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, isDark: boolean) {
	const base = isDark ? "#2d3a4a" : "#8b9eb5";
	const cushion = isDark ? "#3a4d62" : "#a8bdd4";
	const arm = isDark ? "#253040" : "#7b8ea5";
	ctx.fillStyle = base;
	rr(ctx, x, y, w, 8, 3);
	ctx.fill();
	ctx.fillStyle = cushion;
	rr(ctx, x, y + 7, w, 10, 3);
	ctx.fill();
	ctx.fillStyle = arm;
	rr(ctx, x - 4, y, 8, 17, 3);
	ctx.fill();
	ctx.fillStyle = arm;
	rr(ctx, x + w - 4, y, 8, 17, 3);
	ctx.fill();
	ctx.strokeStyle = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(x + w / 3, y + 7);
	ctx.lineTo(x + w / 3, y + 17);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(x + (w * 2) / 3, y + 7);
	ctx.lineTo(x + (w * 2) / 3, y + 17);
	ctx.stroke();
	ctx.fillStyle = isDark ? "#1a2030" : "#6b7c90";
	[
		[x + 2, y + 15],
		[x + w - 6, y + 15]
	].forEach(([lx, ly]) => ctx.fillRect(lx, ly, 4, 4));
}

// ── Coffee table ──────────────────────────────────────────────────────────
export function drawCoffeeTable(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean) {
	ctx.fillStyle = "rgba(0,0,0,0.15)";
	ctx.beginPath();
	ctx.ellipse(x + 14, y + 6, 16, 7, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = isDark ? "#2a3545" : "#93a8be";
	ctx.beginPath();
	ctx.ellipse(x + 14, y + 4, 15, 6, 0, 0, Math.PI * 2);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#3a4a5a" : "#7a96b0";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.ellipse(x + 14, y + 4, 15, 6, 0, 0, Math.PI * 2);
	ctx.stroke();
	ctx.fillStyle = "rgba(255,255,255,0.1)";
	ctx.beginPath();
	ctx.ellipse(x + 10, y + 2, 6, 2, 0, 0, Math.PI * 2);
	ctx.fill();
}

// ── Pot plant ────────────────────────────────────────────────────────────
export function drawPotPlant(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean) {
	ctx.fillStyle = isDark ? "#4a2d1a" : "#c4825a";
	rr(ctx, x - 5, y - 8, 10, 9, 2);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#6b4028" : "#a0643c";
	ctx.lineWidth = 0.5;
	rr(ctx, x - 5, y - 8, 10, 9, 2);
	ctx.stroke();
	ctx.fillStyle = isDark ? "#2d1a0a" : "#6b4a28";
	ctx.fillRect(x - 4, y - 9, 8, 3);
	const lc = ["#16a34a", "#15803d", "#22c55e", "#166534"];
	[
		[-5, -18, 4, 3, -0.3],
		[-2, -20, 4, 3, 0],
		[3, -18, 4, 3, 0.3],
		[-7, -14, 3.5, 2.5, -0.5],
		[5, -14, 3.5, 2.5, 0.5]
	].forEach(([lx, ly, rx, ry, rot], i) => {
		ctx.save();
		ctx.translate(x + (lx as number), y + (ly as number));
		ctx.rotate(rot as number);
		ctx.fillStyle = lc[i % lc.length];
		ctx.beginPath();
		ctx.ellipse(0, 0, rx as number, ry as number, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	});
}

// ── Hospital bed ──────────────────────────────────────────────────────────
export function drawHospitalBed(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean) {
	ctx.fillStyle = isDark ? "#1e293b" : "#cbd5e1";
	rr(ctx, x - 20, y - 10, 40, 20, 3);
	ctx.fill();
	ctx.fillStyle = isDark ? "#0f172a" : "#f8fafc";
	rr(ctx, x - 18, y - 8, 36, 16, 2);
	ctx.fill();
	ctx.fillStyle = isDark ? "#1e1b4b" : "#e0e7ff";
	rr(ctx, x + 10, y - 6, 8, 12, 2);
	ctx.fill();
	ctx.fillStyle = isDark ? "#172554" : "#bfdbfe";
	rr(ctx, x - 18, y - 8, 20, 16, 2);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#64748b" : "#94a3b8";
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(x + 16, y - 10);
	ctx.lineTo(x + 16, y - 25);
	ctx.stroke();
	ctx.fillStyle = isDark ? "#0ea5e988" : "#38bdf888";
	rr(ctx, x + 14, y - 25, 4, 6, 1);
	ctx.fill();
}

// ── Filing cabinet ────────────────────────────────────────────────────────
export function drawFilingCabinet(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean) {
	ctx.fillStyle = isDark ? "#1e2535" : "#9aaec0";
	rr(ctx, x, y, 20, 28, 2);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#2d3a50" : "#7a98b0";
	ctx.lineWidth = 0.75;
	rr(ctx, x, y, 20, 28, 2);
	ctx.stroke();
	[0, 9, 18].forEach((dy) => {
		ctx.strokeStyle = isDark ? "#3a4a60" : "#5a7898";
		ctx.lineWidth = 0.5;
		ctx.beginPath();
		ctx.moveTo(x + 1, y + dy + 8);
		ctx.lineTo(x + 19, y + dy + 8);
		ctx.stroke();
		ctx.fillStyle = isDark ? "#4a5a70" : "#4a6888";
		rr(ctx, x + 7, y + dy + 3, 6, 3, 2);
		ctx.fill();
	});
}

// ── Flower vase ───────────────────────────────────────────────────────────
export function drawFlowerVase(ctx: CanvasRenderingContext2D, x: number, y: number, isDark: boolean) {
	ctx.fillStyle = isDark ? "#2d1a08" : "#8b5a2b";
	rr(ctx, x - 6, y - 2, 12, 10, 1);
	ctx.fill();
	ctx.fillStyle = isDark ? "#1e3a8a" : "#bfdbfe";
	ctx.beginPath();
	ctx.ellipse(x, y - 6, 4, 6, 0, 0, Math.PI * 2);
	ctx.fill();
	const fc = ["#f43f5e", "#ec4899", "#d946ef"];
	[
		[-3, -12],
		[3, -11],
		[0, -14]
	].forEach(([fx, fy], i) => {
		ctx.strokeStyle = "#16a34a";
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x, y - 10);
		ctx.lineTo(x + fx, y + fy);
		ctx.stroke();
		ctx.fillStyle = fc[i];
		ctx.beginPath();
		ctx.arc(x + fx, y + fy, 2.5, 0, Math.PI * 2);
		ctx.fill();
	});
}
