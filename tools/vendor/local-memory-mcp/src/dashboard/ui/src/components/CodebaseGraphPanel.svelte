<script lang="ts">
	import { onDestroy } from "svelte";
	import type { CodeSymbol } from "../lib/api";
	import Icon from "../lib/Icon.svelte";
	import {
		fetchCodebaseGraph,
		type CodeGraphKind,
		type CodeGraphNode,
		type CodeGraphResult
	} from "../lib/codebaseGraph";
	import { initializeSphereLayout, initializeZeroEdgeOverviewLayout } from "../lib/kg/KGForceLayout";
	import type { LayoutNode, LayoutEdge } from "../lib/kg/KGForceLayout";
	import { stopNeuralAnimation } from "../lib/kg/KGNeuralRenderer";
	import CodebaseGraphLegend from "./CodebaseGraphLegend.svelte";
	import KGGraphCanvas from "./KGGraphCanvas.svelte";

	// ─── Props ────────────────────────────────────────────────────────────────

	let {
		repo = "",
		onSymbolSelect = null
	}: {
		repo: string;
		/** Open the clicked symbol in the existing CodebaseSymbolDetail nav. */
		onSymbolSelect?: ((symbol: CodeSymbol) => void) | null;
	} = $props();

	// ─── State ────────────────────────────────────────────────────────────────
	let graphData = $state<CodeGraphResult | null>(null);
	let loading = $state(false);
	let error = $state("");
	/** Distinguishes "repo not indexed" (actionable hint) from generic failures. */
	let indexRequired = $state(false);
	let graphKind = $state<CodeGraphKind | "">("");
	let canvasReady = $state(false);

	// Layout state — $state so KGGraphCanvas picks up the reassigned arrays.
	let layoutNodes = $state<LayoutNode[]>([]);
	let layoutEdges = $state<LayoutEdge[]>([]);
	// O(1) lookups for the canvas (LayoutNode) and node→symbol navigation (raw
	// CodeGraphNode — LayoutNode carries no filePath). Rebuilt wholesale on data
	// change, never mutated in place (KGGraph buildNodeLookup pattern).
	let layoutLookup = new Map<string, LayoutNode>();
	let metaLookup = new Map<string, CodeGraphNode>();

	// Interaction state — plain object mutated in place by KGGraphCanvas each
	// frame (KGGraph pattern, kept out of Svelte's proxy for the hot loop).
	let graphState = {
		hoveredNode: null as LayoutNode | null,
		selectedNode: null as LayoutNode | null,
		selectedEdge: null as LayoutEdge | null,
		tooltipPos: { x: 0, y: 0 },
		showTooltip: false,
		hiddenNodeCount: 0
	};

	// Canvas dimensions (managed by KGGraphCanvas, used by buildLayout)
	let canvasWidth = 800;
	let canvasHeight = 600;
	let kgCanvasRef: KGGraphCanvas;

	// Stale-fetch guard: only the latest request may commit its result.
	let fetchSeq = 0;

	// ─── Derived ──────────────────────────────────────────────────────────────

	let hasLayout = $derived(layoutNodes.length > 0);
	let zeroEdgeOverview = $derived(layoutNodes.length > 0 && layoutEdges.length === 0);
	let nodeCount = $derived(graphData?.nodes.length ?? 0);
	let edgeCount = $derived(graphData?.edges.length ?? 0);
	let truncated = $derived(graphData?.truncated ?? false);
	let stats = $derived(graphData?.stats ?? null);

	// ─── Layout ───────────────────────────────────────────────────────────────

	function getNodeByKey(key: string): LayoutNode | undefined {
		return layoutLookup.get(key);
	}

	// Maps are created INSIDE the helper and returned wholesale — the lookup is
	// rebuilt on data change, never mutated in place (KGGraph buildNodeLookup
	// pattern; per-line silences match KGGraph.svelte:114).
	function buildLookups(
		nodes: LayoutNode[],
		meta: CodeGraphNode[]
	): {
		layout: Map<string, LayoutNode>;
		meta: Map<string, CodeGraphNode>;
	} {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Lookups are rebuilt wholesale on data change, never mutated in place (KGGraph buildNodeLookup pattern).
		const layout = new Map<string, LayoutNode>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Lookups are rebuilt wholesale on data change, never mutated in place (KGGraph buildNodeLookup pattern).
		const metaMap = new Map<string, CodeGraphNode>();
		for (let i = 0; i < nodes.length; i++) {
			layout.set(nodes[i].id, nodes[i]);
			layout.set(nodes[i].name, nodes[i]);
			metaMap.set(meta[i].id, meta[i]);
			metaMap.set(meta[i].name, meta[i]);
		}
		return { layout, meta: metaMap };
	}

	function buildLayout(data: CodeGraphResult) {
		const nodes: LayoutNode[] = data.nodes.map((n) => ({
			id: n.id,
			name: n.name,
			type: n.kind,
			x: 0,
			y: 0,
			z: 0,
			vx: 0,
			vy: 0,
			pinned: false
		}));
		const edges: LayoutEdge[] = data.edges.map((e) => ({
			source: e.source,
			target: e.target,
			relation_type: e.relation_type
		}));

		// Zero-edge repo → deterministic grid overview; otherwise sphere layout.
		const laid =
			nodes.length > 0 && edges.length === 0
				? initializeZeroEdgeOverviewLayout(nodes, canvasWidth, canvasHeight)
				: initializeSphereLayout(nodes, edges, canvasWidth, canvasHeight);

		layoutNodes = laid;
		layoutEdges = edges;
		const lookups = buildLookups(laid, data.nodes);
		layoutLookup = lookups.layout;
		metaLookup = lookups.meta;
	}

	// ─── Fetch ────────────────────────────────────────────────────────────────

	async function loadGraph() {
		if (!repo) return;
		const seq = ++fetchSeq;
		loading = true;
		error = "";
		indexRequired = false;
		try {
			const data = await fetchCodebaseGraph(repo, graphKind ? { kind: graphKind } : undefined);
			if (seq !== fetchSeq) return;
			graphData = data;
			if (data.nodes.length > 0) {
				buildLayout(data);
			} else {
				// Server never returns an empty node set; degrade gracefully regardless.
				layoutNodes = [];
				layoutEdges = [];
				error = "No symbols found for this repository";
				indexRequired = true;
			}
		} catch (err) {
			if (seq !== fetchSeq) return;
			const msg = err instanceof Error ? err.message : "Failed to load code graph";
			error = msg;
			// 404 REPO_NOT_INDEXED message: `Repo "X" is not indexed — run index first`.
			indexRequired = /not indexed/i.test(msg);
			graphData = null;
			layoutNodes = [];
			layoutEdges = [];
		} finally {
			if (seq === fetchSeq) loading = false;
		}
	}

	// Reload when repo changes, when the canvas first becomes ready (real
	// dimensions), or when the kind filter changes (graphKind read in loadGraph).
	$effect(() => {
		if (repo && canvasReady) {
			void loadGraph();
		} else {
			layoutNodes = [];
			layoutEdges = [];
			graphData = null;
		}
	});

	function handleDetailEntityChange(name: string) {
		if (!name) return; // edge / background click — no delete ops in this graph.
		// Prefer the unique `sym-*` id of the just-selected node — KGGraphCanvas
		// sets selectedNode right before this callback, so it is exact even for
		// duplicate symbol names. Name fallback only when the id misses.
		const id = graphState.selectedNode?.id;
		const meta = (id && metaLookup.get(id)) ?? metaLookup.get(name);
		if (meta) onSymbolSelect?.(nodeToSymbol(meta));
	}

	// N3-accepted cast (CodebaseCallGraph.selectCaller): unknown kinds degrade.
	function nodeToSymbol(n: CodeGraphNode): CodeSymbol {
		return {
			name: n.name,
			kind: n.kind as CodeSymbol["kind"],
			filePath: n.filePath
		};
	}

	function handleCanvasResize(w: number, h: number) {
		canvasWidth = w;
		canvasHeight = h;
	}

	// ─── Kind filter (optional `kind` param — server re-ranks + re-caps) ──────
	const KIND_FILTERS: Array<{ value: CodeGraphKind | ""; label: string; title: string }> = [
		{ value: "", label: "All", title: "All reference kinds plus co-defined pairs" },
		{ value: "call", label: "Calls", title: "Only call references" },
		{ value: "import", label: "Imports", title: "Only import references" },
		{ value: "co_defined", label: "Co-defined", title: "Only symbols defined together in the same file" }
	];

	function setKindFilter(kind: CodeGraphKind | "") {
		if (kind === graphKind) return;
		graphKind = kind;
	}

	onDestroy(() => {
		stopNeuralAnimation();
	});
