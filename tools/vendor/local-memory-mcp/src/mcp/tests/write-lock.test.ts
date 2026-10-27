import { describe, it, expect, vi, beforeEach } from "vitest";
import { WriteLock, isRecoverableLockError } from "../storage/write-lock";
import lockfile from "proper-lockfile";
import fs from "fs";

vi.mock("proper-lockfile", () => ({
	default: {
		lock: vi.fn(),
		unlock: vi.fn(),
		checkSync: vi.fn()
	}
}));

vi.mock("fs", () => ({
	default: {
		existsSync: vi.fn(),
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn()
	}
}));

describe("WriteLock", () => {
	const dbPath = "/test/db/path/memory.db";
	const dirPath = "/test/db/path";

	beforeEach(() => {
		// Reset BOTH call history and implementations so a test that stubs a
		// rejection (FIX-025 retry cases) cannot leak into the next test.
		vi.resetAllMocks();
		vi.mocked(lockfile.lock).mockImplementation(async () => async () => {});
		vi.mocked(lockfile.unlock).mockResolvedValue(undefined);
	});

	describe("constructor", () => {
		it("should create directory and file if they do not exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false);

			new WriteLock(dbPath);

			expect(fs.existsSync).toHaveBeenCalledWith(dbPath);
			expect(fs.mkdirSync).toHaveBeenCalledWith(dirPath, { recursive: true });
			expect(fs.writeFileSync).toHaveBeenCalledWith(dbPath, "");
		});

		it("should not create directory or file if they already exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);

			new WriteLock(dbPath);

			expect(fs.existsSync).toHaveBeenCalledWith(dbPath);
			expect(fs.mkdirSync).not.toHaveBeenCalled();
			expect(fs.writeFileSync).not.toHaveBeenCalled();
		});
	});

	describe("acquire", () => {
		it("should acquire the lock with correct parameters", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			await lock.acquire();

			expect(lockfile.lock).toHaveBeenCalledWith(
				dbPath,
				expect.objectContaining({
					stale: 30000,
					retries: {
						retries: 250,
						minTimeout: 200,
						maxTimeout: 200
					},
					realpath: false,
					onCompromised: expect.any(Function)
				})
			);
			// Can't directly access private 'locked', but we can infer it works if release tries to unlock
		});

		it("passes an onCompromised handler that never throws (uncaught-exception fix)", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			await lock.acquire();

			const opts = vi.mocked(lockfile.lock).mock.calls[0][1] as { onCompromised: (e: Error) => void };
			// proper-lockfile's DEFAULT onCompromised THROWS, escaping as an
			// uncaught exception ("Unable to update lock within the stale
			// threshold"). Our handler must swallow it instead.
			expect(() => opts.onCompromised(new Error("Unable to update lock within the stale threshold"))).not.toThrow();
		});
	});

	describe("acquire robustness (FIX-025)", () => {
		it("classifies the recoverable lock signatures (stale threshold, ENOENT, ECOMPROMISED/ELOCKED)", () => {
			expect(isRecoverableLockError(new Error("Unable to update lock within the stale threshold"))).toBe(true);
			expect(
				isRecoverableLockError(
					Object.assign(new Error("ENOENT: no such file or directory, utime '/x/memory.db.lock'"), { code: "ENOENT" })
				)
			).toBe(true);
			expect(isRecoverableLockError(Object.assign(new Error("x"), { code: "ECOMPROMISED" }))).toBe(true);
			expect(
				isRecoverableLockError(Object.assign(new Error("Lock file is already being held"), { code: "ELOCKED" }))
			).toBe(true);
			// A genuine programming error is NOT recoverable.
			expect(isRecoverableLockError(new Error("SQLITE_BUSY: database is locked"))).toBe(false);
			expect(isRecoverableLockError(undefined)).toBe(false);
			// A bare ENOENT unrelated to a lockfile must NOT be swallowed.
			expect(
				isRecoverableLockError(
					Object.assign(new Error("ENOENT: no such file or directory, open '/x/other'"), { code: "ENOENT" })
				)
			).toBe(false);
		});

		it("retries a recoverable acquire failure ONCE, then succeeds (positive)", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.lock).mockRejectedValueOnce(new Error("Unable to update lock within the stale threshold"));
			const lock = new WriteLock(dbPath);

			// First attempt rejects (recoverable) → retry → second succeeds.
			await expect(lock.acquire()).resolves.toBeUndefined();
			expect(lockfile.lock).toHaveBeenCalledTimes(2);
		});

		it("throws an actionable error after the retry budget is exhausted (negative)", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.lock).mockRejectedValue(new Error("Unable to update lock within the stale threshold"));
			const lock = new WriteLock(dbPath);

			// Two consecutive failures (1 retry) must NOT escape as the raw
			// proper-lockfile error; it is wrapped with recovery guidance.
			await expect(lock.acquire()).rejects.toThrow(/Failed to acquire exclusive write lock.*stale threshold/s);
			expect(lockfile.lock).toHaveBeenCalledTimes(2);
		});

		it("does NOT retry a non-recoverable acquire failure (negative)", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.lock).mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" }));
			const lock = new WriteLock(dbPath);

			await expect(lock.acquire()).rejects.toThrow(/Failed to acquire exclusive write lock/);
			expect(lockfile.lock).toHaveBeenCalledTimes(1);
		});

		it("withExclusiveLock surfaces the actionable error and still releases (no wedge)", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.lock).mockRejectedValue(new Error("Unable to update lock within the stale threshold"));
			const lock = new WriteLock(dbPath);

			await expect(lock.withExclusiveLock(() => "never")).rejects.toThrow(/Failed to acquire exclusive write lock/);
			// The failure must not wedge the tail chain — a later call still runs.
			vi.mocked(lockfile.lock).mockImplementation(async () => async () => {});
			await expect(lock.withExclusiveLock(() => "ok")).resolves.toBe("ok");
		});
	});

	describe("compromised lock recovery", () => {
		it("does NOT unlock a lock another process stole after compromise", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);
			await lock.acquire();

			// Simulate the heartbeat detecting a foreign mtime mid-section.
			const opts = vi.mocked(lockfile.lock).mock.calls[0][1] as { onCompromised: (e: Error) => void };
			opts.onCompromised(new Error("Unable to update lock within the stale threshold"));

			vi.mocked(lockfile.unlock).mockClear();
			await lock.release();

			// Unlocking here would delete a lock we no longer own — must skip.
			expect(lockfile.unlock).not.toHaveBeenCalled();
		});

		it("clears the compromised flag so a later acquire/release unlocks normally", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);
			await lock.acquire();

			const opts = vi.mocked(lockfile.lock).mock.calls[0][1] as { onCompromised: (e: Error) => void };
			opts.onCompromised(new Error("stolen"));
			await lock.release(); // skips unlock, resets state

			vi.mocked(lockfile.unlock).mockClear();
			await lock.acquire();
			await lock.release();

			expect(lockfile.unlock).toHaveBeenCalledTimes(1);
		});
	});

	describe("release", () => {
		it("should do nothing if not locked", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			await lock.release();

			expect(lockfile.unlock).not.toHaveBeenCalled();
		});

		it("should unlock if locked", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			await lock.acquire();
			await lock.release();

			expect(lockfile.unlock).toHaveBeenCalledWith(dbPath, { realpath: false });
		});

		it("should ignore unlock errors and set locked to false", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.unlock).mockRejectedValue(new Error("Unlock failed"));
			const lock = new WriteLock(dbPath);

			await lock.acquire();
			await lock.release(); // Should not throw

			expect(lockfile.unlock).toHaveBeenCalled();

			// To verify locked was set to false, a subsequent release should do nothing
			vi.mocked(lockfile.unlock).mockClear();
			await lock.release();
			expect(lockfile.unlock).not.toHaveBeenCalled();
		});
	});

	describe("withLock (fast path — no proper-lockfile)", () => {
		it("should run the function inline without acquiring or releasing the file lock", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);
			const fn = vi.fn().mockResolvedValue("result");

			// Fast path keeps the withWrite call sites unpriced by any fs ops
			// (OPT-PERF-09): BEGIN IMMEDIATE + busy_timeout is the mutex.
			const result = await lock.withLock(fn);

			expect(result).toBe("result");
			expect(fn).toHaveBeenCalled();
			expect(lockfile.lock).not.toHaveBeenCalled();
			expect(lockfile.unlock).not.toHaveBeenCalled();
		});

		it("is reentrant by construction — no lock state to re-enter", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			const result = await lock.withLock(function inner() {
				// Removing file-lock re-entrance entirely; a nested write just runs.
				return lock.withLock(() => "nested-result");
			});

			expect(result).toBe("nested-result");
			expect(lockfile.lock).not.toHaveBeenCalled();
		});
	});

	describe("withExclusiveLock", () => {
		it("should acquire, run function, and release", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);
			const fn = vi.fn().mockResolvedValue("result");

			const result = await lock.withExclusiveLock(fn);

			expect(result).toBe("result");
			expect(lockfile.lock).toHaveBeenCalled();
			expect(fn).toHaveBeenCalled();
			expect(lockfile.unlock).toHaveBeenCalled();
		});

		it("should release lock even if function throws", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);
			const error = new Error("Function failed");
			const fn = vi.fn().mockRejectedValue(error);

			await expect(lock.withExclusiveLock(fn)).rejects.toThrow("Function failed");

			expect(lockfile.lock).toHaveBeenCalled();
			expect(fn).toHaveBeenCalled();
			expect(lockfile.unlock).toHaveBeenCalled();
		});

		it("serializes concurrent exclusive bodies (reader-gate atomicity, TASK-159)", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			// Guarded handlers (conflict-check → insert; status gate → archive)
			// rely on withExclusiveLock to run their whole body atomically. The
			// `tail` chain must let exactly ONE body be in flight at a time even
			// when several writers race: otherwise two processes could both pass
			// a read-gate before either writes (duplicate / double-archive).
			let inFlight = 0;
			let maxInFlight = 0;
			const completed: string[] = [];
			const run = (name: string) =>
				lock.withExclusiveLock(async () => {
					inFlight++;
					maxInFlight = Math.max(maxInFlight, inFlight);
					await new Promise((r) => setTimeout(r, 5));
					inFlight--;
					completed.push(name);
				});

			await Promise.all([run("a"), run("b"), run("c")]);

			expect(maxInFlight).toBe(1);
			expect(completed).toHaveLength(3);
		});

		it("reenters inline when already holding the exclusive lock (nested archive)", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.lock).mockClear();
			const lock = new WriteLock(dbPath);

			const result = await lock.withExclusiveLock(function outer() {
				// A sibling archive/guard nested inside the outer exclusive section
				// must run inline without a second proper-lockfile acquisition.
				return lock.withExclusiveLock(() => "inner-result");
			});

			expect(result).toBe("inner-result");
			// Exactly one acquire/release for the whole nested section (no ELOCKED).
			expect(lockfile.lock).toHaveBeenCalledTimes(1);
			expect(lockfile.unlock).toHaveBeenCalledTimes(1);
		});
	});

	describe("isLocked", () => {
		it("should return true if lockfile.checkSync returns true", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.checkSync).mockReturnValue(true);
			const lock = new WriteLock(dbPath);

			const result = lock.isLocked();

			expect(result).toBe(true);
			expect(lockfile.checkSync).toHaveBeenCalledWith(dbPath, { realpath: false });
		});

		it("should return false if lockfile.checkSync returns false", () => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(lockfile.checkSync).mockReturnValue(false);
			const lock = new WriteLock(dbPath);

			const result = lock.isLocked();

			expect(result).toBe(false);
			expect(lockfile.checkSync).toHaveBeenCalledWith(dbPath, { realpath: false });
		});
	});
});
