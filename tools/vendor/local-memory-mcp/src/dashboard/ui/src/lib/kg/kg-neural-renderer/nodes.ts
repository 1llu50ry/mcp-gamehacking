/**
 * Node rendering for the Knowledge Graph Neural Renderer.
 */

import type { LayoutNode, LayoutEdge } from "../KGForceLayout";
import { isDarkMode, fogFactor, roundRect, PALETTE } from "./layout";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface NeuralRenderState {
	hoveredNode: LayoutNode | null;
	selectedNode: LayoutNode | null;
	selectedEdge: LayoutEdge | null;
	showTooltip: boolean;
	tooltipPos: { x: number; y: number };
	hiddenNodeCount?: number;
}

// ─── Particle Drawing — Tiny Star with Soft Bloom ────────────────────────────

// ─── Radial Gradient Cache ───────────────────────────────────────────────────
// The per-particle glow gradient is identical for every particle of the same
// color and theme (the color stops are fixed *fractions* of the outer radius).
// The gradient is built once, centered at the origin with a reference outer
// radius, then drawn inside a per-particle translate/scale (see below). Because
// the stops are relative to GLOW_REF_RADIUS, scaling reproduces the exact same
// gradient shape at any position/radius — no allocation per frame per particle.
// Alpha is applied via ctx.globalAlpha so the cached gradient object can be
// shared regardless of each particle's blend/twinkle alpha.
const GLOW_REF_RADIUS = 100;
const glowGradientCache = new Map<string, CanvasGradient>();
let glowGradientCacheDark: boolean | null = null;

function darkenColor(color: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
	return {
		r: Math.round(color.r * 0.65),
		g: Math.round(color.g * 0.65),
		b: Math.round(color.b * 0.65)
	};
}

function getGlowGradient(
	ctx: CanvasRenderingContext2D,
	dark: boolean,
	color: { r: number; g: number; b: number }
): CanvasGradient {
	// Invalidate cache on theme change (gradient stops differ per theme)
	if (glowGradientCacheDark !== dark) {
		glowGradientCache.clear();
		glowGradientCacheDark = dark;
	}

	const key = `${color.r},${color.g},${color.b}`;
	let grad = glowGradientCache.get(key);
	if (grad) return grad;

	grad = ctx.createRadialGradient(0, 0, 0, 0, 0, GLOW_REF_RADIUS);
	if (dark) {
		// Dark mode: additive glow (original cinematic look)
		grad.addColorStop(0, `rgba(${color.r},${color.g},${color.b},0.2)`);
		grad.addColorStop(0.5, `rgba(${color.r},${color.g},${color.b},0.05)`);
		grad.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
	} else {
		// Light mode: darken colors for contrast against light background
		const c = darkenColor(color);
		grad.addColorStop(0, `rgba(${c.r},${c.g},${c.b},0.18)`);
		grad.addColorStop(0.4, `rgba(${c.r},${c.g},${c.b},0.07)`);
		grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
	}
	glowGradientCache.set(key, grad);
	return grad;
}

// ─── Signal Halo Gradient Cache ──────────────────────────────────────────────
// The light-mode signal halo (index.ts) is the LAST remaining per-frame
// `createRadialGradient` allocation. Like the particle glow, its color stops
// are fixed *fractions* of the halo radius — the inner stop alpha is a fixed
// 0.25 multiplier of the per-signal alpha, which is applied via
// ctx.globalAlpha (alpha-in-string would be `sigAlpha * 0.25`, identical).
// The gradient is built once, origin-centered with a reference radius, then
// drawn inside a per-signal translate/scale — same pattern as TASK-192.
export const SIGNAL_HALO_REF_RADIUS = 100;
const signalHaloGradientCache = new Map<string, CanvasGradient>();
/**
 * Returns the cached origin-centered light-mode signal halo gradient for a
 * (already darkened) color. Draw with `ctx.globalAlpha = sigAlpha` and a
 * translate/scale of `outerR / SIGNAL_HALO_REF_RADIUS`.
 */
