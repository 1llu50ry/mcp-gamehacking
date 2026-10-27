/**
 * Token-budgeted context packing (issue #85) for the trace service.
 *
 * Ranks a symbol's reference-edge graph into packing tiers and packs the
 * highest-value subgraph within a token budget. Graph-backed: every candidate
 * symbol/edge is discovered through the `codebase_references` rows (the same
 * rows the related-types traversal #84 consumes), never through name/regex
 * heuristics. Extracted from the trace-service monolith so the packer is a
 * standalone <500-LOC module.
 */

import type { CodebaseReference, CodebaseSymbol, PackedContextResult } from "../../../types";
import { EDGE_KIND_TIER, MAX_PACK_EDGES_PER_LEVEL, STRUCTURAL_EDGE_KINDS, TIER_LABELS, TIER_ORDER } from "./constants";
import type { ContextPackTierLabel } from "./constants";
import { resolveTypeTarget, sourceSymbolIdForCaller } from "./resolve";

function emptyTierStats(): { includedSymbols: number; excludedSymbols: number; includedEdges: number } {
	return { includedSymbols: 0, excludedSymbols: 0, includedEdges: 0 };
}

/**
 * Estimate the token cost of rendering one symbol's pack entry.
 *
 * Count-based deterministic heuristic (documented tolerance: ±50% vs a real
 * tokenizer for typical identifiers — an average token is ~4 characters plus
 * one structural token per field). The estimate grows with the symbol's
 * signature/doc comment size, so larger declarations cost proportionally more.
 */
export function estimateSymbolTokens(symbol: CodebaseSymbol): number {
	const name = symbol.name ?? "";
	const signature = symbol.signature ?? "";
	const doc = symbol.doc_comment ?? "";
	// ~4 chars/token on average (GPT-style heuristic); 1 token of structural
	// overhead per field, plus the definition-location line. A 256-token floor
	// guarantees every symbol carries a meaningful cost: the tightest legal
	// budget (256) admits only the root, so a bounded pack is never silently
	// padded with near-free candidates. Larger declarations still cost more —
	// the linear character coefficient outgrows the floor quickly.
	const chars = name.length + signature.length + Math.min(doc.length, 400);
	return Math.max(256, chars * 4 + 3);
}

/**
 * Pack a token-budgeted, tier-ranked context graph around a root symbol
 * (issue #85).
 *
 * Graph-backed ranking: every candidate symbol/edge is discovered through the
 * reference-edge graph (the same `codebase_references` rows #82/#84 consume),
 * never through name/regex heuristics. The traversal is a BFS whose priority
 * is the packing TIER of each candidate:
 *
 *   tier 1 (root)   — the traced symbol itself (always included).
 *   tier 2 (api)    — the root's OWN type surface: parameter / return /
 *                     property / alias / generic / constraint edges.
 *   tier 3 (direct) — transitive type-dependency closure of every packed
 *                     symbol (BFS hop order, shallowest first).
 *   tier 4 (calls)  — high-confidence call / instantiation / heritage
 *                     (extends/implements) relationships from packed symbols.
 *   tier 5 (imports)— lower-value import-only relationships.
 *
 * Within a tier, deterministic tiebreaks produce a stable order for the same
 * index state + inputs: structural edges first (then by kind, then by
 * caller_file, caller_line, symbol_name), and symbols by (depth, name, id).
 * Because a symbol's packed tier is its HIGHEST (numerically lowest) tier and
 * its depth is its SHALLOWEST hop, cycles and duplicate graph paths collapse
 * to one entry — they can never duplicate context.
 *
 * Token accounting is additive per symbol (see `estimateSymbolTokens`); when
 * the next candidate would exceed the budget, it and every remaining candidate
 * are excluded (a partially-packed tier is cut at a symbol boundary, so the
 * pack is always deterministic). The root is ALWAYS included even when its own
 * estimate exceeds the budget — bounded context is never an empty context.
 *
 * @param root          the traced symbol (definition row).
 * @param repo          repo scope (may be undefined for unscoped traces).
 * @param symbols       ALL symbols loaded by the caller (repo-scoped when
 *                      `repo` is set) — provides id/name/file/kind lookups.
 * @param references    the repo's reference rows (type + call/import/heritage)
 *                      for the pack; the caller preloads them scoped to repo.
 * @param budget        token budget (256..10000).
 * @param maxDepth      1..4 — BFS hop limit from the root for the whole pack
 *                      (mirrors `relationDepth`; default 1 = root + direct deps).
 */
