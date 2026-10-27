<script lang="ts">
	export let label: string;
	export let active: boolean = false;
	export let color: string = "#64748b";
	export let onClick: () => void = () => {};
</script>

<button class="filter-chip" class:active style="--chip-color:{color}" on:click={onClick} title={label}>
	<span class="chip-dot"></span>
	<span class="chip-text">{label}</span>
</button>

<style>
	.filter-chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px 6px;
		border: 1px solid var(--color-border);
		border-radius: 5px;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 0.62rem;
		font-weight: 600;
		transition: all 0.12s ease;
		white-space: nowrap;
	}

	.filter-chip:hover {
		background: rgba(100, 116, 139, 0.08);
	}

	.chip-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--chip-color);
		flex-shrink: 0;
		opacity: 0.45;
		transition: opacity 0.12s ease;
	}

	.filter-chip.active .chip-dot {
		opacity: 1;
		box-shadow: 0 0 4px var(--chip-color);
	}

	.filter-chip.active {
		border-color: var(--chip-color);
		color: var(--color-text);
		background: color-mix(in srgb, var(--chip-color) 8%, transparent);
	}

	.chip-text {
		text-transform: capitalize;
	}
</style>
