/**
 * Vehicle drawing functions for handoff animations.
 */

import { rr } from "./utils";

// ── Wheelchair sprite (top-down) ──────────────────────────────────────────
export function drawWheelchair(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	wheelAngle: number,
	isDark: boolean
) {
	ctx.save();
	ctx.translate(x, y);

	ctx.fillStyle = "rgba(0,0,0,0.2)";
	ctx.beginPath();
	ctx.ellipse(0, 3, 14, 6, 0, 0, Math.PI * 2);
	ctx.fill();

	ctx.fillStyle = isDark ? "#2d3a50" : "#7a8ea0";
	rr(ctx, -10, -12, 20, 18, 3);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#4a5a70" : "#5a7090";
	ctx.lineWidth = 1;
	rr(ctx, -10, -12, 20, 18, 3);
	ctx.stroke();

	ctx.fillStyle = isDark ? "#1e3a5f" : "#3b82f6";
	rr(ctx, -8, -6, 16, 10, 2);
	ctx.fill();

	ctx.fillStyle = isDark ? "#1e3055" : "#2563eb";
	rr(ctx, -8, -12, 16, 7, 2);
	ctx.fill();

	ctx.fillStyle = isDark ? "#3a4a60" : "#6a7a90";
	rr(ctx, -12, -10, 3, 14, 1);
	ctx.fill();
	rr(ctx, 9, -10, 3, 14, 1);
	ctx.fill();

	const wheelR = 5;
	[-9, 9].forEach((wx) => {
		ctx.strokeStyle = isDark ? "#1a1a2a" : "#333";
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		ctx.arc(wx, 4, wheelR, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = isDark ? "#4a5a70" : "#aabbc0";
		ctx.beginPath();
		ctx.arc(wx, 4, wheelR - 1.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = isDark ? "#2a3a50" : "#7a8a9a";
		ctx.lineWidth = 0.75;
		for (let si = 0; si < 4; si++) {
			const sa = wheelAngle + (si * Math.PI) / 2;
			ctx.beginPath();
			ctx.moveTo(wx, 4);
			ctx.lineTo(wx + Math.cos(sa) * (wheelR - 1), 4 + Math.sin(sa) * (wheelR - 1));
			ctx.stroke();
		}
	});

	[-5, 5].forEach((cx) => {
		ctx.fillStyle = isDark ? "#1a1a2a" : "#333";
		ctx.beginPath();
		ctx.arc(cx, -13, 2, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = isDark ? "#4a5a70" : "#999";
		ctx.beginPath();
		ctx.arc(cx, -13, 1, 0, Math.PI * 2);
		ctx.fill();
	});

	ctx.fillStyle = isDark ? "#3a4a60" : "#5a7090";
	rr(ctx, -6, 5, 12, 3, 1);
	ctx.fill();
	ctx.restore();
}

// ── Stretcher sprite (top-down) ─────────────────────────────────────────
export function drawStretcher(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	wheelAngle: number,
	breathePhase: number,
	isDark: boolean
) {
	ctx.save();
	ctx.translate(x, y);

	ctx.fillStyle = "rgba(0,0,0,0.18)";
	ctx.beginPath();
	ctx.ellipse(0, 4, 20, 7, 0, 0, Math.PI * 2);
	ctx.fill();

	ctx.fillStyle = isDark ? "#2d3a50" : "#8899aa";
	rr(ctx, -18, -10, 36, 16, 3);
	ctx.fill();
	ctx.strokeStyle = isDark ? "#4a5a70" : "#6a7a90";
	ctx.lineWidth = 1;
	rr(ctx, -18, -10, 36, 16, 3);
	ctx.stroke();

	ctx.fillStyle = isDark ? "#1a2535" : "#f0f4f8";
	rr(ctx, -16, -8, 32, 12, 2);
	ctx.fill();

	ctx.fillStyle = isDark ? "#2a3a5a" : "#e0e7ff";
	rr(ctx, 10, -6, 6, 8, 2);
	ctx.fill();

	const breathOffset = Math.sin(breathePhase) * 0.8;
	ctx.fillStyle = isDark ? "#1e3a5f" : "#bfdbfe";
	rr(ctx, -15, -7 + breathOffset, 22, 10 - breathOffset * 0.5, 2);
	ctx.fill();
	ctx.strokeStyle = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)";
	ctx.lineWidth = 0.5;
	ctx.beginPath();
	ctx.moveTo(-5, -7 + breathOffset);
	ctx.lineTo(-5, 3 - breathOffset * 0.3);
	ctx.stroke();

	const wr = 3;
	[
		[-15, 5],
		[15, 5],
		[-15, -11],
		[15, -11]
	].forEach(([wx, wy]) => {
		ctx.fillStyle = isDark ? "#1a1a2a" : "#333";
		ctx.beginPath();
		ctx.arc(wx, wy, wr, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = isDark ? "#4a5a70" : "#999";
		ctx.beginPath();
		ctx.arc(wx, wy, 1.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = isDark ? "#3a4a5a" : "#777";
		ctx.lineWidth = 0.5;
		const sa = wheelAngle;
		ctx.beginPath();
		ctx.moveTo(wx + Math.cos(sa) * wr * 0.5, wy + Math.sin(sa) * wr * 0.5);
		ctx.lineTo(wx - Math.cos(sa) * wr * 0.5, wy - Math.sin(sa) * wr * 0.5);
		ctx.stroke();
	});

	ctx.strokeStyle = isDark ? "#5a6a80" : "#7a8a9a";
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(-16, -10);
	ctx.lineTo(16, -10);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(-16, 6);
	ctx.lineTo(16, 6);
	ctx.stroke();

	ctx.restore();
}