export function getSignalHaloGradient(
	ctx: CanvasRenderingContext2D,
	color: { r: number; g: number; b: number }
): CanvasGradient {
	const key = `${color.r},${color.g},${color.b}`;
	let grad = signalHaloGradientCache.get(key);
	if (grad) return grad;
	grad = ctx.createRadialGradient(0, 0, 0, 0, 0, SIGNAL_HALO_REF_RADIUS);
	grad.addColorStop(0, `rgba(${color.r},${color.g},${color.b},0.25)`);
	grad.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
	signalHaloGradientCache.set(key, grad);
	return grad;
}

// ─── Precomputed Core Fill Colors (palette color × theme) ────────────────────
// Core colors are a pure function of the palette color and theme — the alpha
// is fixed per theme (dark 0.9, light 1.0) and only ~5 palette colors exist.
// All rgba() strings are built ONCE at module load instead of being allocated
// per particle per frame (~600 string allocations/frame at 300 nodes). Every
// particle of the same color reuses the same fillStyle string, so no per-frame
// min/round color math or template-literal allocation happens in the draw loop.
//
// NOTE: cores are intentionally NOT merged into one combined path per color
// bucket. A single path fill of overlapping circles fills the union once,
// whereas the original per-circle fills composite per circle (alpha
// accumulates differently under source-over in light mode and under "lighter"
// in dark mode). Merging would change the rendered pixels — this keeps EXACT
// visual output while removing the allocation/state-change cost of the fills.
export interface CoreColorTableEntry {
	/** Dark-mode core (brightened +60, alpha 0.9, drawn additive). */
	dark: string;
	/** Light-mode core (darkened color, opaque). */
	light: string;
	/** Light-mode inner bright core (darkened +80, opaque). */
	lightInner: string;
}

function buildCoreColorEntry(color: { r: number; g: number; b: number }): CoreColorTableEntry {
	const c = darkenColor(color);
	return {
		dark: `rgba(${Math.min(255, color.r + 60)},${Math.min(255, color.g + 60)},${Math.min(255, color.b + 60)},0.9)`,
		light: `rgba(${c.r},${c.g},${c.b},1)`,
		lightInner: `rgba(${Math.min(255, c.r + 80)},${Math.min(255, c.g + 80)},${Math.min(255, c.b + 80)},1)`
	};
}

/**
 * Builds the per-color core fillStyle lookup table for a palette. Pure
 * function — keys are the palette color object references (getNodeColor
 * returns these exact PALETTE objects, so identity lookup is O(1) with zero
 * string allocation in the draw loop).
 */
export function buildCoreColorTable(
	palette: { r: number; g: number; b: number }[]
): Map<{ r: number; g: number; b: number }, CoreColorTableEntry> {
	const table = new Map<{ r: number; g: number; b: number }, CoreColorTableEntry>();
	for (const color of palette) {
		table.set(color, buildCoreColorEntry(color));
	}
	return table;
}

const coreColorTable = buildCoreColorTable(PALETTE);

/** O(1) fillStyle lookup; falls back to computing inline for non-palette colors. */
function getCoreColorEntry(color: { r: number; g: number; b: number }): CoreColorTableEntry {
	return coreColorTable.get(color) ?? buildCoreColorEntry(color);
}

