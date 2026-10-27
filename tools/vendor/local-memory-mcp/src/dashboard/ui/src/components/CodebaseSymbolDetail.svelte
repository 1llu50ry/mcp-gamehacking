<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type TraceReference, type TraceParent, type CodebaseSymbolRow } from "../lib/api";
	import SymbolDetailHeader from "./SymbolDetailHeader.svelte";
	import SymbolDetailCodePreview from "./SymbolDetailCodePreview.svelte";
	import CodebaseSymbolTrace from "./CodebaseSymbolTrace.svelte";
	import CodebaseCallGraph from "./CodebaseCallGraph.svelte";
	import { getKindIcon, getKindLabel, buildLocationText } from "../lib/symbolDetailUtils";

	interface CodeSymbol {
		name: string;
		kind: "function" | "class" | "interface" | "type" | "enum" | "variable";
		signature?: string;
		exported?: boolean;
		documentation?: string;
		filePath?: string;
		line?: number;
		column?: number;
		references?: string[];
		relatedSymbols?: string[];
	}

	let {
		symbol = null,
		references = [],
		loading = false,
		repo = "",
		onSymbolSelect = null,
		onOpenFile = null
	}: {
		symbol: CodeSymbol | null;
		references: string[];
		loading: boolean;
		repo: string;
		/** Navigate to another symbol (parent / child) — mirrors CodebaseSymbolList. */
		onSymbolSelect?: ((symbol: CodeSymbol) => void) | null;
		/** Open a file (e.g. a derived-heritage site) in the file tree. */
		onOpenFile?: ((filePath: string) => void) | null;
	} = $props();

	let kindIcon = $derived(getKindIcon(symbol?.kind || "variable"));
	let kindLabel = $derived(getKindLabel(symbol?.kind || "variable"));
	let locationText = $derived(buildLocationText(symbol?.filePath, symbol?.line, symbol?.column));

	// --- Trace state (Enh 6) ---
	let traceRefs = $state<TraceReference[]>([]);
	let traceLoading = $state(false);
	let traceError = $state("");

	// --- Hierarchy state (TASK-300: TRACE surfaces parent/children) ---
	let traceParent = $state<TraceParent | null>(null);
	let traceChildren = $state<CodebaseSymbolRow[]>([]);

	// --- Reference kind filter (Phase 1.1) ---
	// Owned here (bound into CodebaseSymbolTrace) so it can be reset to "all"
	// on EVERY symbol transition — a stale filter must never persist across
	// parent/child navigation (F3).
	let activeKindFilter = $state<string>("all");

	// Fetch trace when symbol changes
	$effect(() => {
		const sym = symbol;
		activeKindFilter = "all";
		if (!sym || !repo) {
			traceRefs = [];
			traceParent = null;
			traceChildren = [];
			return;
		}
		void fetchTrace(sym.name);
	});

	async function fetchTrace(name: string) {
		traceLoading = true;
		traceError = "";
		try {
			const result = await api.codebaseTrace(repo, name);
			traceRefs = result?.references ?? [];
			traceParent = result?.parent ?? null;
			traceChildren = result?.children ?? [];
		} catch {
			traceRefs = [];
			traceParent = null;
			traceChildren = [];
			traceError = "Failed to load references";
		} finally {
			traceLoading = false;
		}
	}
</script>

