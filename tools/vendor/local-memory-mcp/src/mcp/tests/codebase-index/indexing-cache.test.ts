/**
 * indexing-cache utility tests — validates countLines line counting.
 *
 * countLines uses a character scan instead of String.split; these cases
 * pin the contract: empty → 0, non-empty → 1 + count of "\n".
 */

import { describe, it, expect } from "vitest";
import { countLines } from "../../codebase-index/services/indexing-cache";

describe("countLines", () => {
	it("returns 0 for empty content", () => {
		expect(countLines("")).toBe(0);
	});

	it("returns 1 for a single line without trailing newline", () => {
		expect(countLines("const x = 1;")).toBe(1);
	});

	it("counts lines split by \\n without a trailing newline", () => {
		expect(countLines("line1\nline2\nline3")).toBe(3);
	});

	it("a trailing newline still terminates a line (1 + #\\n)", () => {
		expect(countLines("line1\nline2\n")).toBe(3);
	});

	it("counts blank lines between content", () => {
		expect(countLines("a\n\nb")).toBe(3);
	});
});
