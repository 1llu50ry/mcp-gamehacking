<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import { api, type CodeSymbol, type SymbolCallersResult } from "../lib/api";
	import {
		MAX_VISIBLE_CALLERS,
		LABEL_FONT,
		NODE_H,
		NODE_W,
		basename,
		callerXY,
		computeCallGraphLayout,
		displayName,
		edgeLabelText,
		edgeLabelWidth,
		edgeMid,
		edgePath,
		edgeSpread,
		kindColor,
		kindLabel,
		type CallerNode,
		type DagEdge
	} from "../lib/callGraphLayout";
	let {
		symbol = null,
		repo = "",
		onSymbolSelect = null
	}: {
		symbol: { name: string; kind: string; filePath?: string; line?: number } | null;
		repo: string;
		/** Open a caller node in the symbol detail view. */
		onSymbolSelect?: ((symbol: CodeSymbol) => void) | null;
	} = $props();

	// --- State (4-state: loading / error / empty / success) ---
	let data = $state<SymbolCallersResult | null>(null);
	let loading = $state(false);
	let error = $state("");
	let fetchSeq = 0;

	// --- Fetch callers when the symbol changes ---
	$effect(() => {
		const sym = symbol;
		if (!sym || !repo) {
			data = null;
			return;
		}
		void fetchCallers(sym);
	});

	async function fetchCallers(sym: { name: string; kind: string; filePath?: string; line?: number }): Promise<void> {
		const seq = ++fetchSeq;
		loading = true;
		error = "";
		data = null; // never show a stale graph for the previous symbol
		try {
			// filePath disambiguates duplicate names (TASK-373) — always sent.
			const result = await api.codebaseSymbolCallers(repo, sym.name, undefined, sym.filePath);
			if (seq !== fetchSeq) return;
			data = result;
		} catch (err) {
			if (seq !== fetchSeq) return;
			data = null;
			error = err instanceof Error ? err.message : "Failed to load callers";
		} finally {
			if (seq === fetchSeq) loading = false;
		}
	}

	// ── DAG model (grid/edge math + kind palette live in lib/callGraphLayout.ts)
	let callerNodes = $derived.by<CallerNode[]>(() => {
		if (!data) return [];
		return data.groupedByCaller.slice(0, MAX_VISIBLE_CALLERS).map((g) => ({
			key: `${g.caller.name ?? ""}\u0000${g.caller.filePath}`,
			name: g.caller.name,
			kind: g.caller.kind,
			filePath: g.caller.filePath,
			count: g.count
		}));
	});

	let hiddenCallers = $derived((data?.groupedByCaller.length ?? 0) - callerNodes.length);

	let dagEdges = $derived.by<DagEdge[]>(() => {
		if (!data) return [];
		const edges: DagEdge[] = [];
		for (const group of data.groupedByCaller) {
			const callerKey = `${group.caller.name ?? ""}\u0000${group.caller.filePath}`;
			// Skip callers beyond the visible cap (≤ MAX_VISIBLE_CALLERS).
			if (!callerNodes.some((n) => n.key === callerKey)) continue;
			// Aggregate pairs by kind: one edge per (caller, kind) with count.
			// Plain object (not Map) to satisfy svelte/prefer-svelte-reactivity.
			const byKind: Record<string, number> = {};
			for (const pair of group.pairs) {
				byKind[pair.kind] = (byKind[pair.kind] ?? 0) + 1;
			}
			for (const [kind, count] of Object.entries(byKind)) {
				edges.push({ callerKey, kind, count });
			}
		}
		return edges;
	});

	let layout = $derived(computeCallGraphLayout(callerNodes.length));

	// ── Node interaction ───────────────────────────────────────────────────
	function selectCaller(node: CallerNode) {
		if (!node.name || typeof onSymbolSelect !== "function") return;
		onSymbolSelect({
			name: node.name,
			kind: (node.kind ?? "variable") as CodeSymbol["kind"],
			filePath: node.filePath,
			line: undefined
		});
	}

	function handleNodeKeydown(e: KeyboardEvent, node: CallerNode) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			selectCaller(node);
		}
	}
</script>

