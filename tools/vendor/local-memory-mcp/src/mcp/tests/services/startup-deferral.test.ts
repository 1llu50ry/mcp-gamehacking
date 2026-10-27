/**
 * FEAT-DAEMON-002E — deferred, failure-isolated startup passes.
 *
 * Pins the contract that lets the listener answer `initialize` BEFORE the heavy
 * optional startup passes (VACUUM / maintenance / warm-up / auto-index) run:
 *
 *   1. DEFERRED — the default scheduler (`setImmediate`) runs the passes on a
 *      LATER event-loop turn, never inline in the caller.
 *   2. ISOLATED — a pass that throws synchronously or rejects is logged at WARN
 *      and the remaining passes still run; `settled` NEVER rejects, so a failed
 *      optional pass can never abort an already-ready server.
 *   3. SEQUENTIAL — passes run in order, one at a time.
 */
import { describe, expect, it, vi } from "vitest";
import { addLogSink, type LogSinkPayload } from "../../utils/logger";
import { scheduleDeferredStartupPasses, type DeferredStartupPass } from "../../services/startup-deferral";

function captureLogs(): { logs: LogSinkPayload[]; detach: () => void } {
	const logs: LogSinkPayload[] = [];
	const detach = addLogSink((payload) => logs.push(payload));
	return { logs, detach };
}

describe("scheduleDeferredStartupPasses (FEAT-DAEMON-002E)", () => {
	it("runs passes on a LATER turn, never inline (listener-before-passes ordering)", async () => {
		const order: string[] = [];
		// A scheduler that defers by a macrotask, mirroring setImmediate: the
		// caller returns BEFORE any pass runs.
		const schedule = (run: () => void) => setTimeout(run, 0);

		const handle = scheduleDeferredStartupPasses(
			[
				{ name: "a", run: () => order.push("a") },
				{ name: "b", run: () => order.push("b") }
			],
			{ schedule }
		);

		// Synchronously after scheduling, nothing has run yet.
		expect(order).toEqual([]);
		await handle.settled;
		expect(order).toEqual(["a", "b"]);
	});

	it("defaults to setImmediate — passes do not run in the same tick as the call", async () => {
		const order: string[] = [];
		const handle = scheduleDeferredStartupPasses([{ name: "x", run: () => order.push("x") }]);
		expect(order).toEqual([]);
		await handle.settled;
		expect(order).toEqual(["x"]);
	});

	it("isolates a synchronous throw and still runs the remaining passes", async () => {
		const { logs, detach } = captureLogs();
		try {
			const order: string[] = [];
			const handle = scheduleDeferredStartupPasses([
				{
					name: "boom",
					run: () => {
						throw new Error("sync explosion");
					}
				},
				{ name: "after", run: () => order.push("after") }
			]);

			await expect(handle.settled).resolves.toBeUndefined();
			expect(order).toEqual(["after"]);
			const warn = logs.find(
				(l) => l.level === "warning" && l.data.message === "[Startup] Deferred startup pass failed — continuing"
			);
			expect(warn).toBeDefined();
			expect(warn?.data.pass).toBe("boom");
			expect(String(warn?.data.error)).toContain("sync explosion");
		} finally {
			detach();
		}
	});

	it("isolates a rejected async pass and still runs the remaining passes", async () => {
		const { logs, detach } = captureLogs();
		try {
			const order: string[] = [];
			const handle = scheduleDeferredStartupPasses([
				{ name: "reject", run: () => Promise.reject(new Error("async explosion")) },
				{ name: "after", run: () => order.push("after") }
			]);

			await expect(handle.settled).resolves.toBeUndefined();
			expect(order).toEqual(["after"]);
			const warn = logs.find((l) => l.level === "warning" && l.data.pass === "reject");
			expect(warn).toBeDefined();
			expect(String(warn?.data.error)).toContain("async explosion");
		} finally {
			detach();
		}
	});

	it("resolves even when EVERY pass fails (never rejects)", async () => {
		const { detach } = captureLogs();
		try {
			const handle = scheduleDeferredStartupPasses([
				{
					name: "one",
					run: () => {
						throw new Error("one");
					}
				},
				{ name: "two", run: () => Promise.reject(new Error("two")) }
			]);
			await expect(handle.settled).resolves.toBeUndefined();
		} finally {
			detach();
		}
	});

	it("runs passes SEQUENTIALLY — a slow first pass completes before the second starts", async () => {
		const order: string[] = [];
		const handle = scheduleDeferredStartupPasses([
			{
				name: "slow",
				run: async () => {
					await new Promise((r) => setTimeout(r, 10));
					order.push("slow-done");
				}
			},
			{ name: "next", run: () => order.push("next-start") }
		]);
		await handle.settled;
		expect(order).toEqual(["slow-done", "next-start"]);
	});

	it("accepts an empty pass list and resolves", async () => {
		const handle = scheduleDeferredStartupPasses([]);
		await expect(handle.settled).resolves.toBeUndefined();
	});

	it("does not run passes until the injected scheduler fires (deferral is real)", async () => {
		const run = vi.fn();
		let captured: (() => void) | undefined;
		const schedule = (fn: () => void) => {
			captured = fn;
		};
		const passes: DeferredStartupPass[] = [{ name: "gated", run }];
		scheduleDeferredStartupPasses(passes, { schedule });

		// Scheduler captured the run but did not invoke it yet.
		expect(run).not.toHaveBeenCalled();
		expect(captured).toBeDefined();
		captured!();
		// Let the microtask queue drain.
		await Promise.resolve();
		expect(run).toHaveBeenCalledTimes(1);
	});
});
