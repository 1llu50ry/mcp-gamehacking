<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type CodeSymbol, type DeadCodeBlock } from "../lib/api";
	import { currentRepo } from "../lib/stores";
	import CodebaseFileTree from "./CodebaseFileTree.svelte";
	import CodebaseViewTabs from "./CodebaseViewTabs.svelte";
	import CodebaseExploreView from "./CodebaseExploreView.svelte";
	import CodebaseInsightsView from "./CodebaseInsightsView.svelte";
	import CodebaseEmptyState from "./CodebaseEmptyState.svelte";
	import { aggregateSymbolCounts } from "../lib/fileTreeUtils";

	let { repo = "" }: { repo: string } = $props();

	// --- Types ---
	interface ArchitectureData {
		root: {
			path: string;
			name: string;
			type: string;
			children?: Array<Record<string, unknown>>;
		};
		summary: Record<string, unknown>;
		/** Dead-code candidates + hotspots (TASK-319/320) — present only when the ARCHITECTURE response carries them. */
		deadCode?: DeadCodeBlock;
	}

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

	// --- State ---
	let loading = $state(false);
	let error = $state("");
	let hasIndex = $state(false);
	let sidebarOpen = $state(true);
	let activeView = $state<"explore" | "insights">("explore");
	let selectedSymbol = $state<CodeSymbol | null>(null);
	let selectedFile = $state<string | null>(null);
	let fileSymbols = $state<CodeSymbol[]>([]);
	let fileSymbolsLoading = $state(false);
	let fileSymbolsError = $state("");
	let architectureData = $state<ArchitectureData | null>(null);
	let architectureLoading = $state(false);
	let architectureError = $state("");
	// ARIA live region (STD-002 / TASK-400): scoped sr-only announcements for
	// async index state changes (loaded / not-found / error / indexing).
	let liveAnnounce = $state("");

	// --- Derived: language breakdown ---
	let languageEntries = $derived.by<LanguageEntry[]>(() => {
		const summary = architectureData?.summary;
		if (!summary) return [];
		const lb = summary.languageBreakdown as Record<string, number> | undefined;
		if (!lb || typeof lb !== "object") return [];
		const total = Object.values(lb).reduce((a: number, b: number) => a + b, 0);
		if (total === 0) return [];
		return Object.entries(lb)
			.map(([name, count]) => ({
				name,
				count,
				percentage: Math.round((count / total) * 100),
				color: ""
			}))
			.sort((a, b) => b.count - a.count);
	});

	// --- Derived: top-level exports ---
	let topLevelExports = $derived.by<TopExport[]>(() => {
		const summary = architectureData?.summary;
		if (!summary) return [];
		const exports = summary.topLevelExports as Array<{ name: string; kind: string; file_path: string }> | undefined;
		if (!Array.isArray(exports)) return [];
		return exports.slice(0, 10);
	});

	// --- Derived: dead-code block (TASK-320) ---
	let deadCodeBlock = $derived<DeadCodeBlock | null>(architectureData?.deadCode ?? null);

	// --- Derived: per-kind symbol counts aggregated from the ARCHITECTURE
	// tree (TASK-328 IndexStats "By kind" cell). ---
	let indexKindCounts = $derived(aggregateSymbolCounts((architectureData?.root as Record<string, unknown>) ?? {}));

	// --- Reactive: load index when repo changes ---
	$effect(() => {
		if (repo) {
			void loadCodebaseIndex();
		}
	});

	async function loadCodebaseIndex() {
		if (!repo) {
			hasIndex = false;
			return;
		}
		loading = true;
		error = "";
		try {
			const result = await api.codebaseIndexStatus(repo);
			if (result?.indexed === true) {
				hasIndex = true;
				liveAnnounce = "Codebase index loaded";
				void loadArchitecture();
			} else {
				hasIndex = false;
				architectureData = null;
				liveAnnounce = "No codebase index found";
			}
		} catch {
			hasIndex = false;
			architectureData = null;
			liveAnnounce = "Failed to load codebase index";
		} finally {
			loading = false;
		}
	}

	async function loadArchitecture() {
		if (!repo) {
			architectureData = null;
			return;
		}
		architectureLoading = true;
		architectureError = "";
		try {
			const result = await api.codebaseArchitecture(repo, 5);
			architectureData = result as ArchitectureData;
		} catch (err) {
			architectureError = err instanceof Error ? err.message : "Failed to load file tree";
			architectureData = null;
		} finally {
			architectureLoading = false;
		}
	}

	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}

	async function startIndexing() {
		if (!repo) return;
		try {
			await api.codebaseReindex(repo);
			liveAnnounce = "Codebase indexing started";
			// After triggering, reload the index status (loadCodebaseIndex also loads architecture)
			await loadCodebaseIndex();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to start indexing";
		}
	}

	function handleSymbolSelect(symbol: CodeSymbol) {
		selectedSymbol = symbol;
	}

	/** Open a file in the detail view (file tree, symbol detail, dead-code rows). */
	function openCodebaseFile(filePath: string) {
		selectedSymbol = null;
		selectedFile = filePath;
		void loadFileSymbols(filePath);
	}

	async function loadFileSymbols(filePath: string) {
		if (!repo || !filePath) {
			fileSymbols = [];
			return;
		}
		fileSymbolsLoading = true;
		fileSymbolsError = "";
		try {
			const result = await api.codebaseSymbols(repo, filePath);
			fileSymbols = result ?? [];
		} catch (err) {
			fileSymbolsError = err instanceof Error ? err.message : "Failed to load symbols";
			fileSymbols = [];
		} finally {
			fileSymbolsLoading = false;
		}
	}
