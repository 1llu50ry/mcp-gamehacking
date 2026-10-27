/**
 * Layout utilities for the Knowledge Graph Neural Renderer.
 *
 * Pure utility functions and constants — no module-level state.
 */

import type { LayoutNode } from "../KGForceLayout";

// ─── Constants ───────────────────────────────────────────────────────────────

// Particle sizes (tiny!)
export const PARTICLE_BASE_RADIUS = 1.5;
export const PARTICLE_IMPORTANT_RADIUS = 5;
export const PARTICLE_SUBTLE_MIN = 0.8;

// Edges — very thin
export const EDGE_BASE_WIDTH = 0.5;

// Camera
export const CAMERA_DISTANCE = 500;
export const CAMERA_ROTATION_SPEED = 0.00008;
export const CAMERA_TILT_AMOUNT = 0.08;
export const FOCAL_LENGTH = 300;

// Depth / Fog
export const FOG_NEAR = 150;
export const FOG_FAR = 700;

// Breathing
export const BREATHE_SPEED = 0.0002;
export const BREATHE_AMOUNT = 0.015;

// Twinkle
export const TWINKLE_SPEED = 0.001;
export const TWINKLE_AMOUNT = 0.3;

// Signals
export const MAX_SIGNALS = 30;
export const SIGNAL_SPEED = 0.0008;
export const SIGNAL_SPAWN_INTERVAL = 800;

// Camera control
export const ZOOM_LERP = 0.12;
export const ZOOM_MIN = 150;
export const ZOOM_MAX = 2000;
export const DRAG_SENSITIVITY = 0.005;
export const AUTO_ROTATE_RESUME_MS = 3000;

// ─── Colors — Cyberpunk / Holographic ────────────────────────────────────────

export const PALETTE = [
	{ r: 0, g: 212, b: 255 }, // electric cyan
	{ r: 139, g: 92, b: 246 }, // violet
	{ r: 79, g: 70, b: 229 }, // indigo
	{ r: 236, g: 72, b: 153 }, // soft magenta
	{ r: 100, g: 180, b: 255 }, // light blue
	{ r: 250, g: 204, b: 21 } // amber — codebase symbol kinds (TASK-329)
];

export const TYPE_COLOR_INDEX: Record<string, number> = {
	person: 1,
	place: 2,
	organization: 3,
	concept: 0,
	unknown: 4,
	// Codebase symbol kinds (TASK-329 code-graph force panel). Additive: KG
	// entity types keep their indices above; these keys only affect codebase
	// graph nodes (LayoutNode.type = CodeGraphNode.kind). Any other kind falls
	// back to index 4 (light blue) via getNodeColor's `?? 4`.
	function: 0,
	class: 1,
	interface: 2,
	type: 3,
	enum: 4,
	variable: 5
};

export const BG_DARK = "#050a1a";
export const BG_LIGHT = "#e2e8f0";

// ─── Internal 3D Types ──────────────────────────────────────────────────────

export interface Node3D {
	node: LayoutNode;
	x: number;
	y: number;
	z: number;
	phaseOffset: number;
	isHub: boolean;
	degree: number;
	color: { r: number; g: number; b: number };
	firing: boolean;
	fireTimer: number;
	fireStartTime: number;
}

export interface ProjectedNode {
	sx: number;
	sy: number;
	z: number;
	scale: number;
	depth: number;
	node3d: Node3D;
}

// ─── Theme Detection ─────────────────────────────────────────────────────────

export function isDarkMode(): boolean {
	return document.documentElement.classList.contains("dark");
}

// ─── Color Helpers ───────────────────────────────────────────────────────────

export function getNodeColor(type: string): { r: number; g: number; b: number } {
	const idx = TYPE_COLOR_INDEX[type] ?? 4;
	return PALETTE[idx];
}

// ─── Fog Calculation ─────────────────────────────────────────────────────────

export function fogFactor(z: number): number {
	const depth = (z + FOG_FAR) / (FOG_FAR * 2);
	return Math.max(0.25, Math.min(1, 1 - depth));
}

// ─── 3D Projection — Dual-Axis Rotation ──────────────────────────────────────

/**
 * The 4 rotation trig values used by `project3D`. `rotY`/`rotX` are frame
 * constants (camera rotation only changes once per frame), so these are
 * computed ONCE per frame and shared by every node/signal projection instead
 * of recomputing 4 trig calls per node (~1200/frame at 300 nodes → 4/frame).
 */
export interface RotationTrig {
	cosY: number;
	sinY: number;
	cosX: number;
	sinX: number;
}

export function computeRotationTrig(rotY: number, rotX: number): RotationTrig {
	return {
		cosY: Math.cos(rotY),
		sinY: Math.sin(rotY),
		cosX: Math.cos(rotX),
		sinX: Math.sin(rotX)
	};
}