export function drawParticle(
	ctx: CanvasRenderingContext2D,
	sx: number,
	sy: number,
	depth: number,
	color: { r: number; g: number; b: number },
	radius: number,
	baseAlpha: number,
	twinkle: number,
	dark: boolean,
	/** TASK-277: during camera drag, skip the decorative bloom layer. */
	simplified = false
) {
	const fog = fogFactor(depth);
	const finalAlpha = baseAlpha * fog * twinkle;

	if (finalAlpha < 0.01) return;

	ctx.save();

	// Apply per-particle alpha once for the whole particle (glow + cores).
	// The cached gradient + core fill colors bake fixed multipliers and rely
	// on globalAlpha to scale their opacity — visually identical to the original
	// alpha-in-string approach while letting the gradient be reused.
	ctx.globalAlpha = finalAlpha;

	if (dark) {
		ctx.globalCompositeOperation = "lighter";

		// Glow — drawn in a transformed space so the shared origin-centered
		// gradient can be reused for any particle position/radius. Skipped
		// while dragging: it is the costliest raster of the particle (~300
		// "lighter"-composite gradient fills/frame) and the bloom is barely
		// visible while the scene is in motion.
		if (!simplified) {
			ctx.save();
			ctx.translate(sx, sy);
			ctx.scale((radius * 5) / GLOW_REF_RADIUS, (radius * 5) / GLOW_REF_RADIUS);
			ctx.fillStyle = getGlowGradient(ctx, dark, color);
			ctx.beginPath();
			ctx.arc(0, 0, GLOW_REF_RADIUS, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}

		// Core particle — fillStyle from the precomputed table (zero alloc)
		ctx.beginPath();
		ctx.arc(sx, sy, Math.max(0.5, radius), 0, Math.PI * 2);
		ctx.fillStyle = getCoreColorEntry(color).dark;
		ctx.fill();
	} else {
		const core = getCoreColorEntry(color);

		// Glow — see dark mode comment above
		if (!simplified) {
			ctx.save();
			ctx.translate(sx, sy);
			ctx.scale((radius * 4) / GLOW_REF_RADIUS, (radius * 4) / GLOW_REF_RADIUS);
			ctx.fillStyle = getGlowGradient(ctx, dark, color);
			ctx.beginPath();
			ctx.arc(0, 0, GLOW_REF_RADIUS, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();
		}

		// Core particle — full color, solid
		ctx.beginPath();
		ctx.arc(sx, sy, Math.max(1.0, radius), 0, Math.PI * 2);
		ctx.fillStyle = core.light;
		ctx.fill();

		// Inner bright core
		const ir = Math.max(0.5, radius * 0.45);
		ctx.beginPath();
		ctx.arc(sx, sy, ir, 0, Math.PI * 2);
		ctx.fillStyle = core.lightInner;
		ctx.fill();
	}

	ctx.restore();
}

// ─── Tooltip Drawing ─────────────────────────────────────────────────────────

export function drawTooltip(
	ctx: CanvasRenderingContext2D,
	node: LayoutNode,
	pos: { x: number; y: number },
	canvasWidth: number,
	canvasHeight: number
) {
	const dark = isDarkMode();
	ctx.save();
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

	ctx.fillStyle = dark ? "rgba(2,6,23,0.92)" : "rgba(255,255,255,0.95)";
	ctx.shadowColor = "rgba(0,0,0,0.2)";
	ctx.shadowBlur = 12;
	roundRect(ctx, tx, ty, tw, th, 8);
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.strokeStyle = dark ? "rgba(148,163,184,0.2)" : "rgba(0,0,0,0.08)";
	ctx.lineWidth = 1;
	roundRect(ctx, tx, ty, tw, th, 8);
	ctx.stroke();

	ctx.textAlign = "left";
	ctx.textBaseline = "top";
	for (let i = 0; i < lines.length; i++) {
		const isTitle = i === 0;
		ctx.font = isTitle ? "bold 12px system-ui,sans-serif" : "10px system-ui,sans-serif";
		ctx.fillStyle = dark ? "#e2e8f0" : "#1e293b";
		ctx.fillText(lines[i], tx + pad, ty + pad + i * lh);
	}
	ctx.restore();
}

// ─── Overflow Notice ─────────────────────────────────────────────────────────

export function drawOverflowNotice(ctx: CanvasRenderingContext2D, w: number, hiddenNodeCount: number) {
	const dark = isDarkMode();
	ctx.save();
	const label = `+${hiddenNodeCount} hidden`;
	ctx.font = "bold 11px system-ui,sans-serif";
	ctx.textAlign = "right";
	ctx.textBaseline = "top";
	const padX = 10;
	const padY = 7;
	const noticeWidth = ctx.measureText(label).width + padX * 2;
	const noticeHeight = 26;
	const x = Math.max(8, w - noticeWidth - 12);
	const y = 12;

	ctx.fillStyle = dark ? "rgba(15,23,42,0.88)" : "rgba(255,255,255,0.9)";
	roundRect(ctx, x, y, noticeWidth, noticeHeight, 999);
	ctx.fill();
	ctx.strokeStyle = dark ? "rgba(148,163,184,0.28)" : "rgba(59,130,246,0.22)";
	ctx.lineWidth = 1;
	roundRect(ctx, x, y, noticeWidth, noticeHeight, 999);
	ctx.stroke();
	ctx.fillStyle = dark ? "#bfdbfe" : "#1d4ed8";
	ctx.fillText(label, x + noticeWidth - padX, y + padY);
	ctx.restore();
}
