/**
 * Parser singleton lifecycle (C1, FEAT-DAEMON-002 review).
 *
 * Proves the process-wide parser pool singleton releases its worker threads on
 * BOTH teardown entry points:
 *   - `closeCodebaseParserPool()` — closes and nulls the singleton;
 *   - `resetCodebaseParserPool()` — now ALSO closes before dropping the
 *     reference (pre-fix it leaked the worker threads).
 * Both are idempotent and safe when no pool was ever created.
 *
 * Runs the REAL `TreeSitterParserPool` (worker threads) so a regression that
 * fails to terminate workers is observable via the pool's own `isClosed()`
 * accounting rather than a mocked spy.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
	getCodebaseParserPool,
	closeCodebaseParserPool,
	resetCodebaseParserPool
} from "../../codebase-index/parser/singleton";
import type { TreeSitterParserPool } from "../../codebase-index/parser/parser-pool";

afterEach(async () => {
	// Never leak a pool across tests.
	await closeCodebaseParserPool();
});

describe("parser singleton lifecycle (C1)", () => {
	it("closeCodebaseParserPool closes the live pool's worker threads", async () => {
		const pool = getCodebaseParserPool() as TreeSitterParserPool;
		await pool.initialize();

		await closeCodebaseParserPool();

		// The live pool's internal worker pool must be gone (all threads stopped).
		const internal = (pool as unknown as { pool: { metrics(): { size: number; active: number; idle: number } } | null })
			.pool;
		expect(internal).toBeNull();
	});

	it("closeCodebaseParserPool is idempotent and safe when never created", async () => {
		// First close with no pool ever created in this fresh module state.
		await expect(closeCodebaseParserPool()).resolves.toBeUndefined();
		await expect(closeCodebaseParserPool()).resolves.toBeUndefined();
	});

	it("resetCodebaseParserPool closes the pool before dropping the reference", async () => {
		const pool = getCodebaseParserPool() as TreeSitterParserPool;
		await pool.initialize();
		const internalBefore = (pool as unknown as { pool: { metrics(): unknown } | null }).pool;
		expect(internalBefore).not.toBeNull();

		await resetCodebaseParserPool();

		// The pool instance was closed (its internal WorkerPool reference nulled),
		// so no worker thread keeps the event loop alive.
		const internalAfter = (pool as unknown as { pool: { metrics(): unknown } | null }).pool;
		expect(internalAfter).toBeNull();

		// And a fresh pool is created on the next access (the singleton was reset).
		const fresh = getCodebaseParserPool();
		expect(fresh).not.toBe(pool);
	});
});
