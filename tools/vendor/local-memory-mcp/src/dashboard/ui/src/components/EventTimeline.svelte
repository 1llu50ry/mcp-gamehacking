<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import type { EventLogEntry } from "../lib/arena/arenaEvents";
	import TimelineHeader from "./TimelineHeader.svelte";
	import TimelineEvent from "./TimelineEvent.svelte";

	export let events: EventLogEntry[] = [];
	export let visible: boolean = true;

	const dispatch = createEventDispatcher();

	let expanded = false;
	let paused = false;
	let activeFilter = "all"; // "all" | "errors" | "tasks" | "agents"
	let eventContainer: HTMLDivElement;

	// Auto-scroll logic — the scroll is deferred to a macrotask so the DOM has
	// flushed before reading scrollHeight (equivalent to awaiting the next tick).
	$: if (expanded && !paused && eventContainer && events) {
		const container = eventContainer;
		setTimeout(() => {
			container.scrollTop = container.scrollHeight;
		}, 0);
	}

	function toggleExpand() {
		expanded = !expanded;
	}

	function handleEventClick(entry: EventLogEntry) {
		dispatch("eventClick", entry);
	}

	function setFilter(filter: string) {
		activeFilter = filter;
	}

	function togglePause() {
		paused = !paused;
	}

	$: filteredEvents = events.filter((e) => {
		if (activeFilter === "all") return true;
		if (activeFilter === "errors") {
			return e.type === "task-failed" || e.type === "task-blocked";
		}
		if (activeFilter === "tasks") {
			return e.type.startsWith("task-");
		}
		if (activeFilter === "agents") {
			return e.type.startsWith("agent-") || e.type.startsWith("memory-");
		}
		return true;
	});
</script>

<div class="event-timeline glass" class:expanded class:visible>
	<TimelineHeader
		{expanded}
		{paused}
		{activeFilter}
		eventCount={events.length}
		onToggle={toggleExpand}
		onSetFilter={setFilter}
		onTogglePause={togglePause}
	/>

	{#if expanded}
		<!-- TASK-275 / audit F11: dedicated polite live region for the event
		     log. The whole-shell aria-live (previously on #dashboardShell)
		     announced every tab/panel change; announcements now come from the
		     timeline itself. -->
		<div class="timeline-body" aria-live="polite">
			<div class="event-list" bind:this={eventContainer}>
				{#if filteredEvents.length === 0}
					<div class="empty-events">No matching events</div>
				{:else}
					{#each filteredEvents as entry (entry.id)}
						<TimelineEvent {entry} onClick={() => handleEventClick(entry)} />
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.event-timeline {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 40;
		border-top: 1px solid var(--color-border);
		box-shadow: var(--glass-shadow-elevated);
		transform: translateY(100%);
		transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
		display: flex;
		flex-direction: column;
		background: var(--glass-bg-strong);
		border-radius: 0 0 12px 12px;
	}

	.event-timeline.visible {
		transform: translateY(calc(100% - 36px));
	}

	.event-timeline.expanded {
		transform: translateY(0);
	}

	.timeline-body {
		height: 200px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.event-list {
		flex: 1;
		overflow-y: auto;
		padding: 6px 0;
		display: flex;
		flex-direction: column;
	}

	.event-list::-webkit-scrollbar {
		width: 6px;
	}
	.event-list::-webkit-scrollbar-track {
		background: transparent;
	}
	.event-list::-webkit-scrollbar-thumb {
		background: var(--color-border);
		border-radius: 3px;
	}
	.event-list::-webkit-scrollbar-thumb:hover {
		background: var(--color-text-faint);
	}

	.empty-events {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 0.72rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}
</style>
