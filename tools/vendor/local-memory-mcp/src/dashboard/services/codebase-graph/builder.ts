import { db } from "../../lib/context";
import { ServiceError } from "../../lib/jsonApi";
import {
	CODE_GRAPH_DEFAULT_NODE_LIMIT,
	CODE_GRAPH_MAX_EDGES,
	CODE_GRAPH_MAX_NODES
} from "../../../mcp/utils/constants";
import type { CodebaseReference, CodebaseSymbol } from "../../../mcp/types";
import type { CodeGraphKind, CodeGraphNode, CodeGraphResult } from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// 3. CODE GRAPH (KGGraphCanvas-compatible nodes/edges)
// ═══════════════════════════════════════════════════════════════════════════

/** Valid `kind` values for GET /api/codebase/graph. */
export const CODE_GRAPH_KINDS: readonly CodeGraphKind[] = ["call", "import", "co_defined"];

/**
 * Build the aggregated code graph for a repo.
 *
 * Pipeline: verify indexed → resolve caller/target symbols for every
 * reference row → degree-rank symbols → select top-N → ship only edges whose
 * both endpoints are selected → cap edges (CODE_GRAPH_MAX_EDGES) with
 * combined-degree priority. Callers resolve by name; rows with caller_name
 * null (heritage extends/implements + module-scope imports — the TS emitter
 * hard-codes null there) resolve by SPAN: the innermost symbol containing
 * caller_line, else the file's first top-level symbol (TASK-374). `kind`
 * filters the edge families; absent means ALL reference kinds + co_defined.
 * Deterministic everywhere (file/line ordering, stable sorts,
 * insertion-ordered Maps).
 *
 * @throws ServiceError 404 REPO_NOT_INDEXED (no files) / 400 INVALID_GRAPH_KIND.
 */
