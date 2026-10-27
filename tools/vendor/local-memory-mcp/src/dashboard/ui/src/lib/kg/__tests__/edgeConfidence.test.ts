import { describe, expect, it } from "vitest";
import {
	EDGE_ALPHA_MULTIPLIERS,
	EDGE_BUCKET_COLORS,
	formatEdgeConfidenceLabel,
	getEdgeConfidenceBucket
} from "../edgeConfidence";

describe("getEdgeConfidenceBucket", () => {
	it("maps ≥0.85 to high (solid)", () => {
		expect(getEdgeConfidenceBucket(1)).toBe("high");
		expect(getEdgeConfidenceBucket(0.9)).toBe("high");
		expect(getEdgeConfidenceBucket(0.85)).toBe("high");
	});

	it("maps 0.6–0.85 to medium (amber)", () => {
		expect(getEdgeConfidenceBucket(0.8)).toBe("medium");
		expect(getEdgeConfidenceBucket(0.6)).toBe("medium");
	});

	it("maps <0.6 to low (dimmer/reddish)", () => {
		expect(getEdgeConfidenceBucket(0.55)).toBe("low");
		expect(getEdgeConfidenceBucket(0.3)).toBe("low");
	});

	it("treats missing confidence as high (backend default 1.0)", () => {
		expect(getEdgeConfidenceBucket(undefined)).toBe("high");
	});
});

describe("formatEdgeConfidenceLabel", () => {
	it("renders relation type only for 1.0/missing (no % suffix, saves space)", () => {
		expect(formatEdgeConfidenceLabel("depends_on", 1)).toBe("depends_on");
		expect(formatEdgeConfidenceLabel("depends_on", undefined)).toBe("depends_on");
	});

	it("appends the rounded percentage for sub-1.0 confidence", () => {
		expect(formatEdgeConfidenceLabel("depends_on", 0.9)).toBe("depends_on · 90%");
		expect(formatEdgeConfidenceLabel("related_to", 0.8)).toBe("related_to · 80%");
		expect(formatEdgeConfidenceLabel("co_mentioned", 0.55)).toBe("co_mentioned · 55%");
	});
});

describe("confidence bucket visuals", () => {
	it("high keeps the renderer default color (null) and full opacity", () => {
		expect(EDGE_BUCKET_COLORS.high).toBeNull();
		expect(EDGE_ALPHA_MULTIPLIERS.high).toBe(1);
	});

	it("medium is amber with slightly reduced opacity", () => {
		expect(EDGE_BUCKET_COLORS.medium).toEqual({ r: 245, g: 158, b: 11 });
		expect(EDGE_ALPHA_MULTIPLIERS.medium).toBeLessThan(1);
	});

	it("low is reddish with the dimmest opacity", () => {
		expect(EDGE_BUCKET_COLORS.low).toEqual({ r: 239, g: 68, b: 68 });
		expect(EDGE_ALPHA_MULTIPLIERS.low).toBeLessThan(EDGE_ALPHA_MULTIPLIERS.medium);
	});
});
