<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { formatDate } from "../lib/utils";
	import type { CodingStandard } from "../lib/stores";
	import { SvelteSet } from "svelte/reactivity";
	import { formatScopeLabel } from "../lib/standardsPanelUtils";
	import { writable } from "svelte/store";
	import { EmptyState, TablePagination } from "./ui";

	export let standards: CodingStandard[] = [];
	export let loading = false;
	export let totalPages = 1;
	export let page = 1;
	export let onOpenEditDrawer: (std: CodingStandard) => void = () => {};
	export let onDeleteRow: (std: CodingStandard) => void = () => {};
	export let onGoToPage: (p: number) => void = () => {};
	export let onBulkDelete: (ids: string[]) => void = () => {};

	const selectedStandardIds = writable<SvelteSet<string>>(new SvelteSet());

	$: allSelected = standards.length > 0 && $selectedStandardIds.size === standards.length;

	function toggleSelect(id: string) {
		selectedStandardIds.update((ids) => {
			const next = new SvelteSet(ids);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleSelectAll() {
		selectedStandardIds.update((ids) => {
			if (ids.size === standards.length) return new SvelteSet();
			return new SvelteSet(standards.map((s) => s.id));
		});
	}

	function clearSelection() {
		selectedStandardIds.set(new SvelteSet());
	}

	function handleBulkDelete() {
		onBulkDelete(Array.from($selectedStandardIds));
		clearSelection();
	}
</script>

<div class="mem-table-wrap">
	<table class="mem-table">
		<thead>
			<tr class="mem-thead-row">
				<th class="mem-th" style="width:36px;">
					<input type="checkbox" checked={allSelected} on:change={() => toggleSelectAll()} aria-label="Select all" />
				</th>
				<th class="mem-th" style="min-width:200px;">Title</th>
				<th class="mem-th">Context</th>
				<th class="mem-th">Version</th>
				<th class="mem-th">Language</th>
				<th class="mem-th">Updated</th>
				<th class="mem-th">Scope</th>
				<th class="mem-th" style="width:80px;"></th>
			</tr>
		</thead>
		<tbody>
			{#if loading}
				{#each { length: 5 } as _, i (i)}
					<tr>
						<td colspan="8" class="mem-td">
							<div class="skeleton" style="height:20px;border-radius:6px;"></div>
						</td>
					</tr>
				{/each}
			{:else if standards.length === 0}
				<tr>
					<td colspan="8" class="mem-td" style="padding:0;border-bottom:none;">
						<EmptyState
							icon="check"
							title="No standards found"
							description="Adjust the filters or create a standard."
						/>
					</td>
				</tr>
			{:else}
				{#each standards as std, i (`${std.id}-${i}`)}
					<tr
						class="mem-row"
						class:selected={$selectedStandardIds.has(std.id)}
						on:click={() => onOpenEditDrawer(std)}
						role="button"
						tabindex="0"
						on:keydown={(e) => e.key === "Enter" && onOpenEditDrawer(std)}
					>
						<td class="mem-td" on:click|stopPropagation>
							<input
								type="checkbox"
								checked={$selectedStandardIds.has(std.id)}
								on:change={() => toggleSelect(std.id)}
								aria-label="Select standard {std.title}"
							/>
						</td>
						<td class="mem-td" style="max-width:300px;">
							<div class="truncate font-semibold" style="font-size:0.82rem;color:var(--color-text);">{std.title}</div>
							{#if std.tags?.length}
								<div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">
									{#each std.tags.slice(0, 4) as tag (tag)}
										<span
											style="font-size:0.6rem;background:rgba(99,102,241,0.1);color:#6366f1;padding:1px 5px;border-radius:9999px;"
											>{tag}</span
										>
									{/each}
								</div>
							{/if}
						</td>
						<td class="mem-td" style="font-size:0.78rem;color:var(--color-text);">{std.context || "—"}</td>
						<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);">v{std.version}</td>
						<td class="mem-td" style="font-size:0.78rem;color:var(--color-text);">{std.language || "any"}</td>
						<td class="mem-td" style="font-size:0.75rem;color:var(--color-text-muted);white-space:nowrap;"
							>{formatDate(std.updated_at)}</td
						>
						<td class="mem-td">
							<span class="scope-chip" class:scope-global={std.is_global} class:scope-repo={!std.is_global}
								>{formatScopeLabel(std.is_global)}</span
							>
						</td>
						<td class="mem-td row-actions reveal-on-hover" on:click|stopPropagation>
							<button
								class="row-action-btn edit-btn"
								on:click={() => onOpenEditDrawer(std)}
								title="Edit / View"
								aria-label="Edit standard"
							>
								<Icon name="edit" size={13} strokeWidth={2} />
							</button>
							<button
								class="row-action-btn delete-btn"
								on:click={() => onDeleteRow(std)}
								title="Delete"
								aria-label="Delete standard"
							>
								<Icon name="trash" size={13} strokeWidth={2} />
							</button>
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<div class="standard-cards" aria-label="Coding standards">
	{#if loading}
		{#each { length: 3 } as _, i (i)}<div class="standard-card">
				<div class="skeleton" style="height:124px;border-radius:10px;"></div>
			</div>{/each}
	{:else if standards.length === 0}
		<div class="mobile-empty">
			<EmptyState icon="check" title="No standards found" description="Adjust the filters or add a reusable rule." />
		</div>
	{:else}
		{#each standards as std (std.id)}
			<article class="standard-card" class:selected={$selectedStandardIds.has(std.id)}>
				<div class="standard-heading">
					<input
						type="checkbox"
						checked={$selectedStandardIds.has(std.id)}
						on:change={() => toggleSelect(std.id)}
						aria-label={`Select standard ${std.title}`}
					/><button class="standard-title" on:click={() => onOpenEditDrawer(std)}>{std.title}</button><span
						class="scope-chip"
						class:scope-global={std.is_global}
						class:scope-repo={!std.is_global}>{formatScopeLabel(std.is_global)}</span
					>
				</div>
				{#if std.context}<p>{std.context}</p>{/if}
				<div class="standard-meta">
					<span>{std.language || "Any language"}</span><span>v{std.version}</span><span
						>{formatDate(std.updated_at)}</span
					>
				</div>
				{#if std.tags?.length}<div class="standard-tags">
						{#each std.tags.slice(0, 4) as tag (tag)}<span>{tag}</span>{/each}
					</div>{/if}
				<div class="mobile-actions">
					<button class="btn btn-ghost" on:click={() => onOpenEditDrawer(std)}>Open</button><button
						class="btn btn-danger"
						on:click={() => onDeleteRow(std)}>Delete</button
					>
				</div>
			</article>
		{/each}
	{/if}
</div>

<!-- Pagination -->
<TablePagination {page} {totalPages} {loading} onPageChange={onGoToPage} />

<!-- Bulk Action Toolbar -->
{#if $selectedStandardIds.size > 0}
	<div class="bulk-actions-bar">
		<span><b>{$selectedStandardIds.size}</b> selected</span>
		<div style="width:12px;"></div>
		<button class="btn btn-sm" style="background:rgba(120,120,120,0.2);color:inherit;" on:click={() => clearSelection()}
			>Cancel</button
		>
		<button
			class="btn btn-sm btn-accent"
			style="background:#ef4444;color:white;border:none;"
			on:click={handleBulkDelete}>Delete</button
		>
	</div>
{/if}

<style>
	/* ── Scope chips ── */
	.scope-chip {
		font-size: 0.68rem;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 9999px;
		display: inline-block;
	}

	.scope-global {
		background: rgba(168, 85, 247, 0.1);
		color: #a855f7;
		border: 1px solid rgba(168, 85, 247, 0.2);
	}

	.scope-repo {
		background: rgba(14, 165, 233, 0.1);
		color: #0ea5e9;
		border: 1px solid rgba(14, 165, 233, 0.2);
	}

	.standard-cards {
		display: none;
	}

	.bulk-actions-bar {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 20px;
		background: var(--color-surface, #1e1e2e);
		border: 1px solid var(--color-border);
		border-radius: 16px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
		z-index: 100;
		font-size: 0.85rem;
		color: var(--color-text);
	}

	@media (max-width: 720px) {
		.standard-cards {
			display: grid;
			gap: var(--space-3);
		}
		.standard-card {
			display: grid;
			gap: var(--space-3);
			padding: var(--space-4);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
			background: var(--color-surface);
		}
		.standard-card.selected {
			border-color: var(--color-primary);
			background: var(--color-primary-soft);
		}
		.standard-heading {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto;
			align-items: start;
			gap: 10px;
		}
		.standard-title {
			/* 44px on touch: this is the card's primary action (opens the
			   editor), so it has to clear the tap-target floor. */
			min-height: 44px;
			padding: 0;
			border: 0;
			background: transparent;
			color: var(--color-text);
			font-size: 0.92rem;
			font-weight: 700;
			line-height: 1.4;
			text-align: left;
		}
		.standard-card p {
			margin: 0;
			font-size: 0.8rem;
			line-height: 1.5;
			color: var(--color-text-muted);
		}
		.standard-meta,
		.standard-tags {
			display: flex;
			flex-wrap: wrap;
			gap: 6px 12px;
			font-size: 0.72rem;
			color: var(--color-text-muted);
		}
		.standard-tags span {
			padding: 3px 7px;
			border-radius: 999px;
			background: var(--color-hover, var(--color-surface-hover));
		}
		.mobile-actions {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 8px;
		}
		.mobile-empty {
			display: grid;
			justify-items: center;
			gap: 8px;
			padding: 40px 16px;
			border: 1px solid var(--color-border);
			border-radius: var(--radius-lg);
			color: var(--color-text-muted);
			text-align: center;
		}
		.bulk-actions-bar {
			left: 16px;
			right: 16px;
			transform: none;
			justify-content: center;
			flex-wrap: wrap;
		}
	}
</style>
