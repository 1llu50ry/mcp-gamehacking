<script lang="ts">
	import { CODEBASE_KIND_ORDER, EDGE_KIND_LABELS, kindColor, type CodeGraphStats } from "../lib/codebaseGraph";

	// Legend footer — extracted from CodebaseGraphPanel (TASK-389) so the panel
	// stays under the 500-line guideline (GQ2ACG). Pure presentational: renders
	// node-kind color dots (palette-synced via lib/codebaseGraph kindColor),
	// edge-kind labels, and graph stats. Emits no events.
	let {
		nodeCount = 0,
		edgeCount = 0,
		truncated = false,
		stats = null
	}: {
		nodeCount: number;
		edgeCount: number;
		truncated: boolean;
		stats: CodeGraphStats | null;
	} = $props();
</script>

<div class="cg-footer">
	<div class="cg-legend-group" aria-label="Node colors by symbol kind">
		<span class="cg-legend-label">Symbols</span>
		{#each CODEBASE_KIND_ORDER as k (k)}
			<span class="cg-legend-item" title="{k} symbol">
				<i class="cg-dot" style="background:{kindColor(k)};" aria-hidden="true"></i>
				{k}
			</span>
		{/each}
	</div>

	<div class="cg-legend-group" aria-label="Edge kinds">
		<span class="cg-legend-label">Edges</span>
		{#each Object.keys(EDGE_KIND_LABELS) as k (k)}
			<span class="cg-legend-item cg-edge-kind" title="Edge kind: {EDGE_KIND_LABELS[k]}">
				<span class="cg-edge-swatch" aria-hidden="true"></span>
				{EDGE_KIND_LABELS[k]}
			</span>
		{/each}
		<span class="cg-legend-hint">Hover an edge to see its kind label</span>
	</div>

	<div class="cg-legend-group cg-stats" aria-label="Graph statistics">
		<span>
			{nodeCount} nodes · {edgeCount} edges
			{#if stats}
				· top-degree of {stats.totalSymbols} symbols
			{/if}
		</span>
		{#if truncated}
			<span class="cg-truncated-badge" title="Edge list was capped server-side to the highest-degree edges">
				Edges truncated
			</span>
		{/if}
	</div>
</div>

<style>
	.cg-footer {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
		padding: 8px 14px;
		border-top: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
	}

	.cg-legend-group {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.cg-legend-group + .cg-legend-group {
		padding-left: 12px;
		border-left: 1px solid var(--color-border);
	}

	.cg-legend-label {
		font-size: 0.56rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.75;
	}

	.cg-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.64rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.cg-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.cg-edge-swatch {
		display: inline-block;
		width: 12px;
		height: 2px;
		border-radius: 2px;
		background: var(--color-text-muted);
		opacity: 0.6;
	}

	.cg-legend-hint {
		font-size: 0.6rem;
		font-style: italic;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.cg-stats {
		margin-left: auto;
		font-size: 0.66rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.cg-truncated-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		font-size: 0.6rem;
		font-weight: 800;
		color: #f59e0b;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.25);
		border-radius: 999px;
		white-space: nowrap;
	}

	@media (max-width: 720px) {
		.cg-legend-group + .cg-legend-group {
			padding-left: 0;
			border-left: none;
		}

		.cg-stats {
			margin-left: 0;
			width: 100%;
		}
	}
</style>
