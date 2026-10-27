import type { CodebaseReadInput } from "../schemas/codebase-read";
import { SQLiteStore } from "../../storage/sqlite";
import type { CodebaseSymbol, CodebaseReference, RelatedTypeEdge, PackedContextResult } from "../../types";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import {
	traceSymbol,
	AmbiguousSymbolError,
	collectRelatedTypes,
	packContext,
	type TraceReference
} from "../../codebase-index/services/trace-service";
import { formatDocComment } from "../../utils/doc-comment-format";
import { logger } from "../../utils/logger";
import { buildApiSurface, formatApiSurface, type ApiSurface } from "./api-surface";

// ── TRACE ────────────────────────────────────────────────────────────────

/**
 * Map a stored codebase_references row to a TraceReference (the trace-service
 * input contract), building the human-readable context line.
 *
 * Import metadata (v27, issue #83) is surfaced: for an aliased import the
 * context shows `import <imported> as <local> from '<specifier>'` and the
 * canonical target fields (targetFile/targetSymbolId) ride along on the
 * reference.
 */
export function storedReferenceToTraceReference(r: CodebaseReference): TraceReference {
	const importNote = r.import_kind ? ` (${r.import_kind}${r.local_name ? `, local=${r.local_name}` : ""})` : "";
	const context = `${r.kind} ${r.symbol_name}${importNote}${r.role ? ` (${r.role})` : ""}${
		r.module_specifier ? ` from '${r.module_specifier}'` : ""
	}${r.caller_name ? ` (in ${r.caller_name})` : ""}`;
	return {
		filePath: r.caller_file,
		startLine: r.caller_line ?? 0,
		startCol: 0,
		endLine: r.caller_line ?? 0,
		endCol: 0,
		context,
		kind: r.kind,
		callerName: r.caller_name,
		targetFile: r.target_file,
		targetSymbolId: r.target_symbol_id,
		role: r.role ?? null,
		localName: r.local_name ?? null,
		importedName: r.imported_name ?? null,
		moduleSpecifier: r.module_specifier ?? null,
		importKind: r.import_kind ?? null
	};
}

/**
 * Render the related-types edge set as an indented tree (issue #84).
 *
 * Edges arrive as a flat BFS hop list; the tree groups them by their
 * `fromSymbolId` source so each level is nested under its parent's line,
 * mirroring the issue's example:
 *
 *   createOrder
 *   ├─ parameter → CreateOrderDto
 *   │  └─ property → CreateOrderItemDto
 *   └─ return → OrderResponseDto
 *
 * Cycles/repeated targets are already deduplicated by the traversal (a target
 * appears once, at its shallowest depth), so the tree is acyclic by
 * construction. Hops past depth 1 carry a `[d=N]` suffix so transitive
 * chains stay readable without trusting indentation alone.
 */
export function formatRelatedTypeTree(rootName: string, edges: RelatedTypeEdge[]): string {
	if (edges.length === 0) return rootName;
	const bySource = new Map<string, RelatedTypeEdge[]>();
	for (const e of edges) {
		const arr = bySource.get(e.fromSymbolId) ?? [];
		arr.push(e);
		bySource.set(e.fromSymbolId, arr);
	}
	const lines: string[] = [rootName];

	// Defensive cycle guard: even though the traversal dedupes targets (each
	// symbol appears at most once, at its shallowest depth — and the root is
	// pre-registered as reported), track rendered targets so a malformed or
	// future edge set can never recurse infinitely on a bySource cycle.
	const rendered = new Set<string>();

	// Recursively render the edge forest: each edge's line is nested under its
	// source's line, and its own children (edges whose fromSymbolId is this
	// edge's target) are nested one level deeper. `prefix` carries the trunk
	// continuation ("│  ") vs blank ("   ") for the parent's sibling position.
	const renderEdge = (e: RelatedTypeEdge, prefix: string, isLast: boolean): void => {
		const branch = isLast ? "└─" : "├─";
		const depthNote = e.depth > 1 ? ` [d=${e.depth}]` : "";
		lines.push(`${prefix}${branch} ${e.role ?? "type"} → ${e.targetName}${depthNote}`);
		if (rendered.has(e.targetSymbolId)) return;
		rendered.add(e.targetSymbolId);
		const children = bySource.get(e.targetSymbolId) ?? [];
		const childPrefix = prefix + (isLast ? "   " : "│  ");
		children.forEach((c, j) => renderEdge(c, childPrefix, j === children.length - 1));
	};

	const firstLevel = edges.filter((e) => e.depth === 1);
	firstLevel.forEach((e, i) => renderEdge(e, "", i === firstLevel.length - 1));

	return lines.join("\n");
}

