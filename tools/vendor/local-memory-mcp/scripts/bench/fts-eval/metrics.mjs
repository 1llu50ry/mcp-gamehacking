/**
 * Metrics concern for the FTS5 tokenizer evaluation harness.
 *
 * Pure statistical helpers (percentiles) and the recall@k computation that
 * evaluates an FTS MATCH result against the LIKE-oracle id set.
 */

export function percentile(sorted, p) {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
	return sorted[idx];
}

export function percentiles(samples) {
	const s = [...samples].sort((a, b) => a - b);
	return { p50: percentile(s, 0.5), p95: percentile(s, 0.95), p99: percentile(s, 0.99), n: s.length };
}

/**
 * Recall@k for one (tokenizer, match-expression) pair against the oracle id set.
 *
 * @param {{unicode:(k:number)=>import("better-sqlite3").Statement, trigram:(k:number)=>import("better-sqlite3").Statement}} stmt
 * @param {"unicode"|"trigram"} table
 * @param {string} match - the FTS MATCH expression
 * @param {number[]} oracle - row ids the LIKE oracle would return
 * @param {number} k - result limit
 */
export function recallAt(stmt, table, match, oracle, k) {
	const out = { found: 0, hit: 0, err: null };
	try {
		const rows = stmt[table](k).all(match);
		out.found = rows.length;
		const set = new Set(rows.map((r) => r.rowid));
		for (const id of oracle) if (set.has(id)) out.hit++;
		out.recall = oracle.length > 0 ? out.hit / oracle.length : null;
	} catch (e) {
		out.err = String(e.message || e).split("\n")[0];
	}
	return out;
}
