/**
 * Query fixtures + FTS match-shape builder + the ground-truth oracle for the
 * mid-word fallback benchmark (TASK-483).
 *
 * Query classes:
 *   - `short`   : 2-4 char PREFIX / whole-word queries. unicode61 FTS5 (prefix-`*`
 *                 shape) surfaces these, so the fallback must stay GATED OFF and
 *                 contribute no added latency.
 *   - `midword` : 2-4 char INTERNAL-substring queries (e.g. "tor" inside
 *                 "vectorization"). unicode61 cannot surface these, so the FTS
 *                 baseline recall is ~0%; the bounded fallback is what recovers
 *                 them.
 *
 * The oracle is the permanent production fallback semantics: a case-insensitive
 * substring match (LIKE '%q%') over title + content + tags, scoped to owner/repo.
 * FTS recall and fallback recall are both measured against this oracle.
 */
import Database from "better-sqlite3";

// Canonical FTS match builder (mirrors src/mcp/utils — prefix-`*` per term,
// phrases verbatim, AND, cap 8). unicode61 production shape.
export function buildFtsMatchQuery(raw) {
	if (!raw) return "";
	const trimmed = raw.trim();
	if (!trimmed) return "";
	const phrases = [];
	const phraseRanges = [];
	const re = /"([^"]+)"/g;
	let m;
	while ((m = re.exec(trimmed)) !== null) {
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

export const SHORT_QUERIES = ["vec", "mem", "tok", "ind", "cac", "sql", "opt", "ser", "nor", "sea"];

export const MIDWORD_QUERIES = ["tor", "ory", "dex", "zer", "lit", "ize", "ken", "to", "ex", "iz"];

export const QUERIES = [
	...SHORT_QUERIES.map((q) => ({ cls: "short", q })),
	...MIDWORD_QUERIES.map((q) => ({ cls: "midword", q }))
];

/**
 * Build a case-insensitive substring oracle (LIKE '%q%') scoped to owner/repo.
 * Returns oracleRows(q) -> array of row ids (the ground-truth hit set).
 */
export function createOracle(db, owner, repo) {
	const stmt = db.prepare(
		`SELECT id FROM memories WHERE owner = ? AND repo = ? AND status = 'active' AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)`
	);
	return function oracleRows(q) {
		const pat = `%${q}%`;
		return stmt.all(owner, repo, pat, pat, pat).map((r) => r.id);
	};
}

/**
 * Run the unicode61 FTS baseline for a query, scoped to owner/repo, returns the
 * array of row ids (bm25 ordered, capped at `limit`).
 */
export function runFtsBaseline(db, query, owner, repo, limit = 200) {
	const safe = buildFtsMatchQuery(query);
	if (!safe) return [];
	try {
		return db
			.prepare(
				`SELECT m.id FROM memories_fts fts JOIN memories m ON m.id = fts.rowid WHERE memories_fts MATCH ? AND m.owner = ? AND m.repo = ? AND m.status = 'active' ORDER BY bm25(memories_fts) LIMIT ?`
			)
			.all(safe, owner, repo, limit)
			.map((r) => r.id);
	} catch {
		return [];
	}
}

// Re-export for callers that want a bare Database type annotation.
export { Database };
