/**
 * semantic-pass — optional semantic enrichment pass (issue #89/#90,
 * TASK-015/TASK-016).
 *
 * Split of the former parse-pipeline.ts monolith (TASK-553). Tree-sitter
 * structural indexing (above) is the PRIMARY indexer and is ALWAYS applied.
 * This BOUNDED, ISOLATED secondary pass selects a language adapter (via
 * SemanticAdapterRegistry) and attaches inferred signatures to a SEPARATE set
 * of columns so the structural `signature` is never overwritten. It is fully
 * guarded: master flag off ⇒ skip; no adapter ⇒ skip (structural unchanged);
 * timeout ⇒ skip; any failure ⇒ degraded (no-op). Structural indexing proceeds
 * regardless of this pass's outcome.
 */

import type { ParsedSymbol } from "../../parser/language-visitor";
import type { SemanticSymbolEnrichment } from "../../semantic/adapter";
import {
	enrichSymbolsSemantic,
	getDefaultSemanticRegistry,
	repoPathFromAbsolute,
	type SemanticAdapterRegistry
} from "../../semantic/registry";
import { symbolKey } from "../../semantic/typescript-enricher";
import { CODEBASE_SEMANTIC_ENRICH, CODEBASE_SEMANTIC_ENRICH_TIMEOUT_MS } from "../../../utils/constants";
import type { SymbolWithSemantic } from "./types";

/**
 * Run the optional semantic enrichment pass in a crash/timeout-isolated way
 * (issue #89/#90). Delegates to the language-selected {@link SemanticAdapter}
 * through {@link enrichSymbolsSemantic}, which selects by language, applies the
 * wall-clock timeout + try/catch isolation, and returns the `name#startLine` →
 * enrichment map — or null on gate skip / no adapter / degraded. NEVER throws, so
 * structural indexing is never affected.
 */
export async function safeEnrichSemantic(
	filePath: string,
	absolutePath: string,
	language: string,
	content: string,
	symbols: ParsedSymbol[],
	registry?: SemanticAdapterRegistry
): Promise<Map<string, SemanticSymbolEnrichment> | null> {
	const repoPath = repoPathFromAbsolute(absolutePath, filePath);
	return enrichSymbolsSemantic(
		registry ?? getDefaultSemanticRegistry(),
		language,
		filePath,
		repoPath,
		content,
		symbols,
		CODEBASE_SEMANTIC_ENRICH_TIMEOUT_MS
	);
}

/**
 * Attach the optional semantic columns (semantic_signature / semantic_source /
 * semantic_updated_at) to each resolved symbol via its stable `name#startLine`
 * key. Gate + map lookup happen here so the caller stays a straight loop; a
 * symbol with no match keeps all three columns null (structural only). Returns
 * the number of symbols that received a semantic signature.
 */
export function applySemanticEnrichment(
	symbols: SymbolWithSemantic[],
	semanticMap: Map<string, SemanticSymbolEnrichment> | null,
	now: () => Date = () => new Date()
): number {
	if (!CODEBASE_SEMANTIC_ENRICH || !semanticMap || semanticMap.size === 0) return 0;
	let enriched = 0;
	for (const sym of symbols) {
		const hit = semanticMap.get(symbolKey(sym.name, sym.startLine));
		if (hit) {
			sym.semantic = hit;
			sym.semanticUpdatedAt = now().toISOString();
			enriched++;
		}
	}
	return enriched;
}
