<script lang="ts">
	import type { Snippet } from "svelte";
	import Icon from "../../lib/Icon.svelte";

	/**
	 * EmptyState — every empty region answers three questions:
	 *   1. what is this area   (title)
	 *   2. why is it empty     (description)
	 *   3. what do I do next   (action)
	 *
	 * "No data." answers none of them and is banned.
	 *
	 * The icon is intentionally muted and small. A large gradient-filled
	 * illustration draws the eye to the least useful part of the screen.
	 */
	let {
		icon = "inbox",
		title,
		description = "",
		size = "inline",
		action
	}: {
		icon?: string;
		title: string;
		description?: string;
		/** `inline` fits inside a panel; `page` centers in a full view. */
		size?: "inline" | "page";
		action?: Snippet;
	} = $props();
</script>

<div class="empty size-{size}">
	<span class="empty-icon" aria-hidden="true">
		<Icon name={icon} size={20} strokeWidth={1.75} />
	</span>
	<p class="empty-title">{title}</p>
	{#if description}
		<p class="empty-description">{description}</p>
	{/if}
	{#if action}
		<div class="empty-action">{@render action()}</div>
	{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-2);
	}

	.size-inline {
		padding: var(--space-7) var(--space-4);
	}

	.size-page {
		padding: var(--space-9) var(--space-4);
		min-height: 320px;
		justify-content: center;
	}

	.empty-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: var(--radius-md);
		background: var(--color-surface-hover);
		color: var(--color-text-muted);
		margin-bottom: var(--space-1);
	}

	.empty-title {
		font-size: var(--text-body);
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}

	.empty-description {
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
		max-width: 46ch;
		line-height: var(--leading-normal);
	}

	.empty-action {
		margin-top: var(--space-3);
	}
</style>
