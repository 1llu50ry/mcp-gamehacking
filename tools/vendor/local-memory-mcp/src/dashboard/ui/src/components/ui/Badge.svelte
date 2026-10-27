<script lang="ts">
	import type { Snippet } from "svelte";

	/**
	 * Badge — one status-label contract.
	 *
	 * The dashboard previously drew status with ~9 different treatments: pill,
	 * chip, tag, dot+text, gradient pill, uppercase-800-weight micro-label. Same
	 * semantic meaning, six visual answers.
	 *
	 * Rules baked in here:
	 * - color NEVER carries meaning alone — the text label always states the
	 *   status, so the badge is legible to colorblind users and screen readers
	 * - tones map to semantics, not to decoration; there is no "purple because
	 *   it looked nice" tone
	 * - one radius, one size scale, tabular numerals so counts don't jitter
	 */
	let {
		tone = "neutral",
		size = "sm",
		dot = false,
		children
	}: {
		tone?: "neutral" | "accent" | "success" | "warning" | "danger";
		size?: "sm" | "md";
		/** Adds a leading status dot. Useful in dense lists where text alone blurs. */
		dot?: boolean;
		children?: Snippet;
	} = $props();
</script>

<span class="badge tone-{tone} size-{size}">
	{#if dot}<span class="badge-dot" aria-hidden="true"></span>{/if}
	{@render children?.()}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		border-radius: var(--radius-pill);
		font-weight: var(--weight-medium);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		border: 1px solid transparent;
	}

	.size-sm {
		font-size: var(--text-label);
		padding: 2px var(--space-2);
	}

	.size-md {
		font-size: var(--text-secondary);
		padding: var(--space-1) var(--space-3);
	}

	.badge-dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-pill);
		background: currentColor;
		flex-shrink: 0;
	}

	.tone-neutral {
		background: var(--color-surface-hover);
		color: var(--color-text-muted);
		border-color: var(--color-border);
	}

	.tone-accent {
		background: rgba(37, 99, 235, 0.08);
		color: #1d4ed8;
		border-color: rgba(37, 99, 235, 0.18);
	}

	.tone-success {
		background: rgba(16, 185, 129, 0.1);
		color: #047857;
		border-color: rgba(16, 185, 129, 0.2);
	}

	.tone-warning {
		background: rgba(245, 158, 11, 0.12);
		color: #b45309;
		border-color: rgba(245, 158, 11, 0.22);
	}

	.tone-danger {
		background: rgba(239, 68, 68, 0.1);
		color: #b91c1c;
		border-color: rgba(239, 68, 68, 0.2);
	}

	/* Dark theme: the light-mode 700-shades fail contrast on dark tints, so each
	   tone flips to its bright shade against a darker fill. */
	:global(.dark) .tone-accent {
		background: rgba(96, 165, 250, 0.14);
		color: #93c5fd;
		border-color: rgba(96, 165, 250, 0.24);
	}
	:global(.dark) .tone-success {
		background: rgba(52, 211, 153, 0.14);
		color: #6ee7b7;
		border-color: rgba(52, 211, 153, 0.24);
	}
	:global(.dark) .tone-warning {
		background: rgba(251, 191, 36, 0.14);
		color: #fcd34d;
		border-color: rgba(251, 191, 36, 0.24);
	}
	:global(.dark) .tone-danger {
		background: rgba(248, 113, 113, 0.14);
		color: #fca5a5;
		border-color: rgba(248, 113, 113, 0.24);
	}
</style>
