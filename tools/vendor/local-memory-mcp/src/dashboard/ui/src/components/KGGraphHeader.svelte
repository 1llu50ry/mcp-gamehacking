<script lang="ts">
	import Icon from "$lib/Icon.svelte";
	import KGZeroEdgeStatus from "./KGZeroEdgeStatus.svelte";

	export let nodeCount: number;
	export let edgeCount: number;
	export let isLoading: boolean;
	export let errorMsg: string;
	export let isZeroEdgeOverview: boolean;
	export let visibleNodeCount: number;
	export let hiddenNodeCount: number;
	export let zoomPercent: number = 100;
	export let onAddEntity: () => void;
	export let onAddRelation: () => void;
	export let onRefresh: () => void;
	export let onZoomIn: () => void;
	export let onZoomOut: () => void;
	export let onResetCamera: () => void;
</script>

<div class="kg-toolbar">
	<div class="kg-toolbar-left">
		<span class="kg-stats">
			{nodeCount} nodes · {edgeCount} edges
		</span>
		{#if edgeCount > 0 && !isZeroEdgeOverview}
			<span
				class="kg-conf-legend"
				role="img"
				aria-label="Edge confidence legend: solid line means at least 85 percent, amber 60 to 85 percent, red below 60 percent"
			>
				<span class="kg-conf-item"><i class="kg-conf-swatch kg-conf-high" aria-hidden="true"></i>≥85%</span>
				<span class="kg-conf-item"><i class="kg-conf-swatch kg-conf-med" aria-hidden="true"></i>60–85%</span>
				<span class="kg-conf-item"><i class="kg-conf-swatch kg-conf-low" aria-hidden="true"></i>&lt;60%</span>
			</span>
		{/if}
	</div>
	<div class="kg-toolbar-right">
		<!-- Zoom controls -->
		<div class="kg-zoom-controls">
			<button class="btn btn-ghost btn-sm kg-zoom-btn" on:click={onZoomOut} title="Zoom out"> &#8722; </button>
			<button class="btn btn-ghost btn-sm kg-zoom-label" on:click={onResetCamera} title="Reset zoom">
				{zoomPercent}%
			</button>
			<button class="btn btn-ghost btn-sm kg-zoom-btn" on:click={onZoomIn} title="Zoom in">
				<Icon name="plus" size={12} strokeWidth={2} />
			</button>
		</div>
		<button class="btn btn-ghost btn-sm" on:click={onAddEntity}>
			<Icon name="plus" size={12} strokeWidth={2} />
			Add Entity
		</button>
		<button class="btn btn-ghost btn-sm" on:click={onAddRelation}>
			<Icon name="link" size={12} strokeWidth={2} />
			Add Relation
		</button>
		<button class="btn btn-ghost btn-sm" on:click={onRefresh} disabled={isLoading}>
			<Icon name="refresh-cw" size={12} strokeWidth={2} className={isLoading ? "animate-spin" : ""} />
			Refresh
		</button>
	</div>
</div>

{#if errorMsg}
	<div class="kg-error">
		<Icon name="triangle-alert" size={14} strokeWidth={1.75} />
		{errorMsg}
	</div>
{/if}
{#if isZeroEdgeOverview}
	<KGZeroEdgeStatus {visibleNodeCount} totalNodeCount={nodeCount} {hiddenNodeCount} />
{/if}

<style>
	.kg-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.05);
		flex-shrink: 0;
	}

	:global(.dark) .kg-toolbar {
		border-color: rgba(148, 163, 184, 0.1);
	}

	.kg-toolbar-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.kg-toolbar-right {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.kg-zoom-controls {
		display: flex;
		align-items: center;
		gap: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	:global(.dark) .kg-zoom-controls {
		border-color: rgba(148, 163, 184, 0.15);
	}

	.kg-zoom-btn {
		/* Zoom controls are primary canvas actions — full 40px target (44px coarse, >=32px at 390px). */
		padding: 6px 10px !important;
		min-width: 40px;
		min-height: 40px;
		justify-content: center;
		border-radius: 0 !important;
		border-right: 1px solid var(--color-border);
	}

	:global(.dark) .kg-zoom-btn {
		border-right-color: rgba(148, 163, 184, 0.15);
	}

	@media (max-width: 390px) {
		.kg-zoom-btn {
			min-width: 34px;
			min-height: 34px;
			padding: 4px 8px !important;
		}

		.kg-zoom-label {
			min-width: 40px;
			min-height: 34px;
			padding: 2px 6px !important;
		}
	}

	@media (pointer: coarse) {
		.kg-zoom-btn,
		.kg-zoom-label {
			min-height: 44px;
			min-width: 44px;
		}
	}

	.kg-zoom-label {
		padding: 4px 10px !important;
		min-width: 48px;
		min-height: 40px;
		justify-content: center;
		border-radius: 0 !important;
		font-size: 0.68rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}

	.kg-stats {
		font-size: var(--text-secondary);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	/* Edge confidence legend (TASK-330) — swatches mirror the renderer buckets */
	.kg-conf-legend {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding-left: 12px;
		border-left: 1px solid var(--color-border);
	}

	:global(.dark) .kg-conf-legend {
		border-left-color: rgba(148, 163, 184, 0.15);
	}

	.kg-conf-item {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.65rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	.kg-conf-swatch {
		display: inline-block;
		width: 14px;
		height: 3px;
		border-radius: 2px;
	}

	.kg-conf-high {
		background: var(--color-text-muted);
	}

	.kg-conf-med {
		background: #f59e0b; /* amber — matches EDGE_BUCKET_COLORS.medium */
	}

	.kg-conf-low {
		background: #ef4444; /* red — matches EDGE_BUCKET_COLORS.low */
	}

	.kg-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		background: rgba(239, 68, 68, 0.08);
		color: var(--color-danger);
		font-size: 0.8rem;
		font-weight: 600;
		border-bottom: 1px solid rgba(239, 68, 68, 0.15);
	}

	:global(.kg-loading),
	:global(.kg-empty) {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	:global(.kg-empty svg) {
		opacity: 0.3;
	}

	@media (max-width: 640px) {
		.kg-toolbar {
			align-items: flex-start;
			flex-direction: column;
			gap: 10px;
		}

		.kg-toolbar-right {
			flex-wrap: wrap;
		}
	}
</style>
