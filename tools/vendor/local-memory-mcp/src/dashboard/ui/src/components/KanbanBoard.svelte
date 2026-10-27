<script lang="ts">
	import { onDestroy } from "svelte";
	import { taskSearch } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";
	import TaskCard from "./TaskCard.svelte";
	import ExportToolbar from "./ExportToolbar.svelte";
	import type { Task } from "../lib/stores";
	import { createKanbanHandler, COLUMNS } from "../lib/composables/useKanban";
	import { confirmDelete } from "../lib/confirm";

	export let onTaskClick: (task: Task) => void = () => {};
	export let onBulkImport: () => void = () => {};

	const kanban = createKanbanHandler();
	const kanbanState = { subscribe: kanban.subscribe };

	export function loadTasks(repo: string) {
		kanban.loadTasks(repo, $taskSearch);
	}

	$: selectedCount = $kanbanState.selectedTaskIds.size;

	// ── ARIA live region (STD-002 / TASK-400) ─────────────────────────────
	// One scoped sr-only polite region for the tasks view: announce async
	// loads (total task count) and status moves (drag-drop / bulk move).
	let liveRegionText = "";
	let lastTotal = -1;
	// TASK-410: unsubscribe on destroy — KanbanBoard mounts per-tab
	// ({#if $activeTab === "tasks"}) and is destroyed on tab switch; without
	// cleanup every visit registers a permanent store subscriber that keeps
	// the destroyed instance alive and runs this reduce on every kanban store
	// mutation forever (matches MemoryList/AgentArena cleanup pattern).
	const unsubLiveRegion = kanbanState.subscribe((s) => {
		const total = Object.values(s.pagination).reduce((sum: number, p) => sum + (p?.totalItems || 0), 0);
		if (total !== lastTotal) {
			lastTotal = total;
			if (total > 0) liveRegionText = `Loaded ${total} tasks`;
		}
	});
	onDestroy(() => unsubLiveRegion());

	async function confirmBulkDelete() {
		if (await confirmDelete(`Are you sure you want to delete ${selectedCount} tasks?`)) {
			await kanban.handleBulkDelete();
		}
	}
</script>

