<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type CodeSymbol, type CodeSearchMatch } from "../lib/api";
	import CodeSearchResults from "./CodeSearchResults.svelte";
	import SymbolSearchResults from "./SymbolSearchResults.svelte";

	type SearchMode = "symbols" | "code";

	let {
		repo = "",
		onSymbolSelect = (_symbol: CodeSymbol) => {}
	}: {
		repo: string;
		onSymbolSelect: (symbol: CodeSymbol) => void;
	} = $props();

	// State
	let mode = $state<SearchMode>("symbols");
	let query = $state("");
	let results = $state<CodeSymbol[]>([]);
	let codeMatches = $state<CodeSearchMatch[]>([]);
	let loading = $state(false);
	let error = $state("");
	let isOpen = $state(false);
	let selectedIndex = $state(-1);
	let inputEl = $state<HTMLInputElement | null>(null);
	let containerEl = $state<HTMLDivElement | null>(null);

	// Derived
	/** Number of visible rows for keyboard navigation in the active mode. */
	let visibleCount = $derived(mode === "code" ? codeMatches.length : results.length);

	/** CODE-mode errors about a missing/unindexed repo or unresolvable repo
	 *  path get a re-index hint (TASK-317) — mirrors the tab's error handling. */
	let codeIndexGuidance = $derived(mode === "code" && /index|repoPath|repository path|codebase-index/i.test(error));

	// Effects
	$effect(() => {
		const currentQuery = query;
		const currentRepo = repo;
		const currentMode = mode;

		if (currentQuery.length < 2 || !currentRepo) {
			results = [];
			codeMatches = [];
			isOpen = false;
			return;
		}

		// Clear both lists on any re-run (query or mode change) so stale rows
		// from the other mode never linger while the new fetch is in flight.
		results = [];
		codeMatches = [];
		isOpen = false;
		loading = true;
		error = "";

		const timer = setTimeout(async () => {
			try {
				if (currentMode === "code") {
					const response = await api.codebaseCodeSearch(currentRepo, currentQuery, { limit: 10 });
					codeMatches = response.matches ?? [];
					isOpen = true;
				} else {
					const response = await api.codebaseSearch(currentRepo, currentQuery, 10);
					results = response.results || [];
					isOpen = true;
				}
				selectedIndex = -1;
			} catch (err) {
				error = err instanceof Error ? err.message : "Search failed";
				results = [];
				codeMatches = [];
				// Keep the dropdown open so the error state (incl. re-index
				// guidance) is actually visible to the user.
				isOpen = true;
			} finally {
				loading = false;
			}
		}, 300);

		return () => {
			clearTimeout(timer);
		};
	});

	// Click outside handler
	$effect(() => {
		const handler = (event: MouseEvent) => {
			if (containerEl && !containerEl.contains(event.target as Node)) {
				isOpen = false;
			}
		};

		document.addEventListener("click", handler);
		return () => {
			document.removeEventListener("click", handler);
		};
	});

	function handleKeydown(event: KeyboardEvent) {
		if (!isOpen && results.length === 0 && codeMatches.length === 0) {
			return;
		}

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, visibleCount - 1);
				break;
			case "ArrowUp":
				event.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, -1);
				break;
			case "Enter":
				event.preventDefault();
				if (selectedIndex >= 0 && selectedIndex < visibleCount) {
					if (mode === "code") {
						const match = codeMatches[selectedIndex];
						if (match) selectCodeMatch(match);
					} else {
						const symbol = results[selectedIndex];
						if (symbol) selectSymbol(symbol);
					}
				}
				break;
			case "Escape":
				event.preventDefault();
				isOpen = false;
				selectedIndex = -1;
				break;
		}
	}

	function selectSymbol(symbol: CodeSymbol) {
		onSymbolSelect(symbol);
		query = symbol.name;
		isOpen = false;
		selectedIndex = -1;
		inputEl?.blur();
	}

	/** Deep-link to the enclosing symbol's detail when enrichment found one. */
	function selectCodeMatch(match: CodeSearchMatch) {
		const enc = match.enclosingSymbol;
		if (enc) {
			onSymbolSelect({
				name: enc.name,
				kind: enc.kind as CodeSymbol["kind"],
				filePath: match.filePath,
				line: enc.startLine
			});
		}
		isOpen = false;
		selectedIndex = -1;
		inputEl?.blur();
	}