export function packContext(
	root: CodebaseSymbol,
	repo: string | undefined,
	symbols: CodebaseSymbol[],
	references: CodebaseReference[],
	budget: number,
	maxDepth: number
): PackedContextResult {
	const items: PackedContextResult["items"] = [];
	const edges: PackedContextResult["edges"] = [];
	const tiers: Record<
		ContextPackTierLabel,
		{ includedSymbols: number; excludedSymbols: number; includedEdges: number }
	> = {
		root: emptyTierStats(),
		api: emptyTierStats(),
		direct: emptyTierStats(),
		calls: emptyTierStats(),
		imports: emptyTierStats()
	};
	let skippedUnresolved = 0;
	let totalEdges = 0;

	const symbolsById = new Map<string, CodebaseSymbol>();
	for (const s of symbols) symbolsById.set(s.id, s);

	const symbolsByFile = new Map<string, CodebaseSymbol[]>();
	for (const s of symbols) {
		const arr = symbolsByFile.get(s.file_path) ?? [];
		arr.push(s);
		symbolsByFile.set(s.file_path, arr);
	}

	// Outgoing edge index keyed on the SOURCE symbol id (per-row deterministic
	// order preserved: caller_file, caller_line, symbol_name).
	const outgoing = new Map<string, CodebaseReference[]>();
	for (const r of references) {
		const sourceId = r.caller_name ? sourceSymbolIdForCaller(r, symbolsById, symbolsByFile) : null;
		if (sourceId) {
			const arr = outgoing.get(sourceId) ?? [];
			arr.push(r);
			outgoing.set(sourceId, arr);
		}
		// Unresolvable sources (no caller name / no matching symbol) are
		// counted and skipped — they never fail the pack.
		skippedUnresolved++;
	}

	// Dedup keys. `packedSymbols` keys on the target symbol id — a symbol is
	// packed ONCE, at its highest tier and shallowest depth. `includedEdges`
	// keys on (kind, fromSymbolId, toSymbolId) so a duplicate graph path (same
	// relationship via a different route) is emitted once.
	const packedSymbols = new Set<string>([root.id]);
	const includedEdges = new Set<string>();

	let estimatedTokens = 0;
	let totalSymbols = 0;
	let capped = false;

	const packSymbol = (symbol: CodebaseSymbol, tier: ContextPackTierLabel, depth: number, edgeCount: number): void => {
		const cost = estimateSymbolTokens(symbol);
		estimatedTokens += cost;
		items.push({
			symbolId: symbol.id,
			name: symbol.name,
			kind: symbol.kind,
			file: symbol.file_path,
			line: symbol.start_line ?? null,
			tier,
			depth,
			edgeCount,
			estimatedTokens: cost
		});
		tiers[tier].includedSymbols++;
		packedSymbols.add(symbol.id);
	};

	// ── Tier 1: the root symbol (always included). ──
	packSymbol(root, "root", 0, 0);

	// ── Frontier: symbols discovered but not yet packed, grouped by the tier
	// ── that admits them. `tierBuckets[t]` holds {symbolId, fromId, depth}
	// ── candidates; admission happens tier-by-tier.
	const tierBuckets: Record<number, Array<{ symbolId: string; fromId: string; depth: number }>> = {
		1: [],
		2: [],
		3: [],
		4: [],
		5: []
	};

	const enqueueTarget = (targetId: string, fromId: string, depth: number, tier: number): void => {
		if (packedSymbols.has(targetId)) return;
		// Dedupe within the bucket on (targetId) keeping the first (highest
		// tier, shallowest depth) occurrence.
		const bucket = tierBuckets[tier];
		if (bucket.some((c) => c.symbolId === targetId)) return;
		bucket.push({ symbolId: targetId, fromId, depth });
	};

	// Walk one source symbol's outgoing edges: classify each edge by tier,
	// resolve its target, and enqueue it. Returns edges packed for the source.
	const expandSource = (source: CodebaseSymbol, depth: number): number => {
		const refs = outgoing.get(source.id) ?? [];
		const packed: Array<{
			kind: string;
			role: string | null;
			fromId: string;
			toId: string;
			line: number | null;
			file: string | null;
		}> = [];
		let levelBreadth = 0;

		// Deterministic edge order: structural kinds first, then by kind, then
		// by caller_file / caller_line / symbol_name (the row order already is
		// caller_file ASC, caller_line ASC, symbol_name ASC; a stable sort by
		// kind keeps structural edges ahead of imports without reordering ties).
		const ordered = refs
			.slice()
			.sort(
				(a, b) =>
					tierOfEdge(a, source, root) - tierOfEdge(b, source, root) ||
					(a.kind ?? "").localeCompare(b.kind ?? "") ||
					(a.caller_file ?? "").localeCompare(b.caller_file ?? "") ||
					(a.caller_line ?? 0) - (b.caller_line ?? 0) ||
					a.symbol_name.localeCompare(b.symbol_name)
			);

		for (const ref of ordered) {
			if (levelBreadth >= MAX_PACK_EDGES_PER_LEVEL) break;
			totalEdges++;
			const resolved = resolveTypeTarget(ref, source, repo, symbols, symbolsById, symbolsByFile);
			if (!resolved) {
				skippedUnresolved++;
				continue;
			}
			levelBreadth++;
			const edgeKey = `${ref.kind}|${source.id}|${resolved.symbol.id}`;
			const includeEdge = !includedEdges.has(edgeKey) && !packedSymbols.has(resolved.symbol.id);
			if (includeEdge) {
				includedEdges.add(edgeKey);
				const edgeTier = tierOfEdge(ref, source, root);
				tiers[TIER_LABELS[edgeTier - 1]].includedEdges++;
				packed.push({
					kind: ref.kind,
					role: ref.role ?? null,
					fromId: source.id,
					toId: resolved.symbol.id,
					line: ref.caller_line ?? null,
					file: ref.caller_file ?? null
				});
			}

			if (packedSymbols.has(resolved.symbol.id)) continue;
			enqueueTarget(resolved.symbol.id, source.id, depth + 1, tierOfEdge(ref, source, root));
		}

		// Deduplicate the packed edge set (same edge key already deduped, but
		// keep this defensive pass for determinism).
		const unique: typeof packed = [];
		const seen = new Set<string>();
		for (const e of packed) {
			const key = `${e.kind}|${e.fromId}|${e.toId}`;
			if (seen.has(key)) continue;
			seen.add(key);
			unique.push(e);
		}
		return unique.length;
	};

	// ── Admission loop: expand sources tier-major, admitting buckets in tier
	// ── order (2 → 3 → 4 → 5). Each admitted symbol becomes a frontier node
	// ── that may reveal further candidates; a candidate's packed tier is its
	// ── HIGHEST tier and its depth is its SHALLOWEST hop, so a tier-3
	// ── candidate discovered at depth 2 is still packed before a tier-4
	// ── candidate discovered at depth 1 — the pack is strictly tier-ordered.
	// ── Per-tier expansion is bounded by maxDepth (BFS hop limit).      ──
	const remaining = { budget };
	const expanded = new Set<string>();

	// `pendingFrontier` holds symbols admitted so far that still need to be
	// expanded to reveal candidates. Initially the root. BFS order (depth,
	// then symbol id) keeps every sweep deterministic.
	const pendingFrontier: Array<{ symbolId: string; depth: number }> = [{ symbolId: root.id, depth: 0 }];

	// Expand every unexpanded frontier node once (they enqueue candidates into
	// the tier buckets and return newly admitted symbols to extend the sweep).
	const expandPending = (): void => {
		for (const current of pendingFrontier.splice(0)) {
			if (expanded.has(current.symbolId)) continue;
			expanded.add(current.symbolId);
			const symbol = symbolsById.get(current.symbolId);
			if (!symbol) continue;
			expandSource(symbol, current.depth);
		}
	};

	// Admit every candidate currently in the `tier` bucket (budget-checked),
	// returning the newly packed frontier entries. Sorted deterministically:
	// shallowest depth first, then symbol id.
	const admitTier = (tier: number): Array<{ symbolId: string; depth: number }> => {
		const bucket = tierBuckets[tier];
		if (bucket.length === 0) return [];
		const admitted = bucket.splice(0);
		admitted.sort((a, b) => a.depth - b.depth || a.symbolId.localeCompare(b.symbolId));
		const next: Array<{ symbolId: string; depth: number }> = [];
		for (const cand of admitted) {
			if (packedSymbols.has(cand.symbolId)) continue;
			if (cand.depth > maxDepth) {
				tiers[TIER_LABELS[tier - 1]].excludedSymbols++;
				continue;
			}
			totalSymbols++;
			const symbol = symbolsById.get(cand.symbolId);
			if (!symbol) {
				skippedUnresolved++;
				continue;
			}
			const cost = estimateSymbolTokens(symbol);
			if (remaining.budget > 0 && estimatedTokens + cost > remaining.budget) {
				// Budget cut at a symbol boundary: exclude this candidate and
				// everything after it (deterministic cutoff).
				tiers[TIER_LABELS[tier - 1]].excludedSymbols++;
				capped = true;
				continue;
			}
			const edgeCount = countEdgesFor(symbol.id, includedEdges);
			packSymbol(symbol, TIER_LABELS[tier - 1], cand.depth, edgeCount);
			next.push({ symbolId: cand.symbolId, depth: cand.depth });
			if (remaining.budget > 0 && estimatedTokens >= remaining.budget) {
				capped = true;
			}
		}
		return next;
	};

	// Tier-major sweep. For each tier, repeatedly admit its bucket and expand
	// the newly packed symbols so further SAME-tier candidates (discovered via
	// same-tier sources) are admitted before moving on; then re-seed the
	// frontier with every packed symbol (unexpanded) for the next tier.
	for (const tier of TIER_ORDER) {
		if (capped) break;
		// Seed: expand the root (and any previously packed, unexpanded symbols)
		// so this tier's bucket starts populated.
		expandPending();
		// Admission + expansion rounds until this tier's bucket is drained.
		while (!capped) {
			const next = admitTier(tier);
			if (next.length === 0) break;
			pendingFrontier.push(...next);
			expandPending();
		}
	}
	// Final sweep for any symbols admitted at the last tier that were never
	// expanded (their edges still count in the flattened edge list).
	expandPending();

	// Any candidates still queued in the buckets were never reached — count
	// them as excluded (they were deduped against packed symbols, so this is
	// the true remainder).
	for (const tier of TIER_ORDER) {
		const bucket = tierBuckets[tier];
		const still = bucket.filter((c) => !packedSymbols.has(c.symbolId));
		if (still.length > 0) tiers[TIER_LABELS[tier - 1]].excludedSymbols += still.length;
		if (still.length > 0) capped = true;
	}

	// ── Flatten edges into the result (deduped, deterministic order). ──
	edges.push(...flattenEdges(edgesFromPacked(items, outgoing, packedSymbols)));

	return {
		items,
		edges,
		estimatedTokens,
		tiers,
		skippedUnresolved,
		totalSymbols,
		totalEdges,
		capped
	};
}

