<script lang="ts">
	/**
	 * Insights mode: architecture, exports, dead code, and the symbol graph.
	 *
	 * Both of its navigation actions hand control back to Explore, so the mode
	 * switch is the parent's decision — this component only reports what was
	 * picked.
	 */
	import type { CodeSymbol, DeadCodeBlock } from "../lib/api";
	import CodebaseIndexStatus from "./CodebaseIndexStatus.svelte";
	import CodebaseLanguageBreakdown from "./CodebaseLanguageBreakdown.svelte";
	import CodebaseTopExports from "./CodebaseTopExports.svelte";
	import CodebaseDeadCode from "./CodebaseDeadCode.svelte";
	import CodebaseGraphPanel from "./CodebaseGraphPanel.svelte";

	interface LanguageEntry {
		name: string;
		count: number;
		percentage: number;
		color: string;
	}

	interface TopExport {
		name: string;
		kind: string;
		file_path: string;
	}

	let {
		repo,
		languageEntries,
		indexKindCounts,
		topLevelExports,
		deadCodeBlock,
		onOpenFile,
		onSymbolSelect
	}: {
		repo: string;
		languageEntries: LanguageEntry[];
		indexKindCounts: Record<string, number>;
		topLevelExports: TopExport[];
		deadCodeBlock: DeadCodeBlock | null;
		onOpenFile: (path: string) => void;
		onSymbolSelect: (symbol: CodeSymbol) => void;
	} = $props();
</script>

<section class="insights-view" aria-label="Codebase insights">
	<CodebaseIndexStatus {repo} languageCount={languageEntries.length} kindCounts={indexKindCounts} />
	<div class="insight-grid">
		<CodebaseLanguageBreakdown {languageEntries} /><CodebaseTopExports {topLevelExports} />
	</div>
	<CodebaseDeadCode block={deadCodeBlock} {onOpenFile} />
	<CodebaseGraphPanel {repo} {onSymbolSelect} />
</section>

<style>
	.insights-view {
		display: grid;
		gap: 20px;
	}

	/* Normalize children so vertical rhythm is governed exclusively by grid gap */
	.insights-view > :global(*) {
		margin-top: 0;
		margin-bottom: 0;
	}

	.insight-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 20px;
	}

	.insight-grid > :global(*) {
		margin-bottom: 0;
	}

	@media (max-width: 900px) {
		.insight-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
