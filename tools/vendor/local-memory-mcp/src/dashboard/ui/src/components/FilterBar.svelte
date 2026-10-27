<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { arenaStateManager } from "../lib/arena/arenaStateManager";
	import Icon from "../lib/Icon.svelte";
	import FilterMenu from "./FilterMenu.svelte";
	import { computeActiveCount } from "../lib/filterBarUtils";
	import type { FilterState } from "../lib/arena/arenaEvents";

	// ── State ────────────────────────────────────────────────────────────────
	let collapsed = true;
	let currentFilter: FilterState = {
		repository: null,
		roles: [],
		priorities: [],
		statuses: [],
		search: ""
	};

	// ── Subscribe to state manager for current filter ──────────────────────
	const unsub = arenaStateManager.getStore().subscribe(($state) => {
		currentFilter = { ...$state.ui.activeFilter };
	});

	onDestroy(() => unsub());

	// ── Keyboard shortcut ──────────────────────────────────────────────────
	function onKeyDown(e: KeyboardEvent): void {
		if (
			e.key === "f" &&
			!e.ctrlKey &&
			!e.metaKey &&
			!e.altKey &&
			e.target instanceof HTMLElement &&
			e.target.tagName !== "INPUT" &&
			e.target.tagName !== "TEXTAREA"
		) {
			e.preventDefault();
			collapsed = !collapsed;
		}
	}

	onMount(() => {
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	// ── Filter mutators ────────────────────────────────────────────────────
	function toggleRepo(repo: string | null): void {
		const next = currentFilter.repository === repo ? null : repo;
		currentFilter.repository = next;
		arenaStateManager.setFilter({ repository: next });
	}

	function toggleRole(role: string): void {
		const roles = currentFilter.roles.includes(role)
			? currentFilter.roles.filter((r) => r !== role)
			: [...currentFilter.roles, role];
		currentFilter.roles = roles;
		arenaStateManager.setFilter({ roles });
	}

	function togglePriority(pKey: string): void {
		const priorities = currentFilter.priorities.includes(pKey)
			? currentFilter.priorities.filter((p) => p !== pKey)
			: [...currentFilter.priorities, pKey];
		currentFilter.priorities = priorities;
		arenaStateManager.setFilter({ priorities });
	}

	function toggleStatus(sKey: string): void {
		const statuses = currentFilter.statuses.includes(sKey)
			? currentFilter.statuses.filter((s) => s !== sKey)
			: [...currentFilter.statuses, sKey];
		currentFilter.statuses = statuses;
		arenaStateManager.setFilter({ statuses });
	}

	function onSearchInput(e: Event): void {
		const val = (e.target as HTMLInputElement).value;
		currentFilter.search = val;
		arenaStateManager.setFilter({ search: val });
	}

	function clearSearch(): void {
		currentFilter.search = "";
		arenaStateManager.setFilter({ search: "" });
	}

	function clearAll(): void {
		currentFilter = { repository: null, roles: [], priorities: [], statuses: [], search: "" };
		arenaStateManager.setFilter(currentFilter);
	}

	// ── Derived: active filter count ──────────────────────────────────────
	$: activeCount = computeActiveCount(currentFilter);
</script>

<div class="filter-bar-root" class:collapsed>
	<!-- Toggle button -->
	<button
		class="filter-toggle"
		class:active={activeCount > 0}
		on:click={() => (collapsed = !collapsed)}
		title="Toggle filters (F)"
		aria-expanded={!collapsed}
		aria-label="Toggle filter bar"
	>
		<Icon name="circle-dot" size={14} strokeWidth={1.75} />
		{#if activeCount > 0}
			<span class="filter-count">{activeCount}</span>
		{/if}
	</button>

	{#if !collapsed}
		<FilterMenu
			{currentFilter}
			onToggleRepo={toggleRepo}
			onToggleRole={toggleRole}
			onTogglePriority={togglePriority}
			onToggleStatus={toggleStatus}
			{onSearchInput}
			onClearSearch={clearSearch}
			onClearAll={clearAll}
		/>
	{/if}
</div>

<style>
	.filter-bar-root {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 16px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.02);
		min-height: 34px;
		flex-wrap: wrap;
	}

	.filter-toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		padding: 6px 12px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: 0.7rem;
		font-weight: 600;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}
	.filter-toggle:hover {
		background: rgba(100, 116, 139, 0.08);
		color: var(--color-text);
	}
	.filter-toggle.active {
		border-color: var(--color-primary, #6366f1);
		color: var(--color-primary, #6366f1);
		background: rgba(99, 102, 241, 0.06);
	}
	.filter-count {
		font-size: 0.6rem;
		background: var(--color-primary, #6366f1);
		color: #fff;
		border-radius: 999px;
		padding: 0 5px;
		min-width: 14px;
		text-align: center;
		line-height: 14px;
		font-weight: 700;
	}

	/* ── Collapsed state ────────────────────────────────────────────── */
	.collapsed {
		padding: 4px 16px;
	}

	@media (pointer: coarse) {
		.filter-toggle {
			min-width: 44px;
			min-height: 44px;
		}
	}
</style>
