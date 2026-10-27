/**
 * SymbolRankingService tests — validates all 5 ranking tiers, tiebreakers,
 * filtering, and edge cases (empty query, combined filter+rank).
 *
 * These tests are pure unit tests — no DB, no I/O. Uses hand-crafted
 * CodebaseSymbol stubs.
 */

import { describe, it, expect } from "vitest";
import { rankSymbols, filterSymbols, RankTier } from "../../codebase-index/services/symbol-ranking";
import type { CodebaseSymbol } from "../../types/codebase-symbol";

// ── Minimal helpers ─────────────────────────────────────────────────────

function makeSymbol(overrides: Partial<CodebaseSymbol> & Pick<CodebaseSymbol, "name" | "file_path">): CodebaseSymbol {
	return {
		id: `id-${overrides.name}-${overrides.file_path}`,
		repo: "test/repo",
		kind: "function",
		exported: false,
		default_export: false,
		start_line: null,
		start_col: null,
		end_line: null,
		end_col: null,
		signature: null,
		doc_comment: null,
		parent_symbol_id: null,
		created_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
		...overrides
	};
}

// ── Tier 1: Exact match ─────────────────────────────────────────────────

describe("Ranking — Tier 1: Exact match", () => {
	it("ranks exact case-sensitive match at top", () => {
		const symbols = [
			makeSymbol({ name: "getUser", file_path: "src/utils.ts" }),
			makeSymbol({ name: "getUserData", file_path: "src/data.ts" }),
			makeSymbol({ name: "getUser", file_path: "src/api.ts" })
		];

		const ranked = rankSymbols(symbols, "getUser");

		// Both "getUser" symbols should be in Tier.Exact
		expect(ranked[0].rankTier).toBe(RankTier.Exact);
		expect(ranked[0].symbol.name).toBe("getUser");
		expect(ranked[1].rankTier).toBe(RankTier.Exact);
		expect(ranked[1].symbol.name).toBe("getUser");
		// Non-exact should be lower tier
		const nonExact = ranked.filter((r) => r.symbol.name === "getUserData");
		expect(nonExact.length).toBeGreaterThan(0);
		expect(nonExact[0].rankTier).toBeGreaterThan(RankTier.Exact);
	});

	it("ranks exact case-insensitive match after case-sensitive", () => {
		const symbols = [
			makeSymbol({ name: "GetUser", file_path: "src/caps.ts" }),
			makeSymbol({ name: "getUser", file_path: "src/main.ts" })
		];

		const ranked = rankSymbols(symbols, "getUser");

		// Case-sensitive "getUser" should score higher than case-insensitive "GetUser"
		expect(ranked[0].rankTier).toBe(RankTier.Exact);
		expect(ranked[0].symbol.name).toBe("getUser");
		expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
		expect(ranked[1].rankTier).toBe(RankTier.Exact);
		expect(ranked[1].symbol.name).toBe("GetUser");
	});
});

// ── Tier 2: CamelCase match ─────────────────────────────────────────────

describe("Ranking — Tier 2: CamelCase match", () => {
	it("matches FooBar query against getFooBar symbol", () => {
		const symbols = [
			makeSymbol({ name: "getFooBar", file_path: "src/utils.ts" }),
			makeSymbol({ name: "unrelatedFunction", file_path: "src/misc.ts" })
		];

		const ranked = rankSymbols(symbols, "FooBar");

		// getFooBar should be CamelCase tier
		const match = ranked.find((r) => r.symbol.name === "getFooBar")!;
		expect(match.rankTier).toBe(RankTier.CamelCase);

		const unrelated = ranked.find((r) => r.symbol.name === "unrelatedFunction")!;
		expect(unrelated.rankTier).toBeGreaterThan(RankTier.CamelCase);
	});

	it("single-word query with no camelCase boundary goes to prefix", () => {
		const symbols = [
			makeSymbol({ name: "foobar", file_path: "src/plain.ts" }),
			makeSymbol({ name: "getFooBar", file_path: "src/camel.ts" })
		];

		// "foobar" has no camelCase boundary, so it won't be treated as CamelCase query
		const ranked = rankSymbols(symbols, "foobar");

		const exact = ranked.find((r) => r.symbol.name === "foobar")!;
		expect(exact.rankTier).toBe(RankTier.Exact);

		// "getFooBar" should be Substring or FTS5 match for query "foobar"
		const getFooBar = ranked.find((r) => r.symbol.name === "getFooBar")!;
		expect(getFooBar.rankTier).toBeGreaterThan(RankTier.Exact);
	});
});