/**
 * Render a token-budgeted context pack (issue #85) as compact Markdown.
 *
 * Items are already tier-ranked (root first) with per-item tier/edgeCount and
 * a total estimated-token figure; this surfaces the pack + its accounting so
 * the agent sees exactly what was included, what was cut, and why.
 */
export function formatContextPack(pack: PackedContextResult): string {
	const header = `### Context Pack\n\nEstimated: ${pack.estimatedTokens} tokens (count-based heuristic, ±50% — not a tokenizer measurement)\n${
		pack.capped ? "**Budget reached — some reachable symbols excluded.**\n" : ""
	}`;
	const lines: string[] = [header];
	if (pack.items.length === 0) {
		lines.push("No symbols packed.");
	} else {
		for (const it of pack.items) {
			const roleNote =
				it.tier === "root" ? "" : ` [${it.tier}, d=${it.depth}, ${it.edgeCount} edge${it.edgeCount === 1 ? "" : "s"}]`;
			lines.push(`- ${it.name} (${it.kind ?? "?"}) — ${it.file}:${it.line ?? "?"}${roleNote}`);
		}
	}
	lines.push(
		`Tiers: ${(["root", "api", "direct", "calls", "imports"] as const)
			.map(
				(t) =>
					`${t}=${pack.tiers[t].includedSymbols} in/+${pack.tiers[t].includedEdges} edges${
						pack.tiers[t].excludedSymbols > 0 ? `/-${pack.tiers[t].excludedSymbols} cut` : ""
					}`
			)
			.join(", ")}`
	);
	if (pack.skippedUnresolved > 0)
		lines.push(`(${pack.skippedUnresolved} unresolved reference${pack.skippedUnresolved > 1 ? "s" : ""} skipped)`);
	return lines.join("\n");
}