</script>

<div class="codebase-page animate-fade-in">
	<!-- ARIA live region (STD-002 / TASK-400): scoped, never the whole shell -->
	<div class="sr-only" aria-live="polite" aria-atomic="true">{liveAnnounce}</div>

	{#if !repo || loading || error || !hasIndex}
		<!-- TASK-397 (STD-002): exactly one h1 must survive the empty state.
		     The indexed branch renders "Codebase Overview" below; here the same
		     canonical h1 stays visible above the empty-state message so SR
		     users always get a page heading. CodebaseEmptyState adds none. -->
		<div class="codebase-empty-head">
			<!-- Same heading treatment as the indexed branch below, so the page
			     title does not change size depending on whether an index exists. -->
			<header class="codebase-header">
				<div>
					<p>Search files and symbols, then review architecture, exports, and hotspots.</p>
				</div>
			</header>
			<CodebaseEmptyState
				{repo}
				{hasIndex}
				{loading}
				{error}
				onRetry={() => void loadCodebaseIndex()}
				onStartIndexing={startIndexing}
			/>
		</div>
	{:else}
		<!-- ─── Indexed Content (Sidebar + Content) ─── -->
		<div class="codebase-layout" class:sidebar-collapsed={!sidebarOpen}>
			<!-- Sidebar toggle for mobile -->
			<button
				class="sidebar-toggle"
				onclick={toggleSidebar}
				aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
			>
				<Icon name={sidebarOpen ? "chevron-left" : "chevron-right"} size={16} strokeWidth={2} />
			</button>

			<!-- File tree sidebar -->
			<aside class="codebase-sidebar" class:open={sidebarOpen}>
				<div class="sidebar-header">
					<Icon name="file-text" size={14} strokeWidth={1.75} />
					<span class="section-label">File Tree</span>
				</div>
				<div class="sidebar-content">
					<CodebaseFileTree
						architecture={architectureData?.root?.children ?? null}
						loading={architectureLoading}
						error={architectureError || null}
						onFileSelect={openCodebaseFile}
						onRetry={() => void loadArchitecture()}
					/>
				</div>
			</aside>

			<!-- Main content area -->
			<main class="codebase-content">
				<div class="codebase-content-scroll">
					<header class="codebase-header">
						<div>
							<p>
								Find a symbol or file first. Switch to insights only when you need architecture, exports, and hotspots.
							</p>
						</div>
						<div class="repo-badge">{$currentRepo}</div>
					</header>
					<CodebaseViewTabs {activeView} onSelect={(view) => (activeView = view)} />

					{#if activeView === "explore"}
						<CodebaseExploreView
							{repo}
							{selectedSymbol}
							{selectedFile}
							{fileSymbols}
							{fileSymbolsLoading}
							{fileSymbolsError}
							onSymbolSelect={handleSymbolSelect}
							onOpenFile={openCodebaseFile}
						/>
					{:else}
						<CodebaseInsightsView
							{repo}
							{languageEntries}
							{indexKindCounts}
							{topLevelExports}
							{deadCodeBlock}
							onOpenFile={(path) => {
								openCodebaseFile(path);
								activeView = "explore";
							}}
							onSymbolSelect={(symbol) => {
								handleSymbolSelect(symbol);
								activeView = "explore";
							}}
						/>
					{/if}
				</div>
			</main>
		</div>
	{/if}
</div>

<style>
	.codebase-page {
		height: 100%;
		min-height: 400px;
	}

	/* ── Layout: sidebar + content ── */
	.codebase-layout {
		display: flex;
		gap: 0;
		height: calc(100vh - 180px);
		position: relative;
	}

	.codebase-layout.sidebar-collapsed .codebase-sidebar {
		width: 0;
		padding: 0;
		overflow: hidden;
		border: none;
	}

	.codebase-layout.sidebar-collapsed .codebase-content {
		flex: 1;
	}

	/* ── Sidebar ── */
	.codebase-sidebar {
		width: 260px;
		min-width: 200px;
		border-right: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		transition:
			width 0.2s ease,
			padding 0.2s ease;
		border-radius: 16px 0 0 16px;
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.04);
	}

	.sidebar-content {
		flex: 1;
		overflow-y: auto;
	}

	/* ── Sidebar toggle ── */
	.sidebar-toggle {
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		z-index: 5;
		width: 36px;
		height: 44px;
		border: none;
		background: var(--color-surface);
		border-radius: 0 8px 8px 0;
		color: var(--color-text-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 2px 0 8px rgba(0, 0, 0, 0.06);
		transition: color 0.15s ease;
	}

	/* A 36px-wide edge tab is hard to hit with a thumb; widen on touch. */
	@media (pointer: coarse) {
		.sidebar-toggle {
			width: 44px;
		}
	}

	.sidebar-toggle:hover {
		color: var(--color-text);
	}

	.sidebar-collapsed .sidebar-toggle {
		left: 0;
	}

	/* ── Content ── */
	.codebase-content {
		flex: 1;
		overflow: clip;
		padding: 0;
		position: relative;
	}

	.codebase-content-scroll {
		display: grid;
		gap: 20px;
		height: 100%;
		overflow-y: auto;
		padding: 24px;
	}
	.codebase-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
	}
	.codebase-header p:last-child {
		max-width: 680px;
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.55;
		color: var(--color-text-muted);
	}
	@media (pointer: coarse) {
	}

	/* ── Repo badge (reuse pattern) ── */
	.repo-badge {
		font-size: 0.68rem;
		font-weight: 800;
		color: var(--color-primary);
		background: rgba(99, 102, 241, 0.08);
		border: 1px solid rgba(99, 102, 241, 0.16);
		padding: 4px 8px;
		border-radius: 999px;
	}

	/* ── Responsive: sidebar becomes overlay on narrow screens ── */
	@media (max-width: 768px) {
		.codebase-sidebar {
			position: absolute;
			left: 0;
			top: 0;
			bottom: 0;
			z-index: 10;
			box-shadow: 4px 0 24px rgba(0, 0, 0, 0.12);
			background: var(--color-surface);
		}

		.codebase-layout:not(.sidebar-collapsed) .codebase-content {
			opacity: 0.3;
			pointer-events: none;
		}
	}
</style>
