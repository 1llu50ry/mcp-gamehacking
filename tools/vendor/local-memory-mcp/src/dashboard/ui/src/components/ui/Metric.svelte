<script lang="ts">
	/**
	 * Metric — a single number with its label.
	 *
	 * The old stat cards buried the value: 11px uppercase-800 label on top, then
	 * a value at nearly the same size, inside a tinted gradient box, four to a
	 * row. Everything shouted, so nothing was readable at a glance.
	 *
	 * Here the number is the largest thing and the label is quiet, which is the
	 * actual hierarchy — you scan for the value, then read what it means.
	 * Numerals are tabular so a row of metrics stays optically aligned.
	 */
	let {
		label,
		value,
		hint = "",
		tone = "neutral"
	}: {
		label: string;
		value: string | number;
		/** Short qualifier under the value (e.g. "of 240", "last 7d"). */
		hint?: string;
		/** Semantic emphasis. `neutral` is correct for the vast majority. */
		tone?: "neutral" | "success" | "warning" | "danger";
	} = $props();
</script>

<div class="metric">
	<p class="metric-label">{label}</p>
	<p class="metric-value tone-{tone}">{value}</p>
	{#if hint}<p class="metric-hint">{hint}</p>{/if}
</div>

<style>
	.metric {
		min-width: 0;
	}

	.metric-label {
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
		font-weight: var(--weight-regular);
	}

	.metric-value {
		margin-top: var(--space-1);
		font-size: 1.5rem;
		font-weight: var(--weight-semibold);
		letter-spacing: -0.02em;
		line-height: var(--leading-tight);
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	.metric-hint {
		margin-top: var(--space-1);
		font-size: var(--text-label);
		color: var(--color-text-faint);
		font-variant-numeric: tabular-nums;
	}

	.tone-success {
		color: var(--color-success);
	}
	.tone-warning {
		color: var(--color-warning);
	}
	.tone-danger {
		color: var(--color-danger);
	}
</style>
