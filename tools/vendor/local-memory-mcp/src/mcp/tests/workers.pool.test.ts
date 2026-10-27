/**
 * Unit tests for the generic bounded worker_threads pool
 * (FEAT-DAEMON-002B, src/mcp/workers/pool.ts).
 *
 * A tiny deterministic fixture worker (../workers/test-fixture.worker.mjs)
 * drives every branch: echo/compute results, application errors, timeouts,
 * hard crashes, queue ordering, and graceful shutdown. No real indexer or
 * embedding worker is involved.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { availableParallelism } from "node:os";
import {
	WorkerPool,
	WorkerPoolClosedError,
	WorkerPoolDisabledError,
	WorkerTaskCrashError,
	WorkerTaskError,
	WorkerTaskTimeoutError,
	CRASH_STORM_MAX_CONSECUTIVE,
	clampPoolSize,
	resolvePoolSize
} from "../workers/pool";

const FIXTURE = new URL("../workers/test-fixture.worker.mjs", import.meta.url);

interface FixtureRequest {
	op: "echo" | "add" | "delay" | "throw" | "crash";
	value?: unknown;
	a?: number;
	b?: number;
	ms?: number;
	message?: string;
}

const openPools: WorkerPool[] = [];

function makePool(size: number, taskTimeoutMs = 5_000): WorkerPool {
	const pool = new WorkerPool({ workerPath: FIXTURE, size, taskTimeoutMs });
	openPools.push(pool);
	return pool;
}

/** Wait until `predicate` holds, polling on a short interval (bounded). */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

afterEach(async () => {
	await Promise.all(openPools.splice(0).map((pool) => pool.close({ mode: "cancel" })));
	delete process.env.WORKER_POOL_SIZE;
});

// ── Sizing ────────────────────────────────────────────────────────────────

describe("pool sizing", () => {
	it("resolves an explicit override", () => {
		expect(resolvePoolSize(1)).toBe(1);
		expect(resolvePoolSize(2)).toBe(2);
	});

	it("defaults to WORKER_POOL_SIZE (2), capped by availableParallelism", () => {
		expect(resolvePoolSize()).toBe(clampPoolSize(2));
	});

	it("never exceeds os.availableParallelism()", () => {
		const cap = Math.max(1, availableParallelism());
		expect(resolvePoolSize(10_000)).toBe(cap);
		expect(clampPoolSize(10_000)).toBe(cap);
	});

	it("clamps non-positive / fractional requests up to at least 1", () => {
		expect(resolvePoolSize(0)).toBe(clampPoolSize(2)); // 0 ⇒ fall back to env default
		expect(clampPoolSize(0)).toBe(1);
		expect(clampPoolSize(-5)).toBe(1);
	});

	it("reads WORKER_POOL_SIZE from the environment", async () => {
		vi.resetModules();
		process.env.WORKER_POOL_SIZE = "3";
		const mod = await import("../workers/pool");
		expect(mod.resolvePoolSize()).toBe(mod.clampPoolSize(3));
		vi.resetModules();
	});

	it("reports size and idle/active/queued metrics", () => {
		const pool = makePool(2);
		expect(pool.poolSize).toBe(2);
		expect(pool.metrics()).toEqual({ size: 2, active: 0, idle: 2, queued: 0 });
	});
});

// ── Request / response ──────────────────────────────────────────────────────

describe("request / response", () => {
	it("round-trips a structured-clone payload", async () => {
		const pool = makePool(2);
		const value = { nested: { list: [1, 2, 3] }, text: "hello" };
		await expect(pool.run<FixtureRequest, typeof value>({ op: "echo", value })).resolves.toEqual(value);
	});

	it("computes and returns a result", async () => {
		const pool = makePool(2);
		await expect(pool.run<FixtureRequest, number>({ op: "add", a: 40, b: 2 })).resolves.toBe(42);
	});

	it("rejects with a non-retryable WorkerTaskError on an application error", async () => {
		const pool = makePool(1);
		const error = await pool.run<FixtureRequest, never>({ op: "throw", message: "boom" }).catch((e) => e);
		expect(error).toBeInstanceOf(WorkerTaskError);
		expect((error as WorkerTaskError).message).toBe("boom");
		expect((error as WorkerTaskError).retryable).toBe(false);
	});
});

// ── Queue ordering ──────────────────────────────────────────────────────────

describe("queue ordering", () => {
	it("drains a single-worker queue FIFO", async () => {
		const pool = makePool(1);
		const order: number[] = [];
		// The first task holds the only worker briefly; the rest queue behind it.
		const first = pool.run<FixtureRequest, number>({ op: "delay", ms: 30, value: 1 }).then((v) => {
			order.push(v);
			return v;
		});
		const rest = [2, 3, 4].map((n) =>
			pool.run<FixtureRequest, number>({ op: "delay", ms: 0, value: n }).then((v) => {
				order.push(v);
				return v;
			})
		);
		await Promise.all([first, ...rest]);
		expect(order).toEqual([1, 2, 3, 4]);
	});
});

// ── Timeout ─────────────────────────────────────────────────────────────────

describe("per-task timeout", () => {
	it("rejects a slow task with a retryable WorkerTaskTimeoutError", async () => {
		const pool = makePool(1);
		const error = await pool
			.run<FixtureRequest, number>({ op: "delay", ms: 1_000, value: 1 }, { timeoutMs: 40 })
			.catch((e) => e);
		expect(error).toBeInstanceOf(WorkerTaskTimeoutError);
		expect((error as WorkerTaskTimeoutError).retryable).toBe(true);
	});

	it("keeps serving tasks after a timeout (worker replaced)", async () => {
		const pool = makePool(1);
		await pool.run<FixtureRequest, number>({ op: "delay", ms: 1_000, value: 1 }, { timeoutMs: 40 }).catch(() => {});
		await expect(pool.run<FixtureRequest, number>({ op: "add", a: 1, b: 1 })).resolves.toBe(2);
		await waitFor(() => pool.metrics().idle === 1);
	});
});

