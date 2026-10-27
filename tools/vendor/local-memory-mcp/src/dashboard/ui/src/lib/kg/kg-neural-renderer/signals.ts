/**
 * Signal management for the Knowledge Graph Neural Renderer.
 *
 * Manages signal spawning, updating, and lifecycle.
 */

import type { Signal } from "./edges";
import type { Node3D, RotationTrig } from "./layout";
import type { LayoutNode, LayoutEdge } from "../KGForceLayout";
import { SIGNAL_SPAWN_INTERVAL, MAX_SIGNALS, SIGNAL_SPEED, fogFactor, project3D } from "./layout";
import { getSignalHaloGradient, SIGNAL_HALO_REF_RADIUS } from "./nodes";
import type { CameraProjectionInput } from "./projection";

// ─── Module-Level State ─────────────────────────────────────────────────────

const signals: Signal[] = [];
let lastSignalSpawn = 0;

// ─── Pre-computed hub edges for O(1) lookup ────────────────────────────────
const hubEdgesCache: Map<string, LayoutEdge[]> = new Map();

export function clearSignals(): void {
	signals.length = 0;
	lastSignalSpawn = 0;
	hubEdgesCache.clear();
}

export function getSignals(): Signal[] {
	return signals;
}

// ─── Build hub edges cache (call once per data update) ─────────────────────

function buildHubEdgesCache(nodes3d: Node3D[], animEdges: LayoutEdge[]): void {
	hubEdgesCache.clear();
	for (const n3d of nodes3d) {
		if (!n3d.isHub) continue;
		const nodeId = n3d.node.id;
		const edges: LayoutEdge[] = [];
		for (const e of animEdges) {
			if (e.source === nodeId || e.target === nodeId) {
				edges.push(e);
			}
		}
		if (edges.length > 0) {
			hubEdgesCache.set(nodeId, edges);
		}
	}
}

// ─── Hub signal spawning ───────────────────────────────────────────────────

export function spawnSignals(
	now: number,
	nodes3d: Node3D[],
	animEdges: LayoutEdge[],
	nodeIndexById: Map<string, number>
): void {
	if (now - lastSignalSpawn < SIGNAL_SPAWN_INTERVAL) return;
	if (signals.length >= MAX_SIGNALS) return;
	lastSignalSpawn = now;

	// Build cache if empty (first call or after data update)
	if (hubEdgesCache.size === 0 && nodes3d.length > 0) {
		buildHubEdgesCache(nodes3d, animEdges);
	}

	for (const n3d of nodes3d) {
		if (!n3d.isHub) continue;
		if (signals.length >= MAX_SIGNALS) break;

		// O(1) lookup from pre-computed cache
		const hubEdges = hubEdgesCache.get(n3d.node.id);
		if (!hubEdges || hubEdges.length === 0) continue;

		const edge = hubEdges[Math.floor(Math.random() * hubEdges.length)];
		const fromId = edge.source === n3d.node.id ? edge.source : edge.target;
		const toId = edge.source === n3d.node.id ? edge.target : edge.source;

		const fromIdx = nodeIndexById.get(fromId);
		const toIdx = nodeIndexById.get(toId);
		if (fromIdx === undefined || toIdx === undefined) continue;

		if (Math.random() > 0.4) continue;

		signals.push({
			fromIdx,
			toIdx,
			progress: 0,
			createdAt: now,
			color: n3d.color
		});
	}
}

// ─── Signal update ─────────────────────────────────────────────────────────

export function updateSignals(): void {
	for (let i = signals.length - 1; i >= 0; i--) {
		signals[i].progress += SIGNAL_SPEED;
		if (signals[i].progress >= 1) {
			signals.splice(i, 1);
		}
	}
}

// ─── Signal draw pass ───────────────────────────────────────────────────────

export interface DrawSignalLayerInput {
	animNodes: LayoutNode[];
	nodes3d: Node3D[];
	cx: number;
	cy: number;
	width: number;
	height: number;
	breathe: number;
	cam: CameraProjectionInput;
	frameTrig: RotationTrig;
	dark: boolean;
}

