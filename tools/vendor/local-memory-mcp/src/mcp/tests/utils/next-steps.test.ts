import { describe, it, expect } from "vitest";
import { extractNextSteps } from "../../utils/next-steps";

describe("extractNextSteps", () => {
	it("joins steps with '; '", () => {
		expect(extractNextSteps({ next_steps: ["run tests", "push branch"] })).toBe("run tests; push branch");
	});

	it("returns a single step verbatim", () => {
		expect(extractNextSteps({ next_steps: ["run tests"] })).toBe("run tests");
	});

	it("coerces non-string step values", () => {
		expect(extractNextSteps({ next_steps: [1, true, null] })).toBe("1; true; null");
	});

	it("truncates joined steps longer than 300 chars with an ellipsis", () => {
		const long = Array.from({ length: 40 }, (_, i) => `step number ${i} with some padding text`).join("; ");
		const result = extractNextSteps({ next_steps: long.split("; ") });
		expect(result.length).toBe(303);
		expect(result.endsWith("...")).toBe(true);
		expect(result.slice(0, 300)).toBe(long.slice(0, 300));
	});

	it("keeps a joined string of exactly 300 chars untruncated", () => {
		expect(extractNextSteps({ next_steps: ["x".repeat(300)] })).toBe("x".repeat(300));
	});

	it("returns an empty string for a missing or non-array next_steps", () => {
		expect(extractNextSteps(undefined)).toBe("");
		expect(extractNextSteps({})).toBe("");
		expect(extractNextSteps({ next_steps: "not-an-array" })).toBe("");
	});

	it("returns an empty string for an empty steps array", () => {
		expect(extractNextSteps({ next_steps: [] })).toBe("");
	});
});
