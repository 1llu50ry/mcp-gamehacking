<script lang="ts">
	import Icon from "$lib/Icon.svelte";
	import type { EventLogEntry } from "$lib/arena/arenaEvents";
	import { getEventColor, getEventIcon, getEventLabel, formatTime } from "$lib/timelineUtils";

	export let entry: EventLogEntry;
	export let onClick: () => void = () => {};
</script>

<button class="event-row" on:click={onClick}>
	<span class="event-time">{formatTime(entry.timestamp)}</span>
	<span class="event-icon" style="color: {getEventColor(entry)}">
		<Icon name={getEventIcon(entry)} size={11} />
	</span>
	<span class="event-label">{getEventLabel(entry)}</span>
	<span class="event-type-badge" style="background:{getEventColor(entry)}15; color:{getEventColor(entry)}">
		{entry.type}
	</span>
</button>

<style>
	.event-row {
		height: 26px;
		min-height: 26px;
		display: flex;
		align-items: center;
		padding: 0 16px;
		border: none;
		background: transparent;
		width: 100%;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		transition: background 0.15s ease;
		animation: slide-in 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.event-row:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.event-time {
		font-family: "JetBrains Mono", monospace;
		font-size: 0.65rem;
		color: var(--color-text-faint);
		min-width: 60px;
		opacity: 0.8;
	}

	.event-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin-right: 8px;
		width: 14px;
	}

	.event-label {
		font-size: 0.7rem;
		color: var(--color-text);
		font-weight: 600;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.95;
	}

	.event-type-badge {
		font-size: 0.58rem;
		font-weight: 800;
		padding: 1px 6px;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-left: 8px;
	}

	@keyframes slide-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
