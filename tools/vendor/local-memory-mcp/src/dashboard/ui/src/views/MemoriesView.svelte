<script lang="ts">
	import type { Memory } from "../lib/stores";
	import MemoryList from "../components/MemoryList.svelte";
	import Icon from "../lib/Icon.svelte";
	import { PageHeader, Surface } from "../components/ui";

	/**
	 * Memories — the workspace knowledge collection.
	 *
	 * Two structural fixes over the old inline block in App.svelte:
	 *
	 * 1. The page had no `<h1>`. Its title was a `.section-label` div — 11px,
	 *    uppercase, weight 800 — which announces as nothing to a screen reader
	 *    and reads as a chrome label rather than the name of the page.
	 * 2. "New Memory" was the sixth cell of the filter grid, weighted the same
	 *    as a page-size dropdown. The page's one primary action now lives in the
	 *    header, where the eye lands first and where every other page in the app
	 *    puts it.
	 */
	let {
		list = $bindable(),
		onMemoryClick,
		onNewMemory,
		onBulkImport
	}: {
		list?: MemoryList;
		onMemoryClick: (memory: Memory) => void;
		onNewMemory: () => void;
		onBulkImport: () => void;
	} = $props();
</script>

<PageHeader description="Decisions, patterns, code facts, and mistakes this workspace has recorded.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={onNewMemory} id="newMemoryBtn">
			<Icon name="plus" size={16} strokeWidth={2} />
			New memory
		</button>
	{/snippet}
</PageHeader>

<Surface padding="lg" label="Memory list">
	<MemoryList bind:this={list} {onMemoryClick} {onBulkImport} />
</Surface>
