<script lang="ts">
	/**
	 * Explore mode: find one thing and read it.
	 *
	 * Owns nothing — every piece of state is passed in and every action is a
	 * callback, so this stays a presentation shell. The parent keeps the
	 * selection because Insights can also drive it (clicking a dead-code entry
	 * or a graph node switches back here with a target already chosen).
	 */
	import type { CodeSymbol } from "../lib/api";
	import CodebaseSearchBar from "./CodebaseSearchBar.svelte";
	import CodebaseSymbolDetail from "./CodebaseSymbolDetail.svelte";
	import CodebaseFileViewer from "./CodebaseFileViewer.svelte";
	import CodebaseSymbolList from "./CodebaseSymbolList.svelte";
	import { EmptyState, Skeleton } from "./ui";

	let {
		repo,
		selectedSymbol,
		selectedFile,
		fileSymbols,
		fileSymbolsLoading,
		fileSymbolsError,
		loading = false,
		onSymbolSelect,
		onOpenFile
	}: {
		repo: string;
		selectedSymbol: CodeSymbol | null;
		selectedFile: string | null;
		fileSymbols: CodeSymbol[];
		fileSymbolsLoading: boolean;
		fileSymbolsError: string;
		loading?: boolean;
		onSymbolSelect: (symbol: CodeSymbol) => void;
		onOpenFile: (path: string) => void;
	} = $props();
</script>

<section class="explore-view" aria-label="Explore codebase">
	<CodebaseSearchBar {repo} {onSymbolSelect} />
	<div class="explore-result">
		{#if loading}
			<div class="explore-loading" aria-label="Loading explore view" data-testid="explore-loading">
				<div class="explore-skeleton-header">
					<Skeleton variant="line" width="35%" height="20px" />
					<Skeleton variant="line" width="60%" height="14px" />
				</div>
				<div class="explore-skeleton-split">
					<Skeleton variant="block" height="240px" />
					<Skeleton variant="block" height="240px" />
				</div>
			</div>
		{:else if selectedSymbol}
			<CodebaseSymbolDetail
				symbol={selectedSymbol}
				references={[]}
				loading={false}
				{repo}
				{onSymbolSelect}
				{onOpenFile}
			/>
		{:else if selectedFile}
			<div class="explore-file-split">
				<div class="explore-file-viewer-pane">
					<CodebaseFileViewer {repo} filePath={selectedFile} />
				</div>
				<div class="explore-symbol-list-pane">
					<CodebaseSymbolList symbols={fileSymbols} loading={fileSymbolsLoading} {onSymbolSelect} />
					{#if fileSymbolsError}<div class="inline-error">{fileSymbolsError}</div>{/if}
				</div>
			</div>
		{:else}
			<div class="explore-empty">
				<EmptyState
					icon="file-text"
					title="Choose a file or search for a symbol"
					description="The file tree keeps your place while results open here."
					size="inline"
				/>
			</div>
		{/if}
	</div>
</section>

<style>
	.explore-view {
		display: grid;
		gap: 20px;
	}

	.explore-result {
		padding: 20px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.explore-file-split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 20px;
		align-items: start;
	}

	.explore-file-viewer-pane {
		min-width: 0;
	}

	.explore-file-viewer-pane :global(.fv-panel) {
		margin-bottom: 0;
	}

	.explore-symbol-list-pane {
		min-width: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md, 10px);
		background: rgba(255, 255, 255, 0.02);
		overflow: hidden;
		max-height: 520px;
		overflow-y: auto;
	}

	.explore-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-8, 32px) var(--space-4, 16px);
	}

	.explore-loading {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 12px 0;
	}

	.explore-skeleton-header {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.explore-skeleton-split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 20px;
		margin-top: 8px;
	}

	.inline-error {
		margin: var(--space-3, 12px) var(--space-4, 16px);
		padding: 12px;
		border-radius: var(--radius-md);
		background: rgba(239, 68, 68, 0.1);
		color: var(--color-danger);
		font-size: 0.8rem;
	}

	@media (max-width: 1024px) {
		.explore-file-split,
		.explore-skeleton-split {
			grid-template-columns: 1fr;
			gap: 16px;
		}

		.explore-symbol-list-pane {
			max-height: none;
		}
	}

	@media (max-width: 768px) {
		.explore-result {
			padding: 14px;
		}
	}
</style>
