import { describe, it, expect } from "vitest";
import { looksLikeTaskCode } from "../../utils/code-shape";

// FIX-027 — unit coverage for the short-code shape detector that powers the
// "use 'code' instead of 'id'" hint. Mirrors src/mcp/utils/code-shape.ts per
// .agents/documents/testing.md §2.1.

const UUID = "d8597488-f19c-4958-96b9-1dee148f2e91";

describe("code-shape — looksLikeTaskCode", () => {
	it("positive: recognises single- and multi-segment short codes", () => {
		expect(looksLikeTaskCode("TASK-431")).toBe(true);
		expect(looksLikeTaskCode("FIX-027")).toBe(true);
		expect(looksLikeTaskCode("FIX-559-2")).toBe(true);
		expect(looksLikeTaskCode("BULK-001")).toBe(true);
		expect(looksLikeTaskCode("  TASK-431  ")).toBe(true); // trimmed
	});

	it("negative: a UUID is explicitly excluded", () => {
		expect(looksLikeTaskCode(UUID)).toBe(false);
	});

	it("negative: bare tokens, placeholder shapes and non-strings do NOT match", () => {
		expect(looksLikeTaskCode("T01")).toBe(false);
		expect(looksLikeTaskCode("abc123")).toBe(false);
		expect(looksLikeTaskCode("-leading")).toBe(false);
		expect(looksLikeTaskCode("trailing-")).toBe(false);
		expect(looksLikeTaskCode("")).toBe(false);
		expect(looksLikeTaskCode("   ")).toBe(false);
		expect(looksLikeTaskCode(431)).toBe(false);
		expect(looksLikeTaskCode(undefined)).toBe(false);
	});
});
