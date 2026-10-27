<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	interface SymbolHeaderData {
		name: string;
		kind: string;
		exported?: boolean;
	}

	let {
		symbol = null,
		kindIcon = "code",
		kindLabel = "Symbol"
	}: {
		symbol: SymbolHeaderData | null;
		kindIcon: string;
		kindLabel: string;
	} = $props();
</script>

{#if symbol}
	<div class="detail-header">
		<div class="detail-header-icon">
			<Icon name={kindIcon} size={18} strokeWidth={1.75} />
		</div>
		<div class="detail-header-info">
			<div class="detail-header-row">
				<span class="detail-name">{symbol.name}</span>
				{#if symbol.exported}
					<span class="detail-export-badge">export</span>
				{/if}
			</div>
			<div class="detail-kind-label">{kindLabel}</div>
		</div>
	</div>
{/if}

<style>
	.detail-header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 16px;
	}

	.detail-header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(14, 165, 233, 0.15));
		border: 1px solid rgba(99, 102, 241, 0.2);
		color: var(--color-primary);
		flex-shrink: 0;
	}

	.detail-header-info {
		flex: 1;
		min-width: 0;
	}

	.detail-header-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.detail-name {
		font-size: 1rem;
		font-weight: 800;
		color: var(--color-text);
		letter-spacing: -0.01em;
	}

	.detail-export-badge {
		font-size: 0.56rem;
		font-weight: 700;
		color: #22c55e;
		background: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.15);
		padding: 2px 6px;
		border-radius: 4px;
		letter-spacing: 0.02em;
	}

	.detail-kind-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-text-muted);
		margin-top: 2px;
	}
</style>
