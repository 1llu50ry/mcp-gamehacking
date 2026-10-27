import { describe, it, expect } from "vitest";
import {
	ORCHESTRATOR_PLACEHOLDER_CODE_PATTERN,
	isOrchestratorPlaceholderCode,
	orchestratorPlaceholderMessage,
	assertNotOrchestratorPlaceholder
} from "../utils/placeholder-code";
import { toErrorResponse } from "../utils/mcp-error";

/**
 * FIX-021 — reserved orchestrator template placeholders (T01/R01/Q01/…) must be
 * recognized as unsubstituted template tokens and surface an actionable
 * VALIDATION_ERROR, while genuinely unknown real codes keep the normal
 * not-found and valid codes are untouched.
 */
describe("orchestrator placeholder-code detection (FIX-021)", () => {
	it("positive: recognizes every reserved prefix with exactly two digits", () => {
		for (const code of ["T01", "R01", "Q01", "FIX01", "FEAT01", "PERF01", "DEBT01", "P01", "G01"]) {
			expect(isOrchestratorPlaceholderCode(code)).toBe(true);
		}
		// Case-insensitive in practice is NOT claimed — reserved tokens are
		// uppercase; lowercase real codes must pass through.
		expect(isOrchestratorPlaceholderCode("t01")).toBe(false);
	});

	it("negative: real codes with a separator or different digit count are NOT placeholders", () => {
		// Real codes in this repo are `PREFIX-NNN` (TASK-426, FIX-021) or
		// arbitrary user codes — none collide with the reserved shape.
		for (const code of ["TASK-99999", "TASK-426", "FIX-021", "T01-2", "T1", "T001", "R01x", "P-01", "G2", ""]) {
			expect(isOrchestratorPlaceholderCode(code)).toBe(false);
		}
	});

	it("negative: non-string values are never placeholders", () => {
		expect(isOrchestratorPlaceholderCode(undefined)).toBe(false);
		expect(isOrchestratorPlaceholderCode(null)).toBe(false);
		expect(isOrchestratorPlaceholderCode(101)).toBe(false);
	});

	it("the reserved pattern matches the documented shape", () => {
		expect(ORCHESTRATOR_PLACEHOLDER_CODE_PATTERN.test("T01")).toBe(true);
		expect(ORCHESTRATOR_PLACEHOLDER_CODE_PATTERN.test("TASK-001")).toBe(false);
	});

	it("builds an actionable message naming the placeholder and the remedy", () => {
		const message = orchestratorPlaceholderMessage("T01");
		expect(message).toContain("'T01'");
		expect(message).toContain("unsubstituted orchestrator template placeholder");
		expect(message).toContain("task-read");
	});

	it("assert throws for a reserved placeholder and is a no-op for everything else", () => {
		expect(() => assertNotOrchestratorPlaceholder("T01")).toThrow(/unsubstituted orchestrator template placeholder/);
		expect(() => assertNotOrchestratorPlaceholder("R01")).toThrow();
		expect(() => assertNotOrchestratorPlaceholder("Q01")).toThrow();
		expect(() => assertNotOrchestratorPlaceholder("TASK-99999")).not.toThrow();
		expect(() => assertNotOrchestratorPlaceholder(undefined)).not.toThrow();
		expect(() => assertNotOrchestratorPlaceholder(null)).not.toThrow();
	});

	it("classifies the placeholder error as VALIDATION_ERROR (not INTERNAL_ERROR)", () => {
		const res = toErrorResponse(new Error(orchestratorPlaceholderMessage("T01")));
		expect(res.isError).toBe(true);
		expect(res.structuredContent).toMatchObject({
			schema: "tool-error",
			code: "VALIDATION_ERROR",
			retryable: false
		});
		expect((res.structuredContent as { message: string }).message).toContain("'T01'");
	});
});
