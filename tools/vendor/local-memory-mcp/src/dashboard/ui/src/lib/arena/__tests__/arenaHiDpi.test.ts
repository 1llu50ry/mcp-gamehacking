// @vitest-environment node
/**
 * HiDPI coordinate-space contract.
 *
 * The arena canvas allocates its backing store in DEVICE pixels
 * (`canvas.width = cssWidth * dpr`) so the scene renders at native panel
 * resolution instead of being upscaled from a 1x bitmap — the latter was the
 * source of the visibly blocky output on any dpr>1 display.
 *
 * That split introduces exactly one hazard: every OTHER arena coordinate —
 * world positions, pan offsets, hit tests, cull bounds — is in CSS pixels. If
 * any consumer reads `canvas.width` and treats it as a CSS length, everything
 * it computes is off by the device-pixel ratio (clicks land at half position,
 * culling over-extends, focus centring pushes the target off-screen).
 *
 * These tests pin the reconciliation helpers so that regression cannot return
 * silently. They deliberately avoid a real canvas: jsdom's 2D context is a
 * stub, so asserting on rendering would prove nothing. The invariant under
 * test is pure arithmetic over the element's two size fields.
 */

import { describe, it, expect } from "vitest";
import { getCanvasDpr, getCanvasCssSize } from "../arena-renderer/utils";

/**
 * Minimal stand-in for the two fields the helpers read. `clientWidth` is the
 * CSS box the browser lays out; `width` is the backing-store allocation.
 */
function makeCanvas(cssW: number, cssH: number, dpr: number): HTMLCanvasElement {
	return {
		width: Math.round(cssW * dpr),
		height: Math.round(cssH * dpr),
		clientWidth: cssW,
		clientHeight: cssH
	} as unknown as HTMLCanvasElement;
}

describe("HiDPI canvas coordinate space", () => {
	describe("getCanvasDpr", () => {
		it("recovers the ratio the backing store was allocated at", () => {
			expect(getCanvasDpr(makeCanvas(1000, 600, 1))).toBe(1);
			expect(getCanvasDpr(makeCanvas(1000, 600, 2))).toBe(2);
			expect(getCanvasDpr(makeCanvas(1000, 600, 3))).toBe(3);
		});

		it("handles fractional ratios reported by scaled displays", () => {
			// Windows display scaling and browser zoom both produce these.
			expect(getCanvasDpr(makeCanvas(1000, 600, 1.5))).toBeCloseTo(1.5, 5);
			expect(getCanvasDpr(makeCanvas(800, 600, 1.25))).toBeCloseTo(1.25, 5);
		});

		it("falls back to 1 before layout, when the CSS box is still zero", () => {
			// initCanvas runs on a timeout and via ResizeObserver; the first
			// call can land before the element has been laid out. Dividing by
			// zero here would poison every downstream coordinate with Infinity.
			const unlaidOut = { width: 0, height: 0, clientWidth: 0, clientHeight: 0 } as unknown as HTMLCanvasElement;
			expect(getCanvasDpr(unlaidOut)).toBe(1);
		});

		it("never returns a non-positive ratio", () => {
			// A zero-width backing store with a laid-out element would otherwise
			// yield 0 and collapse the whole scene to a point.
			const degenerate = { width: 0, height: 0, clientWidth: 500, clientHeight: 300 } as unknown as HTMLCanvasElement;
			expect(getCanvasDpr(degenerate)).toBe(1);
		});
	});

	describe("getCanvasCssSize", () => {
		it("returns the CSS box, not the device-pixel backing store", () => {
			// This is the property every hit test and cull bound depends on:
			// the value must NOT scale with dpr.
			for (const dpr of [1, 2, 3]) {
				expect(getCanvasCssSize(makeCanvas(1177, 780, dpr))).toEqual({ w: 1177, h: 780 });
			}
		});

		it("keeps the world size stable as the device ratio changes", () => {
			// Dragging a window between a laptop panel and an external monitor
			// re-inits the canvas at a different ratio. The arena world must not
			// resize underneath the user when that happens.
			const onRetina = getCanvasCssSize(makeCanvas(1440, 900, 2));
			const onStandard = getCanvasCssSize(makeCanvas(1440, 900, 1));
			expect(onRetina).toEqual(onStandard);
		});

		it("round-trips against the ratio it was derived from", () => {
			const canvas = makeCanvas(1024, 768, 2);
			const { w, h } = getCanvasCssSize(canvas);
			const dpr = getCanvasDpr(canvas);
			expect(w * dpr).toBe(canvas.width);
			expect(h * dpr).toBe(canvas.height);
		});
	});

	describe("regression: treating the backing store as CSS pixels", () => {
		it("would double pan centring on a 2x display", () => {
			// focusEntity centres a target: pan = size/2 - world * zoom.
			// Using canvas.width (device px) instead of the CSS size pushes the
			// centre a full half-viewport off-screen. Pinned as an explicit
			// contrast so the correct term is obvious to the next reader.
			const canvas = makeCanvas(1000, 600, 2);
			const zoom = 1;
			const worldX = 100;

			const correct = getCanvasCssSize(canvas).w / 2 - worldX * zoom;
			const buggy = canvas.width / 2 - worldX * zoom;

			expect(correct).toBe(400);
			expect(buggy).toBe(900);
			expect(buggy - correct).toBe(getCanvasCssSize(canvas).w / 2);
		});

		it("would over-extend cull bounds by the device ratio", () => {
			// Cull bounds derived from the backing store cover twice the real
			// viewport on a 2x display, so nothing is ever culled.
			const canvas = makeCanvas(1200, 800, 2);
			const zoom = 1;

			const correctRight = getCanvasCssSize(canvas).w / zoom;
			const buggyRight = canvas.width / zoom;

			expect(correctRight).toBe(1200);
			expect(buggyRight).toBe(2400);
		});
	});
});
