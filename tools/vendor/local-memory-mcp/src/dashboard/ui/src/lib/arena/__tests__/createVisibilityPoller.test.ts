// @vitest-environment jsdom

/**
 * createVisibilityPoller — visibility-gated poller unit tests (OPT-PERF-02 NIT).
 *
 * jsdom is the vitest default environment for the dashboard UI
 * (vitest.config.ts), so `document` is present unless stubbed away to
 * simulate SSR. These tests pin the poller contract:
 *
 *   - visibility gate: fetch only fires when the document is visible
 *   - SSR no-op: with no `document`, start() polls nothing and stop() is safe
 *   - double-start guard: a second start() must not stack intervals/listeners
 *   - stop(): clears the interval AND the visibilitychange listener
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVisibilityPoller } from "../createVisibilityPoller";

describe("createVisibilityPoller", () => {
	let visible = "visible";

	beforeEach(() => {
		vi.useFakeTimers();
		visible = "visible";
		// jsdom defaults to "visible"; make it mutable per test.
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => visible
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	describe("visibility gate", () => {
		it("fetches on each tick while the document is visible (positive)", () => {
			const fetchFn = vi.fn();
			const poller = createVisibilityPoller(fetchFn, 1000);
			poller.start();

			vi.advanceTimersByTime(1000);
			expect(fetchFn).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(2000);
			expect(fetchFn).toHaveBeenCalledTimes(3);
		});

		it("skips fetch while the document is hidden (negative)", () => {
			const fetchFn = vi.fn();
			const poller = createVisibilityPoller(fetchFn, 1000);
			poller.start();

			visible = "hidden";
			vi.advanceTimersByTime(5000);
			expect(fetchFn).not.toHaveBeenCalled();
		});

		it("fetches immediately when the document becomes visible again (resume)", () => {
			const fetchFn = vi.fn();
			const poller = createVisibilityPoller(fetchFn, 1000);
			poller.start();

			visible = "hidden";
			vi.advanceTimersByTime(3000);
			expect(fetchFn).not.toHaveBeenCalled();

			// visibilitychange listener fires the fetch on the visible transition.
			visible = "visible";
			document.dispatchEvent(new Event("visibilitychange"));
			expect(fetchFn).toHaveBeenCalledTimes(1);
		});
	});

	describe("SSR no-op", () => {
		it("never polls when document is undefined (SSR)", () => {
			vi.stubGlobal("document", undefined);
			const fetchFn = vi.fn();
			const poller = createVisibilityPoller(fetchFn, 1000);

			// Must not throw (typeof document === "undefined" guard).
			expect(() => poller.start()).not.toThrow();
			vi.advanceTimersByTime(10_000);
			expect(fetchFn).not.toHaveBeenCalled();

			// stop() on a never-started poller is a safe no-op.
			expect(() => poller.stop()).not.toThrow();
		});
	});

	describe("double-start guard", () => {
		it("does not stack intervals when start() is called twice", () => {
			const fetchFn = vi.fn();
			const poller = createVisibilityPoller(fetchFn, 1000);
			poller.start();
			poller.start();
			poller.start();

			vi.advanceTimersByTime(3000);
			// Exactly one interval → one fetch per tick, not three.
			expect(fetchFn).toHaveBeenCalledTimes(3);
		});

		it("does not register duplicate visibilitychange listeners on double start", () => {
			const addSpy = vi.spyOn(document, "addEventListener");
			const poller = createVisibilityPoller(vi.fn(), 1000);
			poller.start();
			poller.start();

			const visibilityListeners = addSpy.mock.calls.filter(([name]) => name === "visibilitychange");
			expect(visibilityListeners).toHaveLength(1);
		});
	});

	describe("stop()", () => {
		it("clears the interval so ticks stop firing", () => {
			const fetchFn = vi.fn();
			const poller = createVisibilityPoller(fetchFn, 1000);
			poller.start();

			vi.advanceTimersByTime(1000);
			expect(fetchFn).toHaveBeenCalledTimes(1);

			poller.stop();
			vi.advanceTimersByTime(10_000);
			expect(fetchFn).toHaveBeenCalledTimes(1);
		});

		it("removes the visibilitychange listener", () => {
			const removeSpy = vi.spyOn(document, "removeEventListener");
			const fetchFn = vi.fn();
			const poller = createVisibilityPoller(fetchFn, 1000);
			poller.start();

			poller.stop();
			expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

			// Listener is gone: a visible transition must not trigger a fetch.
			visible = "hidden";
			visible = "visible";
			document.dispatchEvent(new Event("visibilitychange"));
			expect(fetchFn).not.toHaveBeenCalled();
		});

		it("is idempotent — calling stop() twice does not throw", () => {
			const poller = createVisibilityPoller(vi.fn(), 1000);
			poller.start();
			poller.stop();
			expect(() => poller.stop()).not.toThrow();
		});
	});
});
