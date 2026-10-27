export const QUERY_SETS = [
	{ kind: "empty", query: "", note: "empty string — falls through to no-query path" },
	{ kind: "empty", query: "   ", note: "whitespace-only — normalized to empty" },
	{ kind: "short", query: "go", note: "<3 chars — below stopword/length gate" },
	{ kind: "short", query: "ui", note: "<3 chars" },
	{ kind: "short", query: "id", note: "<3 chars" },
	{ kind: "short", query: "e", note: "1 char pathological" },
	{ kind: "short", query: "AI", note: "2 char" },
	{ kind: "normal", query: "vector", note: "single token — common" },
	{ kind: "normal", query: "memory", note: "single token" },
	{ kind: "normal", query: "sqlite", note: "single token" },
	{ kind: "normal", query: "cache", note: "single token" },
	{ kind: "normal", query: "search index", note: "two tokens" },
	{
		kind: "long",
		query: "vector embedding semantic search hybrid scoring with bm25 and recency",
		note: "long multi-term"
	},
	{
		kind: "long",
		query: "workspace memory is indexed for fast semantic search across the project with multi-tenant isolation",
		note: "long sentence-length"
	},
	{ kind: "high-result", query: "memory", note: "high-result — matches many rows via stem family" },
	{ kind: "high-result", query: "vector", note: "high-result — dominant token" },
	{ kind: "high-result", query: "search", note: "high-result" },
	{ kind: "no-result", query: "zz_nonexistent_token_xyz_999", note: "zero-result orphan token" },
	{ kind: "no-result", query: "qqq_zzz_no_match_12345", note: "zero-result" },
	{ kind: "phrase", query: '"semantic search"', note: "quoted phrase" },
	{ kind: "cjk", query: "记忆", note: "CJK 2-char" },
	{ kind: "cjk", query: "向量", note: "CJK 2-char" },
	{ kind: "special", query: "data-pipeline", note: "hyphenated" },
	{ kind: "special", query: "better-sqlite3", note: "tech identifier with hyphen" }
];

export const WRITE_PAYLOAD_VARIANTS = [
	{ kind: "short", titleLen: 8, contentLen: 24 },
	{ kind: "normal", titleLen: 24, contentLen: 200 },
	{ kind: "long", titleLen: 48, contentLen: 2000 }
];
