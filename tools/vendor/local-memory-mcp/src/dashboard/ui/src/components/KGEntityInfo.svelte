<script lang="ts">
	import { getTypeColor, formatTimestamp, type KgEntityDetail } from "$lib/kg/kgEntityUtils";

	export let entity: KgEntityDetail;
</script>

<!-- Header -->
<div class="detail-header">
	<h2 class="entity-name">{entity.name ?? "Unnamed"}</h2>
	{#if entity.type}
		<span
			class="type-badge"
			style="background:{getTypeColor(entity.type)}20;color:{getTypeColor(entity.type)};border-color:{getTypeColor(
				entity.type
			)}40"
		>
			{entity.type}
		</span>
	{/if}
</div>

<!-- Description -->
{#if entity.description}
	<div class="detail-section">
		<p class="entity-description">{entity.description}</p>
	</div>
{/if}

<!-- Stats -->
<div class="detail-section stats-row">
	{#if entity.created_at}
		<div class="stat">
			<span class="stat-label">Created</span>
			<span class="stat-value">{formatTimestamp(entity.created_at)}</span>
		</div>
	{/if}
	{#if entity.updated_at}
		<div class="stat">
			<span class="stat-label">Updated</span>
			<span class="stat-value">{formatTimestamp(entity.updated_at)}</span>
		</div>
	{/if}
</div>

<style>
	.detail-header {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		flex-wrap: wrap;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--color-border);
		margin-bottom: 4px;
		padding-right: 36px;
	}

	:global(.dark) .detail-header {
		border-bottom-color: rgba(148, 163, 184, 0.1);
	}

	.entity-name {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 800;
		color: var(--color-text);
		line-height: 1.3;
		word-break: break-word;
	}

	.type-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		border-radius: 6px;
		border: 1px solid;
		font-size: 0.68rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.detail-section {
		padding: 12px 0;
	}

	.entity-description {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}

	.stats-row {
		display: flex;
		gap: 20px;
		flex-wrap: wrap;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.stat-label {
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
	}

	.stat-value {
		font-size: 0.78rem;
		color: var(--color-text);
		font-variant-numeric: tabular-nums;
	}
</style>