<div>
	<div class="sr-only" aria-live="polite" aria-atomic="true">{liveRegionText}</div>

	<!-- Toolbar -->
	<div class="task-toolbar mb-4">
		<div class="search-wrap">
			<span class="search-icon-inner">
				<Icon name="search" size={13} strokeWidth={2} />
			</span>
			<input
				class="form-input"
				style="padding-left:32px;font-size:0.8rem;"
				type="text"
				placeholder="Search tasks…"
				aria-label="Search tasks"
				bind:value={$taskSearch}
			/>
		</div>
		<div class="flex gap-2">
			<ExportToolbar onExport={(f) => kanban.handleExport(f)} onImport={onBulkImport} />
		</div>
	</div>

	<!-- Kanban Board -->
	<div class="kanban-board">
		{#each COLUMNS as col (col.status)}
			<!-- svelte-ignore a11y-no-static-element-interactions -->
			<div
				class="kanban-col {$kanbanState.dragOverCol === col.status ? 'drag-over' : ''}"
				style="background:{col.bg};border:1px solid {col.border};padding:12px;border-radius:16px;transition: border-color 0.2s;"
				on:dragover={(e) => kanban.handleDragOver(e, col.status)}
				on:dragleave={() => kanban.handleDragLeave(col.status)}
				on:drop={() => {
					kanban.handleDrop(col.status);
					liveRegionText = `Task moved to ${col.label}`;
				}}
			>
				<!-- Column header -->
				<div class="flex items-center gap-2 mb-3">
					<span style="color:{col.color};display:flex;flex-shrink:0;">
						<Icon name={col.icon} size={13} strokeWidth={2} />
					</span>
					<span style="font-size:0.78rem;font-weight:700;color:var(--color-text);">{col.label}</span>
					<span
						class="col-count"
						style="margin-left:auto;background:{col.bg};color:{col.color};border:1px solid {col.border};"
					>
						{$kanbanState.pagination[col.status]?.totalItems || 0}
					</span>
				</div>

				<!-- Task cards -->
				<div class="flex flex-col" style="gap:8px;overflow-y:auto;max-height:calc(100vh - 340px);padding-right:2px;">
					{#if ($kanbanState.columnTasks[col.status] || []).length === 0}
						{#if $kanbanState.loadingCols.has(col.status)}
							<div class="skeleton" style="height:80px;border-radius:12px;"></div>
							<div class="skeleton" style="height:60px;border-radius:12px;"></div>
						{:else}
							<div class="empty-col">
								<span style="color:{col.color};opacity:0.5;"><Icon name={col.icon} size={22} strokeWidth={1.25} /></span
								>
								<div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:6px;">No tasks</div>
							</div>
						{/if}
					{:else}
						{#each $kanbanState.columnTasks[col.status] as task, i (`${task.id}-${i}`)}
							<!-- svelte-ignore a11y-no-static-element-interactions -->
							<div
								class="task-card-wrapper"
								draggable="true"
								on:dragstart={(e) => kanban.handleDragStart(e, task, col.status)}
								style="cursor: grab;"
							>
								<TaskCard
									{task}
									selected={$kanbanState.selectedTaskIds.has(task.id)}
									onToggleSelect={() => kanban.toggleSelectTask(task.id)}
									on:click={() => onTaskClick(task)}
								/>
							</div>
						{/each}

						<!-- Load more -->
						{#if $kanbanState.pagination[col.status]?.hasMore}
							<button
								class="btn btn-ghost btn-sm w-full"
								style="margin-top:4px;justify-content:center;"
								on:click={() => kanban.loadMore(col.status)}
								disabled={$kanbanState.loadingCols.has(col.status)}
							>
								{#if $kanbanState.loadingCols.has(col.status)}
									<span class="animate-spin"><Icon name="refresh-cw" size={12} strokeWidth={2} /></span>
								{:else}
									<Icon name="chevron-down" size={12} strokeWidth={2} />
								{/if}
								{$kanbanState.loadingCols.has(col.status) ? "Loading…" : "Load more"}
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- Bulk Action Toolbar -->
	{#if selectedCount > 0}
		<div class="bulk-actions-bar">
			<span><b>{selectedCount}</b> selected</span>
			<div style="width:12px;"></div>
			<button
				class="btn btn-sm"
				style="background:rgba(120,120,120,0.2);color:inherit;"
				on:click={() => kanban.clearSelection()}>Cancel</button
			>
			<select
				class="form-select"
				style="width:140px;font-size:0.8rem;"
				on:change={(e) => {
					const target = e.currentTarget.value;
					if (target) {
						kanban.handleBulkStatusMove(target);
						liveRegionText = `Tasks moved to ${target}`;
					}
					e.currentTarget.value = "";
				}}
			>
				<option value="">Move to...</option>
				{#each COLUMNS as col (col.status)}
					<option value={col.status}>{col.label}</option>
				{/each}
			</select>
			<button
				class="btn btn-sm btn-accent"
				style="background:#ef4444;color:white;border:none;"
				on:click={confirmBulkDelete}>Delete</button
			>
		</div>
	{/if}
</div>

<style>
	.task-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.search-wrap {
		position: relative;
		flex: 1 1 240px;
		max-width: 420px;
	}

	.search-wrap :global(.form-input) {
		width: 100%;
	}

	.search-icon-inner {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		display: flex;
		pointer-events: none;
	}

	.col-count {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 1px 8px;
		border-radius: 9999px;
	}

	.empty-col {
		text-align: center;
		padding: 28px 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.drag-over {
		border-color: var(--color-accent) !important;
		background: rgba(99, 102, 241, 0.1) !important;
	}

	.task-card-wrapper {
		min-width: 0;
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
		.task-toolbar {
			align-items: stretch;
		}

		.search-wrap {
			flex-basis: 100%;
			max-width: none;
		}

		.task-toolbar > :global(.flex) {
			width: 100%;
			justify-content: flex-end;
			flex-wrap: wrap;
		}

		.kanban-board {
			display: grid;
			grid-template-columns: 1fr;
			overflow: visible;
			gap: 12px;
		}

		.kanban-col {
			min-width: 0;
			width: 100%;
		}

		.kanban-col > :global(.flex.flex-col) {
			max-height: none !important;
		}

		.bulk-actions-bar {
			left: 12px;
			right: 12px;
			bottom: 12px;
			transform: none;
			flex-wrap: wrap;
			padding: 12px;
		}
	}
</style>
