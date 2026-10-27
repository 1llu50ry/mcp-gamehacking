<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { ArenaRenderer } from "../lib/arena/arenaRenderer";
	import type { ArenaScene, ArenaLayoutConfig } from "../lib/arena/arenaTypes";
	import { getArenaLayoutManager } from "../lib/arena/arena-layout/ArenaLayoutManager";
	import { aggregateZoneCounts, placeTasksInZones, sectionsToZones } from "../lib/arena/arenaTransform-layout";

	let {
		scene = null,
		isDark = false,
		reducedMotion = false,
		reducedTransparency = false,
		zoom = 1.0,
		panX = 0,
		panY = 0,
		onrenderer,
		onlayout,
		oncanvas
	}: {
		scene?: ArenaScene | null;
		loading?: boolean;
		isDark?: boolean;
		reducedMotion?: boolean;
		reducedTransparency?: boolean;
		zoom?: number;
		panX?: number;
		panY?: number;
		onrenderer?: (r: ArenaRenderer) => void;
		onlayout?: (l: ArenaLayoutConfig) => void;
		oncanvas?: (c: HTMLCanvasElement) => void;
	} = $props();

	let canvas: HTMLCanvasElement;
	let wrapEl: HTMLDivElement;
	let renderer: ArenaRenderer | null = null;
	let layout: ArenaLayoutConfig | null = null;
	/** Last measured wrapEl size key — re-inits are idempotent so the
	 * ResizeObserver cannot feedback-loop (canvas attr changes alter the
	 * CSS `height:auto` wrap size → RO fires → re-init with identical dims).
	 * Also avoids the transient "ResizeObserver loop completed with
	 * undelivered notifications" console error on mount. */
	let lastInitKey = "";

	/**
	 * Re-place task workstations after a resize: the shared layout manager has
	 * new dimensions, so positions baked at the old size are recomputed from
	 * the current scene's task list (in place — the renderer reads the same
	 * scene object every frame).
	 */
	function reBakePositions(currentScene: ArenaScene): void {
		const manager = getArenaLayoutManager();
		const tasks = Array.from(currentScene.tasks.values());
		const zones = sectionsToZones(manager.getSections());
		manager.setOccupancy(
			aggregateZoneCounts(
				tasks,
				zones.map((z) => z.id)
			)
		);
		const positions = placeTasksInZones(tasks, zones);
		for (const t of currentScene.tasks.values()) {
			const p = positions.get(t.id);
			if (p) {
				t.x = p.x;
				t.y = p.y;
			}
		}
	}

	function initCanvas(): void {
		if (!canvas || !wrapEl) return;
		const w = wrapEl.clientWidth || 960;
		const h = Math.max(520, Math.min(window.innerHeight - 220, 800));
		// Backing store is sized in DEVICE pixels, the element in CSS pixels.
		// Previously both were CSS pixels, so on any HiDPI display (dpr 2 or 3)
		// the browser upscaled a 1x bitmap to the physical panel — every drawn
		// pixel doubled, which is the entire source of the "blocky" look. The
		// ratio is capped at 3 so a dpr-4 device can't allocate a 4x buffer.
		const dpr = Math.min(window.devicePixelRatio || 1, 3);
		const key = `${w}x${h}@${dpr}`;
		if (key === lastInitKey) return;
		lastInitKey = key;
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		canvas.style.width = `${w}px`;
		canvas.style.height = `${h}px`;
		// The shared ArenaLayoutManager (module singleton) is the single source
		// of truth for geometry — the scene transform (buildArenaScene) and the
		// renderer both consume this same instance, so baked task positions and
		// drawn rooms always match. The measured size overrides the 960px
		// fallback default from AgentArena.
		const manager = getArenaLayoutManager();
		manager.setDimensions(w, h);
		layout = { canvasWidth: w, canvasHeight: h, layoutManager: manager };
		onlayout?.(layout);
		oncanvas?.(canvas);

		// Positions baked at an older size are re-placed at the new dims so
		// workstations stay aligned with their rooms until the next poll.
		if (scene) reBakePositions(scene);

		if (!renderer) {
			renderer = new ArenaRenderer(canvas);
			renderer.setViewport(zoom, panX, panY);
			renderer.setReducedMotion(reducedMotion);
			renderer.setReducedTransparency(reducedTransparency);
			renderer.start();
			onrenderer?.(renderer);
		}
		if (scene && layout) renderer.update(scene, layout, isDark);
	}

	onMount(() => {
		const tid = setTimeout(() => {
			initCanvas();
		}, 60);
		const ro = new ResizeObserver(() => initCanvas());
		ro.observe(wrapEl);
		return () => {
			clearTimeout(tid);
			ro.disconnect();
		};
	});

	onDestroy(() => {
		renderer?.stop();
	});
</script>

<div class="arena-wrap" bind:this={wrapEl}>
	<canvas bind:this={canvas} class="arena-canvas"></canvas>
</div>

<style>
	.arena-wrap {
		position: relative;
		width: 100%;
		background: var(--color-bg);
	}
	.arena-canvas {
		display: block;
		width: 100%;
		height: auto;
	}
</style>
