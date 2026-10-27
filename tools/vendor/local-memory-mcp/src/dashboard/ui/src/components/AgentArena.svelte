<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { derived } from "svelte/store";
	import { theme } from "../lib/stores";
	import { createArenaHandler } from "../lib/composables/useAgentArena";
	import { arenaStateManager } from "../lib/arena/arenaStateManager";
	import RepositoryCluster from "./RepositoryCluster.svelte";
	import EventTimeline from "./EventTimeline.svelte";
	import FilterBar from "./FilterBar.svelte";
	import ArenaHeader from "./ArenaHeader.svelte";
	import ArenaLegend from "./ArenaLegend.svelte";
	import ArenaViewport from "./ArenaViewport.svelte";

	// ── Accessibility: reduced motion ──────────────────────────────────────
	const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
	let reducedMotion = $state(motionQuery.matches);
	motionQuery.addEventListener("change", (e) => {
		reducedMotion = e.matches;
	});

	// ── Accessibility: reduced transparency ────────────────────────────────
	const transparencyQuery = window.matchMedia("(prefers-reduced-transparency: reduce)");
	let reducedTransparency = $state(transparencyQuery.matches);
	transparencyQuery.addEventListener("change", (e) => {
		reducedTransparency = e.matches;
	});

	// ── Accessibility: ARIA live region ────────────────────────────────────
	let liveRegionText = $state("");

	// ── Stores ─────────────────────────────────────────────────────────────
	const arena = createArenaHandler();
	const repos = derived(arenaStateManager.getStore(), ($state) => $state.repositories);
	const eventLog = derived(arenaStateManager.getStore(), ($state) => $state.ui.eventLog);

	// ── Accessibility: announce events via ARIA live region ────────────────
	let lastEventCount = 0;
	const eventAnnounceUnsub = eventLog.subscribe(($events) => {
		if ($events.length <= lastEventCount) {
			lastEventCount = $events.length;
			return;
		}
		const newEvents = $events.slice(lastEventCount);
		lastEventCount = $events.length;
		for (const evt of newEvents) {
			const announce = formatEventAnnouncement(evt);
			if (announce) {
				liveRegionText = announce;
			}
		}
	});
	onDestroy(() => eventAnnounceUnsub());

	function formatEventAnnouncement(evt: {
		type: string;
		action: string;
		entityType: string;
		entityId: string;
		detail: string;
	}): string | null {
		const entityLabel = `${evt.entityType} ${evt.entityId}`;
		if (evt.action === "completed") return `Task ${evt.entityId} completed`;
		if (evt.action === "failed") return `Task ${evt.entityId} failed`;
		if (evt.action === "connected") return `${entityLabel} connected`;
		if (evt.action === "disconnected") return `${entityLabel} disconnected`;
		if (evt.action === "blocked") return `Task ${evt.entityId} blocked: ${evt.detail}`;
		return null;
	}

	function handleEventClick(e: CustomEvent) {
		const entry = e.detail;
		if (entry.entityId && entry.entityType) {
			arenaStateManager.setSelected(entry.entityId, entry.entityType);
			if (entry.entityType === "agent") {
				arenaStateManager.setSidePanelView("agent");
			} else if (entry.entityType === "task") {
				arenaStateManager.setSidePanelView("task");
			} else if (entry.entityType === "repository") {
				arenaStateManager.setSidePanelView("repo");
			}
		}
	}

	const ARENA_INIT_DELAY_MS = 60;

	onMount(() => {
		const tid = setTimeout(() => {
			const w = 960;
			const h = Math.max(520, Math.min(window.innerHeight - 220, 800));
			arena.start({ canvasWidth: w, canvasHeight: h });
		}, ARENA_INIT_DELAY_MS);

		return () => {
			clearTimeout(tid);
		};
	});

	onDestroy(() => {
		arena.stop();
	});
</script>

<div class="arena-root glass card animate-fade-in" class:reduced-transparency={reducedTransparency}>
	<!-- ARIA live region for screen reader announcements -->
	<div class="sr-only" aria-live="polite" aria-atomic="true">{liveRegionText}</div>

	<!-- Header -->
	<ArenaHeader loading={$arena.loading} scene={$arena.scene} error={$arena.error} repoCount={$arena.repoCount} />

	<!-- Filter bar -->
	<FilterBar />

	<!-- World canvas + minimap + zoom controls -->
	<ArenaViewport
		scene={$arena.scene}
		loading={$arena.loading}
		isDark={$theme === "dark"}
		{reducedMotion}
		{reducedTransparency}
		onlayout={(l) => arena.setLayout(l)}
	/>

	<!-- Footer legend -->
	<ArenaLegend />

	<RepositoryCluster repositories={$repos} collapsed={true} />

	<EventTimeline events={$eventLog} on:eventClick={handleEventClick} />
</div>

<style>
	.arena-root {
		position: relative;
		padding: 0;
		overflow: hidden;
		border-radius: 0;
	}
</style>