export function buildCodeGraph(repo: string, rawLimit?: string, rawKind?: string): CodeGraphResult {
	if (db.codebaseFiles.getFileCountByRepo(repo) === 0) {
		throw new ServiceError(404, `Repo "${repo}" is not indexed — run index first`, "REPO_NOT_INDEXED");
	}

	const kind = normalizeGraphKind(rawKind);
	const nodeLimit = parseNodeLimit(rawLimit);

	const symbols = db.codebaseSymbols.getSymbolsByRepo(repo);
	const refs = db.codebaseReferences.getReferencesByRepo(repo);

	// Symbol indexes: by id (target_symbol_id resolution), by file+name
	// (caller_name / unresolved target resolution — the name-based model), and
	// by file (span-based caller resolution for caller_name-null rows —
	// heritage + module-scope imports, TASK-374).
	const byId = new Map<string, CodebaseSymbol>();
	const byFileAndName = new Map<string, CodebaseSymbol>();
	const byFile = new Map<string, CodebaseSymbol[]>();
	for (const sym of symbols) {
		byId.set(sym.id, sym);
		const key = `${sym.file_path}\u0000${sym.name}`;
		if (!byFileAndName.has(key)) byFileAndName.set(key, sym);
		const fileList = byFile.get(sym.file_path);
		if (fileList) fileList.push(sym);
		else byFile.set(sym.file_path, [sym]);
	}

	interface RawEdge {
		source: string;
		target: string;
		relation_type: string;
	}

	const refEdges: RawEdge[] = [];
	const coEdges: RawEdge[] = [];
	// Degree = count of in-scope edges touching each symbol (spec: "degree
	// from refs count" — co_defined edges only contribute in co_defined mode,
	// where they are the only signal available).
	const degree = new Map<string, number>();
	const bump = (id: string): void => {
		degree.set(id, (degree.get(id) ?? 0) + 1);
	};

	// ── Reference edges (call/instantiation/import/extends/implements) ──
	if (kind !== "co_defined") {
		for (const ref of refs) {
			if (kind === "call" && ref.kind !== "call") continue;
			if (kind === "import" && ref.kind !== "import") continue;

			// Caller by name when the emitter resolved one; by SPAN when
			// caller_name is null (heritage/module-scope import rows) — never
			// drop a heritage/import edge just because the parse had no name.
			const callerSym =
				ref.caller_name !== null
					? byFileAndName.get(`${ref.caller_file}\u0000${ref.caller_name}`)
					: resolveCallerBySpan(ref, byFile);
			if (!callerSym) continue;
			const targetSym = resolveTargetSymbol(ref, byId, byFileAndName);
			if (!targetSym || targetSym.id === callerSym.id) continue;

			refEdges.push({ source: callerSym.id, target: targetSym.id, relation_type: ref.kind });
			bump(callerSym.id);
			bump(targetSym.id);
		}
	}

	// ── co_defined edges (same-file consecutive symbols, unified-graph
	//    pattern :90-105) — deterministic via getSymbolsByRepo ordering ──
	if (kind !== "call" && kind !== "import") {
		const fileGroups = new Map<string, string[]>();
		for (const sym of symbols) {
			const ids = fileGroups.get(sym.file_path) ?? [];
			ids.push(sym.id);
			fileGroups.set(sym.file_path, ids);
		}
		for (const ids of fileGroups.values()) {
			for (let i = 1; i < ids.length; i++) {
				coEdges.push({ source: ids[i - 1], target: ids[i], relation_type: "co_defined" });
				if (kind === "co_defined") {
					bump(ids[i - 1]);
					bump(ids[i]);
				}
			}
		}
	}

	// ── Degree ranking + top-N node selection ───────────────────────────
	const symbolIndex = new Map<string, number>();
	symbols.forEach((sym, i) => symbolIndex.set(sym.id, i));
	const rankedIds: string[] =
		degree.size === 0
			? symbols.map((s) => s.id) // no refs/co signal → file-order fallback
			: [...degree.entries()]
					.sort((a, b) => b[1] - a[1] || (symbolIndex.get(a[0]) ?? 0) - (symbolIndex.get(b[0]) ?? 0))
					.map(([id]) => id);
	const selected = new Set(rankedIds.slice(0, nodeLimit));

	// ── Edge assembly: dedupe (site multiplicity ≠ graph multiplicity) → keep
	//    only edges between selected nodes → cap by combined-degree priority ──
	const deduped: RawEdge[] = [];
	{
		const seen = new Set<string>();
		const all =
			kind === "co_defined" ? coEdges : kind === "call" || kind === "import" ? refEdges : [...refEdges, ...coEdges];
		for (const edge of all) {
			const key = `${edge.source}\u0000${edge.target}\u0000${edge.relation_type}`;
			if (seen.has(key)) continue;
			seen.add(key);
			deduped.push(edge);
		}
	}

	const inScope = deduped.filter((e) => selected.has(e.source) && selected.has(e.target));
	const truncated = inScope.length > CODE_GRAPH_MAX_EDGES;
	const priority = (e: RawEdge): number => (degree.get(e.source) ?? 0) + (degree.get(e.target) ?? 0);
	const finalEdges: RawEdge[] = truncated
		? [...inScope].sort((a, b) => priority(b) - priority(a)).slice(0, CODE_GRAPH_MAX_EDGES)
		: inScope;

	const nodes: CodeGraphNode[] = rankedIds
		.filter((id) => selected.has(id))
		.map((id) => {
			const sym = byId.get(id);
			if (!sym) throw new ServiceError(500, `Selected symbol ${id} missing from index`, "GRAPH_ASSEMBLY");
			const deg = degree.get(id) ?? 0;
			return {
				id: `sym-${id}`,
				name: sym.name,
				kind: sym.kind,
				filePath: sym.file_path,
				size: 14 + Math.min(deg, 30),
				degree: deg
			};
		});

	return {
		id: `codebase-graph-${repo}`,
		nodes,
		edges: finalEdges.map((e) => ({
			source: `sym-${e.source}`,
			target: `sym-${e.target}`,
			relation_type: e.relation_type
		})),
		truncated,
		stats: { totalSymbols: symbols.length, totalRefs: refs.length, nodeLimit, edgeCap: CODE_GRAPH_MAX_EDGES }
	};
}

/**
 * Resolve a reference row to its target SYMBOL (the callee node):
 * target_symbol_id (exact, v23) → (target_file, symbol_name) → same-file
 * (symbol_name in caller_file, the v21 pre-target-file fallback). Returns
 * undefined when the target cannot be anchored to a real symbol — such rows
 * are dropped (an edge needs a real node at both ends, and a dangling name
 * points at a symbol that was never indexed into this repo's row set).
 */
function resolveTargetSymbol(
	ref: CodebaseReference,
	byId: Map<string, CodebaseSymbol>,
	byFileAndName: Map<string, CodebaseSymbol>
): CodebaseSymbol | undefined {
	if (ref.target_symbol_id) {
		const exact = byId.get(ref.target_symbol_id);
		if (exact) return exact;
	}
	if (ref.target_file) {
		const byPath = byFileAndName.get(`${ref.target_file}\u0000${ref.symbol_name}`);
		if (byPath) return byPath;
	}
	return byFileAndName.get(`${ref.caller_file}\u0000${ref.symbol_name}`);
}

