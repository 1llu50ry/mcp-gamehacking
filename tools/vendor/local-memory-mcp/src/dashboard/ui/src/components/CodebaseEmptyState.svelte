<script lang="ts">
	import Icon from "../lib/Icon.svelte";

	interface CodebaseEmptyStateProps {
		repo?: string;
		hasIndex?: boolean;
		loading?: boolean;
		error?: string;
		onRetry?: () => void;
		onStartIndexing?: () => void;
	}

	let {
		repo = "",
		hasIndex = false,
		loading = false,
		error = "",
		onRetry,
		onStartIndexing
	}: CodebaseEmptyStateProps = $props();
</script>

{#if !repo}
	<div class="codebase-empty">
		<div class="codebase-empty-icon animate-float">
			<Icon name="code" size={32} strokeWidth={1.5} />
		</div>
		<div class="codebase-empty-title">Select a repository to view its codebase index.</div>
		<div class="codebase-empty-text">
			Choose a repository from the sidebar to browse its file structure and indexed content.
		</div>
	</div>
{:else if loading}
	<div class="codebase-empty">
		<div class="codebase-empty-icon animate-float">
			<Icon name="refresh-cw" size={28} strokeWidth={1.5} />
		</div>
		<div class="codebase-empty-title">Loading codebase index...</div>
	</div>
{:else if error}
	<div class="codebase-empty">
		<div
			class="codebase-empty-icon animate-float"
			style="background:linear-gradient(135deg,rgba(239,68,68,0.15),rgba(220,38,38,0.15));border-color:rgba(239,68,68,0.2);"
		>
			<Icon name="triangle-alert" size={28} strokeWidth={1.5} />
		</div>
		<div class="codebase-empty-title">Failed to load codebase</div>
		<div class="codebase-empty-text">{error}</div>
		<button class="codebase-action-btn" onclick={onRetry}>
			<Icon name="refresh-cw" size={14} strokeWidth={2} />
			<span>Retry</span>
		</button>
	</div>
{:else if !hasIndex}
	<div class="codebase-empty">
		<div class="codebase-empty-icon animate-float">
			<Icon name="file-text" size={32} strokeWidth={1.5} />
		</div>
		<div class="codebase-empty-title">No codebase index found</div>
		<div class="codebase-empty-text">
			This repository hasn't been indexed yet. Create an index to browse its file structure and enable codebase-aware
			features.
		</div>
		<button class="codebase-action-btn primary" onclick={onStartIndexing}>
			<Icon name="upload-cloud" size={14} strokeWidth={2} />
			<span>Index Now</span>
		</button>
	</div>
{/if}

<style>
	.codebase-empty {
		text-align: center;
		padding: 80px 20px;
	}

	.codebase-empty-icon {
		display: inline-flex;
		width: 72px;
		height: 72px;
		border-radius: 20px;
		background: linear-gradient(135deg, rgba(14, 165, 233, 0.15), rgba(99, 102, 241, 0.15));
		border: 1px solid rgba(14, 165, 233, 0.2);
		align-items: center;
		justify-content: center;
		margin-bottom: 20px;
		color: var(--color-primary);
	}

	.codebase-empty-title {
		font-size: 1.15rem;
		font-weight: 800;
		color: var(--color-text);
		margin-bottom: 8px;
		letter-spacing: -0.02em;
	}

	.codebase-empty-text {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		max-width: 420px;
		margin: 0 auto 20px;
		line-height: 1.5;
	}

	.codebase-action-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 18px;
		border-radius: 10px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.06);
		color: var(--color-text);
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.codebase-action-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		border-color: var(--color-primary);
	}

	.codebase-action-btn.primary {
		background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
		color: white;
		border: none;
		box-shadow: 0 4px 16px var(--glow-primary);
	}

	.codebase-action-btn.primary:hover {
		opacity: 0.92;
		transform: translateY(-1px);
	}
</style>