async function handleTraceMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const name = validated.name!.trim();
	const repo = validated.repo?.trim();

	const allSymbols: CodebaseSymbol[] = repo
		? db.codebaseSymbols.getSymbolsByRepo(repo)
		: db.codebaseSymbols.getAllSymbols();

	const symbols = allSymbols.length > 0 ? allSymbols : [];

	// Preload 'type' reference rows ONCE per TRACE request (issue #84) — the
	// related-type traversal reuses this set across every name variant and
	// depth expansion, avoiding a per-hop DB query. When a contextBudget is set
	// (issue #85) the packer ALSO needs call/instantiation/import/heritage rows,
	// so preload the repo's full reference set in that case.
	const typeRefs: CodebaseReference[] =
		validated.includeRelatedTypes && repo ? db.codebaseReferences.getReferencesByRepo(repo, ["type"]) : [];

	const allRefs: CodebaseReference[] =
		validated.contextBudget != null && repo ? db.codebaseReferences.getReferencesByRepo(repo) : [];

	// Heritage edges (extends/implements) for the API surface view (issue #86):
	// resolved once per TRACE request so inherited public members can be folded
	// into the surface without a per-base-class DB round-trip. Only loaded when
	// view:'api' is requested, so the legacy TRACE path is untouched.
	const heritageRefs: CodebaseReference[] =
		validated.view === "api" && repo ? db.codebaseReferences.getReferencesByRepo(repo, ["extends", "implements"]) : [];

	function tryTrace(traceName: string): McpResponse | null {
		try {
			// Table-backed reference edges for the exact symbol (TASK-236 / #64;
			// Phase 1.1 heritage kinds + target fields v23 / TASK-299). TRACE
			// mode requires a concrete repo, so this is always scoped. Reflected
			// into TraceReference for the trace result; the service merges them
			// with the in-memory doc_comment scan and dedupes by call-site line.
			const storedRefs: TraceReference[] =
				validated.includeReferences && repo
					? db.codebaseReferences.getReferencesBySymbol(repo, traceName).map(storedReferenceToTraceReference)
					: [];

			const result = traceSymbol(traceName, repo, symbols, validated.includeReferences, storedRefs);

			const refList =
				result.references.length > 0
					? `\n\n### References (${result.references.length})\n\n${result.references
							.slice(0, 20)
							.map((r) => `- ${r.filePath}:${r.startLine}-${r.endLine}`)
							.join("\n")}${result.references.length > 20 ? `\n... and ${result.references.length - 20} more` : ""}`
					: "";

			// Hierarchy surface (TASK-300): parent container + direct children of
			// the traced symbol, populated from parent_symbol_id links at index time.
			const hierarchy =
				result.parent || result.children.length > 0
					? `\n\n### Hierarchy\n\n${result.parent ? `Parent: ${result.parent.name} (${result.parent.kind}) — ${result.parent.filePath}:${result.parent.line ?? "?"}` : "Parent: none (top-level)"}\nChildren (${result.children.length}):\n${result.children
							.slice(0, 20)
							.map((c) => `- ${c.name} (${c.kind}) — ${c.file_path}:${c.start_line ?? "?"}`)
							.join("\n")}${result.children.length > 20 ? `\n... and ${result.children.length - 20} more` : ""}`
					: "";

			// Related-types surface (issue #84): bounded BFS over 'type' edges
			// when includeRelatedTypes is set. Pure additive — the legacy TRACE
			// response shape is untouched when the flag is omitted.
			const relatedTypes =
				validated.includeRelatedTypes && repo
					? collectRelatedTypes(result.symbol, repo, symbols, typeRefs, validated.relationDepth ?? 1)
					: null;

			const relatedList = relatedTypes
				? `\n\n### Related Types\n\n${relatedTypes.edges.length > 0 ? formatRelatedTypeTree(result.symbol.name, relatedTypes.edges) : "None found"}${relatedTypes.skippedUnresolved > 0 ? `\n\n(${relatedTypes.skippedUnresolved} unresolved type edge${relatedTypes.skippedUnresolved > 1 ? "s" : ""} skipped)` : ""}`
				: "";

			// Token-budgeted context pack (issue #85): when a contextBudget is
			// set, TRACE returns a bounded, tier-ranked graph pack instead of the
			// unbounded related-type / reference surface. It combines with
			// includeRelatedTypes + relationDepth (the pack reuses the same 'type'
			// edges plus call/instantiation/import/heritage edges for tiers 4/5).
			const contextPack: PackedContextResult | null =
				validated.contextBudget != null && repo
					? packContext(result.symbol, repo, symbols, allRefs, validated.contextBudget, validated.relationDepth ?? 1)
					: null;

			const packList = contextPack ? `\n\n${formatContextPack(contextPack)}` : "";

			const docPart = (() => {
				const d = formatDocComment(result.symbol.doc_comment);
				return d ? `\nDoc: ${d}` : "";
			})();

			// Compact public API surface view (issue #86): bounded, deterministic
			// contract of the traced container's public members. Pure additive —
			// the legacy TRACE response shape is untouched when view:'api' is
			// omitted. When set, the surface is computed and appended to both the
			// text body and the JSON envelope (navigable metadata preserved).
			const apiSurface: ApiSurface | null =
				validated.view === "api" ? buildApiSurface(result.symbol, result.children, symbols, heritageRefs) : null;

			const apiPart = apiSurface ? `\n\n### API Surface\n\n\`\`\`\n${formatApiSurface(apiSurface)}\n\`\`\`` : "";

			// Opt-in semantic signature (issue #89, TASK-015): when includeSemantic
			// is set and the traced symbol carries an inferred signature, surface it
			// in a dedicated section. Purely additive — the legacy TRACE text body
			// is untouched when the flag is omitted. The JSON envelope already
			// carries `result.symbol.semantic_signature` et al.
			const semanticPart =
				validated.includeSemantic && result.symbol.semantic_signature
					? `\n\n### Semantic\n\n\`\`\`\n${result.symbol.semantic_signature}\n\`\`\`${
							result.symbol.semantic_source ? ` (source: ${result.symbol.semantic_source})` : ""
						}`
					: "";

			const contentSummary = `Symbol "${traceName}"\nDefined: ${result.definition.file}:${result.definition.line}-${result.definition.endLine}${docPart}${apiPart}${refList}${hierarchy}${relatedList}${packList}${semanticPart}`;

			return createMcpResponse(
				{
					...result,
					schema: "codebase-read",
					mode: "trace",
					originalName: traceName !== name ? name : undefined,
					relatedTypes: relatedTypes ? relatedTypes.edges : undefined,
					relatedTypesSkippedUnresolved: relatedTypes?.skippedUnresolved,
					contextPack: contextPack ?? undefined,
					apiSurface: apiSurface ?? undefined,
					semantic:
						validated.includeSemantic && result.symbol.semantic_signature
							? {
									signature: result.symbol.semantic_signature,
									source: result.symbol.semantic_source ?? null,
									updatedAt: result.symbol.semantic_updated_at ?? null
								}
							: undefined
				},
				`Symbol "${traceName}": defined in ${result.definition.file}:${result.definition.line}, ` +
					`${result.references.length} references, ` +
					`${result.parent ? `parent ${result.parent.name}, ` : ""}${result.children.length} children found` +
					(relatedTypes
						? `, ${relatedTypes.edges.length} related type${relatedTypes.edges.length === 1 ? "" : "s"}`
						: "") +
					(contextPack
						? `, ${contextPack.items.length} symbols packed (~${contextPack.estimatedTokens} est. tokens, ${contextPack.capped ? "budget reached" : "within budget"})`
						: ""),
				{ includeJson: validated.json, contentSummary }
			);
		} catch (err) {
			// Re-throw ambiguous errors — they should propagate, not fall through
			if (err instanceof AmbiguousSymbolError) throw err;
			return null;
		}
	}

	function camelCaseFromHyphens(s: string): string {
		return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
	}

	// Try exact name first, then fallback variants
	const nameVariants = [name];

	// Variant 1: hyphens → dots (e.g., memory-write → memory.write)
	if (name.includes("-")) {
		nameVariants.push(name.replace(/-/g, "."));
	}

	// Variant 2: hyphens → camelCase (e.g., memory-write → memoryWrite)
	if (name.includes("-")) {
		nameVariants.push(camelCaseFromHyphens(name));
	}

	// Variant 3: dots → hyphens (e.g., memory.write → memory-write)
	if (name.includes(".")) {
		nameVariants.push(name.replace(/\./g, "-"));
	}

	// Variant 4: underscores → hyphens
	if (name.includes("_")) {
		nameVariants.push(name.replace(/_/g, "-"));
	}

	// Deduplicate
	const seen = new Set<string>();
	const uniqueVariants: string[] = [];
	for (const v of nameVariants) {
		if (!seen.has(v)) {
			seen.add(v);
			uniqueVariants.push(v);
		}
	}

	try {
		for (const v of uniqueVariants) {
			const result = tryTrace(v);
			if (result) return result;
		}
	} catch (err) {
		if (err instanceof AmbiguousSymbolError) {
			return createMcpErrorResponse({
				code: "AMBIGUOUS_SYMBOL",
				message: err.message,
				retryable: false,
				details: {
					disambiguation: err.disambiguation.map((s) => ({
						name: s.name,
						kind: s.kind,
						file: s.file_path,
						line: s.start_line,
						exported: s.exported
					}))
				}
			});
		}
		const message = err instanceof Error ? err.message : String(err);
		logger.error("[handleCodebaseRead:trace] Unexpected error", { name, repo, error: message });
		return createMcpErrorResponse({ code: "TRACE_FAILED", message: "Symbol trace failed", retryable: true });
	}

	// All variants failed — return SymbolNotFoundError for the original name
	return createMcpErrorResponse({
		code: "SYMBOL_NOT_FOUND",
		message: `Symbol "${name}" not found`,
		retryable: false
	});
}

export { handleTraceMode };
