<script lang="ts">
	import Icon from "$lib/Icon.svelte";
	import { availableRepos } from "$lib/stores";
	import { ROLE_COLORS } from "$lib/arena/arenaTransform";
	import FilterChip from "./FilterChip.svelte";
	import { AGENT_ROLES, PRIORITIES, STATUSES, computeActiveCount } from "$lib/filterBarUtils";
	import type { FilterState } from "$lib/arena/arenaEvents";

	export let currentFilter: FilterState;
	export let onToggleRepo: (repo: string | null) => void;
	export let onToggleRole: (role: string) => void;
	export let onTogglePriority: (pKey: string) => void;
	export let onToggleStatus: (sKey: string) => void;
	export let onSearchInput: (e: Event) => void;
	export let onClearSearch: () => void;
	export let onClearAll: () => void;
</script>

<div class="filter-panel">
	<!-- Search -->
	<div class="filter-section search-section">
		<span class="search-icon">
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg
			>
		</span>
		<input
			type="text"
			class="search-input"
			placeholder="Search agents, tasks…"
			aria-label="Search agents and tasks"
			value={currentFilter.search}
			on:input={onSearchInput}
		/>
		{#if currentFilter.search}
			<button class="search-clear" on:click={onClearSearch} aria-label="Clear search">
				<Icon name="circle-x" size={12} />
			</button>
		{/if}
	</div>

	<div class="filter-sep"></div>

	<!-- Repository -->
	<div class="filter-section">
		<span class="filter-label">Repo</span>
		<select
			class="repo-select"
			aria-label="Filter by repository"
			value={currentFilter.repository ?? ""}
			on:change={(e) => onToggleRepo((e.target as HTMLSelectElement).value || null)}
		>
			<option value="">All repos</option>
			{#each $availableRepos as r (r.repo)}
				<option value={r.repo}>{r.repo.split("/").pop()}</option>
			{/each}
		</select>
	</div>

	<div class="filter-sep"></div>

	<!-- Roles -->
	<div class="filter-section toggle-group">
		<span class="filter-label">Roles</span>
		{#each AGENT_ROLES as role (role)}
			<FilterChip
				label={role}
				active={currentFilter.roles.includes(role)}
				color={ROLE_COLORS[role] ?? "#64748b"}
				onClick={() => onToggleRole(role)}
			/>
		{/each}
	</div>

	<div class="filter-sep"></div>

	<!-- Priority -->
	<div class="filter-section toggle-group">
		<span class="filter-label">Priority</span>
		{#each PRIORITIES as p (p.key)}
			<FilterChip
				label={p.key}
				active={currentFilter.priorities.includes(p.key)}
				color={p.color}
				onClick={() => onTogglePriority(p.key)}
			/>
		{/each}
	</div>

	<div class="filter-sep"></div>

	<!-- Status -->
	<div class="filter-section toggle-group">
		<span class="filter-label">Status</span>
		{#each STATUSES as s (s.key)}
			<FilterChip
				label={s.label}
				active={currentFilter.statuses.includes(s.key)}
				color={s.color}
				onClick={() => onToggleStatus(s.key)}
			/>
		{/each}
	</div>

	<!-- Clear all -->
	{#if computeActiveCount(currentFilter) > 0}
		<div class="filter-sep"></div>
		<button class="clear-btn" on:click={onClearAll} title="Clear all filters">
			<Icon name="circle-x" size={11} />
			Clear all
		</button>
	{/if}
</div>

<style>
	.filter-panel {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		flex: 1;
		min-width: 0;
		animation: filter-slide 0.15s ease;
	}

	@keyframes filter-slide {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.filter-section {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-wrap: wrap;
	}

	.filter-label {
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
		opacity: 0.6;
		margin-right: 2px;
		flex-shrink: 0;
	}

	.filter-sep {
		width: 1px;
		height: 18px;
		background: var(--color-border);
		flex-shrink: 0;
		margin: 0 2px;
	}

	/* Search */
	.search-section {
		position: relative;
		flex: 0 1 200px;
		min-width: 100px;
	}

	.search-icon {
		position: absolute;
		left: 7px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		opacity: 0.5;
		pointer-events: none;
		display: flex;
		align-items: center;
	}

	.search-input {
		width: 100%;
		padding: 4px 24px 4px 24px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text);
		font-size: 0.7rem;
		font-family: inherit;
		outline: none;
		transition: border-color 0.15s ease;
	}

	.search-input::placeholder {
		color: var(--color-text-muted);
		opacity: 0.5;
	}

	.search-input:focus {
		border-color: var(--color-primary, #6366f1);
	}

	.search-clear {
		position: absolute;
		right: 4px;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		border-radius: 4px;
	}

	.search-clear:hover {
		color: var(--color-text);
		background: rgba(100, 116, 139, 0.12);
	}

	/* Repo select */
	.repo-select {
		padding: 3px 6px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text);
		font-size: 0.67rem;
		font-family: inherit;
		outline: none;
		cursor: pointer;
		max-width: 140px;
		transition: border-color 0.15s ease;
	}

	.repo-select:focus {
		border-color: var(--color-primary, #6366f1);
	}

	/* Toggle groups */
	.toggle-group {
		gap: 3px;
	}

	/* Clear button */
	.clear-btn {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 3px 8px;
		border: 1px solid rgba(239, 68, 68, 0.25);
		border-radius: 6px;
		background: rgba(239, 68, 68, 0.06);
		color: #ef4444;
		cursor: pointer;
		font-size: 0.62rem;
		font-weight: 700;
		transition: all 0.12s ease;
		white-space: nowrap;
	}

	.clear-btn:hover {
		background: rgba(239, 68, 68, 0.12);
		border-color: rgba(239, 68, 68, 0.4);
	}
</style>