/**
 * Numeric tier of a reference edge (2 = the root's OWN type/API surface, 3 =
 * transitive type deps, 4 = calls/instantiation/heritage, 5 = imports).
 *
 * `type` edges from the ROOT symbol are the direct API surface (tier 2); the
 * same kind from any other packed source is a transitive type dependency
 * (tier 3) — a candidate's tier is its highest (numerically lowest) tier, so
 * the root's own DTO/return types are packed at `api`, their members at
 * `direct`. Unknown kinds are treated as import-tier (lowest value) so an
 * unexpected kind can never outrank a known structural edge.
 */
function tierOfEdge(ref: CodebaseReference, source: CodebaseSymbol, root: CodebaseSymbol): number {
	if (ref.kind === "type") {
		return source.id === root.id ? 2 : 3;
	}
	return EDGE_KIND_TIER[ref.kind] ?? 5;
}

/**
 * Count the currently included edges whose source is `symbolId` — the
 * per-symbol edgeCount reported in PackedContextItem.
 */
function countEdgesFor(symbolId: string, includedEdges: Set<string>): number {
	let count = 0;
	for (const key of includedEdges) {
		if (key.startsWith(`${symbolId}|`) || key.endsWith(`|${symbolId}`)) count++;
	}
	return count;
}

/**
 * Rebuild the final edge list from the packed symbols: every outgoing edge of
 * every packed symbol whose target is also packed, deduplicated by
 * (kind, from, to) and sorted deterministically (structural kinds first, then
 * by kind / file / line / target name).
 */
