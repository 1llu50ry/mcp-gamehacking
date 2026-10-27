<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { CodeSymbol } from "../lib/api";

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

	let {
		symbols = [],
		selectedIndex = -1,
		onSelect = (_symbol: CodeSymbol) => {}
	}: {
		symbols: CodeSymbol[];
		selectedIndex: number;
		onSelect: (symbol: CodeSymbol) => void;
	} = $props();

	/** Grouped by kind — same ordering as the parent's flat `results` list,
	 *  so `symbols.indexOf(symbol)` stays the keyboard-nav flat index. */
	let groupedResults = $derived.by(() => {
		const groups: Record<string, CodeSymbol[]> = {};
		for (const symbol of symbols) {
			const kind = symbol.kind || "other";
			if (!groups[kind]) groups[kind] = [];
			groups[kind].push(symbol);
		}
		return groups;
	});
</script>

{#if symbols.length === 0}
	<div class="search-empty">No symbols found</div>
{:else}
	{#each Object.entries(groupedResults) as [kind, groupSymbols] (kind)}
		<div class="search-group">
			<div class="search-group-header">
				<Icon name={getKindIcon(kind)} size={12} strokeWidth={2} />
				<span>{kind}</span>
			</div>
			{#each groupSymbols as symbol (symbol.name + symbol.filePath)}
				<button
					class="search-result"
					class:selected={symbols.indexOf(symbol) === selectedIndex}
					id="search-result-{symbols.indexOf(symbol)}"
					role="option"
					aria-selected={symbols.indexOf(symbol) === selectedIndex}
					onclick={() => onSelect(symbol)}
				>
					<div class="result-icon">
						<Icon name={getKindIcon(symbol.kind)} size={14} strokeWidth={1.75} />
					</div>
					<div class="result-info">
						<div class="result-name">{symbol.name}</div>
						<div class="result-meta">
							{#if symbol.filePath}
								<span class="result-path">{truncatePath(symbol.filePath)}</span>
							{/if}
							{#if symbol.line != null}
								<span class="result-line">:{symbol.line}</span>
							{/if}
						</div>
					</div>
				</button>
			{/each}
		</div>
	{/each}
{/if}

<style>
	.search-empty {
		padding: 12px 16px;
		color: var(--color-text-muted);
		font-size: 0.78rem;
		text-align: center;
	}

	.search-group {
		padding: 8px 0;
	}

	.search-group:first-child {
		padding-top: 4px;
	}

	.search-group:last-child {
		padding-bottom: 4px;
	}

	.search-group-header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 16px;
		font-size: 0.68rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
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

	.result-name {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
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
</style>
