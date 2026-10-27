/**
 * enrich-parse — per-outcome enrichment: structural symbols → parent-linked
 * + optionally semantically enriched, then mapped to DB rows.
 *
 * Split of the former parse-pipeline.ts monolith (TASK-553). Composition of
 * three existing helpers so the pipeline batch loop stays a straight
 * accumulation:
 *
 *   1. resolveFileParents — assigns each symbol a fresh UUID and resolves
 *      parent_symbol_id (same-file, name-based per ADR-002) BEFORE insert.
 *   2. safeEnrichSemantic — the bounded, isolated secondary pass (never
 *      throws; structural indexing proceeds regardless of its outcome).
 *   3. symbolRow / referenceInsert (row-mappers) — map the resolved symbols
 *      and the parsed references to DB insert rows.
 */

import type { CodebaseFileInsert, CodebaseReferenceInsert, CodebaseSymbolInsert } from "../../../types";
import type { ParsedReference } from "../../parser/language-visitor";
import { reexportSpecFromParsedReference } from "../../parser/reexport-resolution";
import { resolveFileParents } from "../../parser/parent-resolver";
import { CODEBASE_SEMANTIC_ENRICH } from "../../../utils/constants";
import type { PipelineContext, ParsedOutcome, ResolvedSymbols, SymbolWithSemantic } from "./types";
import { applySemanticEnrichment, safeEnrichSemantic } from "./semantic-pass";
import { fileRow, referenceInsert, symbolRow } from "./row-mappers";

/**
 * Run the optional semantic pass for one outcome. Mirrors the original gate
 * exactly: the pass runs only when the master flag is on AND the file
 * produced symbols. NEVER throws — structural indexing is unaffected.
 */
async function semanticPassFor(
	ctx: PipelineContext,
	outcome: ParsedOutcome,
	symbols: SymbolWithSemantic[]
): Promise<{ map: NonNullable<ResolvedSymbols["semanticMap"]>; enriched: number }> {
	if (!CODEBASE_SEMANTIC_ENRICH || symbols.length === 0) {
		return { map: new Map(), enriched: 0 };
	}
	const map =
		(await safeEnrichSemantic(
			outcome.plan.filePath,
			outcome.plan.absolutePath,
			outcome.plan.language,
			outcome.content,
			symbols,
			ctx.options.semanticRegistry
		)) ?? new Map();
	const enriched = applySemanticEnrichment(symbols, map);
	return { map, enriched };
}

/**
 * Resolve one parsed outcome into its semantic columns and DB insert rows.
 * Called ONLY for outcomes without an error — the caller classifies failures.
 */
export async function enrichParsedOutcome(
	ctx: PipelineContext,
	outcome: ParsedOutcome
): Promise<{
	resolved: ResolvedSymbols;
	symbolRows: CodebaseSymbolInsert[];
	referenceInserts: CodebaseReferenceInsert[];
	fileInsert: CodebaseFileInsert;
}> {
	// Parent linking happens BEFORE semantic enrichment so the optional pass
	// sees the same resolved symbol set the row mapper persists.
	const symbols: SymbolWithSemantic[] = resolveFileParents(outcome.parseResult?.symbols ?? []).map((sym) => ({
		...sym,
		semantic: null,
		semanticUpdatedAt: null
	}));
	const { map, enriched } = await semanticPassFor(ctx, outcome, symbols);
	const resolved: ResolvedSymbols = { symbols, semanticMap: map.size > 0 ? map : null, semanticEnriched: enriched };

	const symbolRows = symbols.map((sym) => symbolRow(sym, ctx.repo, outcome.plan.filePath, outcome.content));
	const referenceInserts = buildReferenceRows(ctx, outcome);
	return {
		resolved,
		symbolRows,
		referenceInserts,
		fileInsert: fileRow(outcome.plan, ctx.repo, outcome.checksum, outcome.lineCount)
	};
}

/**
 * Map a parsed outcome's reference edges to DB rows, expanding re-export edges
 * to their canonical targets when a resolver is available (issue #87) and
 * resolving import edges to theirs (issue #83 / FIX-83). A reference of kind
 * 'reexport' that resolves to exactly one target is written with that target;
 * a wildcard `export *` that resolves to several targets is expanded into one
 * row per re-exported symbol; an unresolved re-export is still persisted with
 * null targets (visible, matching the #83 import stance). An 'import'
 * reference with a resolvable module specifier is written with its canonical
 * target (file + symbol when the imported name maps to an exported symbol);
 * unresolved imports keep null targets and stay visible.
 */
function buildReferenceRows(ctx: PipelineContext, outcome: ParsedOutcome): CodebaseReferenceInsert[] {
	const { plan, parseResult } = outcome;
	const rows: CodebaseReferenceInsert[] = [];
	for (const ref of parseResult?.references ?? []) {
		rows.push(...expandReference(ctx, ref, plan.filePath, ctx.repo));
	}
	return rows;
}

/** Expand one parsed reference into one-or-more DB rows (see module doc). */
function expandReference(
	ctx: PipelineContext,
	ref: ParsedReference,
	filePath: string,
	repo: string
): CodebaseReferenceInsert[] {
	const reexportResolver = ctx.reexportResolver;
	if (ref.kind === "reexport" && reexportResolver) {
		const spec = reexportSpecFromParsedReference(ref);
		if (spec) {
			const resolved = reexportResolver.resolve(ref.callerFile || filePath, spec);
			if (resolved.length === 1) {
				const r = resolved[0];
				return [
					{
						...referenceInsert(ref, filePath, repo),
						target_file: r.targetFile,
						target_symbol_id: r.targetSymbolId
					}
				];
			}
			if (resolved.length > 1) {
				// Wildcard `export *` expansion — one edge per target.
				return resolved.map((r) => ({
					...referenceInsert(ref, filePath, repo),
					symbol_name: r.canonicalName,
					target_file: r.targetFile,
					target_symbol_id: r.targetSymbolId
				}));
			}
			// No resolved targets — fall through and persist unresolved.
		}
	}

	// Import → canonical target (issue #83 / FIX-83). Only references that
	// carry a module specifier are resolvable; side-effect imports of external
	// packages and specifier-less references fall through unresolved.
	const importResolver = ctx.importResolver;
	const importInfo = ref.importInfo;
	if (ref.kind === "import" && importResolver && importInfo?.moduleSpecifier) {
		const resolved = importResolver.resolve(
			ref.callerFile || filePath,
			importInfo.moduleSpecifier,
			importInfo.importedName,
			importInfo.importKind
		);
		if (resolved.targetFile) {
			// The module resolved to an indexed file. Keep symbol_name (the
			// canonical imported name / namespace alias) untouched — only the
			// target columns are populated; a miss on the exported name keeps
			// the file-level target with a null symbol (namespace, side-effect,
			// barrel re-export or genuinely unresolved name).
			return [
				{
					...referenceInsert(ref, filePath, repo),
					target_file: resolved.targetFile,
					target_symbol_id: resolved.targetSymbolId
				}
			];
		}
		// Module unresolvable (unindexed/unmatched specifier) — persist as-is.
	}
	return [referenceInsert(ref, filePath, repo)];
}
