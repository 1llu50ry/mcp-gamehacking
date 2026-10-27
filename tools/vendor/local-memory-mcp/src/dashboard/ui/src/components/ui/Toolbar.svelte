<script lang="ts">
	import type { Snippet } from "svelte";

	/**
	 * Toolbar — the search + filter + action row above a collection.
	 *
	 * `feature-toolbar card` was copy-pasted into MemoryListToolbar,
	 * StandardSearchBar, HandoffFilterBar and QueuePage, each drifting its own
	 * gap, wrap behaviour and breakpoints. MemoryListToolbar alone carried a
	 * six-column grid with three media queries and `grid-row` reordering hacks.
	 *
	 * Layout contract:
	 *   [ search (grows) ] [ filters (shrink-to-fit) ] [ actions (pinned right) ]
	 * On narrow viewports it becomes a single column, search first, actions
	 * last — the order the user actually needs.
	 *
	 * It is not a card. Wrapping a control row in a bordered box adds a frame
	 * around the frame of the list beneath it.
	 */
	let {
		label = "Filters and actions",
		search,
		filters,
		actions
	}: {
		label?: string;
		search?: Snippet;
		filters?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<div class="toolbar" role="group" aria-label={label}>
	{#if search}
		<div class="toolbar-search">{@render search()}</div>
	{/if}

	{#if filters}
		<div class="toolbar-filters">{@render filters()}</div>
	{/if}

	{#if actions}
		<div class="toolbar-actions">{@render actions()}</div>
	{/if}
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-bottom: var(--space-4);
	}

	.toolbar-search {
		flex: 1 1 240px;
		min-width: 0;
	}

	.toolbar-search :global(input) {
		width: 100%;
	}

	.toolbar-filters {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		min-width: 0;
	}

	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-left: auto;
		flex-shrink: 0;
	}

	@media (max-width: 720px) {
		.toolbar {
			flex-direction: column;
			align-items: stretch;
		}
		.toolbar-search,
		.toolbar-filters,
		.toolbar-actions {
			margin-left: 0;
			width: 100%;
		}
		.toolbar-filters :global(> *),
		.toolbar-actions :global(> *) {
			flex: 1 1 auto;
			justify-content: center;
		}
	}
</style>
