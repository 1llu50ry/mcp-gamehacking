/**
 * Codebase graph API module (TASK-329, P10-UI).
 *
 * GET /api/codebase/graph?repo=&limit=&kind= — served by
 * codebase-graph.service.ts buildCodeGraph (TASK-324, commit 5853182).
 *
 * Kept OUT of lib/api.ts on purpose: api.ts is TASK-328-owned (uncommitted WIP
 * in the working tree) and TASK-329 must not pollute that commit — this module
 * is the additive home for the graph types + fetch helper.
 *
 * Response shape (mirrors CodeGraphResult from codebase-graph.service.ts):
 *   nodes: { id: "sym-*", name, kind, filePath, size, degree }
 *   edges: { source: "sym-*", target: "sym-*", relation_type }
 *   relation_type: "call" | "instantiation" | "import" | "extends" |
 *                  "implements" | "co_defined"
 *
 * Errors: 404 REPO_NOT_INDEXED (repo has no files indexed), 400
 * INVALID_GRAPH_KIND (kind not in call|import|co_defined). The server caps
 * the payload server-side (CODE_GRAPH_MAX_NODES=240 / CODE_GRAPH_MAX_EDGES=400
 * — constants.ts), so `truncated` flags a trimmed edge list.
 *
 * Also hosts the legend vocabulary (CODEBASE_KIND_ORDER / EDGE_KIND_LABELS /
 * kindColor) — imported by both CodebaseGraphPanel and its CodebaseGraphLegend
 * child so the panel stays under the 500-line guideline (GQ2ACG, TASK-389).
 */

import { PALETTE, TYPE_COLOR_INDEX } from "./kg/kg-neural-renderer/layout";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Graph node in KGGraphCanvas-compatible shape (LayoutNode subset). */
export interface CodeGraphNode {
	/** `sym-${codebase_symbols.id}` — unique per symbol. */
	id: string;
	name: string;
	kind: string;
	filePath: string;
	/** Degree-scaled visual weight (14 + min(degree, 30)) — importance signal. */
	size: number;
	/** Reference/edge degree used for server-side ranking. */
	degree: number;
}

/** Graph edge in KGGraphCanvas-compatible shape (LayoutEdge subset). */
export interface CodeGraphEdge {
	source: string;
	target: string;
	/** 'call' | 'instantiation' | 'import' | 'extends' | 'implements' | 'co_defined'. */
	relation_type: string;
}

export type CodeGraphKind = "call" | "import" | "co_defined";

export interface CodeGraphStats {
	totalSymbols: number;
	totalRefs: number;
	nodeLimit: number;
	edgeCap: number;
}

export interface CodeGraphResult {
	/** `codebase-graph-${repo}`. */
	id: string;
	nodes: CodeGraphNode[];
	edges: CodeGraphEdge[];
	/** True when the edge list was trimmed to the server edge cap. */
	truncated: boolean;
	stats: CodeGraphStats;
}

// ─── Fetch helper ───────────────────────────────────────────────────────────
// Mirrors apiFetch's error surfacing (api.ts:23-33): throws Error(message) with
// the server's `err.error` text (e.g. "Repo "X" is not indexed — run index
// first" → surfaced as the index-required empty state).

export async function fetchCodebaseGraph(repo: string, opts?: { kind?: CodeGraphKind }): Promise<CodeGraphResult> {
	const q = new URLSearchParams({ repo });
	if (opts?.kind) q.set("kind", opts.kind);
	const res = await fetch(`/api/codebase/graph?${q}`);
	if (!res.ok) {
		const err: { error?: string; errors?: Array<{ detail?: string }> } = await res
			.json()
			.catch(() => ({ error: res.statusText }));
		throw new Error(err.error || err.errors?.[0]?.detail || `HTTP ${res.status}`);
	}
	return (await res.json()) as CodeGraphResult;
}

// ─── Legend vocabulary ───────────────────────────────────────────────────────
// Single source of truth for the code-graph legend: kind palette indices ARE
// the renderer's TYPE_COLOR_INDEX (kg-neural-renderer/layout.ts), so the legend
// dots and the canvas node colors always agree. Pure values/functions only.

/** Symbol kinds in legend display order (indexes the renderer palette). */
export const CODEBASE_KIND_ORDER = ["function", "class", "interface", "type", "enum", "variable"];

/** Human labels for the six codebase edge kinds (relation_type → label). */
export const EDGE_KIND_LABELS: Record<string, string> = {
	call: "Call",
	instantiation: "Instantiation",
	import: "Import",
	extends: "Extends",
	implements: "Implements",
	co_defined: "Co-defined"
};

/** Legend dot color for a symbol kind — palette index matches the canvas node
 *  color (TYPE_COLOR_INDEX; unknown kinds fall back to index 4 exactly like
 *  the renderer's getNodeColor, so legend and canvas always agree). */
export function kindColor(kind: string): string {
	const c = PALETTE[TYPE_COLOR_INDEX[kind] ?? 4];
	return `rgb(${c.r},${c.g},${c.b})`;
}