/**
 * Resolve the caller symbol for a reference row whose caller_name is null.
 *
 * The TS emitter hard-codes callerName:null for ALL heritage rows
 * (extends/implements — ts-reference-emission.ts) and for module-scope import
 * rows (typescript-visitor.ts), so name-based lookup is impossible. Anchor by
 * SPAN instead: the innermost symbol in `ref.caller_file` whose
 * [start_line, end_line] contains `ref.caller_line`. When nothing contains
 * the line (or the line is unknown — e.g. a module-scope import sitting above
 * the first symbol's span), fall back to the file's first top-level symbol
 * (parent_symbol_id null), giving the edge a deterministic file-level anchor.
 * The row is only dropped when the caller file has NO symbols at all.
 *
 * Deterministic: innermost by span width, ties by earlier start then id;
 * top-level fallback by (start_line, start_col, id).
 */
function resolveCallerBySpan(
	ref: CodebaseReference,
	byFile: Map<string, CodebaseSymbol[]>
): CodebaseSymbol | undefined {
	const fileSymbols = byFile.get(ref.caller_file);
	if (!fileSymbols || fileSymbols.length === 0) return undefined;

	// Innermost symbol containing the call-site line (smallest span wins —
	// a nested class/method beats its enclosing class).
	let innermost: CodebaseSymbol | undefined;
	if (ref.caller_line !== null) {
		for (const sym of fileSymbols) {
			const start = sym.start_line ?? 0;
			const end = sym.end_line ?? start;
			if (ref.caller_line < start || ref.caller_line > end) continue;
			if (innermost && !isNarrower(sym, innermost)) continue;
			innermost = sym;
		}
	}
	if (innermost) return innermost;

	// Nothing contains the line (module-scope import above the first symbol):
	// anchor at the first top-level symbol of the caller file.
	let topLevel: CodebaseSymbol | undefined;
	for (const sym of fileSymbols) {
		if (sym.parent_symbol_id !== null) continue;
		if (topLevel && !isEarlier(sym, topLevel)) continue;
		topLevel = sym;
	}
	if (topLevel) return topLevel;
	// Defensive: file has symbols but none top-level — first in file order.
	return fileSymbols[0];
}

/** True when `a` is a strictly "narrower" (innermost) span than `b`; ties by earlier start, then id. */
function isNarrower(a: CodebaseSymbol, b: CodebaseSymbol): boolean {
	const aStart = a.start_line ?? 0;
	const bStart = b.start_line ?? 0;
	const aWidth = (a.end_line ?? aStart) - aStart;
	const bWidth = (b.end_line ?? bStart) - bStart;
	if (aWidth !== bWidth) return aWidth < bWidth;
	if (aStart !== bStart) return aStart < bStart;
	return a.id < b.id;
}

/** True when `a` precedes `b` in file order (start_line, start_col); ties by id. */
function isEarlier(a: CodebaseSymbol, b: CodebaseSymbol): boolean {
	if ((a.start_line ?? 0) !== (b.start_line ?? 0)) return (a.start_line ?? 0) < (b.start_line ?? 0);
	if ((a.start_col ?? 0) !== (b.start_col ?? 0)) return (a.start_col ?? 0) < (b.start_col ?? 0);
	return a.id < b.id;
}

/** Validate the `kind` query param; absent → all edge families. */
function normalizeGraphKind(raw: string | undefined): CodeGraphKind | undefined {
	if (raw === undefined || raw.trim() === "") return undefined;
	const k = raw.trim().toLowerCase();
	if ((CODE_GRAPH_KINDS as readonly string[]).includes(k)) return k as CodeGraphKind;
	throw new ServiceError(400, `kind must be one of: ${CODE_GRAPH_KINDS.join(", ")}`, "INVALID_GRAPH_KIND");
}

/** Clamp the `limit` (node count) param to [default, CODE_GRAPH_MAX_NODES]. */
function parseNodeLimit(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") return CODE_GRAPH_DEFAULT_NODE_LIMIT;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n <= 0) return CODE_GRAPH_DEFAULT_NODE_LIMIT;
	return Math.min(n, CODE_GRAPH_MAX_NODES);
}
