<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { CodeSearchMatch } from "../lib/api";

	function getKindIcon(kind: string): string {
		const icons: Record<string, string> = {
			function: "zap",
			class: "layers",
			interface: "terminal",
			type: "hash",
			enum: "list",
			variable: "database",
			other: "code"
		};
		return icons[kind] || "code";
	}

	function truncatePath(path: string, maxLength: number = 20): string {
		if (path.length <= maxLength) return path;
		return "..." + path.slice(-(maxLength - 3));
	}

	/** UI projection of a CODE-mode match (TASK-317). */
	interface CodeMatchItem {
		key: string;
		filePath: string;
		line: number;
		snippet: string;
		symbolKind: string;
		symbolName: string | null;
		badgeTitle: string;
	}

	function toCodeMatchItem(match: CodeSearchMatch): CodeMatchItem {
		const enc = match.enclosingSymbol;
		return {
			key: `${match.filePath}:${match.line}:${match.matchIndex}`,
			filePath: match.filePath,
			line: match.line,
			snippet: match.snippet,
			symbolKind: enc?.kind ?? "other",
			symbolName: enc?.name ?? null,
			badgeTitle: enc ? `${enc.kind} ${enc.name} (lines ${enc.startLine}-${enc.endLine})` : ""
		};
	}

	let {
		matches = [],
		selectedIndex = -1,
		onSelect = (_match: CodeSearchMatch) => {}
	}: {
		matches: CodeSearchMatch[];
		selectedIndex: number;
		onSelect: (match: CodeSearchMatch) => void;
	} = $props();

	/** Display items stay keyed 1:1 with `matches` so a click maps back to the raw match. */
	let items = $derived(matches.map(toCodeMatchItem));
</script>

{#if items.length === 0}
	<div class="search-empty">No code matches</div>
{:else}
	{#each items as item, index (item.key)}
		<button
			class="search-result"
			class:selected={index === selectedIndex}
			id="search-result-{index}"
			role="option"
			aria-selected={index === selectedIndex}
			onclick={() => onSelect(matches[index])}
		>
			<div class="result-icon">
				<Icon name="file-text" size={14} strokeWidth={1.75} />
			</div>
			<div class="result-info">
				<div class="result-meta">
					<span class="result-path">{truncatePath(item.filePath)}</span>
					<span class="result-line">:{item.line}</span>
					{#if item.symbolName}
						<span class="symbol-badge" title={item.badgeTitle}>
							<Icon name={getKindIcon(item.symbolKind)} size={10} strokeWidth={2} />
							{item.symbolName}
						</span>
					{/if}
				</div>
				<div class="result-snippet">{item.snippet}</div>
			</div>
		</button>
	{/each}
{/if}

<style>
	.search-empty {
		padding: 12px 16px;
		color: var(--color-text-muted);
		font-size: 0.78rem;
		text-align: center;
	}

	.search-result {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 16px;
		border: none;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s ease;
		border-radius: 0;
		font-family: inherit;
	}

	.search-result:hover,
	.search-result.selected {
		background: rgba(255, 255, 255, 0.06);
	}

	.result-icon {
		color: var(--color-primary);
		flex-shrink: 0;
	}

	.result-info {
		flex: 1;
		min-width: 0;
	}

	.result-meta {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.68rem;
		color: var(--color-text-muted);
	}

	.result-path {
		font-family: "SF Mono", "Fira Code", monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 150px;
	}

	.result-line {
		font-family: "SF Mono", "Fira Code", monospace;
		opacity: 0.8;
	}

	.result-snippet {
		margin-top: 2px;
		font-family: "SF Mono", "Fira Code", monospace;
		font-size: 0.7rem;
		color: var(--color-text-muted);
		white-space: pre;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.symbol-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		margin-left: auto;
		padding: 1px 8px;
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 600;
		font-family: "SF Mono", "Fira Code", monospace;
		color: var(--color-primary);
		background: rgba(99, 102, 241, 0.08);
		border: 1px solid rgba(99, 102, 241, 0.16);
		white-space: nowrap;
		flex-shrink: 0;
	}
</style>
