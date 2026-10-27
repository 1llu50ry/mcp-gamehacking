<script lang="ts">
	import Icon from "$lib/Icon.svelte";
	import type { CodebaseIndexStatus } from "$lib/api";
	import { computeStatusColor, getStatusColorVar, getStatusBgVar, computeRelativeTime } from "$lib/indexStatusUtils";

	let {
		status,
		loading,
		error,
		reindexing,
		fetchStatus,
		startReindex
	}: {
		status: CodebaseIndexStatus | null;
		loading: boolean;
		error: string;
		reindexing: boolean;
		repo: string;
		fetchStatus: () => Promise<void>;
		startReindex: () => Promise<void>;
	} = $props();

	let statusColor = $derived(computeStatusColor(status));
	let statusColorVar = $derived(getStatusColorVar(statusColor));
	let statusBgVar = $derived(getStatusBgVar(statusColor));
	let relativeTime = $derived(computeRelativeTime(status?.last_indexed_at));
</script>

{#if loading && !status}
	<!-- Loading skeleton -->
	<div class="index-status-row">
		<div class="status-dot skeleton"></div>
		<div class="skeleton-text"></div>
	</div>
{:else if error && !status}
	<!-- Error state -->
	<div class="index-status-row error-state">
		<Icon name="triangle-alert" size={13} strokeWidth={2} />
		<span class="error-text">{error}</span>
		<button class="retry-btn" onclick={() => void fetchStatus()} aria-label="Retry fetching index status">
			<Icon name="refresh-cw" size={11} strokeWidth={2.5} />
		</button>
	</div>
{:else if status?.indexed}
	<!-- Indexed state -->
	<div class="index-status-row" style="background:{statusBgVar};border-color:{statusColorVar}">
		<div class="status-dot" style="background:{statusColorVar};box-shadow:0 0 8px {statusColorVar}"></div>
		<div class="index-info">
			<span class="index-summary">
				Indexed <strong>{status.symbol_count}</strong> symbols across
				<strong>{status.file_count}</strong> files
			</span>
			{#if relativeTime}
				<span class="index-time" style="color:{statusColorVar}">
					Last indexed: {relativeTime}
				</span>
			{/if}
		</div>
		<button
			class="reindex-btn"
			class:stale={status.stale === true}
			onclick={() => void startReindex()}
			disabled={reindexing}
			aria-label="Re-index repository"
		>
			{#if reindexing}
				<Icon name="loader" size={12} strokeWidth={2} />
				<span>Indexing...</span>
			{:else}
				<Icon name="refresh-cw" size={12} strokeWidth={2} />
				<span>Re-index</span>
			{/if}
		</button>
	</div>
{:else}
	<!-- Never indexed state -->
	<div class="index-status-row never-indexed">
		<div class="status-dot" style="background:rgba(239,68,68,0.8);box-shadow:0 0 8px rgba(239,68,68,0.5)"></div>
		<div class="index-info">
			<span class="index-summary">Not indexed yet</span>
			<span class="index-time" style="color:rgba(239,68,68,0.8)">Never indexed</span>
		</div>
		<button
			class="reindex-btn primary"
			onclick={() => void startReindex()}
			disabled={reindexing}
			aria-label="Index repository"
		>
			{#if reindexing}
				<Icon name="loader" size={12} strokeWidth={2} />
				<span>Indexing...</span>
			{:else}
				<Icon name="upload-cloud" size={12} strokeWidth={2} />
				<span>Index Now</span>
			{/if}
		</button>
	</div>
{/if}

<style>
	.index-status-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		border-radius: 10px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
		transition: all 0.2s ease;
	}

	.index-status-row.error-state {
		background: rgba(239, 68, 68, 0.06);
		border-color: rgba(239, 68, 68, 0.15);
	}

	.index-status-row.never-indexed {
		background: rgba(239, 68, 68, 0.04);
		border-color: rgba(239, 68, 68, 0.12);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		flex-shrink: 0;
	}

	.status-dot.skeleton {
		background: var(--color-border);
		animation: pulse-dot 1.5s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}

	.skeleton-text {
		height: 12px;
		width: 160px;
		border-radius: 4px;
		background: var(--color-border);
		animation: pulse-dot 1.5s ease-in-out infinite;
	}

	.index-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.index-summary {
		font-size: 0.78rem;
		color: var(--color-text);
		font-weight: 600;
		line-height: 1.3;
	}

	.index-summary strong {
		font-weight: 800;
	}

	.index-time {
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	.error-text {
		flex: 1;
		font-size: 0.75rem;
		color: rgba(239, 68, 68, 0.9);
		font-weight: 600;
	}

	.retry-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		border: 1px solid rgba(239, 68, 68, 0.2);
		background: rgba(239, 68, 68, 0.08);
		color: rgba(239, 68, 68, 0.9);
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}

	.retry-btn:hover {
		background: rgba(239, 68, 68, 0.15);
		border-color: rgba(239, 68, 68, 0.35);
	}

	.reindex-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 12px;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.05);
		color: var(--color-text-muted);
		font-size: 0.68rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.reindex-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.1);
		border-color: var(--color-primary);
		color: var(--color-text);
	}

	.reindex-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.reindex-btn.stale {
		background: rgba(239, 68, 68, 0.1);
		border-color: rgba(239, 68, 68, 0.3);
		color: rgba(239, 68, 68, 0.9);
	}

	.reindex-btn.stale:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.18);
		border-color: rgba(239, 68, 68, 0.5);
	}

	.reindex-btn.primary {
		background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
		color: white;
		border: none;
		box-shadow: 0 2px 10px var(--glow-primary);
	}

	.reindex-btn.primary:hover:not(:disabled) {
		opacity: 0.92;
		transform: translateY(-1px);
	}
</style>
