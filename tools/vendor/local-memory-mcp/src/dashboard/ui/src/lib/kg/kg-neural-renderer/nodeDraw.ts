/**
 * Node draw-pass: culling → twinkle/radius/alpha → particle raster → hover/
 * select label pill (with type subtitle).
 *
 * Combined raster + label logic of the frame loop. Hover labels are skipped
 * while dragging (TASK-277): the pointer is travelling across the scene, the
 * hover target lags behind, and re-measuring/re-batching the pill every frame
 * during the most expensive interaction is wasted raster. Selected labels are
 * kept so the active entity stays readable.
 */
import {
	FOG_FAR,
	PARTICLE_BASE_RADIUS,
	PARTICLE_IMPORTANT_RADIUS,
	PARTICLE_SUBTLE_MIN,
	TWINKLE_SPEED,
	roundRect
} from "./layout";
import type { ProjectedNode } from "./layout";
import type { NeuralRenderState } from "./nodes";
import { drawParticle } from "./nodes";

export interface DrawNodeLayerInput {
	projected: ProjectedNode[];
	state: NeuralRenderState;
	cam: { effectiveFocalLength: number };
	dark: boolean;
	now: number;
	dragging: boolean;
	viewport: { left: number; right: number; top: number; bottom: number };
}

export function drawNodeLayer(ctx: CanvasRenderingContext2D, input: DrawNodeLayerInput): void {
	const { projected, state, cam, dark, now, dragging, viewport } = input;
	const { left: viewLeft, right: viewRight, top: viewTop, bottom: viewBottom } = viewport;

	for (const p of projected) {
		const n3d = p.node3d;
		const node = n3d.node;
		const isHovered = state.hoveredNode === node;
		const isSelected = state.selectedNode === node;

		// Viewport frustum culling — skip nodes entirely outside viewport
		if (p.sx < viewLeft || p.sx > viewRight || p.sy < viewTop || p.sy > viewBottom) {
			continue;
		}

		// Twinkle
		const twinkle = 0.7 + 0.3 * Math.sin(now * TWINKLE_SPEED + n3d.phaseOffset);

		// Radius: important nodes (degree >= 5 or memoryCount > 0) get larger
		const isImportant = n3d.isHub || (node.memoryCount != null && node.memoryCount > 0);
		const baseR = isImportant ? PARTICLE_IMPORTANT_RADIUS : PARTICLE_BASE_RADIUS;
		const radius = baseR * Math.min(p.scale, 1.3);

		if (radius < 0.3 || p.scale < 0.05) continue;

		// Base alpha from depth
		const baselineScale = cam.effectiveFocalLength / (cam.effectiveFocalLength + FOG_FAR);
		const normalizedScale = p.scale / baselineScale;
		const depthAlpha = Math.max(0.25, Math.min(1, (normalizedScale - 0.15) / 0.85));

		// Hover/select boost
		const hoverBoost = isHovered || isSelected ? 1.5 : 1.0;
		const finalRadius = radius * hoverBoost;

		// Subtle minimum for deep particles
		const drawRadius = Math.max(PARTICLE_SUBTLE_MIN, finalRadius);

		drawParticle(ctx, p.sx, p.sy, p.depth, n3d.color, drawRadius, depthAlpha, twinkle, dark, dragging);

		// Hover/select label (see module doc: hover labels skipped while dragging)
		if (((isHovered && !dragging) || isSelected) && normalizedScale > 0.15) {
			const labelAlpha = Math.max(0, (normalizedScale - 0.15) / 0.85) * depthAlpha;
			if (labelAlpha > 0.05) {
				const darkLabel = dark;
				ctx.save();
				ctx.globalAlpha = labelAlpha;

				// Background pill for readability
				const name = node.name;
				ctx.font = "bold 10px system-ui,sans-serif";
				const tw = ctx.measureText(name).width;
				const pillPad = 6;
				const pillH = 18;
				const pillY = p.sy + drawRadius + 6;

				ctx.fillStyle = darkLabel ? "rgba(2,6,23,0.85)" : "rgba(255,255,255,0.9)";
				ctx.shadowColor = "rgba(0,0,0,0.3)";
				ctx.shadowBlur = 8;
				roundRect(ctx, p.sx - tw / 2 - pillPad, pillY, tw + pillPad * 2, pillH, 4);
				ctx.fill();
				ctx.shadowBlur = 0;

				// Name text
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillStyle = darkLabel ? "#e2e8f0" : "#1e293b";
				ctx.fillText(name, p.sx, pillY + pillH / 2);

				// Type subtitle below pill
				if (node.type) {
					ctx.font = "8px system-ui,sans-serif";
					ctx.fillStyle = darkLabel ? "rgba(148,163,184,0.7)" : "rgba(100,116,139,0.7)";
					ctx.textBaseline = "top";
					ctx.fillText(node.type, p.sx, pillY + pillH + 2);
				}

				ctx.restore();
			}
		}
	}
}
