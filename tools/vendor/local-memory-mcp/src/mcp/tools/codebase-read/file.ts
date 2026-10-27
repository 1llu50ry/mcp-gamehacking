import type { CodebaseReadInput } from "../schemas/codebase-read";
import { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import { docSuffix } from "../../utils/doc-comment-format";
import type { CodebaseSymbol, CodebaseReference, RelatedTypeEdge, PackedContextResult } from "../../types";
import type { TraceReference } from "../../codebase-index/services/trace-service";
import { collectRelatedTypes, packContext } from "../../codebase-index/services/trace-service";
import { storedReferenceToTraceReference, formatRelatedTypeTree, formatContextPack } from "./trace";

// ── FILE SYMBOLS ─────────────────────────────────────────────────────────

/**
 * 1-based inclusive line range for FILE mode (issue #88 / TASK-014).
 */
interface FileRange {
	startLine: number;
	endLine: number;
}

/**
 * Does a symbol's line span intersect the requested range? A single-line
 * symbol uses its `start_line` as both bounds; a symbol with a null `end_line`
 * is treated as spanning just its `start_line`. Intersection (not strict
 * enclosure) is the right primitive here: a range inside a method intersects
 * the method's span AND the enclosing class's span, so both become primary
 * context exactly as the task prescribes ("overlapping OR enclosing").
 */
function symbolOverlapsRange(symbol: CodebaseSymbol, range: FileRange): boolean {
	const start = symbol.start_line ?? 0;
	const end = symbol.end_line ?? symbol.start_line ?? 0;
	return start <= range.endLine && end >= range.startLine;
}

/** Does a symbol's line span contain a single line (innermost-first helper)? */
function symbolEnclosesLine(symbol: CodebaseSymbol, line: number): boolean {
	const start = symbol.start_line ?? 0;
	const end = symbol.end_line ?? symbol.start_line ?? 0;
	return start <= line && end >= line;
}

/**
 * Resolve the symbol that EMITTED a reference row: the symbol whose body holds
 * the call / heritage site.
 *
 * Source resolution prefers the row's `caller_name` + `caller_file` (the same
 * name+file model the trace service uses), then falls back to the innermost
 * symbol whose span contains the `caller_line` — necessary for rows whose
 * `caller_name` is null (top-level heritage/import edges). Returns null when
 * neither resolves within the file.
 */
function refEmittingSymbol(ref: CodebaseReference, fileSymbols: CodebaseSymbol[]): CodebaseSymbol | null {
	if (ref.caller_name && ref.caller_file) {
		const byName = fileSymbols.find((s) => s.name === ref.caller_name && s.file_path === ref.caller_file);
		if (byName) return byName;
	}
	if (ref.caller_line != null) {
		// Innermost-first: the containing symbol with the smallest span wins.
		const containing = fileSymbols
			.filter((s) => symbolEnclosesLine(s, ref.caller_line!))
			.sort((a, b) => (a.end_line ?? a.start_line ?? 0) - (b.end_line ?? b.start_line ?? 0));
		return containing[0] ?? null;
	}
	return null;
}

/**
 * Emitter set = every primary symbol plus all of its descendants (via the
 * `parent_symbol_id` chain at index time). References emitted by a nested
 * member (e.g. a call inside a method inside the class) resolve to the method,
 * so the method must count as an emitter even though only the class is listed
 * as primary — otherwise the call would be wrongly dropped.
 */
function buildEmitterSet(primarySymbols: CodebaseSymbol[], fileSymbols: CodebaseSymbol[]): Set<string> {
	const childrenOf = new Map<string, string[]>();
	for (const s of fileSymbols) {
		if (!s.parent_symbol_id) continue;
		const arr = childrenOf.get(s.parent_symbol_id) ?? [];
		arr.push(s.id);
		childrenOf.set(s.parent_symbol_id, arr);
	}
	const emitters = new Set<string>();
	const visit = (id: string): void => {
		if (emitters.has(id)) return;
		emitters.add(id);
		for (const child of childrenOf.get(id) ?? []) visit(child);
	};
	for (const p of primarySymbols) visit(p.id);
	return emitters;
}

/** Tier labels of a PackedContextResult, used to merge multiple packs. */
const PACK_TIER_KEYS = ["root", "api", "direct", "calls", "imports"] as const;

function emptyTierStats(): { includedSymbols: number; excludedSymbols: number; includedEdges: number } {
	return { includedSymbols: 0, excludedSymbols: 0, includedEdges: 0 };
}

/**
 * Merge one-or-more per-root context packs (issue #85) into a single bounded
 * enrichment across all primary symbols of the range. Items are deduped by
 * symbol id (first occurrence wins); non-root items are skipped once the
 * cumulative estimated token count would exceed `budget`, so the combined
 * pack never blows past the requested bound. Tiers are summed across packs.
 */
function mergeContextPacks(packs: PackedContextResult[], budget: number): PackedContextResult {
	const seenItems = new Set<string>();
	const items: PackedContextResult["items"] = [];
	const seenEdges = new Set<string>();
	const edges: PackedContextResult["edges"] = [];
	const tiers: PackedContextResult["tiers"] = {
		root: emptyTierStats(),
		api: emptyTierStats(),
		direct: emptyTierStats(),
		calls: emptyTierStats(),
		imports: emptyTierStats()
	};
	let estimatedTokens = 0;
	let capped = false;
	let totalSymbols = 0;
	let totalEdges = 0;
	let skippedUnresolved = 0;

	for (const pack of packs) {
		skippedUnresolved += pack.skippedUnresolved;
		totalSymbols += pack.totalSymbols;
		totalEdges += pack.totalEdges;
		for (const it of pack.items) {
			if (seenItems.has(it.symbolId)) continue;
			// Budget cut at a symbol boundary: exclude non-root candidates that
			// would exceed the cumulative budget; roots are always retained.
			if (it.tier !== "root" && estimatedTokens + it.estimatedTokens > budget) {
				capped = true;
				continue;
			}
			seenItems.add(it.symbolId);
			items.push(it);
			estimatedTokens += it.estimatedTokens;
		}
		for (const e of pack.edges) {
			const key = `${e.kind}|${e.fromSymbolId}|${e.toSymbolId}`;
			if (seenEdges.has(key)) continue;
			seenEdges.add(key);
			edges.push(e);
		}
		for (const t of PACK_TIER_KEYS) {
			tiers[t].includedSymbols += pack.tiers[t].includedSymbols;
			tiers[t].excludedSymbols += pack.tiers[t].excludedSymbols;
			tiers[t].includedEdges += pack.tiers[t].includedEdges;
		}
		if (pack.capped) capped = true;
	}

	return { items, edges, estimatedTokens, tiers, skippedUnresolved, totalSymbols, totalEdges, capped };
}

async function handleFileMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const repo = validated.repo;
	if (!repo) {
		return createMcpErrorResponse({
			code: "REPO_REQUIRED",
			message: "Mode 'file' requires a concrete 'repo'.",
			retryable: false
		});
	}
	const filePath = validated.filePath!.trim();

	const file = db.codebaseFiles.getFile(repo, filePath);
	if (!file) {
		return createMcpErrorResponse({
			code: "FILE_NOT_INDEXED",
			message: "File not indexed. Run index_repository first.",
			retryable: false,
			details: { filePath }
		});
	}

	const allFileSymbols = db.codebaseSymbols.getSymbolsByFile(repo, filePath);

	// ── Range parsing + validation (issue #88 / TASK-014) ────────────────
	const { startLine, endLine } = validated;
	const hasStart = startLine != null;
	const hasEnd = endLine != null;

	if (hasStart !== hasEnd) {
		return createMcpErrorResponse({
			code: "RANGE_INCOMPLETE",
			message: "startLine and endLine must be provided together for range-aware FILE mode.",
			retryable: false
		});
	}

	if (hasStart && hasEnd) {
		const s = startLine as number;
		const e = endLine as number;
		if (s > e) {
			return createMcpErrorResponse({
				code: "RANGE_OUT_OF_ORDER",
				message: `endLine (${e}) must be >= startLine (${s}).`,
				retryable: false
			});
		}
		if (file.lines != null && e > file.lines) {
			return createMcpErrorResponse({
				code: "RANGE_OUT_OF_BOUNDS",
				message: `endLine (${e}) exceeds file length (${file.lines} lines).`,
				retryable: false,
				details: { startLine: s, endLine: e, fileLines: file.lines }
			});
		}
		// Range is valid — run the enriched FILE mode.
		return handleFileRangeMode(validated, db, repo, filePath, file, allFileSymbols, { startLine: s, endLine: e });
	}

	// ── No range → unchanged full-file behavior (backward compatible) ────
	const symbols = allFileSymbols;
	let symList = "";
	if (symbols.length > 0) {
		symList =
			`\n\n**Symbols**\n` +
			symbols
				.slice(0, 30)
				.map((s) => {
					const lineRange =
						s.start_line != null
							? s.end_line != null && s.end_line !== s.start_line
								? `L${s.start_line}-L${s.end_line}`
								: `L${s.start_line}`
							: "-";
					const semanticNote =
						validated.includeSemantic && s.semantic_signature ? ` (semantic: ${s.semantic_signature})` : "";
					return `- \`${s.kind}\` ${s.name} ${lineRange}${s.exported ? " [exported]" : ""}${docSuffix(s.doc_comment)}${semanticNote}`;
				})
				.join("\n");
		if (symbols.length > 30) {
			symList += `\n... and ${symbols.length - 30} more`;
		}
	}

	const contentSummary = `Found ${symbols.length} symbols in ${filePath}${symList}`;

	return createMcpResponse(
		{
			schema: "codebase-read",
			mode: "file",
			file: {
				path: file.file_path,
				language: file.language,
				checksum: file.checksum,
				lines: file.lines,
				sizeBytes: file.size_bytes,
				lastIndexedAt: file.last_indexed_at
			},
			symbols,
			total: symbols.length
		},
		`Found ${symbols.length} symbols in ${filePath}`,
		{ includeJson: validated.json, contentSummary }
	);
}