/**
 * Rasters the active signals as tiny bright particles travelling along their
 * edges (skipped by the caller while dragging — decorative only, keeps the
 * pointer hot path lean; ~30 gradient draws/frame saved during pan).
 */
export function drawSignalLayer(ctx: CanvasRenderingContext2D, input: DrawSignalLayerInput): void {
	const { animNodes, nodes3d, cx, cy, width, height, breathe, cam, frameTrig, dark } = input;

	for (const sig of signals) {
		const fromN = animNodes[sig.fromIdx];
		const toN = animNodes[sig.toIdx];
		if (!fromN || !toN) continue;

		const fromN3d = nodes3d[sig.fromIdx];
		const toN3d = nodes3d[sig.toIdx];
		if (!fromN3d || !toN3d) continue;

		// Interpolate 3D position
		const ix = (fromN.x + (toN.x - fromN.x) * sig.progress - cx) * breathe + cx;
		const iy = (fromN.y + (toN.y - fromN.y) * sig.progress - cy) * breathe + cy;
		const iz = (fromN3d.z + (toN3d.z - fromN3d.z) * sig.progress) * breathe;

		const proj = project3D(
			ix - cx,
			iy - cy,
			iz,
			width,
			height,
			cam.rotY,
			cam.rotX,
			cam.effectiveFocalLength,
			frameTrig
		);

		const brightness = Math.sin(sig.progress * Math.PI);
		if (brightness <= 0 || proj.scale < 0.05) continue;

		// Draw signal as a tiny bright particle
		const sigFog = fogFactor(proj.depth);
		const sigAlpha = brightness * sigFog;
		const size = Math.max(0.5, (1.5 + brightness * 1.2) * Math.min(proj.scale, 1.5));

		ctx.save();

		if (dark) {
			ctx.globalCompositeOperation = "lighter";

			// Outer glow
			ctx.beginPath();
			ctx.arc(proj.sx, proj.sy, size * 3, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${sig.color.r},${sig.color.g},${sig.color.b},${sigAlpha * 0.15})`;
			ctx.fill();

			// Core
			const br = Math.min(255, sig.color.r + 80);
			const bg = Math.min(255, sig.color.g + 80);
			const bb = Math.min(255, sig.color.b + 80);
			ctx.beginPath();
			ctx.arc(proj.sx, proj.sy, size, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${br},${bg},${bb},${sigAlpha * 0.9})`;
			ctx.fill();
		} else {
			// Light mode: darken signal colors for contrast
			const darken = (v: number) => Math.round(v * 0.65);
			const sr = darken(sig.color.r);
			const sg = darken(sig.color.g);
			const sb = darken(sig.color.b);

			// Normal blending with soft halo. The halo gradient is built
			// once per color (cached, origin-centered) and drawn in a
			// per-signal translate/scale — the inner stop bakes a fixed
			// 0.25 multiplier and ctx.globalAlpha applies the per-signal
			// alpha (alpha-in-string was `sigAlpha * 0.25`, identical).
			const outerR = size * 2.5;
			ctx.save();
			ctx.translate(proj.sx, proj.sy);
			ctx.scale(outerR / SIGNAL_HALO_REF_RADIUS, outerR / SIGNAL_HALO_REF_RADIUS);
			ctx.globalAlpha = sigAlpha;
			ctx.fillStyle = getSignalHaloGradient(ctx, { r: sr, g: sg, b: sb });
			ctx.beginPath();
			ctx.arc(0, 0, SIGNAL_HALO_REF_RADIUS, 0, Math.PI * 2);
			ctx.fill();
			ctx.restore();

			// Core
			ctx.beginPath();
			ctx.arc(proj.sx, proj.sy, Math.max(1.2, size), 0, Math.PI * 2);
			ctx.fillStyle = `rgba(${sr},${sg},${sb},${sigAlpha})`;
			ctx.fill();
		}

		ctx.restore();
	}
}
