/**
 * Issue-reference detection helpers (TASK-422).
 *
 * Tasks link to GitHub-style issues via the structural `#NNN` convention
 * (e.g. `TASK-128 [#446]`, `fix #1423`, `issue #544`). A search query like
 * "issue 544" ALSO matches tasks that merely mention the words "issue" or
 * "544" in their text — fuzzy keyword hits, NOT structural links. These
 * helpers give the task-read search engine the vocabulary to tell the two
 * apart:
 *
 *   - {@link extractIssueRefs}        — `#NNN` refs ACROSS task text fields
 *     (title/description/comments). Deliberately does NOT treat the bare
 *     phrase "issue 544" as a ref: that is exactly the fuzzy-match case the
 *     task distinguishes from a real link.
 *   - {@link extractQueryIssueTokens} — issue numbers INTENDED by the query:
 *     `#NNN`, or a bare number following "issue"/"issues" ("issue 544").
 *     A bare number ("544") is ambiguous and is NOT an issue token.
 *   - {@link collectIssueRefsFrom}    — union across multiple text sources,
 *     deduplicated and sorted numerically.
 *
 * All functions return numeric strings ("544") — never the `#` prefix — so
 * callers can compare/join without extra normalization.
 */

/** Structural `#NNN` reference — also catches `[#NNN]` and "issue #NNN". */
const ISSUE_REF_RE = /#(\d+)/g;

/** Query-intent issue tokens: `#NNN` OR a bare number after "issue(s)". */
const QUERY_ISSUE_WORD_RE = /(?:issue|issues)\s+#?(\d+)/gi;

/** Deduplicates issue numbers and sorts them numerically ("9" < "544"). */
function dedupeSorted(nums: string[]): string[] {
	return [...new Set(nums)].sort((a, b) => Number(a) - Number(b));
}

/**
 * Extracts structural `#NNN` references from a single text source.
 * Empty/absent text yields `[]`. Bare "issue 544" (no `#`) is NOT a ref —
 * that phrasing is a fuzzy keyword match, not a structural link.
 */
export function extractIssueRefs(text: string | null | undefined): string[] {
	if (!text) return [];
	const matches = text.matchAll(ISSUE_REF_RE);
	const nums: string[] = [];
	for (const m of matches) nums.push(m[1]);
	return dedupeSorted(nums);
}

/**
 * Extracts the issue numbers a search query IS ABOUT: `#NNN` refs plus bare
 * numbers preceded by "issue"/"issues" ("issue 544" → ["544"]). A bare
 * number ("544", "task 5") is ambiguous and intentionally not an issue
 * token. Returns `[]` when the query carries no issue intent.
 */
export function extractQueryIssueTokens(query: string | null | undefined): string[] {
	if (!query) return [];
	const nums: string[] = [];
	for (const m of query.matchAll(ISSUE_REF_RE)) nums.push(m[1]);
	for (const m of query.matchAll(QUERY_ISSUE_WORD_RE)) nums.push(m[1]);
	return dedupeSorted(nums);
}

/**
 * Union of structural issue refs across multiple text sources (task title,
 * description, comments, ...). Sources that are empty/absent are skipped.
 */
export function collectIssueRefsFrom(sources: Array<string | null | undefined>): string[] {
	const nums: string[] = [];
	for (const source of sources) {
		if (!source) continue;
		for (const m of source.matchAll(ISSUE_REF_RE)) nums.push(m[1]);
	}
	return dedupeSorted(nums);
}
