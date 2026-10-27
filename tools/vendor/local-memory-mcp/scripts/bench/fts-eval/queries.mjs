/**
 * Query-set concern for the FTS5 tokenizer evaluation harness.
 *
 * Holds the labeled query set (recall classes), the "slow" latency/EXPLAIN
 * shapes, the production MATCH-shape builder (mirrors
 * src/mcp/utils/fts.ts buildFtsMatchQuery), and the LIKE-oracle helpers that
 * compute which rows the permanent production fallback would return.
 */

// Query set — labeled by recall class. Oracle = LIKE `%q%` on the raw string
// (the permanent production fallback), i.e. "rows a LIKE fallback would find".
export const QUERIES = [
	// Latin token-initial (unicode61 `*` prefix; trigram ≥3 substring).
	{ cls: "latin-token-initial", q: "vector" },
	{ cls: "latin-token-initial", q: "memory" },
	{ cls: "latin-token-initial", q: "sqlite" },
	{ cls: "latin-token-initial", q: "search" },
	{ cls: "latin-token-initial", q: "fts5" },
	{ cls: "latin-token-initial", q: "memo" },
	{ cls: "latin-token-initial", q: "vect" },
	{ cls: "latin-token-initial", q: "tokeniz" },
	// Latin mid-word (unicode61 prefix misses; trigram substring catches).
	{ cls: "latin-midword", q: "orkspace" },
	{ cls: "latin-midword", q: "ntent" },
	{ cls: "latin-midword", q: "emories" },
	{ cls: "latin-midword", q: "obust" },
	{ cls: "latin-midword", q: "ential" },
	{ cls: "latin-midword", q: "sisting" },
	// Technical identifiers (hyphens split for unicode61; trigram substring).
	{ cls: "tech-ident", q: "libsql" },
	{ cls: "tech-ident", q: "better-sqlite3" },
	{ cls: "tech-ident", q: "tree-sitter" },
	{ cls: "tech-ident", q: "supabase" },
	{ cls: "tech-ident", q: "zod" },
	{ cls: "tech-ident", q: "esbuild" },
	// Hyphenated / multi-token phrases.
	{ cls: "hyphen", q: "data-pipeline" },
	{ cls: "hyphen", q: "multi-tenant" },
	// CJK contiguous run, 2-char, token-initial (unicode61 prefix).
	{ cls: "cjk", q: "记忆" },
	{ cls: "cjk", q: "向量" },
	{ cls: "cjk", q: "语义" },
	{ cls: "cjk", q: "索引" },
	// CJK 2-char mid-run (unicode61 prefix misses; trigram <3 chars → 0).
	{ cls: "cjk-midrun", q: "理系" },
	{ cls: "cjk-midrun", q: "存层" },
	// CJK 3+ char contiguous run, token-initial (both catch ≥3 chars).
	{ cls: "cjk-run3", q: "管理系统" },
	{ cls: "cjk-run3", q: "数据库" },
	// CJK 3+ char mid-run substring (unicode61 prefix misses; trigram catches).
	{ cls: "cjk-3char", q: "理系统" },
	{ cls: "cjk-3char", q: "量搜索" },
	{ cls: "cjk-3char", q: "卷词" },
	// <3-char corner (trigram cannot index/query <3 chars → 0 rows).
	{ cls: "short", q: "ui" },
	{ cls: "short", q: "go" },
	{ cls: "short", q: "ts" },
	{ cls: "short", q: "id" },
	{ cls: "short", q: "e" },
	{ cls: "short", q: "AI" },
	// Case sensitivity (unicode61 folds case; trigram is case-sensitive).
	{ cls: "case", q: "VECTOR" },
	{ cls: "case", q: "SQLite" },
	// Diacritics (unicode61 remove_diacritics=1; trigram byte-sensitive).
	{ cls: "diacritic", q: "cafe" },
	// Indonesian.
	{ cls: "id", q: "manajemen" },
	{ cls: "id", q: "pengindeksan" },
	{ cls: "id", q: "kueri" },
	{ cls: "id", q: "memori" },
	{ cls: "id", q: "memakai" }
];