</script>

<div class="search-bar-container" bind:this={containerEl}>
	<div class="search-mode-toggle" role="group" aria-label="Search mode">
		<button
			type="button"
			class="mode-btn"
			class:active={mode === "symbols"}
			aria-pressed={mode === "symbols"}
			onclick={() => {
				mode = "symbols";
			}}
		>
			<Icon name="search" size={11} strokeWidth={2} />
			Symbols
		</button>
		<button
			type="button"
			class="mode-btn"
			class:active={mode === "code"}
			aria-pressed={mode === "code"}
			onclick={() => {
				mode = "code";
			}}
		>
			<Icon name="code" size={11} strokeWidth={2} />
			Code
		</button>
	</div>
	<div class="search-input-wrapper">
		<div class="search-icon">
			<Icon name="search" size={16} strokeWidth={2} />
		</div>
		<input
			type="text"
			class="search-input"
			placeholder={mode === "code" ? "Search code in this repository..." : "Search symbols in this repository..."}
			bind:value={query}
			bind:this={inputEl}
			onkeydown={handleKeydown}
			onfocus={() => {
				if (visibleCount > 0) isOpen = true;
			}}
			aria-label={mode === "code" ? "Search codebase file contents" : "Search codebase symbols"}
			aria-autocomplete="list"
			aria-controls="search-results-list"
			aria-activedescendant={selectedIndex >= 0 ? `search-result-${selectedIndex}` : undefined}
		/>
		{#if loading}
			<div class="search-spinner">
				<Icon name="loader" size={14} strokeWidth={2} />
			</div>
		{/if}
	</div>

	{#if isOpen && (results.length > 0 || codeMatches.length > 0 || error || (mode === "code" && !loading))}
		<div class="search-dropdown" id="search-results-list" role="listbox">
			{#if error}
				<div class="search-error">
					<Icon name="alert-circle" size={14} strokeWidth={2} />
					<div class="search-error-body">
						<span>{error}</span>
						{#if codeIndexGuidance}
							<span class="search-error-hint">Run codebase-index to index this repository, then retry.</span>
						{/if}
					</div>
				</div>
			{:else if mode === "code"}
				<CodeSearchResults matches={codeMatches} {selectedIndex} onSelect={selectCodeMatch} />
			{:else}
				<SymbolSearchResults symbols={results} {selectedIndex} onSelect={selectSymbol} />
			{/if}
		</div>
	{/if}
</div>

<style>
	.search-bar-container {
		position: relative;
		width: 100%;
		margin-bottom: 16px;
	}

	.search-mode-toggle {
		display: inline-flex;
		gap: 2px;
		padding: 2px;
		margin-bottom: 8px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--color-border);
		border-radius: 8px;
	}

	.mode-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 36px;
		padding: 6px 14px;
		font-size: 0.78rem;
		font-weight: 600;
		font-family: inherit;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.mode-btn:hover {
		color: var(--color-text);
	}

	@media (pointer: coarse) {
		.mode-btn {
			min-height: 44px;
		}
	}

	.mode-btn.active {
		background: rgba(99, 102, 241, 0.14);
		color: var(--color-primary);
	}

	.search-input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.search-icon {
		position: absolute;
		left: 12px;
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 10px 36px 10px 36px;
		border-radius: 10px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.04);
		color: var(--color-text);
		font-size: 0.85rem;
		font-family: inherit;
		transition: all 0.15s ease;
		outline: none;
	}

	.search-input:focus {
		border-color: var(--color-primary);
		background: rgba(255, 255, 255, 0.06);
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
	}

	.search-input::placeholder {
		color: var(--color-text-muted);
		opacity: 0.6;
	}

	.search-spinner {
		position: absolute;
		right: 12px;
		color: var(--color-primary);
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

	.search-dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 4px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
		max-height: 400px;
		overflow-y: auto;
		z-index: 50;
	}

	.search-error {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		color: #ef4444;
		font-size: 0.78rem;
	}

	.search-error-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.search-error-hint {
		color: var(--color-text-muted);
		font-size: 0.7rem;
	}
</style>
