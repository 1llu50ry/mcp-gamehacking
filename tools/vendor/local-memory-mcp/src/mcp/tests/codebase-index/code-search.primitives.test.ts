import { describe, it, expect } from "vitest";
import {
	grepContent,
	compileCodeSearchRegex,
	InvalidCodeSearchRegexError,
	findEnclosingSymbol
} from "../../codebase-index/services/code-search.js";
import type { CodebaseSymbol } from "../../types.js";
import { CODE_SEARCH_MAX_REGEX_LENGTH } from "../../utils/constants.js";
import { formatDocComment } from "../../utils/doc-comment-format.js";

function mkSymbol(name: string, kind: string, startLine: number | null, endLine: number | null): CodebaseSymbol {
	return {
		id: `id-${name}`,
		repo: "unit",
		file_path: "f.ts",
		name,
		kind,
		exported: true,
		default_export: false,
		start_line: startLine,
		start_col: null,
		end_line: endLine,
		end_col: null,
		signature: null,
		doc_comment: null,
		parent_symbol_id: null,
		created_at: "",
		updated_at: ""
	};
}

describe("grepContent", () => {
	it("substring match is case-insensitive, reports line + match index + snippet", () => {
		const content = "Hello World\nfoo BAR baz\n";
		const matches = grepContent(content, "bar", null);
		expect(matches).toEqual([{ line: 2, matchIndex: 4, snippet: "foo BAR baz" }]);
	});

	it("reports only the FIRST substring match per line", () => {
		const matches = grepContent("bar bar bar\n", "bar", null);
		expect(matches).toEqual([{ line: 1, matchIndex: 0, snippet: "bar bar bar" }]);
	});

	it("matches regex case-insensitively", () => {
		const content = "const x = 42;\nconst y = 7;\n";
		const re = compileCodeSearchRegex("\\d+");
		expect(grepContent(content, "\\d+", re)).toEqual([
			{ line: 1, matchIndex: 10, snippet: "const x = 42;" },
			{ line: 2, matchIndex: 10, snippet: "const y = 7;" }
		]);
	});

	it("normalizes CRLF line endings", () => {
		const matches = grepContent("one\r\ntwo\r\n", "two", null);
		expect(matches).toEqual([{ line: 2, matchIndex: 0, snippet: "two" }]);
	});

	it("ellipsizes snippets on long lines", () => {
		const long = `aaaa${"x".repeat(60)}NEEDLE${"y".repeat(60)}zzzz`;
		const matches = grepContent(long, "NEEDLE", null);
		expect(matches).toHaveLength(1);
		const snippet = matches[0].snippet;
		// radius 40 each side + 6-char match + 2 ellipses
		expect(snippet.length).toBeLessThanOrEqual(80 + 6 + 2);
		expect(snippet.startsWith("…")).toBe(true);
		expect(snippet.endsWith("…")).toBe(true);
		expect(snippet).toContain("NEEDLE");
	});

	it("no matches → empty array", () => {
		expect(grepContent("abc\n", "zzz", null)).toEqual([]);
	});
});