// Representative "slow" queries for latency + EXPLAIN (broad hits, multi-term,
// phrase, CJK).
export const SLOW_SHAPES = [
	{ name: "single-broad", q: "sqlite" },
	{ name: "single-cjk", q: "记忆" },
	{ name: "multi-and", q: "vector embedding semantic search" },
	{ name: "phrase", q: '"semantic search"' },
	{ name: "short-pathological", q: "e" }
];

// EXPLAIN QUERY PLAN shapes (subset of slow shapes).
export const EXPLAIN_SHAPES = [
	{ name: "single-broad", q: "sqlite" },
	{ name: "multi-and", q: "vector embedding semantic search" },
	{ name: "phrase", q: '"semantic search"' },
	{ name: "single-cjk", q: "记忆" }
];

export function buildFtsMatchQuery(raw) {
	// Mirror of src/mcp/utils/fts.ts buildFtsMatchQuery (production MATCH shape).
	if (!raw) return "";
	const trimmed = raw.trim();
	if (!trimmed) return "";
	const phrases = [];
	const phraseRanges = [];
	const phrasePattern = /"([^"]+)"/g;
	let m;
	while ((m = phrasePattern.exec(trimmed)) !== null) {
		const sanitized = (m[1] || "")
			.replace(/[^\p{L}\p{N}_\s]/gu, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (sanitized.length > 0) phrases.push(`"${sanitized}"`);
		phraseRanges.push({ start: m.index, end: m.index + m[0].length });
	}
	let remaining = "";
	let cursor = 0;
	for (const r of phraseRanges) {
		remaining += trimmed.slice(cursor, r.start) + " ";
		cursor = r.end;
	}
	remaining += trimmed.slice(cursor);
	const cleaned = remaining
		.replace(/["()*:~^+-]/g, " ")
		.replace(/[^\p{L}\p{N}_\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	const terms = cleaned
		.split(" ")
		.filter(Boolean)
		.map((t) => `${t}*`);
	const all = [...phrases, ...terms];
	if (all.length === 0) return "";
	return all.slice(0, 8).join(" AND ");
}

export function rawShape(matchExpr) {
	// Trigram native shape: strip the `*` prefix wildcards (trigram does
	// substring matching on every ≥3-char term natively).
	return matchExpr.replace(/\*/g, "");
}

/**
 * Build the LIKE-oracle helpers bound to a database. The oracle returns the
 * rows the permanent LIKE fallback would return for a given query:
 *   - `"phrase"`        → LIKE %phrase% (adjacent)
 *   - `a b c` (spaces)  → rows containing EVERY term (AND), by intersecting
 *     the per-term LIKE sets to match FTS AND semantics fairly
 *   - single term        → LIKE %term%
 *
 * @param {import("better-sqlite3").Database} db
 */
export function createOracle(db) {
	const likeOracle = db.prepare("SELECT id FROM memories WHERE content LIKE ? OR title LIKE ? OR tags LIKE ?");
	const likeIds = (needle) => likeOracle.all(`%${needle}%`, `%${needle}%`, `%${needle}%`).map((r) => r.id);
	const oracleRows = (q) => {
		const phrase = /"([^"]+)"/.exec(q);
		if (phrase) return likeIds(phrase[1].trim());
		const terms = q.trim().split(/\s+/).filter(Boolean);
		if (terms.length === 1) return likeIds(q.trim());
		let rows = likeIds(terms[0]);
		for (let i = 1; i < terms.length; i++) {
			const set = new Set(likeIds(terms[i]));
			rows = rows.filter((id) => set.has(id));
		}
		return rows;
	};
	return { likeIds, oracleRows };
}
