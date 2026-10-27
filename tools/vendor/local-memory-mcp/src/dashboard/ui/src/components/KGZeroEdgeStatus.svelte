<script lang="ts">
	import Icon from "$lib/Icon.svelte";

	export let visibleNodeCount: number;
	export let totalNodeCount: number;
	export let hiddenNodeCount: number;
</script>

<div class="kg-relation-hint" role="status" aria-live="polite">
	<Icon name="info" size={14} strokeWidth={1.75} />
	<span>
		Showing a capped overview of {visibleNodeCount} of {totalNodeCount} entities because this graph has no relations. Create
		relations or run a relation backfill to enable the connected force graph.
		{#if hiddenNodeCount > 0}
			{hiddenNodeCount} entities are hidden from the canvas and marked in the overview badge to keep the dashboard responsive.
		{/if}
	</span>
</div>

<style>
	.kg-relation-hint {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		font-size: 0.8rem;
		font-weight: 600;
		background: rgba(59, 130, 246, 0.08);
		color: var(--color-text);
		border-bottom: 1px solid rgba(59, 130, 246, 0.18);
	}

	.kg-relation-hint :global(svg) {
		flex-shrink: 0;
		color: var(--color-primary);
	}
</style>
