/**
 * SQLite write-contention retry tests (Phase 2 hardening / FIX-032).
 *
 * Verifies the bounded, jittered retry wrapper in `storage/base.ts`:
 *   - transient busy/locked errors are retried and the write succeeds;
 *   - every retry is logged at warn and exhaustion at error;
 *   - exhaustion surfaces a CLEAR terminal error that preserves `code`/`cause`;
 *   - non-transient (constraint/validation) errors are NOT retried;
 *   - BOTH a `BaseEntity` transaction AND a bare single-statement `run()`
 *     (autocommit) route through the wrapper.
 *
 * The wrapper is exercised directly (no real contention needed) plus
 * end-to-end checks that `BaseEntity` transaction/run paths route through it.
 * The backoff is a synchronous blocking sleep (better-sqlite3 is sync), so the
 * base delay is small in tests and the assertions are timing-agnostic.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { isTransientSqliteError, runWithSqliteWriteRetry, BaseEntity } from "../storage/base";
import { SQLITE_WRITE_RETRY_ATTEMPTS } from "../utils/constants";
import { logger } from "../utils/logger";

/** Build an Error carrying a SQLite `code`, mimicking better-sqlite3. */
function sqliteError(code: string, message: string): Error & { code: string } {
	const error = new Error(message) as Error & { code: string };
	error.code = code;
	return error;
}

describe("isTransientSqliteError", () => {
	it("matches SQLITE_BUSY / SQLITE_LOCKED family codes", () => {
		expect(isTransientSqliteError(sqliteError("SQLITE_BUSY", "database is locked"))).toBe(true);
		expect(isTransientSqliteError(sqliteError("SQLITE_BUSY_SNAPSHOT", "busy snapshot"))).toBe(true);
		expect(isTransientSqliteError(sqliteError("SQLITE_LOCKED", "database table is locked"))).toBe(true);
		expect(isTransientSqliteError(sqliteError("SQLITE_LOCKED_SHAREDCACHE", "locked"))).toBe(true);
	});

	it("matches by message when the code was lost (wrapped/rethrown errors)", () => {
		expect(isTransientSqliteError(new Error("database is locked"))).toBe(true);
		expect(isTransientSqliteError(new Error("database is busy"))).toBe(true);
	});

	it("does NOT match constraint/validation errors", () => {
		expect(isTransientSqliteError(sqliteError("SQLITE_CONSTRAINT_UNIQUE", "UNIQUE constraint failed"))).toBe(false);
		expect(isTransientSqliteError(sqliteError("SQLITE_CONSTRAINT_NOTNULL", "NOT NULL constraint failed"))).toBe(false);
		expect(isTransientSqliteError(sqliteError("SQLITE_MISUSE", "bad use"))).toBe(false);
		expect(isTransientSqliteError(new Error("something else"))).toBe(false);
		expect(isTransientSqliteError("not an error")).toBe(false);
		expect(isTransientSqliteError(undefined)).toBe(false);
	});
});

