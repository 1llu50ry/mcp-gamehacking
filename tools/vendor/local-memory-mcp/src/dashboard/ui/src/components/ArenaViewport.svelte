<script lang="ts">
	import { onDestroy } from "svelte";
	import { derived } from "svelte/store";
	import { ArenaRenderer } from "../lib/arena/arenaRenderer";
	import type { ArenaScene, ArenaLayoutConfig } from "../lib/arena/arenaTypes";
	import { arenaStateManager } from "../lib/arena/arenaStateManager";
	import Icon from "../lib/Icon.svelte";
	import HoverTooltip from "./HoverTooltip.svelte";
	import ArenaMinimap from "./ArenaMinimap.svelte";
	import ArenaViewportCanvas from "./ArenaViewportCanvas.svelte";
	import ArenaViewportControls from "./ArenaViewportControls.svelte";
	import ArenaViewportInteraction from "./ArenaViewportInteraction.svelte";

	// ── Props ────────────────────────────────────────────────────────────────
	let {
		scene = null,
		loading = false,
		isDark = false,
		reducedMotion = false,
		reducedTransparency = false,
		onlayout
	}: {
		scene?: ArenaScene | null;
		loading?: boolean;
		isDark?: boolean;
		reducedMotion?: boolean;
		reducedTransparency?: boolean;
		/** Forward the measured canvas layout up (so the arena handler bakes at real dims). */
		onlayout?: (l: ArenaLayoutConfig) => void;
	} = $props();

	// ── Shared state ────────────────────────────────────────────────────────
	let renderer: ArenaRenderer | null = $state(null);
	let layout: ArenaLayoutConfig | null = $state(null);
	let arenaCanvas: HTMLCanvasElement | null = $state(null);
	let hoverEntityType: "agent" | "task" | "repository" | null = $state(null);
	let hoverEntityId: string | null = $state(null);
	let tooltipPos: { x: number; y: number } | null = $state(null);

	// ── Store ──────────────────────────────────────────────────────────────
	const uiStore = derived(arenaStateManager.getStore(), ($s) => $s.ui);
	let currentZoom = $derived($uiStore.zoom);
	let currentPanX = $derived($uiStore.panX);
	let currentPanY = $derived($uiStore.panY);
	const zoomPercent = $derived(Math.round(currentZoom * 100));

	// ── Push viewport changes to renderer ──────────────────────────────────
	$effect(() => {
		if (renderer) renderer.setViewport(currentZoom, currentPanX, currentPanY);
	});

	// ── Push accessibility prefs to renderer ────────────────────────────────
	$effect(() => {
		if (renderer) renderer.setReducedMotion(reducedMotion);
	});
	$effect(() => {
		if (renderer) renderer.setReducedTransparency(reducedTransparency);
	});

	// ── Push filter to renderer ────────────────────────────────────────────
	const filterUnsub = arenaStateManager.getStore().subscribe(($state) => {
		if (renderer) renderer.setFilter($state.ui.activeFilter);
	});
	onDestroy(() => filterUnsub());

	// ── Push scene + theme to renderer ──────────────────────────────────────
	$effect(() => {
		if (renderer && scene && layout) renderer.update(scene, layout, isDark);
	});

	// ── Zoom control callbacks ─────────────────────────────────────────────
	function zoomIn(): void {
		arenaStateManager.setZoom(Math.min(3.0, currentZoom * (1 + 0.15)));
	}
	function zoomOut(): void {
		arenaStateManager.setZoom(Math.max(0.1, currentZoom * (1 - 0.15)));
	}
	function resetView(): void {
		arenaStateManager.resetView();
	}

	// ── Interaction callbacks ──────────────────────────────────────────────
	function onRendererReady(r: ArenaRenderer): void {
		renderer = r;
	}
	function onLayoutReady(l: ArenaLayoutConfig): void {
		layout = l;
		onlayout?.(l);
	}
	function onCanvasReady(c: HTMLCanvasElement): void {
		arenaCanvas = c;
	}
	function onHover(id: string | null, type: "agent" | "task" | null, pos: { x: number; y: number } | null): void {
		hoverEntityId = id;
		hoverEntityType = type;
		tooltipPos = pos;
	}
</script>

<div class="arena-wrap">
	<ArenaViewportCanvas
		{scene}
		{loading}
		{isDark}
		{reducedMotion}
		{reducedTransparency}
		zoom={currentZoom}
		panX={currentPanX}
		panY={currentPanY}
		onrenderer={onRendererReady}
		onlayout={onLayoutReady}
		oncanvas={onCanvasReady}
	/>

	{#if arenaCanvas}
		<ArenaViewportInteraction
			{renderer}
			{scene}
			canvas={arenaCanvas}
			zoom={currentZoom}
			panX={currentPanX}
			panY={currentPanY}
			onhover={onHover}
		/>
	{/if}

	<HoverTooltip entityType={hoverEntityType} entityId={hoverEntityId} position={tooltipPos} />

	<!-- Empty: no active agents -->
	{#if scene && scene.agents.size === 0 && !loading}
		<div class="arena-empty">
			<Icon name="users" size={30} strokeWidth={1.2} />
			<div style="font-weight:700;font-size:0.9rem">No active agents</div>
			<div class="arena-empty-sub">Agents appear here when they claim tasks across your repositories</div>
		</div>
	{/if}

	<ArenaMinimap {renderer} {layout} {scene} {isDark} {currentZoom} />
	<ArenaViewportControls {zoomPercent} onzoomIn={zoomIn} onzoomOut={zoomOut} onresetView={resetView} />
</div>

<style>
	.arena-wrap {
		position: relative;
		width: 100%;
		background: var(--color-bg);
	}
	:global(.arena-canvas:focus-visible) {
		outline: 3px solid var(--color-primary);
		outline-offset: 2px;
	}
	:global(.sr-only) {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	.arena-empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: var(--color-text-muted);
		pointer-events: none;
	}
	.arena-empty-sub {
		font-size: 0.73rem;
		opacity: 0.6;
		text-align: center;
		max-width: 280px;
	}
</style>
