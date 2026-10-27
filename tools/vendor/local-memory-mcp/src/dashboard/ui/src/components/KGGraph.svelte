<script lang="ts">
	import { untrack } from "svelte";
	import { onMount, onDestroy } from "svelte";
	import { api } from "$lib/api";
	import Icon from "$lib/Icon.svelte";
	import type { KGNode, KGEdge } from "$lib/interfaces";
	import { kgGraphLimit, kgTotalItems } from "$lib/stores";
	import { createGraphLoader, MAX_GRAPH_LIMIT } from "$lib/kg/graphLoader";
	import { buildGraphLayout, buildNodeLookup, EMPTY_NODE_LOOKUP } from "$lib/kg/kgLayoutBuilder";
	import { stopNeuralAnimation } from "$lib/kg/KGNeuralRenderer";
	import type { LayoutNode, LayoutEdge } from "$lib/kg/KGForceLayout";
	import { handleGraphKeyDown } from "$lib/kg/kgKeyboardShortcuts";
	import KGGraphHeader from "./KGGraphHeader.svelte";
	import KGGraphShell from "./KGGraphShell.svelte";
	import KGGraphCanvas from "./KGGraphCanvas.svelte";
	import KGModal from "./KGModal.svelte";
	import KGEntityDrawer from "./KGEntityDrawer.svelte";

	export let repo: string;

	// ─── State ─────────────────────────────────────────────────────────────────
	let nodes: KGNode[] = [];
	let edges: KGEdge[] = [];
	let isLoading = true;
	let errorMsg = "";
	let loadedRepo = "";
	let isZeroEdgeOverview = false;
	let hiddenZeroEdgeNodeCount = 0;
	let truncated = false;

	// Default top-N-by-degree window before 'Show more' grows it (TASK-213).
	// Not a layout cap — initLayout renders the full fetched window up to
	// MAX_GRAPH_LIMIT (see TASK-214), so 'Show more' is a true superset.
	const INITIAL_GRAPH_LIMIT = 300;

	// Layout state
	let layoutNodes: LayoutNode[] = [];
	let layoutEdges: LayoutEdge[] = [];

	// O(1) node lookup map (rebuilt after layout init)
	let nodeLookup = new Map<string, LayoutNode>();

	function getNodeByKey(key: string): LayoutNode | undefined {
		return nodeLookup.get(key);
	}

	// Canvas dimensions (managed by KGGraphCanvas, used by initLayout)
	let canvasWidth = 800;
	let canvasHeight = 600;
	let canvasReady = false;

	// Interaction state (shared with KGGraphCanvas via reference)
	let graphState = {
		hoveredNode: null as LayoutNode | null,
		selectedNode: null as LayoutNode | null,
		selectedEdge: null as LayoutEdge | null,
		tooltipPos: { x: 0, y: 0 },
		showTooltip: false,
		hiddenNodeCount: 0
	};

	// Entity detail panel state (managed by KGEntityDrawer)
	let detailEntityName = "";

	// Tracked to sync zoom percent from canvas to header
	let zoomPercent = 100;

	// Modal state
	let showAddEntityModal = false;
	let showAddRelationModal = false;
	let showDeleteConfirm = false;
	type DeleteTarget = { type: "node"; name: string } | { type: "edge"; name: string; edge: LayoutEdge };
	let deleteTarget: DeleteTarget | null = null;

	// KGGraphCanvas component reference for exported functions
	let kgCanvasRef: KGGraphCanvas;

	// ─── Canvas callbacks ───────────────────────────────────────────────────────

	function handleCanvasReady() {
		canvasReady = true;
	}

	function handleCanvasResize(w: number, h: number) {
		canvasWidth = w;
		canvasHeight = h;
	}

	function handleDetailEntityChange(name: string) {
		detailEntityName = name;
	}

	function handleDeleteNodeRequest(name: string) {
		deleteTarget = { type: "node", name };
		showDeleteConfirm = true;
	}

	function handleDeleteEdgeRequest(source: string, target: string, relationType: string) {
		deleteTarget = {
			type: "edge",
			name: `${source} → ${target} (${relationType})`,
			edge: { source, target, relation_type: relationType }
		};
		showDeleteConfirm = true;
	}

	// ─── Helpers ────────────────────────────────────────────────────────────────

	// ─── Graph fetch orchestration (delegated to graphLoader, TASK-196) ───────
	// The edge cache, AbortController lifecycle, show-more debounce, and the
	// loadGraph/clearGraph/showMore flow live in $lib/kg/graphLoader.ts. This
	// component wires its view/layout state in via stores + callbacks.
	const graphLoader = createGraphLoader({
		repo: () => repo,
		getLoadedRepo: () => loadedRepo,
		setLoadedRepo: (r) => (loadedRepo = r),
		hasLayout: () => layoutNodes.length > 0,
		setNodes: (n) => (nodes = n),
		setEdges: (e) => (edges = e),
		setTruncated: (t) => (truncated = t),
		setLoading: (v) => (isLoading = v),
		setError: (m) => (errorMsg = m),
		onClear: () => {
			layoutNodes = [];
			layoutEdges = [];
			nodeLookup = EMPTY_NODE_LOOKUP;
			isZeroEdgeOverview = false;
			hiddenZeroEdgeNodeCount = 0;
			graphState.selectedNode = null;
			graphState.selectedEdge = null;
			graphState.hoveredNode = null;
			graphState.showTooltip = false;
			detailEntityName = "";
		},
		onDataReady: initLayout,
		graphLimit: kgGraphLimit,
		totalItems: kgTotalItems
	});

	function initLayout() {
		const result = buildGraphLayout(nodes, edges, canvasWidth, canvasHeight);
		layoutNodes = result.layoutNodes;
		layoutEdges = result.layoutEdges;
		isZeroEdgeOverview = result.isZeroEdgeOverview;
		hiddenZeroEdgeNodeCount = result.hiddenZeroEdgeNodeCount;
		nodeLookup = buildNodeLookup(layoutNodes);
	}

	// ─── Modal event handlers ──────────────────────────────────────────────────

	async function handleAddEntity(event: CustomEvent<{ name: string; type: string; description?: string }>) {
		const { name, type, description } = event.detail;
		try {
			await api.kgCreateEntity({ name, type, description, repo });
			showAddEntityModal = false;
			await graphLoader.loadGraph(true);
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to create entity";
		}
	}

	async function handleAddRelation(
		event: CustomEvent<{ from_entity: string; to_entity: string; relation_type: string }>
	) {
		const { from_entity, to_entity, relation_type } = event.detail;
		try {
			await api.kgCreateRelation({ from_entity, to_entity, relation_type, repo });
			showAddRelationModal = false;
			await graphLoader.loadGraph(true);
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to create relation";
		}
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		try {
			if (deleteTarget.type === "node") {
				await api.kgDeleteEntity(deleteTarget.name, repo);
			} else if (deleteTarget.type === "edge") {
				const e = deleteTarget.edge;
				await api.kgDeleteRelation({
					from_entity: e.source,
					to_entity: e.target,
					relation_type: e.relation_type,
					repo
				});
			}
			showDeleteConfirm = false;
			deleteTarget = null;
			graphState.selectedEdge = null;
			graphState.selectedNode = null;
			graphState.showTooltip = false;
			await graphLoader.loadGraph(true);
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : "Failed to delete";
		}
	}

	function cancelDelete() {
		showDeleteConfirm = false;
		deleteTarget = null;
	}

	// ─── Keyboard dismiss ──────────────────────────────────────────────────────

	function clearSelectionAndCloseAll() {
		graphState.showTooltip = false;
		graphState.selectedNode = null;
		graphState.selectedEdge = null;
		showDeleteConfirm = false;
		showAddEntityModal = false;
		showAddRelationModal = false;
		detailEntityName = "";
	}

	function onKeyDown(e: KeyboardEvent) {
		handleGraphKeyDown(e, { clearSelectionAndCloseAll });
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────────

	onMount(() => {
		// Canvas init is handled by KGGraphCanvas — it fires handleCanvasReady
	});

	onDestroy(() => {
		// Stop the neural renderer RAF loop when the KG tab unmounts
		// (TASK-189) — KGGraphCanvas also stops it, this is defense-in-depth.
		stopNeuralAnimation();
		// Cancel any in-flight kgGraph request and pending page navigation.
		graphLoader.dispose();
	});

	// Re-load when repo changes (guarded inside loadGraph against noop)
	$: if (repo && canvasReady && loadedRepo !== repo) {
		// Drop any pending debounced show-more — it belongs to the old repo.
		graphLoader.cancelPendingNavigation();
		// Reset the top-N window before loading a new repo so we don't carry
		// over a stale graphLimit (e.g. limit 900 of repo-A → repo-B starts
		// fresh at the default top-N window).
		kgGraphLimit.set(INITIAL_GRAPH_LIMIT);
		kgTotalItems.set(0);
		untrack(() => graphLoader.loadGraph());
	}

	function handleNavigateToEntity(name: string) {
		const foundNode = layoutNodes.find((n) => n.name === name);
		if (foundNode) {
			graphState.selectedNode = foundNode;
			detailEntityName = name;
		}
	}
</script>

<svelte:window on:keydown={onKeyDown} />

<KGGraphShell>
	<KGGraphHeader
		nodeCount={nodes.length}
		edgeCount={edges.length}
		{isLoading}
		{errorMsg}
		{isZeroEdgeOverview}
		visibleNodeCount={layoutNodes.length}
		hiddenNodeCount={hiddenZeroEdgeNodeCount}
		{zoomPercent}
		onAddEntity={() => (showAddEntityModal = true)}
		onAddRelation={() => (showAddRelationModal = true)}
		onRefresh={() => graphLoader.loadGraph(true)}
		onZoomIn={() => kgCanvasRef?.handleZoomIn()}
		onZoomOut={() => kgCanvasRef?.handleZoomOut()}
		onResetCamera={() => kgCanvasRef?.handleResetCamera()}
	/>

	<!-- Loading / Empty / Canvas -->
	{#if isLoading}
		<div class="kg-loading">
			<div
				class="animate-spin"
				style="width:24px;height:24px;border:3px solid var(--color-border);border-top-color:var(--color-primary);border-radius:50%;"
			></div>
			<span>Loading graph...</span>
		</div>
	{:else if layoutNodes.length === 0}
		<div class="kg-empty">
			<Icon name="share-2" size={32} strokeWidth={1.25} className="" />
			<div>No knowledge graph data found</div>
			<div class="text-xs" style="color:var(--color-text-muted);">Add entities and relations to build your graph.</div>
		</div>
	{/if}
	<div class="kg-canvas-wrap" class:kg-hidden={isLoading || layoutNodes.length === 0}>
		<KGGraphCanvas
			{layoutNodes}
			{layoutEdges}
			{getNodeByKey}
			{graphState}
			{isZeroEdgeOverview}
			nodeCount={nodes.length}
			onDetailEntityChange={handleDetailEntityChange}
			onDeleteNodeRequest={handleDeleteNodeRequest}
			onDeleteEdgeRequest={handleDeleteEdgeRequest}
			onResize={handleCanvasResize}
			onZoomPercentChange={(pct) => (zoomPercent = pct)}
			on:ready={handleCanvasReady}
			bind:this={kgCanvasRef}
		/>
		<KGEntityDrawer
			entityName={detailEntityName}
			{repo}
			onclose={() => {
				detailEntityName = "";
				graphState.selectedNode = null;
			}}
			onnavigate={handleNavigateToEntity}
		/>
	</div>

	<!-- Top-N window (TASK-213): top highest-degree nodes + progressive 'Show more' -->
	{#if $kgTotalItems > 0}
		{@const showMoreDisabled = $kgGraphLimit >= $kgTotalItems || $kgGraphLimit >= MAX_GRAPH_LIMIT}
		<div class="kg-pagination">
			<span class="kg-pagination-info">
				Top {$kgGraphLimit} of {$kgTotalItems} nodes
				{#if truncated}
					<span class="kg-truncated-badge" title="Edge list was truncated to the highest-degree edges">
						Edges truncated
					</span>
				{/if}
				{#if $kgGraphLimit > 600}
					<span class="kg-layout-note" title="The larger top-N window takes longer to lay out">
						Laying out {$kgGraphLimit} nodes…
					</span>
				{/if}
			</span>
			<button
				class="btn btn-ghost btn-sm"
				on:click={() => graphLoader.showMore()}
				disabled={showMoreDisabled}
				title="Load the next 300 highest-degree nodes (capped at 1000)"
			>
				Show more
			</button>
		</div>
	{/if}

	<!-- Modals -->
	<KGModal
		mode="addEntity"
		show={showAddEntityModal}
		on:addEntity={handleAddEntity}
		on:close={() => (showAddEntityModal = false)}
	/>

	<KGModal
		mode="addRelation"
		show={showAddRelationModal}
		entityNodes={layoutNodes}
		on:addRelation={handleAddRelation}
		on:close={() => (showAddRelationModal = false)}
	/>

	<KGModal
		mode="deleteConfirm"
		show={showDeleteConfirm}
		{deleteTarget}
		on:delete={handleDelete}
		on:close={cancelDelete}
	/>
</KGGraphShell>

<style>
	.kg-pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-top: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
	}

	:global(html.dark) .kg-pagination {
		background: rgba(0, 0, 0, 0.15);
	}

	.kg-pagination-info {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.kg-truncated-badge {
		display: inline-flex;
		align-items: center;
		margin-left: 8px;
		padding: 2px 6px;
		font-size: 0.65rem;
		font-weight: 500;
		color: var(--color-warning, #d97706);
		background: rgba(217, 119, 6, 0.1);
		border: 1px solid rgba(217, 119, 6, 0.2);
		border-radius: 4px;
		white-space: nowrap;
	}

	.kg-layout-note {
		display: inline-flex;
		align-items: center;
		margin-left: 8px;
		padding: 2px 6px;
		font-size: 0.65rem;
		font-weight: 500;
		color: var(--color-text-muted);
		background: rgba(128, 128, 128, 0.08);
		border: 1px solid rgba(128, 128, 128, 0.15);
		border-radius: 4px;
		white-space: nowrap;
	}
</style>
