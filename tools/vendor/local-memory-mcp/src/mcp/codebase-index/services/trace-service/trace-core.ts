/**
 * Trace orchestration core for the trace service: the public `traceSymbol`
 * entry point plus the helpers that build its result (re-export chain,
 * reference merge, in-memory reference scan). Extracted from the
 * trace-service monolith so orchestration is one focused module.
 */

import type { CodebaseSymbol } from "../../../types";
import { AmbiguousSymbolError, SymbolNotFoundError } from "./errors";
import type { ReexportChainEntry, TraceReference, TraceResult } from "./types";

/**
 * Trace a symbol by exact name match.
 *
 * 1. Find symbols with exact name match in the provided array.
 * 2. If multiple matches, throw AmbiguousSymbolError with all candidates.
 * 3. If single match, find its definition location and export status.
 * 4. If includeReferences, search other symbols' doc_comments and signatures for the name.
 *
 * @throws {SymbolNotFoundError} if no symbol matches the given name.
 * @throws {AmbiguousSymbolError} if multiple symbols match (disambiguation required).
 */
export function traceSymbol(
	name: string,
	repo: string | undefined,
	symbols: CodebaseSymbol[],
	includeReferences: boolean,
	storedReferences?: TraceReference[]
): TraceResult {
	// Step 1: Find exact name matches
	const matches = symbols.filter((s) => s.name === name);

	if (matches.length === 0) {
		throw new SymbolNotFoundError(name, repo);
	}

	// Step 2: Disambiguation for multiple matches
	if (matches.length > 1) {
		throw new AmbiguousSymbolError(name, matches, repo);
	}

	// Step 3: Single match — build result
	const symbol = matches[0];

	// Step 3b: hierarchy (TASK-300) — the parent is the same-file container
	// whose id equals symbol.parent_symbol_id (set at index time by the parse
	// pipeline); children are the symbols whose parent_symbol_id points at this
	// symbol. Both are resolved in-memory from the provided array, which TRACE
	// mode already loads in full (getSymbolsByRepo), so no extra queries.
	const parentSymbol = symbol.parent_symbol_id ? (symbols.find((s) => s.id === symbol.parent_symbol_id) ?? null) : null;
	const children = symbols
		.filter((s) => s.parent_symbol_id === symbol.id)
		.sort((a, b) => (a.start_line ?? 0) - (b.start_line ?? 0));

	const result: TraceResult = {
		symbol,
		definition: {
			file: symbol.file_path,
			line: symbol.start_line ?? 0,
			column: symbol.start_col ?? 0,
			// A null end_line falls back to the start line (a symbol with no
			// recorded end span is treated as spanning just its start line).
			endLine: symbol.end_line ?? symbol.start_line ?? 0,
			endColumn: symbol.end_col ?? 0
		},
		references: [],
		exportChain: {
			exported: symbol.exported,
			defaultExport: symbol.default_export
		},
		parent: parentSymbol
			? {
					id: parentSymbol.id,
					name: parentSymbol.name,
					kind: parentSymbol.kind,
					filePath: parentSymbol.file_path,
					line: parentSymbol.start_line
				}
			: null,
		children,
		reexportChain: includeReferences ? buildReexportChain(symbol, storedReferences ?? []) : []
	};

	// Step 4: Find references if requested. The table-backed references
	// (emitted by the parse visitors, TASK-236) are the primary precise source;
	// the in-memory doc_comment/signature scan is kept as the safety net when
	// the table has no stored refs for the symbol (e.g. pre-v21 index data or a
	// language without a reference-emitting visitor). When both exist they are
	// merged and deduped by call-site line.
	if (includeReferences) {
		const inMemory = findReferences(name, symbols, symbol.id);
		const stored = storedReferences ?? [];
		if (stored.length === 0) {
			result.references = inMemory;
		} else {
			result.references = mergeStoredAndInMemory(stored, inMemory);
		}
	}

	return result;
}

/**
 * Merge table-backed references with in-memory substring matches, deduping by
 * call-site (filePath, startLine) so the same site is never reported twice.
 * Stored references win on conflict (precise line > symbol-anchored context).
 */
function mergeStoredAndInMemory(stored: TraceReference[], inMemory: TraceReference[]): TraceReference[] {
	const seen = new Set<string>();
	const merged: TraceReference[] = [];
	for (const ref of stored) {
		const key = `${ref.filePath}:${ref.startLine}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(ref);
	}
	for (const ref of inMemory) {
		const key = `${ref.filePath}:${ref.startLine}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(ref);
	}
	return merged;
}

/**
 * Build a symbol's public re-export chain (issue #87, TASK-013) from the
 * stored `reexport` reference edges.
 *
 * A re-export edge "points at" the traced symbol when its resolved target is
 * this symbol — keyed on `target_symbol_id` (the canonical parse-time
 * resolution), with a name+file fallback (`symbol_name` === symbol name AND
 * `target_file` === symbol's definition file) for edges whose target_symbol_id
 * was unresolved at parse time. Each matching edge becomes one
 * {@link ReexportChainEntry} describing WHO re-exports this symbol and under
 * which (aliased) name. De-duplicated by (filePath, startLine).
 */
export function buildReexportChain(symbol: CodebaseSymbol, storedReferences: TraceReference[]): ReexportChainEntry[] {
	const matches = storedReferences.filter(
		(r) => r.kind === "reexport" && (r.targetSymbolId === symbol.id || r.targetFile === symbol.file_path)
	);
	const seen = new Set<string>();
	const out: ReexportChainEntry[] = [];
	for (const r of matches) {
		const key = `${r.filePath}:${r.startLine}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			filePath: r.filePath,
			startLine: r.startLine,
			aliasName: r.localName ?? null,
			canonicalName: r.importedName ?? null,
			moduleSpecifier: r.moduleSpecifier ?? null,
			importKind: r.importKind ?? null
		});
	}
	return out;
}

/**
 * Search other symbols for references to the given name.
 * Checks doc_comments and signatures for the name string.
 * Excludes the definition symbol itself by ID.
 */
function findReferences(name: string, symbols: CodebaseSymbol[], excludeId: string): TraceReference[] {
	const refs: TraceReference[] = [];
	const searchName = name;

	for (const sym of symbols) {
		if (sym.id === excludeId) continue;

		const docComment = sym.doc_comment ?? "";
		const signature = sym.signature ?? "";

		// Check doc_comment for the name
		if (docComment.includes(searchName)) {
			refs.push({
				filePath: sym.file_path,
				startLine: sym.start_line ?? 0,
				startCol: sym.start_col ?? 0,
				endLine: sym.end_line ?? 0,
				endCol: sym.end_col ?? 0,
				context: extractContext(docComment, searchName)
			});
			continue; // Don't double-add if also in signature
		}

		// Check signature for the name
		if (signature.includes(searchName)) {
			refs.push({
				filePath: sym.file_path,
				startLine: sym.start_line ?? 0,
				startCol: sym.start_col ?? 0,
				endLine: sym.end_line ?? 0,
				endCol: sym.end_col ?? 0,
				context: signature
			});
		}
	}

	return refs;
}

/**
 * Extract the line containing the search text, with the match as context.
 */
function extractContext(text: string, search: string): string {
	const lines = text.split("\n");
	for (const line of lines) {
		if (line.includes(search)) {
			return line.trim();
		}
	}
	// Fallback to first line
	return lines[0]?.trim() ?? "";
}
