/**
 * Worker pool concurrency resolution tests (issue #65, TASK-237;
 * FEAT-DAEMON-002C).
 *
 * Verifies `resolveConcurrency` honors the `CODEBASE_INDEX_WORKERS` env alias
 * (0 = auto), falls back to the legacy `CODEBASE_INDEX_PARSE_CONCURRENCY`, and
 * uses the programmatic default otherwise — AND that the resolved value is the
 * REAL worker-pool size, clamped to `[1, os.availableParallelism()]`
 * (FEAT-DAEMON-002C). Env vars are snapshot/restored so tests never leak into
 * sibling suites.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveConcurrency, DEFAULT_CONCURRENCY } from "../../codebase-index/parser/worker-pool";
import { clampPoolSize } from "../../workers/pool";

const WORKERS = "CODEBASE_INDEX_WORKERS";
const LEGACY = "CODEBASE_INDEX_PARSE_CONCURRENCY";

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
	saved[WORKERS] = process.env[WORKERS];
	saved[LEGACY] = process.env[LEGACY];
});

afterEach(() => {
	for (const key of [WORKERS, LEGACY]) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
});

describe("resolveConcurrency — CODEBASE_INDEX_WORKERS alias", () => {
	it("prefers CODEBASE_INDEX_WORKERS over the legacy env var", () => {
		process.env.CODEBASE_INDEX_WORKERS = "6";
		process.env.CODEBASE_INDEX_PARSE_CONCURRENCY = "2";
		expect(resolveConcurrency()).toBe(clampPoolSize(6));
	});

	it("treats CODEBASE_INDEX_WORKERS=0 as auto → legacy value", () => {
		process.env.CODEBASE_INDEX_WORKERS = "0";
		process.env.CODEBASE_INDEX_PARSE_CONCURRENCY = "3";
		expect(resolveConcurrency()).toBe(clampPoolSize(3));
	});

	it("treats CODEBASE_INDEX_WORKERS=0 with no legacy as auto → default", () => {
		process.env.CODEBASE_INDEX_WORKERS = "0";
		delete process.env.CODEBASE_INDEX_PARSE_CONCURRENCY;
		expect(resolveConcurrency()).toBe(clampPoolSize(DEFAULT_CONCURRENCY));
	});

	it("falls back to legacy CODEBASE_INDEX_PARSE_CONCURRENCY when workers is unset", () => {
		delete process.env.CODEBASE_INDEX_WORKERS;
		process.env.CODEBASE_INDEX_PARSE_CONCURRENCY = "8";
		expect(resolveConcurrency()).toBe(clampPoolSize(8));
	});

	it("ignores non-numeric / non-positive worker values (falls back to default)", () => {
		process.env.CODEBASE_INDEX_WORKERS = "-2";
		delete process.env.CODEBASE_INDEX_PARSE_CONCURRENCY;
		expect(resolveConcurrency()).toBe(clampPoolSize(DEFAULT_CONCURRENCY));
	});

	it("returns the programmatic override ahead of any env var", () => {
		process.env.CODEBASE_INDEX_WORKERS = "6";
		expect(resolveConcurrency(10)).toBe(clampPoolSize(10));
	});
});

describe("resolveConcurrency — real pool size (FEAT-DAEMON-002C)", () => {
	it("clamps an over-large request to os.availableParallelism()", () => {
		delete process.env.CODEBASE_INDEX_WORKERS;
		delete process.env.CODEBASE_INDEX_PARSE_CONCURRENCY;
		// A huge request must never oversubscribe the host.
		expect(resolveConcurrency(10_000)).toBe(clampPoolSize(10_000));
	});

	it("never returns less than 1", () => {
		delete process.env.CODEBASE_INDEX_WORKERS;
		delete process.env.CODEBASE_INDEX_PARSE_CONCURRENCY;
		expect(resolveConcurrency()).toBeGreaterThanOrEqual(1);
	});

	it("resolves the same value the generic WorkerPool would size to", () => {
		delete process.env.CODEBASE_INDEX_WORKERS;
		delete process.env.CODEBASE_INDEX_PARSE_CONCURRENCY;
		// The parser pool and the generic pool share the clamp contract.
		expect(resolveConcurrency(2)).toBe(clampPoolSize(2));
	});
});