describe("compileCodeSearchRegex", () => {
	it("throws InvalidCodeSearchRegexError for a bad pattern", () => {
		expect(() => compileCodeSearchRegex("[")).toThrow(InvalidCodeSearchRegexError);
		expect(() => compileCodeSearchRegex("(unclosed")).toThrow(InvalidCodeSearchRegexError);
	});

	// ── ReDoS guard (TASK-344) ───────────────────────────────────────────────
	// V8 has no RegExp timeout and the compiled regex runs per line against
	// indexed files (10-100KB minified lines) on the PROCESS-SHARED server, so
	// catastrophic patterns must be rejected BEFORE `new RegExp` — surfacing the
	// INVALID_REGEX envelope instead of stalling every agent session.

	it("rejects catastrophic (ReDoS) patterns with nested unbounded quantifiers", () => {
		const catastrophic = ["^(a+)+$", "(a|aa)+$", "(a+)*b", "(a*)*", "(a|a?)+", "((ab)+)+", "(.*a){100}"];
		for (const needle of catastrophic) {
			expect(() => compileCodeSearchRegex(needle), `should reject: ${needle}`).toThrow(InvalidCodeSearchRegexError);
		}
	});

	it("rejects over-length patterns beyond CODE_SEARCH_MAX_REGEX_LENGTH", () => {
		const overLength = "a".repeat(CODE_SEARCH_MAX_REGEX_LENGTH + 1);
		expect(() => compileCodeSearchRegex(overLength)).toThrow(InvalidCodeSearchRegexError);
	});

	it("compiles a pattern exactly at the CODE_SEARCH_MAX_REGEX_LENGTH boundary", () => {
		// Exactly at the cap: a long but simple pattern must still compile.
		const atLimit = `${"a".repeat(CODE_SEARCH_MAX_REGEX_LENGTH - 1)}b`;
		expect(compileCodeSearchRegex(atLimit)).toBeInstanceOf(RegExp);
	});

	it("still compiles benign patterns (substring mode unaffected)", () => {
		for (const needle of ["foo.*bar", "\\b\\d{2,4}\\b", "\\d+", "(ab)+", "(foo|bar)", "(?<=const )\\w+"]) {
			expect(() => compileCodeSearchRegex(needle), `should compile: ${needle}`).not.toThrow();
		}
		// Compiled output remains a working, case-insensitive regex.
		const re = compileCodeSearchRegex("foo.*bar");
		expect(re.test("FOO x BAR")).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("findEnclosingSymbol", () => {
	it("picks the innermost enclosing symbol (smallest span)", () => {
		const symbols = [
			mkSymbol("outer", "class", 1, 30),
			mkSymbol("middle", "function", 5, 25),
			mkSymbol("inner", "method", 10, 15)
		];
		expect(findEnclosingSymbol(symbols, 12)).toEqual({
			name: "inner",
			kind: "method",
			startLine: 10,
			endLine: 15,
			docComment: null
		});
		expect(findEnclosingSymbol(symbols, 3)).toEqual({
			name: "outer",
			kind: "class",
			startLine: 1,
			endLine: 30,
			docComment: null
		});
		expect(findEnclosingSymbol(symbols, 50)).toBeNull();
	});

	it("breaks a true tie by earlier start line", () => {
		// Real tie: identical span SIZE (10) and both enclose line 15, but
		// DIFFERENT start lines. 'a' comes first in iteration order; 'b' must
		// still win on the earlier start — proving the tie-break, not just
		// first-in-order precedence.
		const symbols = [mkSymbol("a", "function", 12, 22), mkSymbol("b", "function", 10, 20)];
		const result = findEnclosingSymbol(symbols, 15);
		expect(result).toEqual({ name: "b", kind: "function", startLine: 10, endLine: 20, docComment: null });
	});

	it("identical span and start lines keep the first symbol in order", () => {
		// Full tie (identical span AND identical start) cannot be broken by
		// the documented rule, so the implementation keeps the first symbol in
		// iteration order deterministically.
		const symbols = [mkSymbol("b", "function", 10, 20), mkSymbol("a", "function", 10, 20)];
		const result = findEnclosingSymbol(symbols, 15);
		expect(result?.name).toBe("b");
	});

	it("ignores symbols without spans", () => {
		const symbols = [mkSymbol("noSpan", "function", null, null), mkSymbol("real", "function", 1, 5)];
		expect(findEnclosingSymbol(symbols, 2)).toEqual({
			name: "real",
			kind: "function",
			startLine: 1,
			endLine: 5,
			docComment: null
		});
	});

	it("docComment is carried into EnclosingSymbol (TASK-460)", () => {
		const symbols: CodebaseSymbol[] = [
			{
				id: "1",
				repo: "unit",
				file_path: "f.ts",
				name: "docced",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 1,
				start_col: 0,
				end_line: 10,
				end_col: 1,
				signature: null,
				doc_comment: "Does the thing",
				parent_symbol_id: null,
				created_at: "",
				updated_at: ""
			}
		];
		expect(findEnclosingSymbol(symbols, 5)?.docComment).toBe("Does the thing");
		expect(findEnclosingSymbol(symbols, 50)).toBeNull();
	});

	it("formatDocComment collapses to compact line and truncates >140 chars with ellipsis", () => {
		expect(formatDocComment(null)).toBeNull();
		expect(formatDocComment("")).toBeNull();
		expect(formatDocComment("Short summary.")).toBe("Short summary.");
		const long = `${"x".repeat(200)}\nsecond line @param y`;
		const out = formatDocComment(long)!;
		expect(out.length).toBeLessThanOrEqual(140);
		expect(out.endsWith("…")).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR — searchCodeInRepo
// ═══════════════════════════════════════════════════════════════════════════