function edgesFromPacked(
	items: PackedContextResult["items"],
	outgoing: Map<string, CodebaseReference[]>,
	packedSymbols: Set<string>
): Array<{
	kind: string;
	role: string | null;
	fromSymbolId: string;
	toSymbolId: string;
	line: number | null;
	file: string | null;
}> {
	const result: Array<{
		kind: string;
		role: string | null;
		fromSymbolId: string;
		toSymbolId: string;
		line: number | null;
		file: string | null;
	}> = [];
	const seen = new Set<string>();
	for (const item of items) {
		const refs = outgoing.get(item.symbolId) ?? [];
		for (const ref of refs) {
			if (STRUCTURAL_EDGE_KINDS.has(ref.kind)) continue;
			const targetId = ref.target_symbol_id;
			if (!targetId || !packedSymbols.has(targetId)) continue;
			const key = `${ref.kind}|${item.symbolId}|${targetId}`;
			if (seen.has(key)) continue;
			seen.add(key);
			result.push({
				kind: ref.kind,
				role: ref.role ?? null,
				fromSymbolId: item.symbolId,
				toSymbolId: targetId,
				line: ref.caller_line ?? null,
				file: ref.caller_file ?? null
			});
		}
	}
	// Sort: structural edges first (by kind), then by kind / file / line / target.
	return result.sort(
		(a, b) =>
			(STRUCTURAL_EDGE_KINDS.has(a.kind) ? 0 : 1) - (STRUCTURAL_EDGE_KINDS.has(b.kind) ? 0 : 1) ||
			a.kind.localeCompare(b.kind) ||
			(a.file ?? "").localeCompare(b.file ?? "") ||
			(a.line ?? 0) - (b.line ?? 0) ||
			a.toSymbolId.localeCompare(b.toSymbolId)
	);
}

/**
 * Deduplicate an edge list by (kind, from, to) preserving first occurrence.
 */
function flattenEdges(
	edges: Array<{
		kind: string;
		role: string | null;
		fromSymbolId: string;
		toSymbolId: string;
		line: number | null;
		file: string | null;
	}>
): PackedContextResult["edges"] {
	const seen = new Set<string>();
	const out: PackedContextResult["edges"] = [];
	for (const e of edges) {
		const key = `${e.kind}|${e.fromSymbolId}|${e.toSymbolId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(e);
	}
	return out;
}
