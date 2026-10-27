<script lang="ts">
	import Icon from "$lib/Icon.svelte";
	import type { CodebaseIndexStatus } from "$lib/api";

	let {
		status,
		reindexing,
		indexingInProgress,
		indexingFilesParsed,
		indexingTotalFiles,
		indexingProgressPercent
	}: {
		status: CodebaseIndexStatus | null;
		reindexing: boolean;
		indexingInProgress: boolean;
		indexingFilesParsed: number;
		indexingTotalFiles: number;
		indexingProgressPercent: number;
	} = $props();

	let isStale = $derived(status?.stale === true);
	let stalePercent = $derived(Math.round((status?.staleRatio ?? 0) * 100));
</script>

{#if isStale}
	<div class="stale-warning">
		<div class="stale-row">
			<Icon name="triangle-alert" size={13} strokeWidth={2} />
			<span class="stale-text">Index is stale — {stalePercent}% of files have changed</span>
		</div>
		<div class="stale-bar-track">
			<div class="stale-bar-fill" style="width:{stalePercent}%"></div>
		</div>
	</div>
{/if}

{#if reindexing && indexingInProgress}
	<div class="indexing-progress">
		<div class="progress-row">
			<Icon name="loader" size={12} strokeWidth={2} />
			<span>Indexing... {indexingFilesParsed}/{indexingTotalFiles} files parsed</span>
		</div>
		<div class="progress-bar-track">
			<div class="progress-bar-fill" style="width:{indexingProgressPercent}%"></div>
		</div>
	</div>
{/if}

<style>
	.stale-warning {
		margin-top: 8px;
		padding: 8px 14px;
		border-radius: 8px;
		background: rgba(239, 68, 68, 0.06);
		border: 1px solid rgba(239, 68, 68, 0.15);
	}

	.stale-row {
		display: flex;
		align-items: center;
		gap: 6px;
		color: rgba(239, 68, 68, 0.9);
		font-size: 0.72rem;
		font-weight: 600;
		margin-bottom: 6px;
	}

	.stale-text {
		flex: 1;
	}

	.stale-bar-track {
		height: 4px;
		border-radius: 999px;
		background: rgba(239, 68, 68, 0.12);
		overflow: hidden;
	}

	.stale-bar-fill {
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, rgba(239, 68, 68, 0.8), rgba(220, 38, 38, 0.9));
		transition: width 0.4s ease;
		min-width: 2px;
	}

	.indexing-progress {
		margin-top: 8px;
		padding: 8px 14px;
		border-radius: 8px;
		background: rgba(99, 102, 241, 0.06);
		border: 1px solid rgba(99, 102, 241, 0.12);
	}

	.progress-row {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--color-primary);
		font-size: 0.72rem;
		font-weight: 600;
		margin-bottom: 6px;
	}

	.progress-row :global(svg) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.progress-bar-track {
		height: 4px;
		border-radius: 999px;
		background: rgba(99, 102, 241, 0.12);
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--color-primary), var(--color-accent));
		transition: width 0.4s ease;
		min-width: 2px;
	}
</style>