export function project3D(
	x: number,
	y: number,
	z: number,
	width: number,
	height: number,
	rotY: number,
	rotX: number,
	focalLength: number,
	trig?: RotationTrig
): { sx: number; sy: number; z: number; scale: number; depth: number } {
	// Use the precomputed per-frame trig when supplied (hot path); fall back to
	// computing inline for standalone callers without a cached frame trig.
	const { cosY, sinY, cosX, sinX } = trig ?? computeRotationTrig(rotY, rotX);

	// Rotate around Y axis
	const rx = x * cosY + z * sinY;
	const rz = -x * sinY + z * cosY;

	// Rotate around X axis
	const ry = y * cosX - rz * sinX;
	const finalZ = y * sinX + rz * cosX;

	// Perspective projection
	const denom = focalLength + finalZ;
	const scale = denom > 1 ? focalLength / denom : 1;

	const halfW = width / 2;
	const halfH = height / 2;

	return {
		sx: rx * scale + halfW,
		sy: ry * scale + halfH,
		z: finalZ,
		scale,
		depth: finalZ
	};
}

// ─── Background ──────────────────────────────────────────────────────────────

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
	const dark = isDarkMode();
	const centerX = w / 2;
	const centerY = h / 2;
	const maxR = Math.hypot(centerX, centerY);

	ctx.fillStyle = dark ? BG_DARK : BG_LIGHT;
	ctx.fillRect(0, 0, w, h);

	// Vignette overlay
	const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxR);
	if (dark) {
		grad.addColorStop(0, "rgba(10,14,42,0)");
		grad.addColorStop(0.6, "rgba(10,14,42,0.1)");
		grad.addColorStop(1, "rgba(2,4,12,0.6)");
	} else {
		grad.addColorStop(0, "rgba(226,232,240,0)");
		grad.addColorStop(0.5, "rgba(203,213,225,0.15)");
		grad.addColorStop(1, "rgba(148,163,184,0.3)");
	}
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h);
}

/**
 * Background with per-size/theme gradient caching. First call renders the full
 * background (base fill + vignette via drawBackground) and caches the vignette
 * gradient; later frames with matching size + theme only repaint the cached
 * gradient (identical to the historical per-frame cache in the animation loop).
 */
let cachedBackgroundGradient: CanvasGradient | null = null;
let cachedBackgroundWidth = 0;
let cachedBackgroundHeight = 0;
let cachedBackgroundDark = false;

export function drawBackgroundCached(ctx: CanvasRenderingContext2D, w: number, h: number, dark: boolean): void {
	if (
		cachedBackgroundGradient &&
		cachedBackgroundWidth === w &&
		cachedBackgroundHeight === h &&
		cachedBackgroundDark === dark
	) {
		ctx.fillStyle = cachedBackgroundGradient;
		ctx.fillRect(0, 0, w, h);
		return;
	}
	drawBackground(ctx, w, h);
	// Cache the gradient for next frame
	const centerX = w / 2;
	const centerY = h / 2;
	const maxR = Math.hypot(centerX, centerY);
	const grad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, maxR);
	if (dark) {
		grad.addColorStop(0, "rgba(10,14,42,0)");
		grad.addColorStop(0.6, "rgba(10,14,42,0.1)");
		grad.addColorStop(1, "rgba(2,4,12,0.6)");
	} else {
		grad.addColorStop(0, "rgba(226,232,240,0)");
		grad.addColorStop(0.5, "rgba(203,213,225,0.15)");
		grad.addColorStop(1, "rgba(148,163,184,0.3)");
	}
	cachedBackgroundGradient = grad;
	cachedBackgroundWidth = w;
	cachedBackgroundHeight = h;
	cachedBackgroundDark = dark;
}

// ─── Utility: Rounded Rectangle ──────────────────────────────────────────────

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

// ─── Canvas Sizing ───────────────────────────────────────────────────────────

/**
 * Effective DPR cap for the KG canvas (TASK-271 / audit F3).
 * At DPR 2-3 displays, rendering at native DPR doubles/triples the backing
 * store pixels with no visible gain for this particle graph but a large fill
 * cost per frame (the audit measured 50-85 ms long tasks on a 300-node /
 * 4000-edge graph). Capping at 1.5 cuts raster work by up to 4x on DPR 2
 * displays while keeping edges/particles crisp.
 */
export const MAX_DPR = 1.5;

export function resizeNeuralCanvas(canvas: HTMLCanvasElement): {
	width: number;
	height: number;
	dpr: number;
	ctx: CanvasRenderingContext2D;
} {
	const rect = canvas.parentElement?.getBoundingClientRect();
	const w = rect ? rect.width : 800;
	const h = rect ? rect.height : 600;
	const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
	canvas.width = w * dpr;
	canvas.height = h * dpr;
	canvas.style.width = w + "px";
	canvas.style.height = h + "px";
	const ctx = canvas.getContext("2d")!;
	ctx.scale(dpr, dpr);
	return { width: w, height: h, dpr, ctx };
}
