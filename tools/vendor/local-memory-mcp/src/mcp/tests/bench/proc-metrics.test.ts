/**
 * Unit tests for the PERF-008 `/proc` metric parsers.
 *
 * The parsers are pure (string → value), so they are tested here against
 * hand-written `/proc` dumps. The expected values come from the kernel's
 * documented field order — an independent oracle, not our own output.
 *
 * The live-process sampling half of the module is exercised by the perf gate
 * (`src/mcp/tests/lightness.perf.test.ts`), which is where a real `/proc` read
 * belongs.
 */

import { describe, expect, it } from "vitest";
import {
	PROC_CLOCK_TICKS_PER_SECOND,
	PROC_PAGE_SIZE_BYTES,
	cpuWindow,
	parseProcStat,
	parseProcStatus,
	summarizeSeries,
	type ProcSnapshot
} from "../../bench/proc-metrics";

/** A realistic `/proc/<pid>/stat` line whose `comm` contains spaces and parens. */
const STAT_LINE =
	"4242 (node (worker) pool) S 1 4242 4242 0 -1 4194560 12345 0 0 0 150 25 0 0 20 0 7 0 9876543 1234567890 12345 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0";

describe("parseProcStat", () => {
	it("parses utime/stime/threads/rss around a comm with spaces and parens", () => {
		const stat = parseProcStat(STAT_LINE);
		expect(stat).not.toBeNull();
		expect(stat!.pid).toBe(4242);
		expect(stat!.utimeTicks).toBe(150);
		expect(stat!.stimeTicks).toBe(25);
		expect(stat!.numThreads).toBe(7);
		expect(stat!.rssPages).toBe(12345);
	});

	it("returns null for a malformed or empty line", () => {
		expect(parseProcStat("not a proc line")).toBeNull();
		expect(parseProcStat("")).toBeNull();
	});

	it("returns null when the row is truncated before the required fields", () => {
		expect(parseProcStat("7 (node) S 1 2 3")).toBeNull();
	});
});

describe("parseProcStatus", () => {
	it("parses VmRSS and VmHWM as DISTINCT fields (the VmSize-misread guard)", () => {
		const status = parseProcStatus(
			[
				"Name:\tnode",
				"VmPeak:\t11000000 kB",
				"VmSize:\t10994548 kB",
				"VmHWM:\t  612000 kB",
				"VmRSS:\t  550000 kB",
				"Threads:\t12",
				""
			].join("\n")
		);
		expect(status).not.toBeNull();
		expect(status!.vmRssBytes).toBe(550000 * 1024);
		expect(status!.vmHwmBytes).toBe(612000 * 1024);
		expect(status!.vmSizeBytes).toBe(10994548 * 1024);
		expect(status!.vmPeakBytes).toBe(11000000 * 1024);
		expect(status!.threads).toBe(12);
		// The whole point: VmSize is not RSS and never was.
		expect(status!.vmSizeBytes).toBeGreaterThan(status!.vmRssBytes! * 10);
	});

	it("returns null when no row parses", () => {
		expect(parseProcStatus("")).toBeNull();
		expect(parseProcStatus("garbage without colons")).toBeNull();
	});
});

describe("cpuWindow", () => {
	/** Build a minimal snapshot with the given CPU counter and time. */
	function snapshot(sampledAtMs: number, cpuTicks: number): ProcSnapshot {
		return {
			pid: 1,
			sampledAtMs,
			stat: null,
			status: null,
			nativeThreadCount: 1,
			cpuTicks,
			vmRssBytes: 0,
			vmHwmBytes: 0,
			vmSizeBytes: 0
		};
	}

	it("computes one-core-relative CPU percent from the tick delta", () => {
		// 50 ticks over 1000 ms at 100 ticks/s = 50% of one core.
		const window = cpuWindow(snapshot(0, 100), snapshot(1000, 150));
		expect(window).not.toBeNull();
		expect(window!.cpuTicks).toBe(50);
		expect(window!.wallMs).toBe(1000);
		expect(window!.cpuPercent).toBeCloseTo(50, 5);
		expect(PROC_CLOCK_TICKS_PER_SECOND).toBe(100);
	});

	it("reports above 100% when multiple threads run in parallel", () => {
		// 300 ticks over 1000 ms = 300% (three cores' worth).
		const window = cpuWindow(snapshot(0, 0), snapshot(1000, 300));
		expect(window!.cpuPercent).toBeCloseTo(300, 5);
	});

	it("returns null when the CPU counter is missing or time does not advance", () => {
		expect(cpuWindow({ ...snapshot(0, 0), cpuTicks: null }, snapshot(1000, 50))).toBeNull();
		expect(cpuWindow(snapshot(1000, 0), snapshot(1000, 50))).toBeNull();
	});
});

describe("summarizeSeries", () => {
	/** Build a snapshot series with per-sample overrides. */
	function series(overrides: Partial<ProcSnapshot>[]): ProcSnapshot[] {
		const base: ProcSnapshot = {
			pid: 1,
			sampledAtMs: 0,
			stat: null,
			status: null,
			nativeThreadCount: 1,
			cpuTicks: 0,
			vmRssBytes: 100,
			vmHwmBytes: 200,
			vmSizeBytes: 1000
		};
		return overrides.map((override, index) => ({ ...base, sampledAtMs: index * 100, ...override }));
	}

	it("reports peak CPU, peak threads, final threads and peak VmHWM", () => {
		const summary = summarizeSeries(
			series([
				{ nativeThreadCount: 4, cpuTicks: 0 },
				{ nativeThreadCount: 9, cpuTicks: 20 },
				{ nativeThreadCount: 5, cpuTicks: 25 }
			])
		);
		expect(summary.samples).toBe(3);
		expect(summary.peakThreadCount).toBe(9);
		expect(summary.finalThreadCount).toBe(5);
		expect(summary.peakVmHwmBytes).toBe(200);
		expect(summary.peakCpuPercent).toBeGreaterThan(0);
	});

	it("returns a zeroed summary for an empty series", () => {
		const summary = summarizeSeries([]);
		expect(summary.samples).toBe(0);
		expect(summary.peakCpuPercent).toBe(0);
		expect(summary.peakVmRssBytes).toBe(0);
	});

	it("tracks the peak VmRSS separately from the final value", () => {
		const summary = summarizeSeries(series([{ vmRssBytes: 100 }, { vmRssBytes: 500 }, { vmRssBytes: 300 }]));
		expect(summary.peakVmRssBytes).toBe(500);
		expect(summary.finalVmRssBytes).toBe(300);
	});

	it("uses the documented page size for the stat-derived RSS fallback", () => {
		expect(PROC_PAGE_SIZE_BYTES).toBe(4096);
	});
});
