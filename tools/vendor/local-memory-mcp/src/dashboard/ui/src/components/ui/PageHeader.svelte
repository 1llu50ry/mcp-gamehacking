<script lang="ts">
	import type { Snippet } from "svelte";

	/**
	 * PageHeader — optional view-level banner/toolbar for descriptions and actions.
	 *
	 * Before this existed, all 11 views hand-rolled their own header: some used
	 * `.section-label` inside a `glass card`, some used an inline-styled flex row
	 * with a gradient avatar, some had no title at all. Eleven different answers
	 * to "where am I?".
	 *
	 * Contract:
	 * - the canonical <h1> lives in the shell chrome (TopBarRepoInfo).
	 * - optional section <h2> if title is provided
	 * - optional one-line description; never a paragraph
	 * - `actions` holds AT MOST one primary action; everything else is
	 *   secondary/tertiary or lives in an overflow menu
	 *
	 * The header is deliberately NOT a card. A title on the canvas with
	 * whitespace beneath it reads as a page; a title in a bordered box reads as
	 * one more widget competing with the content.
	 */
	let {
		title = "",
		description = "",
		eyebrow = "",
		actions
	}: {
		title?: string;
		description?: string;
		/** Small contextual label above the title (e.g. workspace or scope). */
		eyebrow?: string;
		actions?: Snippet;
	} = $props();
</script>

<header class="page-header">
	{#if eyebrow || title || description}
		<div class="page-header-text">
			{#if eyebrow}
				<p class="page-eyebrow">{eyebrow}</p>
			{/if}
			{#if title}
				<h2 class="page-title">{title}</h2>
			{/if}
			{#if description}
				<p class="page-description">{description}</p>
			{/if}
		</div>
	{/if}

	{#if actions}
		<div class="page-header-actions">{@render actions()}</div>
	{/if}
</header>

<style>
	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
		margin-bottom: var(--space-5);
	}

	.page-header-text {
		min-width: 0;
	}

	.page-eyebrow {
		font-size: var(--text-label);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
		letter-spacing: 0.02em;
		margin-bottom: var(--space-1);
	}

	.page-title {
		font-size: var(--text-title);
		font-weight: var(--weight-semibold);
		letter-spacing: -0.018em;
		line-height: var(--leading-tight);
		color: var(--color-text);
	}

	.page-description {
		margin: 0;
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
		line-height: var(--leading-normal);
		max-width: 68ch;
	}

	.page-title + .page-description {
		margin-top: var(--space-2);
	}

	.page-eyebrow + .page-description {
		margin-top: var(--space-1);
	}

	.page-header-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	@media (max-width: 720px) {
		.page-header {
			gap: var(--space-3);
			margin-bottom: var(--space-4);
		}
		.page-header-actions {
			width: 100%;
		}
		/* On mobile the lone primary action becomes full-width — a 100px button
		   in a 360px viewport wastes the row and is harder to hit. */
		.page-header-actions :global(> :only-child) {
			width: 100%;
			justify-content: center;
		}
	}
</style>
