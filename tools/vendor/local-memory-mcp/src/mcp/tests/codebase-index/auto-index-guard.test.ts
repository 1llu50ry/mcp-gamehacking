import { afterEach, describe, expect, it, vi } from "vitest";
import {
	containIndexRepositoryFailure,
	logAutoIndexFailure,
	resetAutoIndexFailureDedup
} from "../../codebase-index/services/auto-index-guard";
import { addLogSink, getLogLevel, setLogLevel, type LogSinkPayload } from "../../utils/logger";
import { metrics, METRIC_AUTOINDEX_FAILURES } from "../../utils/metrics";

/**
 * FIX-034 — AutoIndex failure isolation.
 *
 * `autoIndexIfStale` fires `indexRepository` in the background; before this
 * guard a rejection was logged bare and a synchronous throw could escape into
 * the awaited startup path (the reported `[AutoIndex] indexRepository threw`
 * burst). These tests pin: failures are caught (never propagate), counted once
 * per failure, and logged at WARN exactly once per repo (repeats → DEBUG).
 */
function captureLogs(): { logs: LogSinkPayload[]; detach: () => void } {
	const logs: LogSinkPayload[] = [];
	const detach = addLogSink((payload) => logs.push(payload));
	return { logs, detach };
}

describe("containIndexRepositoryFailure (FIX-034)", () => {
	afterEach(() => {
		metrics.reset();
		resetAutoIndexFailureDedup();
		vi.restoreAllMocks();
	});

	it("resolves without throwing when the background run succeeds (positive)", async () => {
		const { logs, detach } = captureLogs();
		try {
			await expect(containIndexRepositoryFailure("repo-a", Promise.resolve({ ok: true }))).resolves.toBeUndefined();
			expect(metrics.getCounter(METRIC_AUTOINDEX_FAILURES)).toBe(0);
			expect(logs.some((l) => l.data.message === "[AutoIndex] indexRepository threw")).toBe(false);
		} finally {
			detach();
		}
	});

	it("catches a rejecting background run and never propagates it (negative)", async () => {
		const { logs, detach } = captureLogs();
		try {
			// The contract under test: a throw must NOT escape into startup.
			await expect(
				containIndexRepositoryFailure("repo-a", Promise.reject(new Error("index blew up")))
			).resolves.toBeUndefined();

			expect(metrics.getCounter(METRIC_AUTOINDEX_FAILURES)).toBe(1);
			const warns = logs.filter((l) => l.level === "warning" && l.data.message === "[AutoIndex] indexRepository threw");
			expect(warns).toHaveLength(1);
			expect(warns[0]!.data.repo).toBe("repo-a");
			expect(warns[0]!.data.error).toBe("index blew up");
		} finally {
			detach();
		}
	});

	it("logs once per repo — repeat failures drop to DEBUG but still count", async () => {
		const prevLevel = getLogLevel();
		setLogLevel("debug");
		const { logs, detach } = captureLogs();
		try {
			await containIndexRepositoryFailure("repo-a", Promise.reject(new Error("first")));
			await containIndexRepositoryFailure("repo-a", Promise.reject(new Error("second")));

			// Both failures are counted…
			expect(metrics.getCounter(METRIC_AUTOINDEX_FAILURES)).toBe(2);
			// …but only the first is a WARN; the repeat is DEBUG.
			const warns = logs.filter((l) => l.level === "warning" && l.data.message === "[AutoIndex] indexRepository threw");
			const debugs = logs.filter(
				(l) => l.level === "debug" && l.data.message === "[AutoIndex] indexRepository threw (repeat suppressed)"
			);
			expect(warns).toHaveLength(1);
			expect(debugs).toHaveLength(1);
		} finally {
			detach();
			setLogLevel(prevLevel);
		}
	});

	it("treats a non-Error rejection value as a string message", async () => {
		const { logs, detach } = captureLogs();
		try {
			await containIndexRepositoryFailure("repo-b", Promise.reject("plain string failure"));
			const warn = logs.find((l) => l.data.message === "[AutoIndex] indexRepository threw");
			expect(warn?.data.error).toBe("plain string failure");
		} finally {
			detach();
		}
	});

	it("logAutoIndexFailure never throws even for an exotic error value", () => {
		expect(() => logAutoIndexFailure("repo-c", { weird: true })).not.toThrow();
		expect(metrics.getCounter(METRIC_AUTOINDEX_FAILURES)).toBe(1);
	});
});
