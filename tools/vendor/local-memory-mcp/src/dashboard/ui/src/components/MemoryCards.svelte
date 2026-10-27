<script lang="ts">
	/**
	 * Memory cards — the narrow-viewport presentation of the rows the table
	 * shows on desktop.
	 *
	 * Split out of MemoryList for the same reason as the queue cards: one file
	 * should not carry two full presentations of the same data. Visibility stays
	 * media-query driven (hidden above 720px), so the parent renders both and
	 * CSS picks one — no resize listener, no hydration mismatch.
	 *
	 * `.type-chip` is intentionally NOT redeclared here: it is a global rule, so
	 * copying it would create the duplicate-selector problem this split exists
	 * to remove.
	 */
	import type { Memory } from "../lib/stores";
	import { formatDate } from "../lib/utils";
	import { TYPE_LABELS, importanceColor } from "../lib/memoryConfig";
	import { EmptyState } from "./ui";

	let {
		memories = [],
		loading = false,
		hasError = false,
		selectedIds,
		onToggleSelect,
		onMemoryClick
	}: {
		memories: Memory[];
		loading: boolean;
		hasError: boolean;
		selectedIds: Set<string>;
		onToggleSelect: (id: string) => void;
		onMemoryClick: (mem: Memory) => void;
	} = $props();
</script>

<div class="memory-cards" aria-label="Memories">
	{#if loading}
		{#each { length: 4 } as _, i (i)}
			<div class="memory-card skeleton" style="height:112px;"></div>
		{/each}
	{:else if !hasError}
		{#if memories.length === 0}
			<EmptyState icon="search" title="No memories found" description="Adjust your search or create a new memory." />
		{:else}
			{#each memories as mem (mem.id)}
				<article class="memory-card" class:selected={selectedIds.has(mem.id)}>
					<div class="memory-card-topline">
						<input
							type="checkbox"
							checked={selectedIds.has(mem.id)}
							onchange={() => onToggleSelect(mem.id)}
							aria-label="Select memory {mem.title}"
						/>
						<span class="type-chip type-{mem.type}">{TYPE_LABELS[mem.type] || mem.type}</span>
						<span class="memory-card-importance" style="color:{importanceColor[mem.importance] || importanceColor[1]};">
							Importance {mem.importance}
						</span>
					</div>
					<button class="memory-card-main" onclick={() => onMemoryClick(mem)}>
						<strong>{mem.title || "Untitled memory"}</strong>
						<span>
							{#if mem.owner || mem.scope?.owner}
								<span class="owner-badge" title="Owner: {mem.owner || mem.scope?.owner}">
									{mem.owner || mem.scope?.owner}
								</span>
								·
							{:else}
								<span class="owner-badge owner-unknown" title="owner unknown (repo-only view)"> unknown </span>
								·
							{/if}
							{formatDate(mem.updated_at)} · {mem.hit_count ?? 0} hits
						</span>
					</button>
					{#if mem.tags?.length}
						<div class="memory-card-tags">
							{#each mem.tags.slice(0, 3) as tag (tag)}<span>{tag}</span>{/each}
						</div>
					{/if}
				</article>
			{/each}
		{/if}
	{/if}
</div>

<style>
	/* Moved verbatim from MemoryList so the split is presentation-neutral. */
	.memory-cards {
		display: none;
	}

	@media (max-width: 720px) {
		.memory-cards {
			display: grid;
			gap: var(--space-3);
		}

		.memory-card {
			padding: var(--space-4);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
			background: var(--color-surface);
		}

		.memory-card.selected {
			border-color: var(--color-primary);
			box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
			background: var(--color-primary-soft);
		}

		.memory-card-topline {
			display: flex;
			align-items: center;
			gap: 8px;
		}

		.memory-card-importance {
			margin-left: auto;
			font-size: 0.6875rem;
			font-weight: 700;
		}

		.memory-card-main {
			display: grid;
			gap: 4px;
			width: 100%;
			min-height: 48px;
			margin-top: 10px;
			padding: 0;
			border: 0;
			background: transparent;
			text-align: left;
			color: var(--color-text);
			cursor: pointer;
		}

		.memory-card-main strong {
			font-size: 0.9375rem;
			line-height: 1.35;
		}

		.memory-card-main span {
			font-size: 0.75rem;
			color: var(--color-text-muted);
		}

		.memory-card-tags {
			display: flex;
			flex-wrap: wrap;
			gap: 4px;
			margin-top: 8px;
		}

		.memory-card-tags span {
			padding: 2px 6px;
			border-radius: 999px;
			background: var(--color-surface-hover);
			font-size: 0.6875rem;
			color: var(--color-text-muted);
		}

		.owner-badge {
			font-size: 0.6rem;
			font-weight: 600;
			padding: 1px 6px;
			border-radius: 9999px;
			background: rgba(148, 163, 184, 0.12);
			color: var(--color-text-muted);
			border: 1px solid rgba(148, 163, 184, 0.2);
			font-family: "JetBrains Mono", monospace;
			white-space: nowrap;
			display: inline-flex;
			align-items: center;
		}

		.owner-badge.owner-unknown {
			opacity: 0.6;
			font-style: italic;
		}
	}
</style>
