// @vitest-environment node
/**
 * rr() — rounded-rect degenerate-geometry guard unit tests (TASK-263).
 *
 * Regression coverage for the production freeze (MEM-1104): a negative
 * radius reaching canvas arcTo throws IndexSizeError, which killed the
 * arena render loop and blanked the canvas. jsdom's 2D context is fake and
 * does NOT exercise arcTo behavior faithfully, so these tests drive rr()
 * through a minimal recording stub (beginPath / moveTo / lineTo / arcTo /
 * closePath spies) and assert on the guard's decision logic and the exact
 * call sequence — never on real canvas rendering.
 *
 * Contract pinned here:
 *   1. w<=0 || h<=0 (incl. negative transient tween values) -> empty path:
 *      beginPath only, no moveTo/lineTo/arcTo/closePath, no throw.
 *   2. r > min(w,h)/2 -> clamped down (never exceeds half the smaller dim).
 *   3. negative r -> clamped to >= 0 (arcTo radius is never negative).
 *   4. NaN dimensions -> treated as degenerate, no throw.
 */

import { describe, it, expect, vi } from "vitest";
import { rr } from "../arena-renderer/utils";

type MockFn = ReturnType<typeof vi.fn>;

/** Minimal recording stub: only the canvas path methods rr() actually calls. */
interface RecordingCtx {
	beginPath: MockFn;
	moveTo: MockFn;
	lineTo: MockFn;
	arcTo: MockFn;
	closePath: MockFn;
}

function makeRecordingCtx(): RecordingCtx {
	return {
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		arcTo: vi.fn(),
		closePath: vi.fn()
	};
}

/**
 * rr() is typed against the full CanvasRenderingContext2D; the stub only
 * implements the five path methods it calls. The cast is deliberate test
 * seaming, not a production type suppression.
 */
function asCtx(stub: RecordingCtx): CanvasRenderingContext2D {
	return stub as unknown as CanvasRenderingContext2D;
}

/** Radius is the 5th argument of every arcTo(x1,y1,x2,y2,radius) call. */
function arcToRadii(stub: RecordingCtx): number[] {
	return stub.arcTo.mock.calls.map((call) => Number(call[4]));
}

/**
 * The degenerate branch (w<=0 || h<=0, incl. NaN): beginPath only — the
 * path stays empty and no path command (moveTo/lineTo/arcTo/closePath) may
 * reach the canvas, so a transient negative radius can never hit arcTo and
 * throw IndexSizeError.
 */
function expectDegeneratePath(stub: RecordingCtx): void {
	expect(stub.beginPath).toHaveBeenCalledTimes(1);
	expect(stub.moveTo).not.toHaveBeenCalled();
	expect(stub.lineTo).not.toHaveBeenCalled();
	expect(stub.arcTo).not.toHaveBeenCalled();
	expect(stub.closePath).not.toHaveBeenCalled();
}

