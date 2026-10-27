<script lang="ts">
	/**
	 * Explore/Insights mode switch.
	 *
	 * Split out with the two views it toggles so the tab markup, its styles and
	 * its touch-target rule live next to each other instead of in the page
	 * shell.
	 */
	import Icon from "../lib/Icon.svelte";

	let {
		activeView,
		onSelect
	}: {
		activeView: "explore" | "insights";
		onSelect: (view: "explore" | "insights") => void;
	} = $props();
</script>

<div class="view-tabs" role="tablist" aria-label="Codebase views">
	<button
		role="tab"
		aria-selected={activeView === "explore"}
		class:active={activeView === "explore"}
		onclick={() => onSelect("explore")}><Icon name="search" size={16} /> Explore</button
	>
	<button
		role="tab"
		aria-selected={activeView === "insights"}
		class:active={activeView === "insights"}
		onclick={() => onSelect("insights")}><Icon name="activity" size={16} /> Insights</button
	>
</div>

<style>
	/* Moved verbatim from CodebasePage so the split is presentation-neutral. */
	.view-tabs {
		display: inline-flex;
		width: fit-content;
		padding: 4px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}
	.view-tabs button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 0 16px;
		border: 0;
		border-radius: calc(var(--radius-md) - 3px);
		background: transparent;
		color: var(--color-text-muted);
		font-weight: 700;
		cursor: pointer;
	}
	.view-tabs button.active {
		background: var(--color-primary);
		color: #fff;
	}
	@media (pointer: coarse) {
		.view-tabs button {
			min-height: 44px;
		}
	}
</style>
