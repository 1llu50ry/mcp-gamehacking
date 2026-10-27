import { describe, it, expect } from "vitest";
import { UUID_REGEX } from "../../utils/uuid";

describe("UUID_REGEX", () => {
	it("matches canonical lowercase UUIDs", () => {
		expect(UUID_REGEX.test("d8597488-f19c-4958-96b9-1dee148f2e91")).toBe(true);
	});

	it("matches uppercase UUIDs (case-insensitive flag)", () => {
		expect(UUID_REGEX.test("D8597488-F19C-4958-96B9-1DEE148F2E91")).toBe(true);
	});

	it("rejects non-UUID strings", () => {
		expect(UUID_REGEX.test("not-a-uuid")).toBe(false);
		expect(UUID_REGEX.test("12345")).toBe(false);
	});

	it("rejects UUIDs with wrong segment lengths", () => {
		// Last group has 11 hex digits instead of 12.
		expect(UUID_REGEX.test("d8597488-f19c-4958-96b9-1dee148f2e9")).toBe(false);
		// First group has 7 hex digits instead of 8.
		expect(UUID_REGEX.test("d859748-f19c-4958-96b9-1dee148f2e91")).toBe(false);
	});

	it("rejects UUIDs without hyphens", () => {
		expect(UUID_REGEX.test("d8597488f19c495896b91dee148f2e91")).toBe(false);
	});

	it("rejects non-hex characters", () => {
		expect(UUID_REGEX.test("g8597488-f19c-4958-96b9-1dee148f2e91")).toBe(false);
	});
});
