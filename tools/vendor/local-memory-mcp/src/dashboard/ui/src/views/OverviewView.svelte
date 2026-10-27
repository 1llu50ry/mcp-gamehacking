<script lang="ts">
	import { currentRepo, dashboardStats, taskTimeStats } from "../lib/stores";
	import { onMount } from "svelte";
	import GlobalCommandCenter from "../components/GlobalCommandCenter.svelte";
	import StatsWidget from "../components/StatsWidget.svelte";
	import TaskStatsWidget from "../components/TaskStatsWidget.svelte";
	import TimeStatsWidget from "../components/TimeStatsWidget.svelte";
	import { EmptyState, SectionHeading, Surface } from "../components/ui";

	/**
	 * Overview — the answer to "what needs my attention right now?".
	 *
	 * Extracted from App.svelte, where it lived as an inline-styled grid nested
	 * three surfaces deep: `glass card` → `glass card` → `glass card`, each with
	 * its own border and padding, so a single number sat inside three frames.
	 * Sections here are flat siblings on the canvas; separation comes from
	 * whitespace and one hairline border, not from stacked boxes.
	 */

	let liveText = "";

	onMount(() => {
		// ARIA live region (STD-002 / TASK-400): scoped announcement for the
		// async stats refresh only — never wraps the whole shell, which would
		// make every DOM change chatter at screen-reader users.
		const unsubStats = dashboardStats.subscribe((s) => {
			if (s) liveText = "Dashboard stats refreshed";
		});
		const unsubTimeStats = taskTimeStats.subscribe((ts) => {
			if (ts) liveText = "Dashboard stats refreshed";
		});
		return () => {
			unsubStats();
			unsubTimeStats();
		};
	});
</script>

<div class="sr-only" aria-live="polite" aria-atomic="true">{liveText}</div>

<div class="overview-stack">
	<GlobalCommandCenter />

	{#if $currentRepo}
		<Surface label="Workspace memory">
			<SectionHeading title="Memory" description="What this workspace knows." meta={$currentRepo} />
			<StatsWidget />
		</Surface>

		<Surface label="Workspace tasks">
			<SectionHeading title="Tasks" description="Planned, active, and completed work." />
			<TaskStatsWidget />
		</Surface>

		<TimeStatsWidget />
	{:else}
		<Surface label="Workspace detail">
			<EmptyState
				icon="folder"
				title="No workspace selected"
				description="Pick a repository in the sidebar to see its memory, task, and execution metrics."
			/>
		</Surface>
	{/if}
</div>

<style>
	.overview-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
