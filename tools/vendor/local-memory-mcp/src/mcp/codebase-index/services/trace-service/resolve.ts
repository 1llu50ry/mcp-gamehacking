/**
 * Shared reference-row resolution helpers for the trace service.
 *
 * Both the related-types traversal (#84) and the context packer (#85) resolve
 * a stored `codebase_references` row to its indexed target symbol through the
 * same preference chain — see {@link resolveTypeTarget}. Extracted here so the
 * two consumers share one implementation (no duplication, ZQZMSU).
 */

import type { CodebaseReference, CodebaseSymbol } from "../../../types";

/**
 * All 'type' reference rows whose caller site is the given symbol: rows whose
 * `caller_file` is the symbol's definition file AND whose `caller_name` is the
 * symbol's name (the TS type-edge emitter tags function/method/field type
 * surfaces with the declaration's name; class/interface/alias type surfaces
 * emit `caller_name` null). Rows in the same file with a DIFFERENT
 * `caller_name` belong to sibling symbols and are excluded.
 */
export function typeEdgesOf(symbol: CodebaseSymbol, references: CodebaseReference[]): CodebaseReference[] {
	return references.filter(
		(r) => r.kind === "type" && r.caller_file === symbol.file_path && (r.caller_name ?? null) === (symbol.name ?? null)
	);
}

/**
 * Resolve a 'type' reference row to its indexed target symbol.
 *
 * Preference order:
 *   1. `target_symbol_id` → direct id lookup (canonical, cross-file safe).
 *   2. Same-file exact-name match — the type is declared alongside the caller
 *      (the overwhelmingly common case for DTOs/interfaces in one module).
 *   3. Repo-wide exact-name match (first row in deterministic file/line
 *      order). Name-based per ADR-002; a same-name collision in another file
 *      may mis-resolve, exactly as reference aggregation does today.
 *
 * Returns null when none of the three resolve — the caller skips the hop
 * (unresolved targets never fail the traversal).
 */
export function resolveTypeTarget(
	ref: CodebaseReference,
	caller: CodebaseSymbol,
	_repo: string | undefined,
	symbols: CodebaseSymbol[],
	symbolsById: Map<string, CodebaseSymbol>,
	symbolsByFile: Map<string, CodebaseSymbol[]>
): { symbol: CodebaseSymbol } | null {
	if (ref.target_symbol_id) {
		const byId = symbolsById.get(ref.target_symbol_id);
		if (byId) return { symbol: byId };
	}
	if (ref.target_file) {
		const sameFile = (symbolsByFile.get(ref.target_file) ?? []).find((s) => s.name === ref.symbol_name);
		if (sameFile) return { symbol: sameFile };
	}
	const byName = symbols.find((s) => s.name === ref.symbol_name);
	if (byName) return { symbol: byName };
	return null;
}

/**
 * Source symbol id for a reference row: `caller_name` + `caller_file` locate
 * the caller symbol (same-file name match). Rows with a null caller_name
 * (top-level heritage/import edges) or an unresolvable caller are skipped.
 */
export function sourceSymbolIdForCaller(
	ref: CodebaseReference,
	symbolsById: Map<string, CodebaseSymbol>,
	symbolsByFile: Map<string, CodebaseSymbol[]>
): string | null {
	if (!ref.caller_name || !ref.caller_file) return null;
	const sameFile = (symbolsByFile.get(ref.caller_file) ?? []).find((s) => s.name === ref.caller_name);
	return sameFile?.id ?? null;
}