</script>

<div class="cg-panel">
	<!-- ─── Header: title (div.section-label — CodebasePage owns the tab h1, STD-002) + kind filter + controls ─── -->
	<div class="cg-toolbar">
		<div class="cg-toolbar-left">
			<div class="section-label cg-title">
				<Icon name="share-2" size={12} strokeWidth={1.75} />
				Code Graph
			</div>
			<div class="cg-kind-filter" role="group" aria-label="Filter graph edges by kind">
				{#each KIND_FILTERS as f (f.value)}
					<button
						class="cg-kind-chip"
						class:active={graphKind === f.value}
						onclick={() => setKindFilter(f.value)}
						aria-pressed={graphKind === f.value}
						title={f.title}
					>
						{f.label}
					</button>
				{/each}
			</div>
		</div>
		<div class="cg-toolbar-right">
			<div class="kg-zoom-controls">
				<button class="btn btn-ghost btn-sm cg-zoom-btn" onclick={() => kgCanvasRef?.handleZoomOut()} title="Zoom out">
					&#8722;
				</button>
				<button
					class="btn btn-ghost btn-sm cg-zoom-label"
					onclick={() => kgCanvasRef?.handleResetCamera()}
					title="Reset zoom"
				>
					Reset
				</button>
				<button class="btn btn-ghost btn-sm cg-zoom-btn" onclick={() => kgCanvasRef?.handleZoomIn()} title="Zoom in">
					<Icon name="plus" size={12} strokeWidth={2} />
				</button>
			</div>
			<button
				class="btn btn-ghost btn-sm"
				onclick={() => void loadGraph()}
				disabled={loading}
				title="Reload the code graph"
			>
				<Icon name="refresh-cw" size={12} strokeWidth={2} className={loading ? "animate-spin" : ""} />
				Refresh
			</button>
		</div>
	</div>

	<!-- Canvas + state overlays (canvas stays mounted to measure real dims before first fetch) -->
	<div class="cg-canvas-wrap" class:cgedge-hidden={!hasLayout}>
		<KGGraphCanvas
			{layoutNodes}
			{layoutEdges}
			{getNodeByKey}
			{graphState}
			isZeroEdgeOverview={zeroEdgeOverview}
			{nodeCount}
			onDetailEntityChange={handleDetailEntityChange}
			onResize={handleCanvasResize}
			on:ready={() => (canvasReady = true)}
			bind:this={kgCanvasRef}
		/>

		{#if !hasLayout}
			{#if loading}
				<div class="cg-overlay" aria-live="polite">
					<div
						class="animate-spin"
						style="width:26px;height:26px;border:3px solid var(--color-border);border-top-color:var(--color-primary);border-radius:50%;"
					></div>
					<span>Loading code graph...</span>
				</div>
			{:else if error}
				<div class="cg-overlay" role="status" aria-live="polite">
					<div class="cg-overlay-icon error">
						<Icon name="triangle-alert" size={22} strokeWidth={1.75} />
					</div>
					{#if indexRequired}
						<div class="cg-overlay-title">Index required — run codebase-index</div>
						<div class="cg-overlay-text">
							This repository has no indexed symbols to graph. Create an index to enable the code graph.
						</div>
					{:else}
						<div class="cg-overlay-title">Failed to load code graph</div>
						<div class="cg-overlay-text">{error}</div>
					{/if}
					<button class="btn btn-ghost btn-sm" onclick={() => void loadGraph()} disabled={loading}>
						<Icon name="refresh-cw" size={12} strokeWidth={2} />
						Retry
					</button>
				</div>
			{:else if nodeCount === 0}
				<div class="cg-overlay">
					<div class="cg-overlay-icon">
						<Icon name="share-2" size={22} strokeWidth={1.5} />
					</div>
					<div class="cg-overlay-title">No code graph data</div>
					<div class="cg-overlay-text">Run codebase-index to populate the symbol graph.</div>
				</div>
			{/if}
		{/if}
	</div>

	<!-- ─── Legend footer (node kind colors + edge kinds + stats) ─── -->
	<CodebaseGraphLegend {nodeCount} {edgeCount} {truncated} {stats} />
</div>

<style>
	.cg-panel {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: 14px;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.02);
		margin-top: 16px;
	}

	/* ── Toolbar ── */
	.cg-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		padding: 10px 14px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.04);
	}

	.cg-toolbar-left {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.cg-toolbar-right {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.cg-title {
		font-size: 0.68rem;
	}

	.cg-kind-filter {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.03);
	}

	.cg-kind-chip {
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.66rem;
		font-weight: 600;
		padding: 3px 10px;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.12s ease;
	}

	.cg-kind-chip:hover {
		color: var(--color-text);
		background: rgba(255, 255, 255, 0.06);
	}

	.cg-kind-chip.active {
		color: var(--color-primary);
		background: rgba(99, 102, 241, 0.12);
	}

	.kg-zoom-controls {
		display: inline-flex;
		align-items: center;
		gap: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.cg-zoom-btn {
		padding: 4px 6px !important;
		min-width: 26px;
		justify-content: center;
		border-radius: 0 !important;
		border-right: 1px solid var(--color-border);
	}

	.cg-zoom-label {
		padding: 4px 8px !important;
		min-width: 52px;
		justify-content: center;
		border-radius: 0 !important;
		font-size: 0.66rem;
		font-weight: 600;
		cursor: pointer;
	}

	/* ── Canvas ── */
	.cg-canvas-wrap {
		position: relative;
		height: 380px;
		min-height: 280px;
		overflow: hidden;
	}

	.cg-canvas-wrap.cgedge-hidden {
		/* Keep the wrap in flow so the canvas measures its real 380px box
		   before the first fetch (KGGraph's kg-hidden needs a fixed shell). */
		opacity: 0;
		pointer-events: none;
	}

	/* Canvas element lives inside KGGraphCanvas — scoped selectors can't reach
	   it, mirror the KGGraphShell :global() convention. */
	:global(.cg-canvas-wrap canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* ── State overlays ── */
	.cg-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		text-align: center;
		padding: 20px;
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-size: 0.82rem;
	}

	.cg-overlay-icon {
		display: inline-flex;
		width: 48px;
		height: 48px;
		border-radius: 14px;
		align-items: center;
		justify-content: center;
		color: var(--color-primary);
		background: rgba(99, 102, 241, 0.08);
		border: 1px solid rgba(99, 102, 241, 0.15);
	}

	.cg-overlay-icon.error {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.08);
		border-color: rgba(239, 68, 68, 0.18);
	}

	.cg-overlay-title {
		font-size: 0.95rem;
		font-weight: 800;
		color: var(--color-text);
	}

	.cg-overlay-text {
		font-size: 0.78rem;
		max-width: 420px;
		line-height: 1.5;
	}
</style>
