<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	export let expanded: boolean = false;
	export let paused: boolean = false;
	export let activeFilter: string = "all";
	export let eventCount: number = 0;
	export let onToggle: () => void = () => {};
	export let onSetFilter: (filter: string) => void = () => {};
	export let onTogglePause: () => void = () => {};
</script>

<!-- Collapsed handle -->
<button class="timeline-handle" on:click={onToggle} aria-expanded={expanded}>
	<div class="handle-left">
		<Icon name="activity" size={14} className="activity-icon" />
		<span class="handle-title">Arena Events</span>
		<span class="event-count-badge">{eventCount}</span>
	</div>
	<div class="handle-right">
		<Icon name={expanded ? "chevron-down" : "chevron-up"} size={14} />
	</div>
</button>

<!-- Expanded panel -->
{#if expanded}
	<div class="timeline-filters">
		<div class="filter-group" role="tablist" aria-label="Event log filters">
			<button
				role="tab"
				aria-selected={activeFilter === "all"}
				tabindex={activeFilter === "all" ? 0 : -1}
				class="filter-btn"
				class:active={activeFilter === "all"}
				on:click={() => onSetFilter("all")}
			>
				All
			</button>
			<button
				role="tab"
				aria-selected={activeFilter === "errors"}
				tabindex={activeFilter === "errors" ? 0 : -1}
				class="filter-btn"
				class:active={activeFilter === "errors"}
				on:click={() => onSetFilter("errors")}
			>
				Errors
			</button>
			<button
				role="tab"
				aria-selected={activeFilter === "tasks"}
				tabindex={activeFilter === "tasks" ? 0 : -1}
				class="filter-btn"
				class:active={activeFilter === "tasks"}
				on:click={() => onSetFilter("tasks")}
			>
				Tasks
			</button>
			<button
				role="tab"
				aria-selected={activeFilter === "agents"}
				tabindex={activeFilter === "agents" ? 0 : -1}
				class="filter-btn"
				class:active={activeFilter === "agents"}
				on:click={() => onSetFilter("agents")}
			>
				Agents
			</button>
		</div>
		<div class="spacer"></div>
		<button
			class="pause-btn"
			class:paused
			on:click={onTogglePause}
			title={paused ? "Resume Auto-scroll" : "Pause Auto-scroll"}
		>
			{#if paused}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg
				>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					><rect x="14" y="4" width="4" height="16" rx="1"></rect><rect x="6" y="4" width="4" height="16" rx="1"
					></rect></svg
				>
			{/if}
			<span>{paused ? "Paused" : "Live"}</span>
		</button>
	</div>
{/if}

<style>
	.timeline-handle {
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 16px;
		background: rgba(255, 255, 255, 0.02);
		border: none;
		border-bottom: 1px solid transparent;
		width: 100%;
		cursor: pointer;
		color: var(--color-text);
		text-align: left;
		font-family: inherit;
		transition: background 0.2s ease;
	}

	.timeline-handle:hover {
		background: rgba(255, 255, 255, 0.05);
	}

	:global(.event-timeline.expanded) .timeline-handle {
		border-bottom-color: var(--color-border);
	}

	.handle-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	:global(.activity-icon) {
		color: var(--color-primary);
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
		100% {
			opacity: 0.6;
		}
	}

	.handle-title {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		opacity: 0.9;
	}

	.event-count-badge {
		font-size: 0.65rem;
		font-weight: 800;
		background: var(--color-border);
		color: var(--color-text-muted);
		padding: 1px 6px;
		border-radius: 999px;
	}

	.handle-right {
		display: flex;
		align-items: center;
		opacity: 0.7;
	}

	.timeline-filters {
		height: 34px;
		display: flex;
		align-items: center;
		padding: 0 12px;
		background: rgba(0, 0, 0, 0.05);
		border-bottom: 1px solid var(--color-border);
		gap: 12px;
	}

	.filter-group {
		display: flex;
		gap: 4px;
	}

	.filter-btn {
		background: transparent;
		border: 1px solid transparent;
		color: var(--color-text-muted);
		font-size: 0.68rem;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.filter-btn:hover {
		color: var(--color-text);
		background: rgba(255, 255, 255, 0.05);
	}

	.filter-btn.active {
		color: var(--color-text);
		background: var(--color-border);
		border-color: rgba(148, 163, 184, 0.2);
	}

	.spacer {
		flex: 1;
	}

	.pause-btn {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 0.65rem;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 4px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 5px;
		transition: all 0.15s ease;
	}

	.pause-btn svg {
		opacity: 0.8;
	}

	.pause-btn:hover {
		color: var(--color-text);
		background: rgba(255, 255, 255, 0.05);
	}

	.pause-btn.paused {
		background: rgba(245, 158, 11, 0.1);
		border-color: rgba(245, 158, 11, 0.3);
		color: #f59e0b;
	}

	@media (pointer: coarse) {
		.timeline-handle {
			height: 44px;
		}
	}
</style>
