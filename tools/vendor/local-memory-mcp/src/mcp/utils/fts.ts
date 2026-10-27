/**
 * FTS5 query-building helpers (MEM-367 / TASK-014).
 *
 * The memories search path uses the FTS5 `unicode61` tokenizer (the SQLite
 * default, shared by codebase_symbols_fts and coding_standards_fts) with a
 * per-term prefix wildcard so token-initial substrings ("vec" → "vector",
 * "fts" → "fts5") reproduce the dominant LIKE '%q%' recall pattern without a
 * full table scan.
 */

// Cap on the number of AND-ed terms in a single MATCH expression — guards
// against pathological multi-word queries blowing up the FTS5 query plan.
export const FTS_MAX_TERMS = 8;

// Top-k candidate set for min-max bm25 normalization (design §6.1, k = 100).
export const FTS_CANDIDATE_CAP = 100;

/**
 * Sanitize a raw query into a bare whitespace-separated term list (no FTS5
 * syntax, no wildcards). Used by the codebase-symbol and standard legacy
 * MATCH paths — do not remove.
 */
export function sanitizeFtsTerm(raw: string): string {
	let cleaned = raw.replace(/[^\w\s]/g, " ").trim();
	cleaned = cleaned.replace(/\s+/g, " ");
	return cleaned;
}

/**
 * Build a safe FTS5 MATCH expression from a raw user query.
 *
 * - Balanced double-quoted phrases (`"data pipeline"`) are kept verbatim as
 *   phrase tokens; phrase content is sanitized to letters/digits/spaces/`_`
 *   and dropped entirely if nothing usable remains.
 * - Remaining whitespace-separated terms have FTS5 metacharacters stripped
 *   (`"`, `(`, `)`, `*`, `~`, `:`, `^`, `+`, `-`) and receive a `*` prefix
 *   wildcard. A hyphen acts as a word separator (`data-pipeline` →
 *   `data* AND pipeline*`), matching how unicode61 tokenizes the content.
 * - Tokens are joined with explicit `AND` (FTS5 implicit-AND) and capped at
 *   {@link FTS_MAX_TERMS}.
 *
 * Returns `""` when nothing usable remains — callers MUST fall back to the
 * non-FTS (LIKE) path in that case.
 *
 * Examples:
 *   `"data pipeline"`  → `"data pipeline"`
 *   `optimize query`   → `optimize* AND query*`
 *   `fts5`             → `fts5*`
 *   `"data" etl`       → `"data" AND etl*`
 *   `data-pipeline`    → `data* AND pipeline*`
 */
export function buildFtsMatchQuery(raw: string): string {
	if (!raw) return "";
	const trimmed = raw.trim();
	if (!trimmed) return "";

	// 1. Extract balanced double-quoted phrases verbatim.
	const phrases: string[] = [];
	const phraseRanges: Array<{ start: number; end: number }> = [];
	const phrasePattern = /"([^"]+)"/g;
	let phraseMatch: RegExpExecArray | null;
	while ((phraseMatch = phrasePattern.exec(trimmed)) !== null) {
		const phraseContent = phraseMatch[1] ?? "";
		const sanitized = phraseContent
			.replace(/[^\p{L}\p{N}_\s]/gu, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (sanitized.length > 0) {
			phrases.push(`"${sanitized}"`);
		}
		phraseRanges.push({ start: phraseMatch.index, end: phraseMatch.index + phraseMatch[0].length });
	}

	// 2. Remove the consumed phrase regions so their words are not re-tokenized.
	let remaining = "";
	let cursor = 0;
	for (const range of phraseRanges) {
		remaining += trimmed.slice(cursor, range.start) + " ";
		cursor = range.end;
	}
	remaining += trimmed.slice(cursor);

	// 3. Strip FTS5 metacharacters; hyphens split terms (unicode61 separator).
	const cleaned = remaining
		.replace(/["()*:~^+-]/g, " ")
		.replace(/[^\p{L}\p{N}_\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();

	// 4. Prefix wildcard per term; join phrases + terms with explicit AND.
	const terms: string[] = [];
	for (const term of cleaned.split(" ")) {
		if (term) terms.push(`${term}*`);
	}

	const allTerms = [...phrases, ...terms];
	if (allTerms.length === 0) return "";
	return allTerms.slice(0, FTS_MAX_TERMS).join(" AND ");
}
