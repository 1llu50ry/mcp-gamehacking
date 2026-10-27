import { describe, expect, it } from "vitest";
import { computeRotationTrig, PALETTE } from "../kg-neural-renderer/layout";
import { buildCoreColorTable } from "../kg-neural-renderer/nodes";

describe("computeRotationTrig", () => {
	it("precomputes the 4 rotation trig values for given rotY/rotX", () => {
		const rotY = 0.3;
		const rotX = -0.2;
		const t = computeRotationTrig(rotY, rotX);
		expect(t.cosY).toBe(Math.cos(rotY));
		expect(t.sinY).toBe(Math.sin(rotY));
		expect(t.cosX).toBe(Math.cos(rotX));
		expect(t.sinX).toBe(Math.sin(rotX));
	});

	it("is frame-constant reuse safe (same input → same values)", () => {
		const a = computeRotationTrig(1.1, 2.2);
		const b = computeRotationTrig(1.1, 2.2);
		expect(a).toEqual(b);
	});
});

describe("buildCoreColorTable", () => {
	it("precomputes per-theme core fillStyle strings for each palette color", () => {
		const table = buildCoreColorTable(PALETTE);

		// electric cyan { r: 0, g: 212, b: 255 }
		const entry = table.get(PALETTE[0]);
		expect(entry).toBeDefined();
		expect(entry!.dark).toBe("rgba(60,255,255,0.9)"); // +60 capped, dark alpha 0.9
		expect(entry!.light).toBe("rgba(0,138,166,1)"); // darkenColor(*0.65), opaque
		expect(entry!.lightInner).toBe("rgba(80,218,246,1)"); // darkened +80, opaque
	});

	it("has exactly one entry per palette color (identity-keyed)", () => {
		const table = buildCoreColorTable(PALETTE);
		expect(table.size).toBe(PALETTE.length);
		for (const color of PALETTE) {
			expect(table.get(color)).toBeDefined();
		}
	});
});
