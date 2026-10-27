import type { RenderCtx } from "./utils";
import { tileNoise } from "./utils";

// ── Global floor ──────────────────────────────────────────────────────────
export function drawGlobalFloor(rc: RenderCtx) {
	const { ctx, canvasW, canvasH, isDark } = rc;
	ctx.fillStyle = isDark ? "#0a0e1a" : "#dde3ed";
	ctx.fillRect(0, 0, canvasW, canvasH);
	ctx.strokeStyle = isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.03)";
	ctx.lineWidth = 0.5;
	const g = 24;
	for (let x = 0; x < canvasW; x += g) {
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, canvasH);
		ctx.stroke();
	}
	for (let y = 0; y < canvasH; y += g) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(canvasW, y);
		ctx.stroke();
	}
}

// ── Plaza floor ──────────────────────────────────────────────────────────
export function drawPlazaFloor(rc: RenderCtx, x: number, y: number, w: number, h: number) {
	const { ctx, isDark } = rc;
	const t = 24;
	const c0 = isDark ? "#2e3540" : "#b0b8c4";
	const c1 = isDark ? "#262d36" : "#a0a8b4";
	ctx.fillStyle = c0;
	ctx.fillRect(x, y, w, h);
	for (let cx2 = Math.floor(x / t) * t; cx2 < x + w; cx2 += t) {
		for (let cy2 = Math.floor(y / t) * t; cy2 < y + h; cy2 += t) {
			if (((Math.round(cx2 / t) + Math.round(cy2 / t)) & 1) === 0) {
				ctx.fillStyle = c1;
				ctx.fillRect(cx2, cy2, t, t);
			}
			if (tileNoise(cx2, cy2) > 0.8) {
				ctx.strokeStyle = isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.1)";
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(cx2 + 2, cy2 + 2);
				ctx.lineTo(cx2 + t / 2, cy2 + t / 2);
				ctx.stroke();
			}
		}
	}
}

// ── Dirt floor ────────────────────────────────────────────────────────────
export function drawDirtFloor(rc: RenderCtx, x: number, y: number, w: number, h: number, baseColor: string) {
	const { ctx, isDark } = rc;
	ctx.fillStyle = baseColor;
	ctx.fillRect(x, y, w, h);
	for (let cx2 = x; cx2 < x + w; cx2 += 16) {
		for (let cy2 = y; cy2 < y + h; cy2 += 16) {
			const r = tileNoise(cx2, cy2);
			if (r > 0.5) {
				ctx.fillStyle = isDark ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.1)";
				ctx.beginPath();
				ctx.arc(cx2 + r * 10, cy2 + r * 10, 2 + r * 2, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}
}

// ── Grass floor ───────────────────────────────────────────────────────────
export function drawGrassFloor(rc: RenderCtx, x: number, y: number, w: number, h: number) {
	const { ctx, isDark } = rc;
	ctx.fillStyle = isDark ? "#1a4020" : "#4ade80";
	ctx.fillRect(x, y, w, h);
	ctx.strokeStyle = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.1)";
	for (let cx2 = x; cx2 < x + w; cx2 += 12) {
		for (let cy2 = y; cy2 < y + h; cy2 += 12) {
			const r = tileNoise(cx2, cy2);
			if (r > 0.4) {
				ctx.beginPath();
				ctx.moveTo(cx2 + r * 5, cy2 + 8);
				ctx.lineTo(cx2 + r * 5 + 2, cy2 + 2);
				ctx.lineTo(cx2 + r * 5 + 4, cy2 + 8);
				ctx.stroke();
			}
		}
	}
}

// ── Wood plank floor ──────────────────────────────────────────────────────
export function drawWoodPlankFloor(rc: RenderCtx, x: number, y: number, w: number, h: number) {
	const { ctx, isDark } = rc;
	const pH = 9;
	const baseR = isDark ? 30 : 180;
	const baseG = isDark ? 22 : 140;
	const baseB = isDark ? 12 : 80;
	ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
	ctx.fillRect(x, y, w, h);

	for (let py = Math.floor(y / pH) * pH; py < y + h; py += pH) {
		const row = Math.round(py / pH);
		const shade = (tileNoise(row, 0) * 30 - 15) * (isDark ? 0.8 : 0.6);
		const r = Math.round(Math.min(255, Math.max(0, baseR + shade)));
		const g = Math.round(Math.min(255, Math.max(0, baseG + shade)));
		const b = Math.round(Math.min(255, Math.max(0, baseB + shade)));
		ctx.fillStyle = `rgb(${r},${g},${b})`;
		ctx.fillRect(x, py, w, pH);
		ctx.strokeStyle = isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.07)";
		ctx.lineWidth = 0.5;
		ctx.beginPath();
		ctx.moveTo(x, py);
		ctx.lineTo(x + w, py);
		ctx.stroke();
		const offset = (row % 2) * 55 + tileNoise(row, 1) * 40;
		for (let jx = x + offset; jx < x + w; jx += 80 + tileNoise(row, jx) * 20) {
			ctx.beginPath();
			ctx.moveTo(jx, py);
			ctx.lineTo(jx, py + pH);
			ctx.stroke();
		}
	}
}

