<script lang="ts">
	import type { Snippet } from "svelte";

	/**
	 * Surface — the single container primitive.
	 *
	 * Replaces the ad-hoc `glass card hover-glow card-body` string that was
	 * copy-pasted across ~40 components, each with a slightly different padding
	 * and radius. Three deliberate variants, nothing else:
	 *
	 * - `bordered` (default) — hairline border, flat. The workhorse.
	 * - `plain`              — no border; use when whitespace alone is enough
	 *                          separation (preferred inside another Surface, so
	 *                          content is never double-framed).
	 * - `raised`             — soft shadow. Reserved for genuinely floating
	 *                          surfaces (popovers). NOT for page content.
	 *
	 * Elevation order is whitespace → border → shade → shadow, so `raised` is
	 * the last resort, never the default.
	 */
	let {
		variant = "bordered",
		padding = "md",
		label = "",
		children
	}: {
		variant?: "bordered" | "plain" | "raised";
		/** Vertical rhythm inside the surface. `none` when the child manages it. */
		padding?: "none" | "sm" | "md" | "lg";
		/** Renders as <section> when given a label, so it becomes a landmark. */
		label?: string;
		children?: Snippet;
	} = $props();
</script>

{#if label}
	<section class="surface surface-{variant} pad-{padding}" aria-label={label}>
		{@render children?.()}
	</section>
{:else}
	<div class="surface surface-{variant} pad-{padding}">
		{@render children?.()}
	</div>
{/if}

<style>
	.surface {
		border-radius: var(--radius-md);
		background: var(--color-surface);
		min-width: 0;
	}

	.surface-bordered {
		border: 1px solid var(--color-border);
	}

	.surface-plain {
		background: transparent;
	}

	.surface-raised {
		border: 1px solid var(--color-border);
		box-shadow: var(--shadow-md);
	}

	.pad-none {
		padding: 0;
	}
	.pad-sm {
		padding: var(--space-3);
	}
	.pad-md {
		padding: var(--space-4);
	}
	.pad-lg {
		padding: var(--space-5);
	}

	@media (max-width: 720px) {
		.pad-lg {
			padding: var(--space-4);
		}
	}
</style>