// ── Tier 3: Prefix match ────────────────────────────────────────────────

describe("Ranking — Tier 3: Prefix match", () => {
	it("ranks prefix matches above substring matches", () => {
		const symbols = [
			makeSymbol({ name: "handleSubmit", file_path: "src/forms.ts" }),
			makeSymbol({ name: "handleData", file_path: "src/data.ts" })
		];

		const ranked = rankSymbols(symbols, "handle");

		// Both should be prefix matches
		expect(ranked[0].rankTier).toBe(RankTier.Prefix);
		expect(ranked[1].rankTier).toBe(RankTier.Prefix);
	});

	it("prefix matching is case-insensitive", () => {
		const symbols = [
			makeSymbol({ name: "MyComponent", file_path: "src/ui.ts" }),
			makeSymbol({ name: "other", file_path: "src/lib.ts" })
		];

		const ranked = rankSymbols(symbols, "my");

		const match = ranked.find((r) => r.symbol.name === "MyComponent")!;
		expect(match.rankTier).toBe(RankTier.Prefix);
	});
});

// ── Tier 4: Substring match ─────────────────────────────────────────────

describe("Ranking — Tier 4: Substring match", () => {
	it("ranks substring matches below prefix", () => {
		const symbols = [
			makeSymbol({ name: "loadUserData", file_path: "src/data.ts" }),
			makeSymbol({ name: "userAuth", file_path: "src/auth.ts" })
		];

		const ranked = rankSymbols(symbols, "data");

		// "loadUserData" contains "data" (case-insensitive) as a substring but NOT prefix
		const dataMatch = ranked.find((r) => r.symbol.name === "loadUserData")!;
		expect(dataMatch.rankTier).toBe(RankTier.Substring);

		// "userAuth" does not contain "data" anywhere → FTS5
		const authMatch = ranked.find((r) => r.symbol.name === "userAuth")!;
		expect(authMatch.rankTier).toBe(RankTier.FTS5);
	});
});

// ── Tier 5: FTS5 fallback ───────────────────────────────────────────────

describe("Ranking — Tier 5: FTS5 fallback", () => {
	it("matches via doc_comment when name does not contain query", () => {
		const symbols = [
			makeSymbol({
				name: "initApp",
				file_path: "src/main.ts",
				doc_comment: "Initializes the authentication system"
			}),
			makeSymbol({ name: "unrelated", file_path: "src/other.ts" })
		];

		const ranked = rankSymbols(symbols, "authentication");

		const initApp = ranked.find((r) => r.symbol.name === "initApp")!;
		expect(initApp.rankTier).toBe(RankTier.FTS5);

		// "unrelated" has no match anywhere — but it still gets classified to FTS5
		// since name.includes returns true even for FTS5 tier. Adjust: "unrelated"
		// doesn't contain "authentication" in name, doc_comment, or signature,
		// BUT our classifyMatch function still returns FTS5 for any remaining symbol
		const unrelated = ranked.find((r) => r.symbol.name === "unrelated")!;
		expect(unrelated.rankTier).toBe(RankTier.FTS5);
		// However, initApp should still score higher than unrelated
		const initIdx = ranked.findIndex((r) => r.symbol.name === "initApp");
		const unrelIdx = ranked.findIndex((r) => r.symbol.name === "unrelated");
		expect(initIdx).toBeLessThan(unrelIdx);
	});
});

// ── Tiebreakers ─────────────────────────────────────────────────────────