describe("runWithSqliteWriteRetry", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("retries a transient busy error then succeeds", () => {
		let calls = 0;
		const run = () => {
			calls += 1;
			if (calls < 3) throw sqliteError("SQLITE_BUSY", "database is locked");
			return "ok";
		};

		expect(runWithSqliteWriteRetry(run)).toBe("ok");
		expect(calls).toBe(3);
	});

	it("logs a warn per retry and an error on terminal exhaustion", () => {
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

		expect(() =>
			runWithSqliteWriteRetry(() => {
				throw sqliteError("SQLITE_BUSY", "database is locked");
			})
		).toThrow();

		// One warn per retry (attempts - 1) and exactly one terminal error.
		expect(warnSpy).toHaveBeenCalledTimes(SQLITE_WRITE_RETRY_ATTEMPTS - 1);
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	it("gives up deterministically after exhaustion with a CLEAR terminal error (code preserved)", () => {
		vi.spyOn(logger, "error").mockImplementation(() => {});
		vi.spyOn(logger, "warn").mockImplementation(() => {});
		let calls = 0;
		const run = () => {
			calls += 1;
			throw sqliteError("SQLITE_BUSY", "database is locked");
		};

		let caught: unknown;
		try {
			runWithSqliteWriteRetry(run);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(Error);
		// The machine code is preserved so downstream classifiers still treat
		// this as SQLITE_BUSY (embedding-queue isBusyError, transport guards).
		expect((caught as { code?: string }).code).toBe("SQLITE_BUSY");
		// The message is actionable, not a bare "database is locked", and still
		// carries the original text so mcp-error's retryable classifier matches.
		const message = (caught as Error).message;
		expect(message).toMatch(/persistent lock contention/);
		expect(message).toMatch(/database is locked/);
		expect((caught as { cause?: unknown }).cause).toBeInstanceOf(Error);
		expect(calls).toBe(SQLITE_WRITE_RETRY_ATTEMPTS);
	});

	it("does NOT retry non-transient errors (single attempt)", () => {
		let calls = 0;
		const run = () => {
			calls += 1;
			throw sqliteError("SQLITE_CONSTRAINT_UNIQUE", "UNIQUE constraint failed: memories.id");
		};

		expect(() => runWithSqliteWriteRetry(run)).toThrow(/UNIQUE constraint failed/);
		expect(calls).toBe(1);
	});

	it("returns the value without retrying when the first attempt succeeds", () => {
		let calls = 0;
		const run = () => {
			calls += 1;
			return 42;
		};
		expect(runWithSqliteWriteRetry(run)).toBe(42);
		expect(calls).toBe(1);
	});
});

describe("BaseEntity.transaction retry integration", () => {
	/** Minimal concrete entity exposing the protected transaction for tests. */
	class TestEntity extends BaseEntity {
		runTransaction<T>(fn: () => T): T {
			return this.transaction(fn);
		}
	}

	it("routes a transaction body through the retry wrapper (busy → success)", () => {
		// A fake Database whose `transaction(fn).immediate` invokes the body
		// directly — the wrapper's retry behaviour is what is under test.
		const fakeDb = {
			transaction: (fn: () => unknown) => ({ immediate: fn })
		};
		const entity = new TestEntity(fakeDb as unknown as ConstructorParameters<typeof BaseEntity>[0]);

		let calls = 0;
		const result = entity.runTransaction(() => {
			calls += 1;
			if (calls < 2) throw sqliteError("SQLITE_BUSY", "database is locked");
			return "done";
		});

		expect(result).toBe("done");
		expect(calls).toBe(2);
	});

	it("propagates a non-transient error from a transaction body", () => {
		const fakeDb = {
			transaction: (fn: () => unknown) => ({ immediate: fn })
		};
		const entity = new TestEntity(fakeDb as unknown as ConstructorParameters<typeof BaseEntity>[0]);

		expect(() =>
			entity.runTransaction(() => {
				throw sqliteError("SQLITE_CONSTRAINT_NOTNULL", "NOT NULL constraint failed");
			})
		).toThrow(/NOT NULL constraint failed/);
	});
});

describe("BaseEntity.run single-statement retry integration (FIX-032)", () => {
	/** Minimal concrete entity exposing the protected single-statement run. */
	class RunEntity extends BaseEntity {
		runStatement(sql: string, params: unknown[] = []): { changes: number } {
			return this.run(sql, params);
		}
	}

	it("retries a bare autocommit statement through the wrapper (busy → success)", () => {
		// A fake Database outside any transaction: a bare statement is
		// autocommit, so it must be retried here (this is the gap FIX-032 closed
		// — previously only transaction() was wrapped).
		let calls = 0;
		const fakeDb = {
			inTransaction: false,
			prepare: () => ({
				run: () => {
					calls += 1;
					if (calls < 2) throw sqliteError("SQLITE_BUSY", "database is locked");
					return { changes: 1 };
				}
			})
		};
		const entity = new RunEntity(fakeDb as unknown as ConstructorParameters<typeof BaseEntity>[0]);

		expect(entity.runStatement("INSERT INTO t VALUES (?)", [1])).toEqual({ changes: 1 });
		expect(calls).toBe(2);
	});

	it("does NOT add a nested retry loop inside an explicit transaction", () => {
		// inTransaction=true → the enclosing transaction() owns retry; a busy
		// error must propagate straight out of run() (single attempt).
		let calls = 0;
		const fakeDb = {
			inTransaction: true,
			prepare: () => ({
				run: () => {
					calls += 1;
					throw sqliteError("SQLITE_BUSY", "database is locked");
				}
			})
		};
		const entity = new RunEntity(fakeDb as unknown as ConstructorParameters<typeof BaseEntity>[0]);

		expect(() => entity.runStatement("INSERT INTO t VALUES (?)", [1])).toThrow(/database is locked/);
		expect(calls).toBe(1);
	});
});
