<script lang="ts">
	import type { Snippet } from "svelte";

	/**
	 * SectionHeading — the sub-page heading contract.
	 *
	 * Replaces `.section-label` / `.stat-label` / bespoke inline-styled h2 rows.
	 * Renders a real `<h2>` so the document outline is navigable by screen
	 * reader, instead of a styled `<div>` that announces as nothing.
	 *
	 * Deliberately NOT the old `.section-label` treatment (uppercase, tracked,
	 * weight 800, 11px). That reads as system chrome; a section heading should
	 * read as content.
	 */
	let {
		title,
		description = "",
		meta = "",
		actions
	}: {
		title: string;
		description?: string;
		/** Optional right-aligned count/status text. Kept short — it is metadata. */
		meta?: string;
		actions?: Snippet;
	} = $props();
</script>

<div class="section-heading">
	<div class="section-heading-text">
		<h2 class="section-title">{title}</h2>
		{#if description}
			<p class="section-description">{description}</p>
		{/if}
	</div>

	{#if meta || actions}
		<div class="section-heading-side">
			{#if meta}<span class="section-meta">{meta}</span>{/if}
			{@render actions?.()}
		</div>
	{/if}
</div>

<style>
	.section-heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
	}

	.section-heading-text {
		min-width: 0;
	}

	.section-title {
		font-size: var(--text-section);
		font-weight: var(--weight-semibold);
		letter-spacing: -0.01em;
		color: var(--color-text);
	}

	.section-description {
		margin-top: var(--space-1);
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
	}

	.section-heading-side {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
		min-width: 0;
	}

	.section-meta {
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
