import { afterEach, describe, expect, it } from "vitest";
import { createMetricsRegistry, DurationSeries } from "../utils/metrics";
import { metrics } from "../utils/metrics";

/**
 * OPT-OBS-01 / TASK-158 — unit coverage for the metrics subsystem.
 *
 * Verifies the DurationSeries nearest-rank percentile math, the bounded
 * sample reservoir, empty/reset negatives, snapshot immutability, and the
 * MetricsRegistry record()/reset()/snapshot() surface that the dispatch core
 * and embedding worker feed.
 */

/** Convenience: samples 1..n pushed sequentially (ascending add order). */
function pushRange(series: DurationSeries, n: number): void {
	for (let i = 1; i <= n; i++) series.add(i);
}

describe("DurationSeries", () => {
	afterEach(() => {
		// Never let state leak between the registry tests below.
		metrics.reset();
	});

	it("computes nearest-rank p50/p95 for a known sequential set", () => {
		const series = new DurationSeries();
		pushRange(series, 1000);

		const snap = series.snapshot();
		// sorted indices: p50 → ceil(0.5*1000)-1 = 499 → 500;
		// p95 → ceil(0.95*1000)-1 = 949 → 950.
		expect(snap.p50Ms).toBe(500);
		expect(snap.p95Ms).toBe(950);
	});

	it("tracks count/min/max/avg/total across the FULL stream (not just reservoir)", () => {
		const series = new DurationSeries();
		pushRange(series, 1000);

		const snap = series.snapshot();
		expect(snap.count).toBe(1000);
		expect(snap.minMs).toBe(1);
		expect(snap.maxMs).toBe(1000);
		expect(snap.totalMs).toBe(500500);
		expect(snap.avgMs).toBe(500.5);
	});

	it("returns an empty (finite) snapshot before any sample — no Infinity leak", () => {
		const snap = new DurationSeries().snapshot();
		expect(snap.count).toBe(0);
		for (const key of ["totalMs", "avgMs", "minMs", "maxMs", "p50Ms", "p95Ms", "lastMs"] as const) {
			expect(Number.isFinite(snap[key])).toBe(true);
			expect(snap[key]).toBe(0);
		}
	});

	it("binds the reservoir to capacity and keeps percentiles in-range as count grows", () => {
		const series = new DurationSeries(5);
		pushRange(series, 100);

		expect(series.snapshot().count).toBe(100); // count tracks the full stream
		expect(series.sampleCount).toBe(5); // reservoir stays bounded at capacity
		const snap = series.snapshot();
		expect(snap.p50Ms).toBeGreaterThanOrEqual(1);
		expect(snap.p95Ms).toBeLessThanOrEqual(100);
		expect(snap.minMs).toBe(1);
		expect(snap.maxMs).toBe(100);
	});

	it("reset() clears samples and counters", () => {
		const series = new DurationSeries();
		pushRange(series, 50);
		expect(series.snapshot().count).toBe(50);

		series.reset();
		const snap = series.snapshot();
		expect(snap.count).toBe(0);
		expect(series.sampleCount).toBe(0);
		expect(snap.minMs).toBe(0);
		expect(snap.maxMs).toBe(0);
	});

	it("produces an immutable snapshot (mutating it never skews later calls)", () => {
		const series = new DurationSeries();
		pushRange(series, 10);

		const first = series.snapshot();
		// Tamper with the returned object aggressively.
		(first as unknown as Record<string, unknown>).p95Ms = 1_000_000;
		(first as unknown as Record<string, unknown>).count = -5;
		(first as unknown as Record<string, unknown>).p50Ms = -7;

		const second = series.snapshot();
		expect(second.count).toBe(10);
		expect(second.p50Ms).not.toBe(-7);
		expect(second.p95Ms).not.toBe(1_000_000);
	});
});

describe("MetricsRegistry", () => {
	afterEach(() => metrics.reset());

	it("records tool outcomes, write-handler, and embed-latency and snapshots them per key", () => {
		const reg = createMetricsRegistry();
		reg.recordTool("memory-read", 20, "success");
		reg.recordTool("memory-read", 40, "error");
		reg.recordWriteHandler("memory-write", 5);
		reg.recordWriteHandler("memory-write", 15);
		reg.recordEmbedLatency(30);

		const snap = reg.snapshot();
		expect(snap.tools["memory-read"].count).toBe(2);
		expect(snap.tools["memory-read"].p50Ms).toBe(20);
		expect(snap.toolOutcomes["memory-read"]).toEqual({ success: 1, error: 1, partial: 0, degraded: 0 });
		expect(snap.writeHandler.total.count).toBe(2);
		expect(snap.writeHandler.byTool["memory-write"].count).toBe(2);
		expect(snap.embedLatency.count).toBe(1);
		expect(snap.embedLatency.p50Ms).toBe(30);
	});

	it("reset() clears all series", () => {
		const reg = createMetricsRegistry();
		reg.recordTool("task-read", 5);
		reg.recordWriteHandler("task-write", 7);
		reg.recordEmbedLatency(9);
		expect(reg.snapshot().tools["task-read"].count).toBe(1);

		reg.reset();
		const snap = reg.snapshot();
		expect(Object.keys(snap.tools)).toHaveLength(0);
		expect(Object.keys(snap.writeHandler.byTool)).toHaveLength(0);
		expect(snap.writeHandler.total.count).toBe(0);
		expect(snap.embedLatency.count).toBe(0);
	});

	it("the shared process singleton feeds the dashboard snapshot shape", () => {
		metrics.recordEmbedLatency(11);
		metrics.recordTool("agent-context", 3);
		const snap = metrics.snapshot();
		expect(snap.embedLatency.count).toBe(1);
		expect(snap.tools["agent-context"].count).toBe(1);
	});

	it("increments named event counters and exposes them in the snapshot (FIX-034)", () => {
		const reg = createMetricsRegistry();
		reg.incrementCounter("semantic_warmup_failures");
		reg.incrementCounter("semantic_warmup_failures", 2);
		reg.incrementCounter("autoindex_failures");

		expect(reg.getCounter("semantic_warmup_failures")).toBe(3);
		expect(reg.snapshot().counters).toEqual({ semantic_warmup_failures: 3, autoindex_failures: 1 });
	});

	it("ignores non-positive counter deltas so a counter never moves backwards (negative)", () => {
		const reg = createMetricsRegistry();
		reg.incrementCounter("c", 5);
		reg.incrementCounter("c", 0);
		reg.incrementCounter("c", -3);
		expect(reg.getCounter("c")).toBe(5);
	});

	it("reset() clears counters too", () => {
		const reg = createMetricsRegistry();
		reg.incrementCounter("c", 4);
		reg.reset();
		expect(reg.getCounter("c")).toBe(0);
		expect(reg.snapshot().counters).toEqual({});
	});
});
