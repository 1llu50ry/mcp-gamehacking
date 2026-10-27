<script lang="ts">
	/**
	 * Skeleton — content-shaped loading placeholder.
	 *
	 * A centered spinner tells the user "something is happening" but not "what
	 * shape it will be", so the layout jumps when data lands. A skeleton that
	 * matches the eventual shape keeps the page stable and makes the wait feel
	 * shorter.
	 *
	 * The shimmer is a background-position animation only — it is disabled
	 * wholesale by the global `prefers-reduced-motion` rule, at which point the
	 * skeleton degrades to a static block, which is still correct.
	 */
	let {
		variant = "line",
		width = "100%",
		height = "",
		lines = 1
	}: {
		variant?: "line" | "block" | "circle";
		width?: string;
		height?: string;
		/** Render N stacked lines. Only meaningful for `line`. */
		lines?: number;
	} = $props();

	const resolvedHeight = $derived(height || (variant === "line" ? "0.875rem" : variant === "circle" ? "32px" : "72px"));
	const rows = $derived(variant === "line" ? Array.from({ length: Math.max(1, lines) }, (_, i) => i) : [0]);
	/* Last line is short so a paragraph block reads as text, not as a bar chart. */
	const widthFor = (i: number) => (variant === "line" && rows.length > 1 && i === rows.length - 1 ? "62%" : width);
</script>

<div class="skeleton-group" aria-hidden="true" data-testid="skeleton">
	{#each rows as row (row)}
		<span
			class="skeleton skeleton-{variant}"
			style="width:{widthFor(row)};height:{resolvedHeight};{variant === 'circle' ? `min-width:${resolvedHeight};` : ''}"
		></span>
	{/each}
</div>

<style>
	.skeleton-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
	}

	.skeleton {
		display: block;
		border-radius: var(--radius-sm);
		background: linear-gradient(
			90deg,
			var(--color-surface-hover) 0%,
			var(--color-surface-subtle) 50%,
			var(--color-surface-hover) 100%
		);
		background-size: 200% 100%;
		animation: skeleton-shimmer 1.4s ease-out infinite;
	}

	.skeleton-circle {
		border-radius: var(--radius-pill);
	}

	.skeleton-block {
		border-radius: var(--radius-md);
	}

	@keyframes skeleton-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
</style>