/**
 * Range-aware FILE mode (issue #88 / TASK-014).
 *
 * Returns ONLY the symbols overlapping/enclosing the range as the primary
 * context, scopes the file's reference rows to those emitted by the enclosing
 * symbols (and to any call site inside the range), and optionally folds in the
 * related-type graph (#84) and a token-bounded enrichment pack (#85). Symbols
 * outside the range are never returned — the rest of the file is excluded.
 */
async function handleFileRangeMode(
	validated: CodebaseReadInput,
	db: SQLiteStore,
	repo: string,
	filePath: string,
	file: {
		file_path: string;
		language: string | null;
		checksum: string | null;
		lines: number;
		size_bytes: number;
		last_indexed_at: string | null;
	},
	allFileSymbols: CodebaseSymbol[],
	range: FileRange
): Promise<McpResponse> {
	const repoSymbols = db.codebaseSymbols.getSymbolsByRepo(repo);

	// Primary context: symbols whose span intersects the range (ordered by line).
	const primarySymbols = allFileSymbols
		.filter((s) => symbolOverlapsRange(s, range))
		.sort((a, b) => (a.start_line ?? 0) - (b.start_line ?? 0));

	const emitters = buildEmitterSet(primarySymbols, allFileSymbols);

	// ── References emitted by the enclosing symbols (scoped) ─────────────
	const fileRefs = db.codebaseReferences.getReferencesByFile(repo, filePath);
	const scopedRefs: TraceReference[] = [];
	const seenRefKeys = new Set<string>();
	for (const ref of fileRefs) {
		const emitting = refEmittingSymbol(ref, allFileSymbols);
		const emittedByEnclosing = emitting ? emitters.has(emitting.id) : false;
		const callSiteInRange =
			ref.caller_line != null && ref.caller_line >= range.startLine && ref.caller_line <= range.endLine;
		if (!emittedByEnclosing && !callSiteInRange) continue;
		const key = `${ref.caller_file}:${ref.caller_line}:${ref.symbol_name}:${ref.kind}`;
		if (seenRefKeys.has(key)) continue;
		seenRefKeys.add(key);
		scopedRefs.push(storedReferenceToTraceReference(ref));
	}

	// ── Related-type graph for the primary symbols (#84) ─────────────────
	const typeRefs: CodebaseReference[] = validated.includeRelatedTypes
		? db.codebaseReferences.getReferencesByRepo(repo, ["type"])
		: [];
	const relatedEdges: RelatedTypeEdge[] = [];
	let relatedSkipped = 0;
	if (validated.includeRelatedTypes) {
		const seenEdges = new Set<string>();
		for (const sym of primarySymbols) {
			const rt = collectRelatedTypes(sym, repo, repoSymbols, typeRefs, validated.relationDepth ?? 1);
			relatedSkipped += rt.skippedUnresolved;
			for (const e of rt.edges) {
				const key = `${e.fromSymbolId}|${e.targetSymbolId}`;
				if (seenEdges.has(key)) continue;
				seenEdges.add(key);
				relatedEdges.push(e);
			}
		}
	}

	// ── Token-bounded enrichment pack (#85) ──────────────────────────────
	let contextPack: PackedContextResult | null = null;
	if (validated.contextBudget != null && primarySymbols.length > 0) {
		const allRefs = db.codebaseReferences.getReferencesByRepo(repo);
		const packs: PackedContextResult[] = [];
		for (const sym of primarySymbols) {
			packs.push(packContext(sym, repo, repoSymbols, allRefs, validated.contextBudget, validated.relationDepth ?? 1));
		}
		contextPack = mergeContextPacks(packs, validated.contextBudget);
	}

	// ── Text body ─────────────────────────────────────────────────────────
	const primaryList =
		primarySymbols.length > 0
			? `\n\n**Primary Symbols (range L${range.startLine}-L${range.endLine})**\n` +
				primarySymbols
					.map((s) => {
						const lineRange =
							s.start_line != null
								? s.end_line != null && s.end_line !== s.start_line
									? `L${s.start_line}-L${s.end_line}`
									: `L${s.start_line}`
								: "-";
						const semanticNote =
							validated.includeSemantic && s.semantic_signature ? ` (semantic: ${s.semantic_signature})` : "";
						return `- \`${s.kind}\` ${s.name} ${lineRange}${s.exported ? " [exported]" : ""}${docSuffix(s.doc_comment)}${semanticNote}`;
					})
					.join("\n")
			: `\n\n**Primary Symbols (range L${range.startLine}-L${range.endLine})**\n(none overlap the given range)`;

	const refList =
		scopedRefs.length > 0
			? `\n\n### References emitted by enclosing symbols (${scopedRefs.length})\n\n${scopedRefs
					.slice(0, 30)
					.map(
						(r) =>
							`- ${r.filePath}:${r.startLine}${r.kind ? ` [${r.kind}]` : ""}${r.targetFile ? ` → ${r.targetFile}` : ""}`
					)
					.join("\n")}${scopedRefs.length > 30 ? `\n... and ${scopedRefs.length - 30} more` : ""}`
			: "";

	const relatedList = validated.includeRelatedTypes
		? `\n\n### Related Types\n\n${
				relatedEdges.length > 0
					? formatRelatedTypeTree(primarySymbols.map((s) => s.name).join(", "), relatedEdges)
					: "None found"
			}${relatedSkipped > 0 ? `\n\n(${relatedSkipped} unresolved type edge${relatedSkipped > 1 ? "s" : ""} skipped)` : ""}`
		: "";

	const packList = contextPack ? `\n\n${formatContextPack(contextPack)}` : "";

	const contentSummary = `Found ${primarySymbols.length} primary symbol(s) in ${filePath} for range L${range.startLine}-L${range.endLine}${primaryList}${refList}${relatedList}${packList}`;

	return createMcpResponse(
		{
			schema: "codebase-read",
			mode: "file",
			file: {
				path: file.file_path,
				language: file.language,
				checksum: file.checksum,
				lines: file.lines,
				sizeBytes: file.size_bytes,
				lastIndexedAt: file.last_indexed_at
			},
			range,
			// Backward-compatible `symbols` array carries the range-relevant set
			// (NOT the whole file) so callers never receive unrelated symbols.
			symbols: primarySymbols,
			fileSymbolCount: allFileSymbols.length,
			primarySymbolCount: primarySymbols.length,
			references: scopedRefs,
			referenceCount: scopedRefs.length,
			relatedTypes: validated.includeRelatedTypes ? relatedEdges : undefined,
			relatedTypesSkippedUnresolved: validated.includeRelatedTypes ? relatedSkipped : undefined,
			contextPack: contextPack ?? undefined
		},
		`Found ${primarySymbols.length} primary symbol(s) in ${filePath} (range L${range.startLine}-L${range.endLine})${
			scopedRefs.length ? `, ${scopedRefs.length} scoped reference(s)` : ""
		}${relatedEdges.length ? `, ${relatedEdges.length} related type(s)` : ""}${
			contextPack
				? `, ${contextPack.items.length} symbols packed (~${contextPack.estimatedTokens} est. tokens${contextPack.capped ? ", budget reached" : ""})`
				: ""
		}`,
		{ includeJson: validated.json, contentSummary }
	);
}

export { handleFileMode };
