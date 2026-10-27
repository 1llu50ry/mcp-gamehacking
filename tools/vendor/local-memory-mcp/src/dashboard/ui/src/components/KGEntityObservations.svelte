<script lang="ts">
	import Icon from "$lib/Icon.svelte";
	import { formatTimestamp } from "$lib/kg/kgEntityUtils";

	export let observations: Array<{
		id: string;
		content: string;
		created_at: string;
	}> = [];
</script>

<div class="detail-section">
	<h3 class="section-title">
		<Icon name="file-text" size={13} strokeWidth={1.75} />
		Observations ({observations.length})
	</h3>
	<ul class="observation-list">
		{#each observations as obs (obs.id)}
			<li class="observation-card">
				<p class="observation-content">{obs.content}</p>
				{#if obs.created_at}
					<span class="observation-time">{formatTimestamp(obs.created_at)}</span>
				{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	.detail-section {
		padding: 12px 0;
	}

	.section-title {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 0 10px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.observation-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.observation-card {
		padding: 10px 12px;
		border-radius: 8px;
		background: rgba(148, 163, 184, 0.06);
		border: 1px solid var(--color-border);
	}

	:global(.dark) .observation-card {
		background: rgba(148, 163, 184, 0.04);
		border-color: rgba(148, 163, 184, 0.08);
	}

	.observation-content {
		margin: 0 0 6px;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--color-text);
		word-break: break-word;
	}

	.observation-time {
		font-size: 0.68rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
</style>