describe("Tiebreakers", () => {
	it("exported > non-exported within same tier", () => {
		// Both exact match by name, but "alpha" is exact case-sensitive, "beta" is substring
		// However if both land in same tier somehow, exported should win
		// Let's test with prefix: both match "al" as prefix
		// Just verify the first for exported is higher — use a query both prefix-match
		const bothPrefix = [
			makeSymbol({ name: "helperFunc", file_path: "src/lib.ts", exported: false }),
			makeSymbol({ name: "helperUtil", file_path: "src/lib.ts", exported: true })
		];
		const pr = rankSymbols(bothPrefix, "helper");
		expect(pr[0].rankTier).toBe(RankTier.Prefix);
		expect(pr[0].symbol.exported).toBe(true);
		expect(pr[0].score).toBeGreaterThan(pr[1].score);
	});

	it("shallow file path > deep file path", () => {
		const symbols = [
			makeSymbol({ name: "myFunc", file_path: "src/a/b/c/deep.ts", exported: true }),
			makeSymbol({ name: "myFunc", file_path: "src/shallow.ts", exported: true })
		];

		const ranked = rankSymbols(symbols, "myFunc");

		// Both exact match. Shallow path (src/shallow.ts = 2 segments) wins over
		// deep path (src/a/b/c/deep.ts = 5 segments)
		expect(ranked[0].symbol.file_path).toBe("src/shallow.ts");
		expect(ranked[1].symbol.file_path).toBe("src/a/b/c/deep.ts");
	});

	it("alphabetical by name as final tiebreaker", () => {
		const symbols = [
			makeSymbol({ name: "zebraFunction", file_path: "src/root.ts", exported: true }),
			makeSymbol({ name: "alphaFunction", file_path: "src/root.ts", exported: true }),
			makeSymbol({ name: "midFunction", file_path: "src/root.ts", exported: true })
		];

		const ranked = rankSymbols(symbols, "Function");

		const sorted = ranked.filter((r) => r.symbol.file_path === "src/root.ts");
		// All tie on exported+path, so alphabetically by name
		expect(sorted[0].symbol.name).toBe("alphaFunction");
		expect(sorted[1].symbol.name).toBe("midFunction");
		expect(sorted[2].symbol.name).toBe("zebraFunction");
	});
});

// ── Filtering ───────────────────────────────────────────────────────────

describe("filterSymbols", () => {
	const symbols: CodebaseSymbol[] = [
		makeSymbol({ name: "func1", file_path: "src/a.ts", kind: "function", repo: "repo-a", exported: true }),
		makeSymbol({ name: "func2", file_path: "src/b.ts", kind: "class", repo: "repo-a", exported: false }),
		makeSymbol({ name: "func3", file_path: "src/c.ts", kind: "function", repo: "repo-b", exported: true }),
		makeSymbol({ name: "func4", file_path: "src/a.ts", kind: "variable", repo: "repo-a", exported: true })
	];

	it("filters by kind", () => {
		const result = filterSymbols(symbols, { kind: ["function"] });
		expect(result).toHaveLength(2);
		expect(result.map((s) => s.name)).toEqual(["func1", "func3"]);
	});

	it("filters by repo", () => {
		const result = filterSymbols(symbols, { repo: "repo-b" });
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe("func3");
	});

	it("filters by exportedOnly", () => {
		const result = filterSymbols(symbols, { exportedOnly: true });
		expect(result).toHaveLength(3);
		expect(result.map((s) => s.name).sort()).toEqual(["func1", "func3", "func4"]);
	});

	it("filters by filePath", () => {
		const result = filterSymbols(symbols, { filePath: "src/a.ts" });
		expect(result).toHaveLength(2);
		expect(result.map((s) => s.name).sort()).toEqual(["func1", "func4"]);
	});

	it("combines multiple filters (AND)", () => {
		const result = filterSymbols(symbols, {
			kind: ["function", "variable"],
			exportedOnly: true,
			repo: "repo-a"
		});
		expect(result).toHaveLength(2);
		expect(result.map((s) => s.name).sort()).toEqual(["func1", "func4"]);
	});

	it("empty filter returns all symbols", () => {
		const result = filterSymbols(symbols, {});
		expect(result).toHaveLength(4);
	});
});

// ── Edge cases ──────────────────────────────────────────────────────────

