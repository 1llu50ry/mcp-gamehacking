<script lang="ts">
	import { memoriesSearch, memoriesTypeFilter, memoriesImportanceMin, memoriesPageSize } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";
	import ExportToolbar from "./ExportToolbar.svelte";
	import { TYPES, TYPE_LABELS } from "../lib/memoryConfig";
	import Toolbar from "./ui/Toolbar.svelte";

	/**
	 * Filter row for the memory collection.
	 *
	 * The "New Memory" primary action used to live here, as the sixth cell of a
	 * six-column grid, visually equal to a page-size dropdown. A page's primary
	 * action does not belong at the end of a filter row — it now sits in the
	 * page header (MemoriesView), leaving this component with a single
	 * responsibility: narrowing the list.
	 *
	 * The bespoke grid with three breakpoints and `grid-row` reordering hacks is
	 * replaced by the shared Toolbar primitive, so this row wraps the same way
	 * as every other collection in the app.
	 */
	const DEFAULT_TYPE = "";
	const DEFAULT_IMPORTANCE: number | null = null;
	const DEFAULT_PAGE_SIZE = 25;

	let {
		onSearchInput = () => {},
		onFilterChange = () => {},
		onPageSizeChange = () => {},
		onExport = (_format: "json" | "csv") => {},
		onImport = () => {},
		onClear = () => {}
	}: {
		onSearchInput?: () => void;
		onFilterChange?: () => void;
		onPageSizeChange?: () => void;
		onExport?: (format: "json" | "csv") => void;
		onImport?: () => void;
		onClear?: () => void;
	} = $props();

	let activeFilterCount = $derived(
		($memoriesTypeFilter !== DEFAULT_TYPE ? 1 : 0) +
			($memoriesImportanceMin !== DEFAULT_IMPORTANCE ? 1 : 0) +
			(Number($memoriesPageSize) !== DEFAULT_PAGE_SIZE ? 1 : 0)
	);

	/**
	 * Reset all filters and pagination size to their default values.
	 */
	function handleClearAll() {
		$memoriesTypeFilter = DEFAULT_TYPE;
		$memoriesImportanceMin = DEFAULT_IMPORTANCE;
		$memoriesPageSize = DEFAULT_PAGE_SIZE;
		onFilterChange();
		onClear();
	}
</script>

<Toolbar label="Memory filters">
	{#snippet search()}
		<div class="search-field">
			<span class="search-icon-inner" aria-hidden="true">
				<Icon name="search" size={16} />
			</span>
			<input
				class="form-input search-input"
				type="text"
				placeholder="Search memories…"
				aria-label="Search memories"
				bind:value={$memoriesSearch}
				oninput={onSearchInput}
			/>
		</div>
	{/snippet}

	{#snippet filters()}
		<select
			class="form-select filter-select"
			aria-label="Filter memories by type"
			bind:value={$memoriesTypeFilter}
			onchange={onFilterChange}
		>
			<option value="">All types</option>
			{#each TYPES as t (t)}
				<option value={t}>{TYPE_LABELS[t]}</option>
			{/each}
		</select>

		<select
			class="form-select filter-select"
			aria-label="Minimum importance"
			bind:value={$memoriesImportanceMin}
			onchange={onFilterChange}
		>
			<option value={null}>Any importance</option>
			{#each [1, 2, 3, 4, 5] as i (i)}
				<option value={i}>Importance {i}+</option>
			{/each}
		</select>

		<select
			class="form-select filter-select"
			aria-label="Memories per page"
			bind:value={$memoriesPageSize}
			onchange={onPageSizeChange}
		>
			{#each [10, 25, 50, 100] as n (n)}
				<option value={n}>{n} per page</option>
			{/each}
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
		<ExportToolbar {onExport} {onImport} />
	{/snippet}
</Toolbar>