{#if loading}
	<div class="detail-skeleton" aria-label="Loading symbol details">
		<div class="detail-skel-header">
			<div class="detail-skel-icon skeleton-pulse"></div>
			<div class="detail-skel-name skeleton-pulse"></div>
		</div>
		<div class="detail-skel-sig skeleton-pulse"></div>
		<div class="detail-skel-section">
			<div class="detail-skel-label skeleton-pulse"></div>
			<div class="detail-skel-text skeleton-pulse" style="width:90%;"></div>
			<div class="detail-skel-text skeleton-pulse" style="width:70%;"></div>
		</div>
		<div class="detail-skel-section">
			<div class="detail-skel-label skeleton-pulse"></div>
			<div class="detail-skel-text skeleton-pulse" style="width:60%;"></div>
			<div class="detail-skel-text skeleton-pulse" style="width:80%;"></div>
		</div>
	</div>
{:else if !symbol}
	<div class="detail-empty">
		<div class="detail-empty-icon">
			<Icon name="code" size={20} strokeWidth={1.5} />
		</div>
		<div class="detail-empty-title">Select a symbol to view details.</div>
	</div>
{:else}
	<div class="detail-panel">
		<SymbolDetailHeader {symbol} {kindIcon} {kindLabel} />

		<SymbolDetailCodePreview {symbol} />

		<!-- ─── Documentation ─── -->
		<div class="detail-section">
			<div class="detail-section-label">Documentation</div>
			{#if symbol.documentation}
				<div class="detail-doc">{symbol.documentation}</div>
			{:else}
				<div class="detail-no-doc">No documentation</div>
			{/if}
		</div>

		<!-- ─── Location ─── -->
		{#if symbol.filePath}
			<div class="detail-section">
				<div class="detail-section-label">Location</div>
				<div class="detail-location">
					<Icon name="file-text" size={12} strokeWidth={1.75} />
					<span class="detail-location-path">{locationText}</span>
				</div>
			</div>
		{/if}

		<!-- ─── Hierarchy + References (Phase 1.1 — split into child component) ─── -->
		<CodebaseSymbolTrace
			{traceRefs}
			{traceParent}
			{traceChildren}
			{traceLoading}
			{traceError}
			{references}
			bind:activeKindFilter
			{onSymbolSelect}
			{onOpenFile}
		/>

		<!-- ─── Callers DAG (TASK-328 [CG-1] point 12): who calls this symbol ─── -->
		<CodebaseCallGraph {symbol} {repo} {onSymbolSelect} />

		<!-- ─── Related Symbols ─── -->
		{#if symbol.relatedSymbols && symbol.relatedSymbols.length > 0}
			<div class="detail-section">
				<div class="detail-section-label">
					Related Symbols
					<span class="detail-section-count">{symbol.relatedSymbols.length}</span>
				</div>
				<div class="detail-related">
					{#each symbol.relatedSymbols as rel (rel)}
						<span class="detail-related-chip">{rel}</span>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ── Skeleton Loading ── */
	.detail-skeleton {
		padding: 16px;
	}

	.detail-skel-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}

	.detail-skel-icon {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
	}

	.detail-skel-name {
		height: 16px;
		width: 120px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.06);
	}

	.detail-skel-sig {
		height: 28px;
		width: 100%;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.04);
		margin-bottom: 16px;
	}

	.detail-skel-section {
		margin-bottom: 14px;
	}

	.detail-skel-label {
		height: 8px;
		width: 60px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.06);
		margin-bottom: 6px;
	}

	.detail-skel-text {
		height: 10px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.04);
		margin-bottom: 4px;
	}

	.skeleton-pulse {
		animation: skeleton-pulse 1.8s ease-in-out infinite;
	}

	@keyframes skeleton-pulse {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}

	/* ── Empty State ── */
	.detail-empty {
		text-align: center;
		padding: 40px 16px;
	}

	.detail-empty-icon {
		display: inline-flex;
		width: 44px;
		height: 44px;
		border-radius: 12px;
		background: rgba(14, 165, 233, 0.1);
		color: var(--color-primary);
		border: 1px solid rgba(14, 165, 233, 0.15);
		align-items: center;
		justify-content: center;
		margin-bottom: 10px;
	}

	.detail-empty-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--color-text-muted);
	}

	/* ── Detail Panel ── */
	.detail-panel {
		padding: 16px;
	}

	/* ── Sections ── */
	.detail-section {
		margin-bottom: 16px;
	}

	.detail-section-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 6px;
	}

	.detail-section-count {
		font-size: 0.56rem;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.06);
		padding: 1px 5px;
		border-radius: 4px;
	}

	/* ── Documentation ── */
	.detail-doc {
		font-size: 0.78rem;
		color: var(--color-text);
		line-height: 1.6;
		padding: 8px 12px;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 8px;
		border: 1px solid var(--color-border);
	}

	.detail-no-doc {
		font-size: 0.74rem;
		color: var(--color-text-muted);
		font-style: italic;
		padding: 8px 12px;
		opacity: 0.6;
	}

	/* ── Location ── */
	.detail-location {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--color-text-muted);
		font-size: 0.72rem;
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
	}

	.detail-location-path {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* ── Related Symbols ── */
	.detail-related {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.detail-related-chip {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid var(--color-border);
		padding: 3px 8px;
		border-radius: 6px;
		font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
	}
</style>
