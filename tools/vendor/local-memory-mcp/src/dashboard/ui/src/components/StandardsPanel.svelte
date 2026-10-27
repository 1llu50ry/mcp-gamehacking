<script lang="ts">
	import { onMount } from "svelte";
	import { api } from "../lib/api";
	import StandardSearchBar from "./StandardSearchBar.svelte";
	import StandardsList from "./StandardsList.svelte";
	import DetailDrawer from "./DetailDrawer.svelte";
	import type { CodingStandard } from "../lib/stores";
	import { dedupeTags } from "../lib/utils";
	import { confirmDelete } from "../lib/confirm";
	import Icon from "../lib/Icon.svelte";
	import { ErrorState, PageHeader } from "./ui";

	export let repo = "";

	let standards: CodingStandard[] = [];
	let loading = false;
	let error = "";
	let notice = "";
	let query = "";
	let language = "";
	let stack = "";
	let scope: "repo" | "global" | "all" = "repo";
	let importing = false;
	let exporting = false;

	// Pagination
	let page = 1;
	let pageSize = 25;
	let totalItems = 0;
	let totalPages = 1;

	// Detail drawer
	let selectedStandard: CodingStandard | null = null;
	let standardDrawerOpen = false;

	$: if (repo) {
		void loadStandards();
	}

	async function loadStandards() {
		if (!repo) return;
		loading = true;
		error = "";
		try {
			const result = await api.standards({
				query: query || undefined,
				language: language || undefined,
				stack: stack || undefined,
				repo: scope === "repo" ? repo : undefined,
				is_global: scope === "global" ? true : undefined,
				page,
				pageSize
			});
			standards = (result.standards || []).map((s) => ({ ...s, tags: dedupeTags(s.tags) }));
			totalItems = result.pagination?.totalItems || 0;
			totalPages = result.pagination?.totalPages || 1;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function onFilterChange() {
		page = 1;
		void loadStandards();
	}

	/**
	 * Reset filter state before reloading standards.
	 */
	function handleClear() {
		language = "";
		stack = "";
		scope = "repo";
		page = 1;
	}

	function goToPage(p: number) {
		if (p < 1 || p > totalPages) return;
		page = p;
		void loadStandards();
	}

	function openCreateDrawer() {
		selectedStandard = null;
		standardDrawerOpen = true;
	}

	function openEditDrawer(std: CodingStandard) {
		selectedStandard = std;
		standardDrawerOpen = true;
	}

	function closeStandardDrawer() {
		standardDrawerOpen = false;
		selectedStandard = null;
	}

	function handleStandardUpdated(_: unknown) {
		void loadStandards();
	}

	function handleStandardDeleted(_: unknown) {
		void loadStandards();
	}

	async function handleBulkDelete(ids: string[]) {
		if (ids.length === 0) return;
		if (!(await confirmDelete(`Are you sure you want to delete ${ids.length} standards?`))) return;
		try {
			await api.bulkStandardAction("delete", ids);
			void loadStandards();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function handleDeleteRow(std: CodingStandard) {
		if (!(await confirmDelete(`Delete coding standard "${std.title}"?`))) return;
		try {
			await api.deleteStandard(std.id);
			void loadStandards();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function exportStandards() {
		exporting = true;
		error = "";
		notice = "";
		try {
			const payloadScope = scope === "global" || scope === "all" ? scope : "repo";
			const payload = await api.exportStandards({
				repo: payloadScope === "repo" ? repo : undefined,
				scope: payloadScope
			});
			const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			const repoPart = repo ? repo.replace(/[^a-z0-9._-]+/gi, "-") : "all";
			const stamp = new Date().toISOString().slice(0, 10);
			link.download = `standards-${repoPart}-${payloadScope}-${stamp}.json`;
			link.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			exporting = false;
		}
	}

	async function importStandards(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		importing = true;
		error = "";
		notice = "";
		try {
			const payload = JSON.parse(await file.text());
			const standardsCount = Array.isArray(payload?.standards) ? payload.standards.length : 0;
			const result = await api.importStandards({
				...payload,
				refresh_vectors: standardsCount > 0 && standardsCount <= 500
			});
			void loadStandards();
			const vectorNote = result.vectors_refreshed ? "" : " Vector refresh skipped for large import.";
			notice = `Imported ${result.imported} and updated ${result.updated} standard(s).${vectorNote}`;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			importing = false;
			input.value = "";
		}
	}

	onMount(() => {
		void loadStandards();
	});
</script>

<PageHeader description="Rules agents apply in this workspace. Add or import only what is genuinely reusable.">
	{#snippet actions()}
		<button class="btn btn-primary" on:click={openCreateDrawer}>
			<Icon name="plus" size={16} strokeWidth={2} />
			Add rule
		</button>
	{/snippet}
</PageHeader>

<div class="feature-shell">
	<StandardSearchBar
		bind:query
		bind:language
		bind:stack
		bind:scope
		{exporting}
		{importing}
		standardsCount={standards.length}
		{onFilterChange}
		onClear={handleClear}
		onExport={exportStandards}
		onImport={importStandards}
	/>

	<div class="results-summary" aria-live="polite">
		<span><strong>{totalItems}</strong> rules</span>
		<span>{scope === "repo" ? "Workspace + global" : scope === "global" ? "Global only" : "All workspaces"}</span>
		{#if totalPages > 1}<span>Page {page} of {totalPages}</span>{/if}
	</div>

	{#if error}
		<ErrorState title="Couldn't load standards" description="The request failed. No rules were changed.">
			{#snippet action()}
				<button class="btn btn-secondary btn-sm" on:click={loadStandards}>Try again</button>
			{/snippet}
		</ErrorState>
	{/if}
	{#if notice}
		<p class="notice-banner" role="status">{notice}</p>
	{/if}

	<StandardsList
		{standards}
		{loading}
		{totalPages}
		{page}
		onOpenEditDrawer={openEditDrawer}
		onDeleteRow={handleDeleteRow}
		onGoToPage={goToPage}
		onBulkDelete={handleBulkDelete}
	/>
</div>

<DetailDrawer
	drawerMode="standard"
	standard={selectedStandard}
	open={standardDrawerOpen}
	onClose={closeStandardDrawer}
	onStandardUpdated={handleStandardUpdated}
	onStandardDeleted={handleStandardDeleted}
	{repo}
/>

<style>
	.feature-shell {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.results-summary {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
	}
	.results-summary strong {
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}

	.notice-banner {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-primary);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--text-secondary);
	}
</style>
