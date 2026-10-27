<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { Theme, HealthData } from "../lib/stores";

	export let healthData: HealthData | null = null;
	export let theme: Theme = "light";
	export let themePreference: string = "auto";
	export let onToggleTheme: (e?: MouseEvent) => void = () => {};
</script>

<!-- Detailed arena metrics belong in Agent Arena; the global chrome keeps only health. -->
<!-- Connection status -->
{#if healthData}
	<div class="top-status">
		<div class="status-dot status-dot-online"></div>
		<span class="status-text">Connected</span>
	</div>
{/if}

<!-- Theme toggle -->
<button
	class="btn btn-ghost btn-icon btn-sm"
	on:click={onToggleTheme}
	title={themePreference === "auto" ? "Theme: auto (Shift+click for manual)" : "Theme: manual (Shift+click for auto)"}
	aria-label="Toggle theme"
>
	{#if theme === "dark"}
		<Icon name="sun" size={16} strokeWidth={1.75} />
	{:else}
		<Icon name="moon" size={16} strokeWidth={1.75} />
	{/if}
</button>

<style>
	.top-status {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 36px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.status-text {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	@media (max-width: 760px) {
		.status-text {
			display: none;
		}
		.top-status {
			min-width: 36px;
			padding: 0;
			justify-content: center;
		}
	}
</style>
