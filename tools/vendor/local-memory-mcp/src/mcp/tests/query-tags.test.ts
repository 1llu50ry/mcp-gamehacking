import { describe, it, expect } from "vitest";
import {
	parseTaggedQuery,
	unionStrings,
	STANDARD_READ_TAG_KEYS,
	MEMORY_READ_TAG_KEYS,
	CODEBASE_READ_TAG_KEYS
} from "../utils/query-tags";

// ── Unit: parseTaggedQuery ─────────────────────────────────────────────────

describe("parseTaggedQuery — unit", () => {
	// (a) extracts a single scalar tag
	it("(a) extracts a single scalar tag into filters", () => {
		const { query, filters } = parseTaggedQuery("language:php", STANDARD_READ_TAG_KEYS);
		expect(query).toBe("");
		expect(filters.language).toBe("php");
	});

	// (b) multi-value comma → array
	it("(b) splits a comma value into a deduped array", () => {
		const { filters } = parseTaggedQuery("tags:a,b,c,a", STANDARD_READ_TAG_KEYS);
		expect(filters.tags).toEqual(["a", "b", "c"]);
	});

	// (c) unknown key left in the residual query as plain text
	it("(c) leaves unknown keys verbatim in the residual query", () => {
		const { query, filters } = parseTaggedQuery("label:ddd language:php", STANDARD_READ_TAG_KEYS);
		expect(query).toBe("label:ddd");
		expect(filters.language).toBe("php");
		expect("label" in filters).toBe(false);
	});

	// (d) boolean parse for is_global
	it("(d) parses is_global booleans (true/1 → true, false/0 → false)", () => {
		expect(parseTaggedQuery("is_global:true", STANDARD_READ_TAG_KEYS).filters.is_global).toBe(true);
		expect(parseTaggedQuery("is_global:1", STANDARD_READ_TAG_KEYS).filters.is_global).toBe(true);
		expect(parseTaggedQuery("is_global:false", STANDARD_READ_TAG_KEYS).filters.is_global).toBe(false);
		expect(parseTaggedQuery("is_global:0", STANDARD_READ_TAG_KEYS).filters.is_global).toBe(false);
	});

	// (e) tags stripped from the residual query so FTS won't see "language:php"
	it("(e) strips tags from the residual query (fixes FTS colon-stripping bug)", () => {
		const { query } = parseTaggedQuery("auth language:php stack:laravel", STANDARD_READ_TAG_KEYS);
		expect(query).toBe("auth");
		expect(query).not.toContain("language:php");
		expect(query).not.toContain("stack:laravel");
	});

	// (f) nested scope object built
	it("(f) builds a nested scope object for scope-nested keys", () => {
		const { filters } = parseTaggedQuery("lang:php", MEMORY_READ_TAG_KEYS);
		expect(filters.scope).toEqual({ language: "php" });
	});

	it("(f.2) scopes owner/repo under filters.scope (protected, structured wins anyway)", () => {
		const { filters } = parseTaggedQuery("owner:acme repo:myrepo", MEMORY_READ_TAG_KEYS);
		expect(filters.scope).toEqual({ owner: "acme", repo: "myrepo" });
	});

	it("union of multiple tokens for the same array param", () => {
		const { filters } = parseTaggedQuery("stack:laravel stack:vue tags:a", STANDARD_READ_TAG_KEYS);
		expect(filters.stack).toEqual(["laravel", "vue"]);
		expect(filters.tags).toEqual(["a"]);
	});

	it("empty / whitespace query returns empty filters", () => {
		expect(parseTaggedQuery("", STANDARD_READ_TAG_KEYS)).toEqual({ query: "", filters: {} });
		expect(parseTaggedQuery("   ", STANDARD_READ_TAG_KEYS)).toEqual({ query: "", filters: {} });
	});

	it("CODEBASE_REPOS_DIR-style alias keys resolve (lang→language, kind→array)", () => {
		const r1 = parseTaggedQuery("lang:ts", CODEBASE_READ_TAG_KEYS);
		expect(r1.filters.language).toBe("ts");
		const r2 = parseTaggedQuery("kind:function,class", CODEBASE_READ_TAG_KEYS);
		expect(r2.filters.kind).toEqual(["function", "class"]);
	});

	it("file/path alias maps to filePath scalar", () => {
		const { filters } = parseTaggedQuery("file:src/foo.ts", CODEBASE_READ_TAG_KEYS);
		expect(filters.filePath).toBe("src/foo.ts");
	});
});

// ── Unit: unionStrings helper ───────────────────────────────────────────────

describe("unionStrings", () => {
	it("unions and dedupes across lists, preserving first-seen order", () => {
		expect(unionStrings(["a", "b"], ["b", "c"], undefined)).toEqual(["a", "b", "c"]);
	});

	it("handles undefined lists", () => {
		expect(unionStrings(undefined, ["x"])).toEqual(["x"]);
		expect(unionStrings()).toEqual([]);
	});
});
