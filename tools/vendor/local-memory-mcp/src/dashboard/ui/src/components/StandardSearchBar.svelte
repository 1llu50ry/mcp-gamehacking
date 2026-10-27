<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import Toolbar from "./ui/Toolbar.svelte";

	/**
	 * Filter row for the coding-standards collection.
	 *
	 * Matches the Memories filter pattern (commit c081154):
	 * search box with search icon, constrained filter inputs/selects,
	 * active filter count badge, and a Clear all button.
	 */
	const DEFAULT_LANGUAGE = "";
	const DEFAULT_STACK = "";
	const DEFAULT_SCOPE: "repo" | "global" | "all" = "repo";

	let {
		query = $bindable(""),
		language = $bindable(""),
		stack = $bindable(""),
		scope = $bindable<"repo" | "global" | "all">("repo"),
		exporting = false,
		importing = false,
		standardsCount = 0,
		onFilterChange = () => {},
		onExport = () => {},
		onImport = (_event: Event) => {},
		onClear = () => {}
	}: {
		query?: string;
		language?: string;
		stack?: string;
		scope?: "repo" | "global" | "all";
		exporting?: boolean;
		importing?: boolean;
		standardsCount?: number;
		onFilterChange?: () => void;
		onExport?: () => void;
		onImport?: (event: Event) => void;
		onClear?: () => void;
	} = $props();

	let importInput = $state<HTMLInputElement | null>(null);

	let activeFilterCount = $derived(
		(language !== DEFAULT_LANGUAGE ? 1 : 0) + (stack !== DEFAULT_STACK ? 1 : 0) + (scope !== DEFAULT_SCOPE ? 1 : 0)
	);

	/**
	 * Reset all filters to default values and notify host.
	 */
	function handleClearAll() {
		language = DEFAULT_LANGUAGE;
		stack = DEFAULT_STACK;
		scope = DEFAULT_SCOPE;
		onClear();
		onFilterChange();
	}
</script>

<Toolbar label="Standard filters">
	{#snippet search()}
		<div class="search-field">
			<span class="search-icon-inner" aria-hidden="true">
				<Icon name="search" size={16} />
			</span>
			<input
				class="form-input search-input"
				type="text"
				placeholder="Search standards…"
				aria-label="Search coding standards"
				bind:value={query}
				oninput={onFilterChange}
			/>
		</div>
	{/snippet}

	{#snippet filters()}
		<input
			class="form-input filter-input"
			placeholder="Language"
			aria-label="Filter by language"
			bind:value={language}
			oninput={onFilterChange}
		/>
		<input
			class="form-input filter-input"
			placeholder="Stack tags"
			aria-label="Filter by stack tags"
			bind:value={stack}
			oninput={onFilterChange}
		/>
		<select class="form-select filter-select" bind:value={scope} onchange={onFilterChange} aria-label="Standard scope">
			<option value="repo">Repo + global</option>
			<option value="global">Global only</option>
			<option value="all">All standards</option>
		</select>

		{#if activeFilterCount > 0}
			<div class="filter-status">
				<span
					class="filter-badge"
					aria-label="{activeFilterCount} active {activeFilterCount === 1 ? 'filter' : 'filters'}"
				>
					<span class="filter-count">{activeFilterCount}</span>
					<span>active</span>
				</span>
				<button
					type="button"
					class="clear-btn"
					onclick={handleClearAll}
					title="Clear all filters"
					aria-label="Clear all filters"
				>
					<Icon name="circle-x" size={14} />
					<span>Clear all</span>
				</button>
			</div>
		{/if}
	{/snippet}

	{#snippet actions()}
		<button class="btn btn-secondary" onclick={onExport} disabled={exporting || standardsCount === 0}>
			<Icon name="download" size={14} strokeWidth={2} />
			{exporting ? "Exporting…" : "Export"}
		</button>
		<button class="btn btn-secondary" onclick={() => importInput?.click()} disabled={importing}>
			<Icon name="upload" size={14} strokeWidth={2} />
			{importing ? "Importing…" : "Import"}
		</button>
		<input bind:this={importInput} class="file-input" type="file" accept="application/json,.json" onchange={onImport} />
	{/snippet}
</Toolbar>

<style>
	.file-input {
		display: none;
	}
</style>
