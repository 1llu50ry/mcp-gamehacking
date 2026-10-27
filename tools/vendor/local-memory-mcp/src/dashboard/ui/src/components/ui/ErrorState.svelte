<script lang="ts">
	import type { Snippet } from "svelte";
	import Icon from "../../lib/Icon.svelte";

	/**
	 * ErrorState — tells the user what failed, reassures them nothing was lost,
	 * and offers a recovery action.
	 *
	 * Raw error text (`error.message`, stack traces) is never rendered to the
	 * user: it is unactionable for them and leaks internals. The caller logs the
	 * real error; this shows the human-readable consequence.
	 *
	 * `role="alert"` so assistive tech announces the failure rather than leaving
	 * the user waiting on a region that silently stopped loading.
	 */
	let {
		title = "Something went wrong",
		description = "We couldn't load this section. Your data is safe.",
		action
	}: {
		title?: string;
		description?: string;
		action?: Snippet;
	} = $props();
</script>

<div class="error-state" role="alert">
	<span class="error-icon" aria-hidden="true">
		<Icon name="triangle-alert" size={18} strokeWidth={1.75} />
	</span>
	<div class="error-body">
		<p class="error-title">{title}</p>
		<p class="error-description">{description}</p>
	</div>
	{#if action}
		<div class="error-action">{@render action()}</div>
	{/if}
</div>

<style>
	.error-state {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-danger);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.error-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--color-danger);
		margin-top: 1px;
	}

	.error-body {
		min-width: 0;
		flex: 1;
	}

	.error-title {
		font-size: var(--text-body);
		font-weight: var(--weight-semibold);
		color: var(--color-text);
	}

	.error-description {
		margin-top: var(--space-1);
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
		line-height: var(--leading-normal);
	}

	.error-action {
		flex-shrink: 0;
	}

	@media (max-width: 560px) {
		.error-state {
			flex-wrap: wrap;
		}
		.error-action {
			width: 100%;
		}
	}
</style>
