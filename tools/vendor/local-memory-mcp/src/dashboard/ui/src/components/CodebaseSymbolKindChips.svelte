<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { SvelteMap } from "svelte/reactivity";
	import type { TraceReference } from "../lib/api";
	import { getKindIcon, refKindLabel, refKindKey, REFERENCE_KIND_ORDER } from "../lib/symbolDetailUtils";

	let {
		traceRefs = [],
		activeKindFilter = $bindable("all")
	}: {
		traceRefs: TraceReference[];
		/** Reference-kind filter (Phase 1.1). Owned by CodebaseSymbolDetail so it
		 *  can be reset to "all" on every symbol transition; bound here so the
		 *  chip row can update it. */
		activeKindFilter?: string;
	} = $props();

	// Per-kind counts for the filter chip row (stable order + "other").
	let refKindCounts = $derived.by(() => {
		const counts = new SvelteMap<string, number>();
		for (const ref of traceRefs) {
			const key = refKindKey(ref.kind);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return counts;
	});

	let refKindChips = $derived.by(() => {
		const chips: { key: string; label: string; count: number }[] = [];
		for (const key of [...REFERENCE_KIND_ORDER, "other"]) {
			const count = refKindCounts.get(key) ?? 0;
			if (count > 0) chips.push({ key, label: refKindLabel(key), count });
		}
		return chips;
	});
</script>

<!-- Kind filter chips -->
{#if traceRefs.length > 0 && refKindChips.length > 0}
	<div class="ref-kind-chips" role="group" aria-label="Filter references by kind">
		<button
			class="ref-kind-chip"
			class:active={activeKindFilter === "all"}
			aria-pressed={activeKindFilter === "all"}
			onclick={() => (activeKindFilter = "all")}
		>
			All
		</button>
		{#each refKindChips as chip (chip.key)}
			<button
				class="ref-kind-chip"
				class:active={activeKindFilter === chip.key}
				aria-pressed={activeKindFilter === chip.key}
				onclick={() => (activeKindFilter = chip.key)}
			>
				<Icon name={getKindIcon(chip.key)} size={10} strokeWidth={2} />
				{chip.label}
				<span class="ref-kind-chip-count">{chip.count}</span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.ref-kind-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		padding: 2px 0 8px;
	}

	.ref-kind-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.04);
		color: var(--color-text-muted);
		font-size: 0.62rem;
		font-weight: 600;
		padding: 3px 8px;
		border-radius: 999px;
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease;
	}

	.ref-kind-chip:hover {
		background: rgba(255, 255, 255, 0.07);
		color: var(--color-text);
	}

	.ref-kind-chip.active {
		background: rgba(99, 102, 241, 0.14);
		border-color: rgba(99, 102, 241, 0.35);
		color: var(--color-primary);
	}

	.ref-kind-chip:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.ref-kind-chip-count {
		font-size: 0.54rem;
		font-weight: 700;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 4px;
		padding: 0 4px;
		opacity: 0.85;
	}
</style>