// ── Crash + respawn ─────────────────────────────────────────────────────────

describe("crash handling", () => {
	it("rejects the in-flight task with a retryable crash error and respawns", async () => {
		const pool = makePool(1);
		const error = await pool.run<FixtureRequest, never>({ op: "crash" }).catch((e) => e);
		expect(error).toBeInstanceOf(WorkerTaskCrashError);
		expect((error as WorkerTaskCrashError).retryable).toBe(true);

		// The pool must recover: a following task succeeds on the respawned worker.
		await expect(pool.run<FixtureRequest, number>({ op: "add", a: 2, b: 3 })).resolves.toBe(5);
		await waitFor(() => pool.metrics().idle === 1);
	});

	it("never wedges the caller — queued work still drains after a crash", async () => {
		const pool = makePool(1);
		const crashed = pool.run<FixtureRequest, never>({ op: "crash" }).catch((e) => e);
		const queued = pool.run<FixtureRequest, number>({ op: "add", a: 7, b: 8 });
		expect(await crashed).toBeInstanceOf(WorkerTaskCrashError);
		await expect(queued).resolves.toBe(15);
	});
});

// ── Crash-storm guard (H1) ──────────────────────────────────────────────────

describe("crash-storm guard (H1)", () => {
	const CRASH_ON_LOAD = new URL("../workers/crash-on-load.worker.mjs", import.meta.url);

	it("a deterministically-crashing worker trips the guard and rejects non-retryably", async () => {
		const pool = new WorkerPool({ workerPath: CRASH_ON_LOAD, size: 1, taskTimeoutMs: 2_000 });
		openPools.push(pool);
		try {
			// Drive enough tasks to exceed the crash threshold. Each task either
			// crashes its worker (retryable WorkerTaskCrashError) or — once the
			// guard trips — is rejected with the NON-retryable disabled error.
			let sawDisabled = false;
			let disabledError: unknown;
			for (let i = 0; i < CRASH_STORM_MAX_CONSECUTIVE + 3; i++) {
				const error = await pool.run<FixtureRequest, never>({ op: "echo", value: i }).catch((e) => e);
				if (error instanceof WorkerPoolDisabledError) {
					sawDisabled = true;
					disabledError = error;
					break;
				}
				expect(error).toBeInstanceOf(WorkerTaskCrashError);
			}

			expect(sawDisabled).toBe(true);
			// NON-retryable so the parser degrades per-file and the embedding pool
			// permanently disables instead of looping forever.
			expect((disabledError as WorkerPoolDisabledError).retryable).toBe(false);

			// The pool must have stopped respawning: no idle/active workers remain.
			await waitFor(() => pool.metrics().active === 0 && pool.metrics().idle === 0);

			// Every subsequent task is rejected immediately with the same class.
			await expect(pool.run<FixtureRequest, never>({ op: "echo", value: 1 })).rejects.toBeInstanceOf(
				WorkerPoolDisabledError
			);
		} finally {
			await pool.close({ mode: "cancel" });
		}
	});

	it("a single transient crash still respawns (guard does NOT trip)", async () => {
		const pool = makePool(1);
		// One crash — well under the threshold.
		const error = await pool.run<FixtureRequest, never>({ op: "crash" }).catch((e) => e);
		expect(error).toBeInstanceOf(WorkerTaskCrashError);

		// The respawned worker serves the next task successfully.
		await expect(pool.run<FixtureRequest, number>({ op: "add", a: 2, b: 3 })).resolves.toBe(5);
		await waitFor(() => pool.metrics().idle === 1);
	});
});

// ── Shutdown ────────────────────────────────────────────────────────────────

describe("graceful shutdown", () => {
	it("drains pending tasks before resolving close()", async () => {
		const pool = makePool(1);
		const pending = [1, 2, 3].map((n) => pool.run<FixtureRequest, number>({ op: "delay", ms: 10, value: n }));
		await pool.close({ mode: "drain" });
		await expect(Promise.all(pending)).resolves.toEqual([1, 2, 3]);
	});

	it("cancels queued tasks but lets in-flight tasks finish", async () => {
		const pool = makePool(1);
		const inFlight = pool.run<FixtureRequest, number>({ op: "delay", ms: 40, value: "inflight" });
		const queuedA = pool.run<FixtureRequest, number>({ op: "delay", ms: 0, value: "a" }).catch((e) => e);
		const queuedB = pool.run<FixtureRequest, number>({ op: "delay", ms: 0, value: "b" }).catch((e) => e);

		await pool.close({ mode: "cancel" });
		await expect(inFlight).resolves.toBe("inflight");
		expect(await queuedA).toBeInstanceOf(WorkerPoolClosedError);
		expect(await queuedB).toBeInstanceOf(WorkerPoolClosedError);
	});

	it("rejects new tasks once closed", async () => {
		const pool = makePool(1);
		await pool.close();
		await expect(pool.run<FixtureRequest, never>({ op: "echo", value: 1 })).rejects.toBeInstanceOf(
			WorkerPoolClosedError
		);
	});

	it("is idempotent — repeated close() resolves the same promise", async () => {
		const pool = makePool(2);
		const a = pool.close();
		const b = pool.close();
		expect(a).toBe(b);
		await a;
	});
});
