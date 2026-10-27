/**
 * Unit tests for src/mcp/services/vacuum.ts — space reclamation helpers
 * (TASK-033 incremental auto_vacuum, TASK-034 safe guarded VACUUM).
 *
 * Strategy: real in-memory SQLiteStore (createTestStore) for the PRAGMA-bound
 * helpers; pure predicate tests for `shouldVacuum`; a bogus-path probe for the
 * `getFreeDiskBytes` degradation. NEVER touches the real database.
 *
 * SQLite semantics exercised here: an in-memory DB cannot be converted to
 * auto_vacuum=INCREMENTAL (no file), so the conversion path skips it and the
 * incremental reclaim is a no-op — both are asserted directly.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import os from "os";
import { createTestStore } from "../storage/sqlite";
import {
	ensureIncrementalAutoVacuum,
	getFreeDiskBytes,
	getVacuumState,
	incrementalVacuum,
	runStartupVacuum,
	shouldVacuum
} from "../services/vacuum";

describe("shouldVacuum (pure predicate)", () => {
	it("returns true at exactly the threshold ratio", () => {
		// 20 / 100 = 0.2 === threshold
		expect(shouldVacuum({ freelistCount: 20, pageCount: 100 }, { freelistRatioThreshold: 0.2 })).toBe(true);
	});

	it("returns true above the threshold ratio", () => {
		expect(shouldVacuum({ freelistCount: 25, pageCount: 100 }, { freelistRatioThreshold: 0.2 })).toBe(true);
	});

	it("returns false just below the threshold ratio", () => {
		expect(shouldVacuum({ freelistCount: 19, pageCount: 100 }, { freelistRatioThreshold: 0.2 })).toBe(false);
	});

	it("returns false for an empty freelist", () => {
		expect(shouldVacuum({ freelistCount: 0, pageCount: 100 }, { freelistRatioThreshold: 0.2 })).toBe(false);
	});

	it("returns false when pageCount is 0 (no divide-by-zero)", () => {
		expect(shouldVacuum({ freelistCount: 0, pageCount: 0 }, { freelistRatioThreshold: 0.2 })).toBe(false);
		// Even a nonsensical freelist on an empty file stays false.
		expect(shouldVacuum({ freelistCount: 5, pageCount: 0 }, { freelistRatioThreshold: 0.2 })).toBe(false);
	});

	it("honors a custom threshold (0.5)", () => {
		expect(shouldVacuum({ freelistCount: 40, pageCount: 100 }, { freelistRatioThreshold: 0.5 })).toBe(false);
		expect(shouldVacuum({ freelistCount: 50, pageCount: 100 }, { freelistRatioThreshold: 0.5 })).toBe(true);
	});
});

describe("getVacuumState", () => {
	it("reads page/freelist/auto_vacuum pragmas from a test store", async () => {
		const store = await createTestStore();
		try {
			const state = getVacuumState(store);

			expect(state.pageCount).toBeGreaterThan(0);
			expect(state.pageSize).toBeGreaterThan(0);
			expect(state.freelistCount).toBeGreaterThanOrEqual(0);
			// Fresh in-memory DB: auto_vacuum defaults to NONE (0).
			expect(state.autoVacuum).toBe(0);
			expect(state.freelistBytes).toBe(state.freelistCount * state.pageSize);
		} finally {
			store.close();
		}
	});
});

describe("incrementalVacuum", () => {
	it("returns 0 when auto_vacuum != 2 (in-memory default is NONE)", async () => {
		const store = await createTestStore();
		try {
			expect(getVacuumState(store).autoVacuum).not.toBe(2);

			const result = incrementalVacuum(store, 1000);

			expect(result.reclaimedPages).toBe(0);
		} finally {
			store.close();
		}
	});

	it("clamps a zero page budget to a no-op", async () => {
		const store = await createTestStore();
		try {
			expect(incrementalVacuum(store, 0).reclaimedPages).toBe(0);
		} finally {
			store.close();
		}
	});
});

describe("ensureIncrementalAutoVacuum", () => {
	it("skips an in-memory database with reason 'in_memory'", async () => {
		const store = await createTestStore();
		try {
			const result = ensureIncrementalAutoVacuum(store);

			expect(result).toEqual({ changed: false, skipped: true, reason: "in_memory" });
		} finally {
			store.close();
		}
	});

	it("never throws for an in-memory database", async () => {
		const store = await createTestStore();
		try {
			expect(() => ensureIncrementalAutoVacuum(store)).not.toThrow();
		} finally {
			store.close();
		}
	});
});

describe("getFreeDiskBytes", () => {
	it("returns a positive number for a real directory", () => {
		const free = getFreeDiskBytes(os.tmpdir());

		expect(typeof free).toBe("number");
		expect(Number.isFinite(free)).toBe(true);
		expect(free).toBeGreaterThan(0);
	});

	it("degrades to MAX_SAFE_INTEGER on a bogus path (never blocks reclamation)", () => {
		const free = getFreeDiskBytes("/nonexistent/definitely-not-a-real-path-xyz");

		expect(free).toBe(Number.MAX_SAFE_INTEGER);
	});
});

describe("runStartupVacuum (TASK-047 startup gate)", () => {
	it("is a no-op (returns null) when the gate is disabled", async () => {
		const store = await createTestStore();
		try {
			expect(runStartupVacuum(store, false)).toBeNull();
		} finally {
			store.close();
		}
	});

	it("invokes ensureIncrementalAutoVacuum when the gate is enabled", async () => {
		const store = await createTestStore();
		try {
			// An in-memory store is skipped by the underlying conversion, so the
			// exact result `ensureIncrementalAutoVacuum` returns proves the helper
			// delegated to it (a non-null result can only come from that call).
			expect(runStartupVacuum(store, true)).toEqual({
				changed: false,
				skipped: true,
				reason: "in_memory"
			});
		} finally {
			store.close();
		}
	});

	it("never throws when enabled (delegates the never-throw guarantee)", async () => {
		const store = await createTestStore();
		try {
			expect(() => runStartupVacuum(store, true)).not.toThrow();
		} finally {
			store.close();
		}
	});
});

describe("VACUUM_ON_STARTUP env gate (TASK-047)", () => {
	const ORIGINAL = process.env.VACUUM_ON_STARTUP;

	afterEach(() => {
		if (ORIGINAL === undefined) delete process.env.VACUUM_ON_STARTUP;
		else process.env.VACUUM_ON_STARTUP = ORIGINAL;
		vi.resetModules();
	});

	/** Re-import constants with VACUUM_ON_STARTUP set to `value` (or unset). */
	async function loadFlag(value?: string): Promise<boolean> {
		vi.resetModules();
		if (value === undefined) delete process.env.VACUUM_ON_STARTUP;
		else process.env.VACUUM_ON_STARTUP = value;
		const mod = await import("../utils/constants");
		return mod.VACUUM_ON_STARTUP;
	}

	it("defaults to false when unset", async () => {
		expect(await loadFlag(undefined)).toBe(false);
	});

	it("defaults to false for an empty string", async () => {
		expect(await loadFlag("")).toBe(false);
	});

	it.each(["true", "1", "yes", "TRUE"])("parses %s as true", async (value) => {
		expect(await loadFlag(value)).toBe(true);
	});

	it.each(["false", "0", "no", "off"])("parses %s as false", async (value) => {
		expect(await loadFlag(value)).toBe(false);
	});
});
