<script lang="ts">
	import type { ArenaRenderer } from "../lib/arena/arenaRenderer";
	import type { ArenaLayoutConfig, ArenaScene } from "../lib/arena/arenaTypes";
	import { arenaStateManager } from "../lib/arena/arenaStateManager";
	import { STATUS_TO_ZONE } from "../lib/arena/arenaTransform-utils";

	let {
		renderer = null,
		layout = null,
		scene = null,
		isDark = false,
		currentZoom = 1
	}: {
		renderer?: ArenaRenderer | null;
		layout?: ArenaLayoutConfig | null;
		scene?: ArenaScene | null;
		isDark?: boolean;
		currentZoom?: number;
	} = $props();

	let minimapCanvas: HTMLCanvasElement;
	let minimapDragging = false;

	// ── Draw minimap ──────────────────────────────────────────────────────
	function drawMinimap(): void {
		if (!minimapCanvas || !layout) return;
		const ctx = minimapCanvas.getContext("2d");
		if (!ctx) return;

		const mw = minimapCanvas.width;
		const mh = minimapCanvas.height;
		const worldW = layout.canvasWidth;
		const worldH = layout.canvasHeight;
		const scaleX = mw / worldW;
		const scaleY = mh / worldH;
		const scale = Math.min(scaleX, scaleY);

		// Background
		ctx.fillStyle = isDark ? "rgba(15,23,42,0.9)" : "rgba(241,245,249,0.9)";
		ctx.fillRect(0, 0, mw, mh);

		// Zone rectangles — geometry AND colors come from the manager via
		// renderer.getZones() (each zone carries its manager visual token).
		// No local color map: the minimap can no longer drift from the arena.
		if (renderer) {
			const zones = renderer.getZones();
			const zoneColorById = new Map(zones.map((z) => [z.id, z.color]));
			for (const z of zones) {
				ctx.fillStyle = isDark ? z.color + "44" : z.color + "33";
				ctx.fillRect(z.x * scale, z.y * scale, z.w * scale, z.h * scale);
				ctx.strokeStyle = z.color + "88";
				ctx.lineWidth = 0.5;
				ctx.strokeRect(z.x * scale, z.y * scale, z.w * scale, z.h * scale);
			}

			// Task dots — tinted by the task's zone color (via STATUS_TO_ZONE);
			// tasks without a zone (completed/canceled) fall back to neutral.
			if (scene) {
				for (const t of scene.tasks.values()) {
					const zoneId = STATUS_TO_ZONE[t.status];
					ctx.fillStyle = (zoneId && zoneColorById.get(zoneId)) || "#94a3b8";
					ctx.fillRect(t.x * scale - 1, t.y * scale - 1, 2, 2);
				}

				// Agent dots (colored by role/color)
				for (const a of scene.agents.values()) {
					ctx.fillStyle = a.color || "#8b5cf6";
					ctx.beginPath();
					ctx.arc(a.x * scale, a.y * scale, 2, 0, Math.PI * 2);
					ctx.fill();
				}
			}
		}

		// Viewport rectangle
		if (renderer) {
			const info = renderer.getViewportInfo();
			const vpX = (-info.panX / info.zoom) * scale;
			const vpY = (-info.panY / info.zoom) * scale;
			const vpW = (info.canvasW / info.zoom) * scale;
			const vpH = (info.canvasH / info.zoom) * scale;

			ctx.strokeStyle = isDark ? "#e2e8f0" : "#1e293b";
			ctx.lineWidth = 1.5;
			ctx.strokeRect(vpX, vpY, vpW, vpH);
			ctx.fillStyle = isDark ? "rgba(226,232,240,0.06)" : "rgba(30,41,59,0.06)";
			ctx.fillRect(vpX, vpY, vpW, vpH);
		}

		// Border
		ctx.strokeStyle = isDark ? "rgba(148,163,184,0.3)" : "rgba(0,0,0,0.1)";
		ctx.lineWidth = 1;
		ctx.strokeRect(0, 0, mw, mh);
	}

	// ── Redraw on any input change ────────────────────────────────────────
	$effect(() => {
		// Read all deps to subscribe
		void renderer;
		void layout;
		void scene;
		void isDark;
		void currentZoom;
		drawMinimap();
	});

	// ── Minimap mouse interaction ─────────────────────────────────────────
	function onMinimapMouseDown(e: MouseEvent): void {
		minimapDragging = true;
		minimapNavigate(e);
	}

	function onMinimapMouseMove(e: MouseEvent): void {
		if (minimapDragging) minimapNavigate(e);
	}

	function onMinimapMouseUp(): void {
		minimapDragging = false;
	}

	function minimapNavigate(e: MouseEvent): void {
		if (!minimapCanvas || !layout) return;
		const rect = minimapCanvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const worldW = layout.canvasWidth;
		const worldH = layout.canvasHeight;
		const scaleX = minimapCanvas.width / worldW;
		const scaleY = minimapCanvas.height / worldH;
		const scale = Math.min(scaleX, scaleY);

		// Convert minimap click to world coords, then center viewport
		const worldX = mx / scale;
		const worldY = my / scale;
		// We need the canvas width from the renderer to compute center
		if (renderer) {
			const info = renderer.getViewportInfo();
			const newPanX = info.canvasW / 2 - worldX * currentZoom;
			const newPanY = info.canvasH / 2 - worldY * currentZoom;
			arenaStateManager.setPan(newPanX, newPanY);
		}
	}
</script>

<div class="minimap-wrap">
	<canvas
		bind:this={minimapCanvas}
		class="minimap-canvas"
		width={160}
		height={100}
		onmousedown={onMinimapMouseDown}
		onmousemove={onMinimapMouseMove}
		onmouseup={onMinimapMouseUp}
		onmouseleave={onMinimapMouseUp}
	></canvas>
</div>

<style>
	.minimap-wrap {
		position: absolute;
		top: 8px;
		right: 8px;
		z-index: 15;
		border-radius: 6px;
		overflow: hidden;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		pointer-events: auto;
	}
	.minimap-canvas {
		display: block;
		cursor: crosshair;
	}
</style>
