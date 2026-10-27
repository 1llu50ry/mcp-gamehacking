<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	export let categories: Array<{
		id: string;
		icon: string;
		label: string;
		count: number;
	}> = [];
	export let activeFilter: string = "all";
	export let onFilterChange: (filter: string) => void = () => {};
</script>

<div class="glass ref-sidebar">
	<div class="ref-sidebar-label">Category</div>
	{#each categories as cat (cat.id)}
		<button class="ref-cat-btn" class:active={activeFilter === cat.id} on:click={() => onFilterChange(cat.id)}>
			<Icon name={cat.icon} size={13} strokeWidth={1.75} />
			<span>{cat.label}</span>
			<span class="ref-cat-count">{cat.count}</span>
		</button>
	{/each}
</div>

<style>
	.ref-sidebar {
		padding: 12px;
		border-radius: 16px;
		border: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		gap: 3px;
		position: sticky;
		top: 80px;
	}

	.ref-sidebar-label {
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--color-text-muted);
		padding: 4px 8px 8px;
	}

	.ref-cat-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 8px 12px;
		border-radius: 9px;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		cursor: pointer;
		width: 100%;
		text-align: left;
		transition: all 0.15s ease;
	}

	.ref-cat-btn:hover {
		background: rgba(14, 165, 233, 0.06);
		color: var(--color-text);
	}

	.ref-cat-btn.active {
		background: rgba(14, 165, 233, 0.1);
		/* WCAG AA: #0ea5e9 measured 2.5:1 on this tint — darkened to pass. */
		color: #01607f;
		border: 1px solid rgba(14, 165, 233, 0.2);
	}

	:global(html.dark) .ref-cat-btn.active {
		background: rgba(14, 165, 233, 0.15);
		color: #38bdf8;
		border-color: rgba(56, 189, 248, 0.25);
	}

	.ref-cat-count {
		margin-left: auto;
		font-size: 0.72rem;
		font-weight: 700;
		background: rgba(100, 116, 139, 0.12);
		color: var(--color-text-muted);
		padding: 1px 6px;
		border-radius: 9999px;
	}

	@media (pointer: coarse) {
		.ref-cat-btn {
			min-height: 44px;
		}
	}
</style>
