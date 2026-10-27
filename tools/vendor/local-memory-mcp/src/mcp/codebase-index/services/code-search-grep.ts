import type { CodebaseSymbol } from "../../types";
import { CODE_SEARCH_SNIPPET_CHARS } from "../../utils/constants";

// ═══════════════════════════════════════════════════════════════════════════
// GREP PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

export interface LineMatch {
	/** 1-based line number. */
	line: number;
	/** Character index of the match within the line. */
	matchIndex: number;
	snippet: string;
}

export interface EnclosingSymbol {
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
	docComment: string | null;
}

/**
 * Match a needle against file content line by line.
 *
 * `regex === null` ⇒ case-insensitive substring; otherwise a compiled regex
 * (case-insensitive). Lines are 1-based; CRLF is normalized.
 */
export function grepContent(content: string, needle: string, regex: RegExp | null): LineMatch[] {
	const lines = content.split(/\r?\n/);
	const matches: LineMatch[] = [];

	if (regex) {
		for (let i = 0; i < lines.length; i++) {
			const m = regex.exec(lines[i]); // no /g flag ⇒ stateless, no lastIndex drift
			if (m && m.index !== undefined) {
				matches.push({
					line: i + 1,
					matchIndex: m.index,
					snippet: buildSnippet(lines[i], m.index, m[0].length)
				});
			}
		}
		return matches;
	}

	const lowerNeedle = needle.toLowerCase();
	for (let i = 0; i < lines.length; i++) {
		const idx = lines[i].toLowerCase().indexOf(lowerNeedle);
		if (idx >= 0) {
			matches.push({
				line: i + 1,
				matchIndex: idx,
				snippet: buildSnippet(lines[i], idx, needle.length)
			});
		}
	}
	return matches;
}

/**
 * Build a ~CODE_SEARCH_SNIPPET_CHARS snippet centered on the match, with
 * ellipsis markers at clipped line boundaries.
 */
function buildSnippet(line: string, matchIndex: number, matchLength: number): string {
	const radius = Math.floor(CODE_SEARCH_SNIPPET_CHARS / 2);
	const start = Math.max(0, matchIndex - radius);
	const end = Math.min(line.length, matchIndex + matchLength + radius);
	const prefix = start > 0 ? "…" : "";
	const suffix = end < line.length ? "…" : "";
	return prefix + line.slice(start, end) + suffix;
}

/**
 * Resolve the innermost enclosing symbol for a line: the symbol with the
 * smallest span whose [start_line, end_line] contains the line (ties break to
 * the earlier start). Pure function over a per-file preloaded span array.
 */
export function findEnclosingSymbol(symbols: CodebaseSymbol[], line: number): EnclosingSymbol | null {
	// Narrowed span is stored alongside the symbol — TS cannot retain the
	// start_line/end_line null-narrowing of an earlier loop iteration on a
	// re-assigned `best`, so we capture the narrowed numbers explicitly.
	let best: { symbol: CodebaseSymbol; startLine: number; endLine: number } | null = null;
	for (const s of symbols) {
		if (s.start_line === null || s.end_line === null) continue;
		if (s.start_line > line || line > s.end_line) continue;
		if (best === null) {
			best = { symbol: s, startLine: s.start_line, endLine: s.end_line };
			continue;
		}
		const span = s.end_line - s.start_line;
		const bestSpan = best.endLine - best.startLine;
		if (span < bestSpan || (span === bestSpan && s.start_line < best.startLine)) {
			best = { symbol: s, startLine: s.start_line, endLine: s.end_line };
		}
	}
	return best
		? {
				name: best.symbol.name,
				kind: best.symbol.kind,
				startLine: best.startLine,
				endLine: best.endLine,
				docComment: best.symbol.doc_comment
			}
		: null;
}
