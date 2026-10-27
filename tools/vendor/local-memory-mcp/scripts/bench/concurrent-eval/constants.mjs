import { performance } from "node:perf_hooks";

export const SEED = 0x480;
export const OWNER = "bench";
export const REPO = "bench-concurrent";
export const BENCH_ROWS = 2000;
export const BENCH_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
export const BENCH_EPOCH_ISO = "2026-01-01T00:00:00.000Z";
export const BENCH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const BUSY_TIMEOUT_MS = 2000;
export const SCENARIOS = ["readers_only", "writers_only", "mixed", "multi_client"];

/**
 * Shared comparable timestamp basis for operation windows across the parent,
 * worker threads, and child processes.
 *
 * - performance.now() is process-local: worker_threads share the parent's
 *   timeOrigin, but a forked child process starts its own timeOrigin, so raw
 *   performance.now() values are NOT comparable across processes.
 * - Date.now() is wall-clock (Unix epoch) and is comparable everywhere, but has
 *   millisecond resolution — too coarse for fast windows.
 *
 * The hybrid basis combines both: an epoch anchor captured at a known instant
 * plus the local monotonic clock's offset from that instant. Within one process
 * (parent + worker threads) the anchor is captured once; child processes capture
 * their own anchor pair at startup. All converted values share the epoch domain
 * while keeping sub-millisecond resolution.
 */
export function createEpochBasis() {
	const epochMs = Date.now();
	const perfMs = performance.now();
	return {
		epochMs,
		perfMs,
		// Convert a local performance.now() reading into the shared epoch basis.
		toEpochMs(perfNow = performance.now()) {
			return epochMs + (perfNow - perfMs);
		}
	};
}