describe("rr() degenerate-geometry guard", () => {
	describe("valid geometry (sanity anchor)", () => {
		it("emits the full rounded-rect path in exact canvas call order", () => {
			const stub = makeRecordingCtx();
			// x=10, y=20, w=100, h=60, r=5 -> clamped r stays 5.
			rr(asCtx(stub), 10, 20, 100, 60, 5);

			expect(stub.beginPath).toHaveBeenCalledTimes(1);
			expect(stub.moveTo).toHaveBeenNthCalledWith(1, 15, 20);
			expect(stub.lineTo).toHaveBeenNthCalledWith(1, 105, 20);
			expect(stub.arcTo).toHaveBeenNthCalledWith(1, 110, 20, 110, 25, 5);
			expect(stub.lineTo).toHaveBeenNthCalledWith(2, 110, 75);
			expect(stub.arcTo).toHaveBeenNthCalledWith(2, 110, 80, 105, 80, 5);
			expect(stub.lineTo).toHaveBeenNthCalledWith(3, 15, 80);
			expect(stub.arcTo).toHaveBeenNthCalledWith(3, 10, 80, 10, 75, 5);
			expect(stub.lineTo).toHaveBeenNthCalledWith(4, 10, 25);
			expect(stub.arcTo).toHaveBeenNthCalledWith(4, 10, 20, 15, 20, 5);
			expect(stub.closePath).toHaveBeenCalledTimes(1);
		});

		it("keeps the requested radius unmodified when it fits", () => {
			const stub = makeRecordingCtx();
			rr(asCtx(stub), 0, 0, 100, 60, 5);
			expect(arcToRadii(stub)).toEqual([5, 5, 5, 5]);
		});
	});

	describe("degenerate dimensions (w<=0 || h<=0)", () => {
		it.each<[number, number, number]>([
			// [w, h, r] — negatives mirror tween transients during spawn/entrance.
			[0, 50, 10],
			[-1, 50, 10],
			[50, 0, 10],
			[50, -1, 10],
			[0, 0, 0],
			[-10, -10, 10],
			[-5, 25, -5], // both negative transient dim AND negative radius
			[-1, -1, -1]
		])("emits an empty path for w=%s h=%s r=%s (no throw, no arcTo)", (w, h, r) => {
			const stub = makeRecordingCtx();
			expect(() => rr(asCtx(stub), 0, 0, w, h, r)).not.toThrow();
			expectDegeneratePath(stub);
		});
	});

	describe("radius clamp (r > min(w,h)/2)", () => {
		it("clamps r down to half the smaller dimension", () => {
			const stub = makeRecordingCtx();
			rr(asCtx(stub), 0, 0, 100, 60, 1000); // min(50, 30) = 30

			const maxHalf = Math.min(100 / 2, 60 / 2);
			const radii = arcToRadii(stub);
			expect(radii).toHaveLength(4);
			for (const radius of radii) {
				expect(radius).toBeLessThanOrEqual(maxHalf + 1e-9);
			}
		});

		it("uses the clamped radius consistently in geometry and arcTo args", () => {
			const stub = makeRecordingCtx();
			rr(asCtx(stub), 10, 20, 100, 60, 1000);
			const rClamped = Math.min(Math.floor(100 / 2), Math.floor(60 / 2)); // 30

			expect(stub.moveTo).toHaveBeenCalledWith(10 + rClamped, 20);
			expect(stub.lineTo).toHaveBeenCalledWith(10 + 100 - rClamped, 20);
			expect(arcToRadii(stub)).toEqual([rClamped, rClamped, rClamped, rClamped]);
		});

		it("never exceeds floor(w/2) or floor(h/2) for odd dimensions", () => {
			const stub = makeRecordingCtx();
			rr(asCtx(stub), 0, 0, 101, 49, 999); // floor(101/2)=50, floor(49/2)=24

			for (const radius of arcToRadii(stub)) {
				expect(radius).toBeLessThanOrEqual(Math.floor(101 / 2));
				expect(radius).toBeLessThanOrEqual(Math.floor(49 / 2));
			}
		});
	});

	describe("negative radius", () => {
		it("clamps a negative r to 0 — arcTo never receives a negative radius", () => {
			const stub = makeRecordingCtx();
			expect(() => rr(asCtx(stub), 0, 0, 100, 100, -5)).not.toThrow();

			expect(arcToRadii(stub)).toEqual([0, 0, 0, 0]);
			// Zero-radius corners still trace a plain rect border.
			expect(stub.closePath).toHaveBeenCalledTimes(1);
		});

		it("clamps very large negative r the same way", () => {
			const stub = makeRecordingCtx();
			rr(asCtx(stub), 0, 0, 100, 100, -1e6);
			expect(arcToRadii(stub)).toEqual([0, 0, 0, 0]);
		});
	});

	describe("NaN dimensions", () => {
		it.each([
			[NaN, 50, 10],
			[50, NaN, 10],
			[NaN, NaN, NaN],
			[NaN, -Infinity, 10]
		])("treats (w=%s, h=%s) as degenerate — no throw, no arcTo", (w, h, r) => {
			const stub = makeRecordingCtx();
			expect(() => rr(asCtx(stub), 0, 0, w, h, r)).not.toThrow();
			expectDegeneratePath(stub);
		});
	});

	describe("invariant sweep (deterministic)", () => {
		it("never throws and never emits a negative arcTo radius across a value grid", () => {
			const dims = [-5, -1, 0, 0.5, 1, 11, 100, 1e6];
			const radii = [-1e9, -10, -1, 0, 1.5, 25, 60, 1e6];

			for (const w of dims) {
				for (const h of dims) {
					for (const r of radii) {
						const stub = makeRecordingCtx();
						expect(() => rr(asCtx(stub), 0, 0, w, h, r)).not.toThrow();
						for (const radius of arcToRadii(stub)) {
							expect(radius).toBeGreaterThanOrEqual(0);
						}
					}
				}
			}
		});
	});
});