<div class="cg-panel">
	{#if loading && !data}
		<!-- Loading skeleton -->
		<div class="cg-skeleton" aria-label="Loading call graph">
			{#each Array(5) as _, i (i)}
				<div class="cg-skeleton-line" style="width:{50 + ((i * 23) % 44)}%;"></div>
			{/each}
		</div>
	{:else if error}
		<!-- Error state -->
		<div class="cg-state">
			<Icon name="triangle-alert" size={14} strokeWidth={2} />
			<span class="cg-state-text">{error}</span>
			<button
				class="cg-retry-btn"
				onclick={() => symbol && void fetchCallers(symbol)}
				aria-label="Retry loading call graph"
			>
				<Icon name="refresh-cw" size={11} strokeWidth={2.5} />
			</button>
		</div>
	{:else if !data || data.total === 0}
		<!-- Empty state -->
		<div class="cg-empty">
			<Icon name="link" size={13} strokeWidth={1.75} />
			<span>No callers found{data ? ` for ${data.symbol.name}` : ""}.</span>
		</div>
	{:else}
		<!-- Header -->
		<div class="cg-header">
			<span class="cg-header-icon"><Icon name="columns" size={12} strokeWidth={1.75} /></span>
			<span class="cg-header-label">Callers</span>
			<span class="cg-header-count">{data.total} call site{data.total === 1 ? "" : "s"}</span>
			<span class="cg-header-sub" title="Caller/callee pairs for this symbol (call/import/extends/implements)">
				← incoming edges
			</span>
		</div>

		<!-- SVG DAG: callers → symbol. NOTE: no role="img" — that role flattens
		     all descendants (caller buttons) into one opaque image for AT. -->
		<svg
			class="cg-svg"
			viewBox="0 0 {layout.svgWidth} {layout.svgHeight}"
			width="100%"
			preserveAspectRatio="xMidYMid meet"
			aria-label="Call graph for {data.symbol.name}"
		>
			<defs>
				<marker
					id="cg-arrow"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<!-- Neutral arrowhead: attrs can't carry CSS var() — fixed slate for both themes. -->
					<path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.85)" />
				</marker>
			</defs>

			<!-- Edges -->
			{#each dagEdges as edge, edgeIdx (edgeIdx)}
				{@const callerIdx = callerNodes.findIndex((n) => n.key === edge.callerKey)}
				{#if callerIdx >= 0}
					{@const perCallerEdges = dagEdges.filter((e) => e.callerKey === edge.callerKey)}
					{@const edgeIdxInCaller = perCallerEdges.findIndex((e) => e === edge)}
					{@const spread = edgeSpread(callerIdx, edgeIdxInCaller, perCallerEdges.length)}
					{@const mid = edgeMid(layout, callerIdx, spread)}
					<path
						d={edgePath(layout, callerIdx, spread)}
						fill="none"
						style={kindColor(edge.kind) ? `stroke:${kindColor(edge.kind)};` : "stroke:var(--color-text-muted);"}
						stroke-width="1.25"
						opacity="0.75"
						marker-end="url(#cg-arrow)"
					>
						<title
							>{callerNodes[callerIdx].name ?? "(module scope)"} — {kindLabel(edge.kind)}{edge.count > 1
								? ` ×${edge.count}`
								: ""}</title
						>
					</path>
					<g class="cg-edge-label">
						<rect
							x={mid.x - edgeLabelWidth(edge) / 2}
							y={mid.y - 12}
							width={edgeLabelWidth(edge)}
							height="11"
							rx="5.5"
							style={kindColor(edge.kind) ? `fill:${kindColor(edge.kind)};` : "fill:var(--color-text-muted);"}
							opacity="0.16"
						/>
						<text
							x={mid.x}
							y={mid.y - 4}
							text-anchor="middle"
							font-size={LABEL_FONT}
							font-weight="700"
							style={kindColor(edge.kind) ? `fill:${kindColor(edge.kind)};` : "fill:var(--color-text-muted);"}
						>
							{edgeLabelText(edge)}
						</text>
					</g>
				{/if}
			{/each}

			<!-- Caller nodes -->
			{#each callerNodes as node, idx (node.key)}
				{@const pos = callerXY(idx)}
				{#if node.name}
					<g
						class="cg-node"
						role="button"
						tabindex="0"
						transform="translate({pos.x}, {pos.y})"
						aria-label="Open caller {node.name} in {node.filePath}"
						onclick={() => selectCaller(node)}
						onkeydown={(e) => handleNodeKeydown(e, node)}
					>
						<title
							>{node.name} — {node.kind ?? "symbol"} in {node.filePath}{node.count > 1
								? ` (${node.count} call sites)`
								: ""}</title
						>
						<rect
							width={NODE_W}
							height={NODE_H}
							rx="7"
							fill="rgba(255,255,255,0.05)"
							style="stroke:var(--color-border);"
							stroke-width="1"
						/>
						<text x="9" y="14" font-size={LABEL_FONT + 0.5} font-weight="700" style="fill:var(--color-text);"
							>{displayName(node)}</text
						>
						<text x="9" y="24" font-size="8" font-weight="600" style="fill:var(--color-text-muted);" opacity="0.7">
							{node.kind ?? "symbol"} · {node.count}
						</text>
					</g>
				{:else}
					<g transform="translate({pos.x}, {pos.y})" pointer-events="none">
						<rect
							width={NODE_W}
							height={NODE_H}
							rx="7"
							fill="rgba(255,255,255,0.02)"
							style="stroke:var(--color-border);"
							stroke-width="1"
							stroke-dasharray="4 3"
						/>
						<text
							x="9"
							y="14"
							font-size={LABEL_FONT + 0.5}
							font-weight="700"
							style="fill:var(--color-text-muted);"
							opacity="0.8">{displayName(node)}</text
						>
						<text x="9" y="24" font-size="8" font-weight="600" style="fill:var(--color-text-muted);" opacity="0.6"
							>module scope</text
						>
						<title>{basename(node.filePath)} — module-scope call site (no enclosing symbol)</title>
					</g>
				{/if}
			{/each}

			<!-- Target node (the queried symbol) -->
			<g transform="translate({layout.targetX}, {layout.targetY})" pointer-events="none">
				<rect
					width={NODE_W}
					height={NODE_H}
					rx="7"
					fill="rgba(99,102,241,0.14)"
					style="stroke:var(--color-primary);"
					stroke-width="1.25"
				/>
				<text x="9" y="14" font-size={LABEL_FONT + 0.5} font-weight="800" style="fill:var(--color-primary);">
					{data.symbol.name.length > 24 ? data.symbol.name.slice(0, 23) + "…" : data.symbol.name}
				</text>
				<text x="9" y="24" font-size="8" font-weight="600" style="fill:var(--color-primary);" opacity="0.75">
					{data.symbol.kind}
				</text>
				<title>{data.symbol.name} ({data.symbol.kind}) — {data.symbol.filePath}</title>
			</g>
		</svg>

		{#if hiddenCallers > 0}
			<div class="cg-more">+{hiddenCallers} more caller{hiddenCallers === 1 ? "" : "s"} hidden</div>
		{/if}

		<!-- Legend -->
		<div class="cg-legend" aria-label="Edge kind legend">
			{#each [...new Set(dagEdges.map((e) => e.kind))] as kind (kind)}
				<span class="cg-legend-item">
					<span
						class="cg-legend-dot"
						style={kindColor(kind) ? `background:${kindColor(kind)};` : "background:var(--color-text-muted);"}
					></span>
					{kindLabel(kind)}
				</span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.cg-panel {
		margin-bottom: 16px;
	}

	/* ── Skeleton ── */
	.cg-skeleton {
		padding: 4px 0;
	}

	.cg-skeleton-line {
		height: 10px;
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.05);
		margin-bottom: 6px;
		animation: cg-pulse 1.6s ease-in-out infinite;
	}

	@keyframes cg-pulse {
		0%,
		100% {
			opacity: 0.4;
		}
		50% {
			opacity: 1;
		}
	}

	/* ── Error / empty ── */
	.cg-state,
	.cg-empty {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		font-size: 0.72rem;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--color-border);
		border-radius: 8px;
	}

	.cg-state {
		color: rgba(239, 68, 68, 0.85);
	}

	.cg-state-text {
		flex: 1;
		min-width: 0;
	}

	.cg-retry-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		border: 1px solid rgba(239, 68, 68, 0.2);
		background: rgba(239, 68, 68, 0.08);
		color: rgba(239, 68, 68, 0.9);
		cursor: pointer;
		flex-shrink: 0;
		transition: all 0.15s ease;
	}

	.cg-retry-btn:hover {
		background: rgba(239, 68, 68, 0.15);
	}

	.cg-retry-btn:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	/* ── Header ── */
	.cg-header {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 8px;
	}

	.cg-header-icon {
		color: var(--color-primary);
		opacity: 0.85;
	}

	.cg-header-label {
		font-size: 0.66rem;
		font-weight: 700;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.cg-header-count {
		font-size: 0.56rem;
		font-weight: 600;
		background: rgba(255, 255, 255, 0.06);
		padding: 1px 5px;
		border-radius: 4px;
	}

	.cg-header-sub {
		font-size: 0.6rem;
		color: var(--color-text-muted);
		opacity: 0.6;
		margin-left: auto;
	}

	/* ── SVG ── */
	.cg-svg {
		display: block;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.02);
	}

	.cg-node {
		cursor: pointer;
		transition: opacity 0.12s ease;
	}

	.cg-node:hover {
		opacity: 0.92;
	}

	.cg-node:focus {
		outline: none;
	}

	.cg-node:focus rect {
		stroke: var(--color-primary);
		stroke-width: 1.75;
	}

	.cg-more {
		margin-top: 6px;
		font-size: 0.62rem;
		font-weight: 600;
		color: var(--color-text-muted);
		opacity: 0.75;
	}

	/* ── Legend ── */
	.cg-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 8px;
	}

	.cg-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 0.62rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.cg-legend-dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		flex-shrink: 0;
	}
</style>