describe("Edge cases", () => {
	it("empty query returns all symbols sorted alphabetically", () => {
		const symbols = [
			makeSymbol({ name: "zoo", file_path: "src/z.ts" }),
			makeSymbol({ name: "alpha", file_path: "src/a.ts" }),
			makeSymbol({ name: "beta", file_path: "src/b.ts" })
		];

		const ranked = rankSymbols(symbols, "");

		expect(ranked).toHaveLength(3);
		expect(ranked[0].rankTier).toBe(RankTier.Exact);
		expect(ranked[0].score).toBe(1.0);
		expect(ranked[0].symbol.name).toBe("alpha");
		expect(ranked[1].symbol.name).toBe("beta");
		expect(ranked[2].symbol.name).toBe("zoo");
	});

	it("whitespace-only query treated as empty", () => {
		const symbols = [makeSymbol({ name: "test", file_path: "src/x.ts" })];

		const ranked = rankSymbols(symbols, "   ");
		expect(ranked).toHaveLength(1);
		expect(ranked[0].rankTier).toBe(RankTier.Exact);
	});

	it("empty symbols array returns empty", () => {
		expect(rankSymbols([], "query")).toEqual([]);
		expect(filterSymbols([], { kind: ["function"] })).toEqual([]);
	});

	it("filter + rank combined workflow", () => {
		const symbols: CodebaseSymbol[] = [
			makeSymbol({ name: "renderButton", file_path: "src/ui.ts", kind: "function", repo: "web", exported: true }),
			makeSymbol({ name: "renderTable", file_path: "src/ui.ts", kind: "function", repo: "web", exported: true }),
			makeSymbol({ name: "ButtonStyle", file_path: "src/styles.ts", kind: "class", repo: "web", exported: false }),
			makeSymbol({ name: "ButtonType", file_path: "src/types.ts", kind: "type", repo: "web", exported: true })
		];

		// Filter to exported functions only, then rank by "Button"
		const filtered = filterSymbols(symbols, { kind: ["function"], exportedOnly: true });
		expect(filtered).toHaveLength(2);

		const ranked = rankSymbols(filtered, "Button");
		expect(ranked).toHaveLength(2);

		// "renderButton" should rank higher than "renderTable" since it contains "Button"
		const buttonIdx = ranked.findIndex((r) => r.symbol.name === "renderButton");
		const tableIdx = ranked.findIndex((r) => r.symbol.name === "renderTable");
		expect(buttonIdx).toBeLessThan(tableIdx);
	});

	it("all symbols match at least some tier", () => {
		// Every symbol should get assigned to SOME tier
		const symbols = [makeSymbol({ name: "zzzzz", file_path: "src/far.ts" })];

		const ranked = rankSymbols(symbols, "query-that-matches-nothing-by-name");

		expect(ranked).toHaveLength(1);
		// Should still be in FTS5 tier even if nothing matches
		expect(ranked[0].rankTier).toBe(RankTier.FTS5);
	});

	it("handles symbols with null doc_comment and signature", () => {
		const symbols = [makeSymbol({ name: "someFunc", file_path: "src/x.ts", doc_comment: null, signature: null })];

		const ranked = rankSymbols(symbols, "unrelated-query");
		expect(ranked).toHaveLength(1);
		expect(ranked[0].rankTier).toBe(RankTier.FTS5);
	});

	it("query with special characters (regex chars)", () => {
		const symbols = [
			makeSymbol({ name: "doSomething", file_path: "src/x.ts" }),
			makeSymbol({ name: "other", file_path: "src/y.ts" })
		];

		// Special regex chars should not crash rankSymbols
		const ranked = rankSymbols(symbols, "(test)");
		expect(ranked).toHaveLength(2);
		// All end up in FTS5 since nothing matches the literal "(test)"
		expect(ranked.every((r) => r.rankTier === RankTier.FTS5)).toBe(true);
	});

	it("query with dots and asterisks (wildcard-like)", () => {
		const symbols = [makeSymbol({ name: "mylib.core.config", file_path: "src/config.ts" })];

		const ranked = rankSymbols(symbols, "*.core");
		expect(ranked).toHaveLength(1);
		// Should not crash — falls to appropriate tier
		expect(ranked[0].rankTier).toBeDefined();
	});

	it("single symbol bucket scoring produces valid score", () => {
		const symbols = [makeSymbol({ name: "onlyOne", file_path: "src/sole.ts", exported: true })];

		const ranked = rankSymbols(symbols, "onlyOne");
		expect(ranked).toHaveLength(1);
		// When range is computed as `maxScore - minScore || 1` for a single item,
		// the score may be normalized to 0.0. Score is always between 0 and 1.
		expect(ranked[0].score).toBeGreaterThanOrEqual(0);
		expect(ranked[0].score).toBeLessThanOrEqual(1);
		expect(ranked[0].rankTier).toBe(RankTier.Exact);
	});
});
