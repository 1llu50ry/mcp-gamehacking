<script lang="ts">
	import { createStatsHandler } from "../lib/composables/useStatsWidget";
	import { dashboardStats } from "../lib/stores";
	import { Badge, ErrorState, Metric, Skeleton } from "./ui";

	const handler = createStatsHandler();
	const { summaryItems, byTypeStats } = handler;
</script>

{#if $dashboardStats === null}
	<ErrorState
		title="Memory stats unavailable"
		description="The stats endpoint didn't respond. Existing memories are unaffected."
	/>
{:else if $dashboardStats === undefined}
	<div class="stat-grid">
		{#each [0, 1, 2, 3] as row (row)}
			<div class="stat-skeleton">
				<Skeleton variant="line" width="60%" />
				<Skeleton variant="line" width="40%" height="1.5rem" />
			</div>
		{/each}
	</div>
{:else}
	<div class="stat-grid">
		{#each $summaryItems as item (item.label)}
			<Metric label={item.label} value={item.val} />
		{/each}
	</div>

	{#if $byTypeStats.length > 0}
		<div class="type-breakdown">
			<h3 class="type-breakdown-label">By type</h3>
			<div class="type-breakdown-list">
				{#each $byTypeStats as item (item.label)}
					<Badge tone="neutral">{item.count} {item.label}</Badge>
				{/each}
			</div>
		</div>
	{/if}
{/if}

<style>
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: var(--space-4);
	}

	.stat-skeleton {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.type-breakdown {
		margin-top: var(--space-5);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}

	.type-breakdown-label {
		font-size: var(--text-label);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
		margin-bottom: var(--space-2);
	}

	.type-breakdown-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
