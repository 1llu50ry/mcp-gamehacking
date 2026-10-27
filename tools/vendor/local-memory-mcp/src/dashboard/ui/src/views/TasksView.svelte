<script lang="ts">
	import type { Task } from "../lib/stores";
	import KanbanBoard from "../components/KanbanBoard.svelte";
	import Icon from "../lib/Icon.svelte";
	import { PageHeader, Surface } from "../components/ui";

	/**
	 * Tasks — the workspace board.
	 *
	 * Previously this was a `glass card` labelled "Task Overview" wrapped in an
	 * `animate-fade-in` div inside App.svelte, with the board's own toolbar
	 * nested inside it — a card inside a card inside the shell, three frames
	 * around a kanban board.
	 *
	 * "Add task" is promoted from the board toolbar to the page header so the
	 * primary action sits in the same position as on every other page.
	 */
	let {
		board = $bindable(),
		onTaskClick,
		onAddTask,
		onBulkImport
	}: {
		board?: KanbanBoard;
		onTaskClick: (task: Task) => void;
		onAddTask: () => void;
		onBulkImport: () => void;
	} = $props();
</script>

<PageHeader description="Planned, active, and completed work for this workspace.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={onAddTask}>
			<Icon name="plus" size={16} strokeWidth={2} />
			Add task
		</button>
	{/snippet}
</PageHeader>

<Surface variant="plain" padding="none" label="Task board">
	<KanbanBoard bind:this={board} {onTaskClick} {onBulkImport} />
</Surface>
