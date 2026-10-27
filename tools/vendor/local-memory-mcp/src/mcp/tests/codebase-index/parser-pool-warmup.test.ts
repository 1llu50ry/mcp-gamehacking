/**
 * M3 (FEAT-DAEMON-002 review) — `_doInitialize` must warm ALL workers.
 *
 * Pre-fix a SINGLE `{ op: "warmup" }` task was dispatched, so with the default
 * 4 workers only ONE had its tree-sitter WASM instantiated; the other 3 paid
 * the init cost lazily on the first real burst. The fix dispatches `poolSize`
 * warmups (the FIFO queue assigns one per worker).
 *
 * `WorkerPool` is mocked so the test observes the DISPATCH COUNT directly
 * (a real pool would start every worker idle regardless of how many warmups
 * ran, hiding the regression).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { runSpy, constructedSizes } = vi.hoisted(() => ({
	runSpy: vi.fn(async (_task: unknown, _options?: unknown) => ({ warmed: true })),
	constructedSizes: [] as number[]
}));

vi.mock("../../workers/pool", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../workers/pool")>();
	class WorkerPool {
		readonly size: number;
		constructor(options: { size?: number }) {
			this.size = options.size ?? 1;
			constructedSizes.push(this.size);
		}
		get poolSize(): number {
			return this.size;
		}
		run = runSpy;
		close = vi.fn(async () => {});
	}
	return {
		...actual,
		WorkerPool
	};
});

// `resolveParserWorkerPath` is only called to construct the pool; keep it cheap.
vi.mock("../../workers/resolve-parser-worker", () => ({
	resolveParserWorkerPath: () => "/tmp/fake-parser.worker.js"
}));

import { TreeSitterParserPool } from "../../codebase-index/parser/parser-pool";

describe("parser pool warm-up dispatches one task per worker (M3)", () => {
	beforeEach(() => {
		runSpy.mockClear();
		constructedSizes.length = 0;
	});

	it("dispatches `poolSize` warmup tasks for a pool of size N", async () => {
		const pool = new TreeSitterParserPool({ concurrency: 3 });
		await pool.initialize();

		expect(constructedSizes).toEqual([3]);
		expect(runSpy).toHaveBeenCalledTimes(3);
		for (const call of runSpy.mock.calls) {
			expect(call[0]).toEqual({ op: "warmup" });
		}
		expect(pool.isInitialized()).toBe(true);
	});

	it("dispatches exactly ONE warmup for a single-worker pool (bounded to size)", async () => {
		const pool = new TreeSitterParserPool({ concurrency: 1 });
		await pool.initialize();

		expect(constructedSizes).toEqual([1]);
		expect(runSpy).toHaveBeenCalledTimes(1);
	});

	it("does not re-warm on a second initialize() (idempotent)", async () => {
		const pool = new TreeSitterParserPool({ concurrency: 2 });
		await pool.initialize();
		expect(runSpy).toHaveBeenCalledTimes(2);

		await pool.initialize();
		expect(runSpy).toHaveBeenCalledTimes(2);
	});
});