// ── Carpet floor ──────────────────────────────────────────────────────────
export function drawCarpetFloor(rc: RenderCtx, x: number, y: number, w: number, h: number, color: string) {
	const { ctx, isDark } = rc;
	ctx.fillStyle = isDark ? "#100d18" : "#1a1535";
	ctx.fillRect(x, y, w, h);
	ctx.strokeStyle = `rgba(${parseInt(color.slice(1, 3), 16)},${parseInt(color.slice(3, 5), 16)},${parseInt(color.slice(5, 7), 16)},0.06)`;
	ctx.lineWidth = 1;
	const sp = 8;
	for (let d = -h; d < w + h; d += sp) {
		ctx.beginPath();
		ctx.moveTo(x + d, y);
		ctx.lineTo(x + d + h, y + h);
		ctx.stroke();
	}
	ctx.strokeStyle = isDark ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.04)";
	ctx.lineWidth = 0.5;
	for (let cx2 = x; cx2 < x + w; cx2 += 12) {
		ctx.beginPath();
		ctx.moveTo(cx2, y);
		ctx.lineTo(cx2, y + h);
		ctx.stroke();
	}
	for (let cy2 = y; cy2 < y + h; cy2 += 12) {
		ctx.beginPath();
		ctx.moveTo(x, cy2);
		ctx.lineTo(x + w, cy2);
		ctx.stroke();
	}
}

// ── Cracked tile floor ────────────────────────────────────────────────────
export function drawCrackedTileFloor(rc: RenderCtx, x: number, y: number, w: number, h: number) {
	const { ctx, isDark } = rc;
	const t = 18;
	const base = isDark ? "#1c1410" : "#c8b89a";
	ctx.fillStyle = base;
	ctx.fillRect(x, y, w, h);
	for (let tx = Math.floor(x / t) * t; tx < x + w; tx += t) {
		for (let ty = Math.floor(y / t) * t; ty < y + h; ty += t) {
			const n = tileNoise(Math.round(tx / t), Math.round(ty / t));
			const r2 = (n * 30 - 15) * (isDark ? 0.7 : 0.5);
			ctx.fillStyle = isDark ? `rgba(255,${100 + r2},${50 + r2},0.04)` : `rgba(180,${140 + r2},${100 + r2},0.3)`;
			ctx.fillRect(tx, ty, t, t);
			if (n > 0.85) {
				ctx.strokeStyle = isDark ? "rgba(0,0,0,0.6)" : "rgba(100,80,60,0.5)";
				ctx.lineWidth = 0.75;
				ctx.beginPath();
				ctx.moveTo(tx + n * t, ty + 2);
				ctx.lineTo(tx + t / 2 + n * 5, ty + t / 2);
				ctx.lineTo(tx + t * 0.8, ty + t - 2);
				ctx.stroke();
			}
		}
	}
	ctx.strokeStyle = isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.12)";
	ctx.lineWidth = 1;
	for (let tx = Math.floor(x / t) * t; tx <= x + w; tx += t) {
		ctx.beginPath();
		ctx.moveTo(tx, y);
		ctx.lineTo(tx, y + h);
		ctx.stroke();
	}
	for (let ty = Math.floor(y / t) * t; ty <= y + h; ty += t) {
		ctx.beginPath();
		ctx.moveTo(x, ty);
		ctx.lineTo(x + w, ty);
		ctx.stroke();
	}
}

// ── Clean tile floor ──────────────────────────────────────────────────────
export function drawCleanTileFloor(rc: RenderCtx, x: number, y: number, w: number, h: number) {
	const { ctx, isDark } = rc;
	const t = 22;
	const c0 = isDark ? "#1a2530" : "#f0f4f8";
	const c1 = isDark ? "#1f2d3a" : "#e8eef4";
	ctx.fillStyle = c0;
	ctx.fillRect(x, y, w, h);
	for (let tx = Math.floor(x / t) * t; tx < x + w; tx += t) {
		for (let ty = Math.floor(y / t) * t; ty < y + h; ty += t) {
			if (((Math.round(tx / t) + Math.round(ty / t)) & 1) === 0) {
				ctx.fillStyle = c1;
				ctx.fillRect(tx + 1, ty + 1, t - 2, t - 2);
				ctx.fillStyle = isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.6)";
				ctx.fillRect(tx + 3, ty + 3, 5, 5);
			}
		}
	}
	ctx.strokeStyle = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)";
	ctx.lineWidth = 0.75;
	for (let tx = Math.floor(x / t) * t; tx <= x + w; tx += t) {
		ctx.beginPath();
		ctx.moveTo(tx, y);
		ctx.lineTo(tx, y + h);
		ctx.stroke();
	}
	for (let ty = Math.floor(y / t) * t; ty <= y + h; ty += t) {
		ctx.beginPath();
		ctx.moveTo(x, ty);
		ctx.lineTo(x + w, ty);
		ctx.stroke();
	}
}

// ── Concrete floor ────────────────────────────────────────────────────────
export function drawConcreteFloor(rc: RenderCtx, x: number, y: number, w: number, h: number) {
	const { ctx, isDark } = rc;
	ctx.fillStyle = isDark ? "#141418" : "#b8bec8";
	ctx.fillRect(x, y, w, h);
	ctx.strokeStyle = isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.15)";
	ctx.lineWidth = 1;
	for (let cy2 = y; cy2 < y + h; cy2 += 4) {
		if (tileNoise(0, Math.round(cy2)) > 0.5) {
			ctx.beginPath();
			ctx.moveTo(x, cy2);
			ctx.lineTo(x + w, cy2);
			ctx.stroke();
		}
	}
	ctx.strokeStyle = isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.1)";
	ctx.lineWidth = 1.5;
	const jH = 80;
	for (let jy = y + (jH - (y % jH || jH)); jy < y + h; jy += jH) {
		ctx.beginPath();
		ctx.moveTo(x, jy);
		ctx.lineTo(x + w, jy);
		ctx.stroke();
	}
}
