/**
 * DocComment text formatting — compact single-line summary for MCP text responses.
 *
 * The persisted `doc_comment` was already serialized by `serializeDocBlock`:
 * `[DEPRECATED] summary + prose + @tags` with `\n` separators. This module
 * collapses it to a compact, truncated line for text formatters so agents
 * instantly see a symbol's purpose without expanding structuredContent JSON.
 */

const DEFAULT_TRUNCATE = 140;

/**
 * Return a compact single-line summary of a serialized doc_comment.
 *
 * - Null/empty → null (caller should omit the doc line).
 * - Collapses newlines to single spaces for the short case.
 * - When longer than `maxLen`, returns the first non-empty line truncated
 *   to `maxLen` with a trailing `…` (U+2026).
 */
export function formatDocComment(doc: string | null | undefined, maxLen: number = DEFAULT_TRUNCATE): string | null {
	if (!doc) return null;
	const trimmed = doc.trim();
	if (trimmed.length === 0) return null;
	// If the whole collapsed doc fits compactly, return it collapsed to one line.
	const collapsed = trimmed
		.replace(/\s*\n\s*/g, " ")
		.replace(/\s{2,}/g, " ")
		.trim();
	if (collapsed.length <= maxLen) return collapsed;

	// Otherwise take the first non-empty logical line and truncate it.
	const firstLine =
		trimmed
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.length > 0) ?? collapsed;
	if (firstLine.length <= maxLen) return firstLine;
	return `${firstLine.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Format a doc_comment as an inline suffix for list items.
 * Returns ` — <summary>` or empty string when absent.
 */
export function docSuffix(doc: string | null | undefined, maxLen: number = DEFAULT_TRUNCATE): string {
	const summary = formatDocComment(doc, maxLen);
	return summary ? ` — ${summary}` : "";
}
