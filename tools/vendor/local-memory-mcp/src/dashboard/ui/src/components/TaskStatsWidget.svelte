<script lang="ts">
	import { currentRepo } from "../lib/stores";
	import { createStatsHandler } from "../lib/composables/useStatsWidget";
	import { Badge, EmptyState, Metric } from "./ui";

	const { taskStats, activeTasks, refreshActiveTasks } = createStatsHandler();

	$: if ($currentRepo) {
		refreshActiveTasks($currentRepo);
	}

	// Five metrics, no per-metric colour. Previously each carried its own hex +
	// glow, so a five-metric row rendered in five different brand colours and
	// the eye had no idea which number mattered.
	$: stats = [
		{ label: "Total", val: $taskStats?.total ?? 0 },
		{ label: "Backlog", val: $taskStats?.backlog ?? 0 },
		{ label: "To do", val: $taskStats?.pending ?? 0 },
		{ label: "Active", val: $taskStats?.in_progress ?? 0 },
		{ label: "Done", val: $taskStats?.completed ?? 0 }
	];
</script>

{#if $taskStats}
	<div class="task-stat-grid">
		{#each stats as s (s.label)}
			<Metric label={s.label} value={s.val} />
		{/each}
	</div>

	<div class="active-tasks">
		<h3 class="active-tasks-label">Active priorities</h3>

		{#if $activeTasks.length > 0}
			<ul class="active-task-list">
				{#each $activeTasks as task, i (`${task.id}-${i}`)}
					<li class="active-task">
						<div class="active-task-text">
							<p class="active-task-title">{task.title}</p>
							<p class="active-task-meta">{task.task_code} · {task.phase}</p>
						</div>
						<Badge tone={task.status === "in_progress" ? "accent" : "neutral"} dot>
							{task.status === "in_progress" ? "Active" : "To do"}
						</Badge>
					</li>
				{/each}
			</ul>
		{:else}
			<EmptyState
				icon="circle-check"
				title="Nothing in flight"
				description="No tasks are pending or in progress for this workspace right now."
			/>
		{/if}
	</div>
{/if}

<style>
	.task-stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
		gap: var(--space-4);
	}

	.active-tasks {
		margin-top: var(--space-5);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}

	.active-tasks-label {
		font-size: var(--text-label);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
		margin-bottom: var(--space-2);
	}

	.active-task-list {
		list-style: none;
		display: flex;
		flex-direction: column;
	}

	/* Rows are separated by a hairline rule rather than each being its own
	   bordered box — five nested boxes inside a panel inside a card was three
	   frames deep for a list of five items. */
	.active-task {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--color-border);
	}

	.active-task:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.active-task-text {
		min-width: 0;
	}

	.active-task-title {
		font-size: var(--text-body);
		font-weight: var(--weight-medium);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.active-task-meta {
		margin-top: 2px;
		font-size: var(--text-label);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
</style>
