/**
 * Linux `/proc` process metrics for the PERF-008 lightness benchmark.
 *
 * The benchmark must report **VmRSS and VmHWM explicitly**, because the original
 * "2.6 GB RSS" claim in PERF-001 was a **VmSize (virtual address space) misread**
 * — VmSize counts reserved-but-untouched mappings (the ONNX/ORT arena and the
 * tree-sitter dylink linear memory) and runs an order of magnitude above the
 * resident set. Every snapshot therefore carries `vmSizeBytes` *and*
 * `vmRssBytes`/`vmHwmBytes` so the two can never be conflated again.
 *
 * Sources (all read-only, no dependency):
 *   - `/proc/<pid>/stat`   → CPU ticks (utime/stime), native thread count, RSS pages
 *   - `/proc/<pid>/status` → VmSize / VmRSS / VmHWM / VmPeak / Threads
 *   - `/proc/<pid>/task`   → authoritative native thread count (directory entries)
 *
 * Parsers are pure (string → value) so they are unit-testable without a live
 * process; the `read*`/`sample*` helpers add the filesystem access.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Ticks per second for `/proc/<pid>/stat` CPU counters. Linux uses the kernel's
 * `USER_HZ`, which is 100 on every mainstream configuration (`getconf CLK_TCK`).
 * Override only for an exotic kernel where `USER_HZ` differs.
 */
export const PROC_CLOCK_TICKS_PER_SECOND = 100;

/**
 * Page size used to convert the `rss` field of `/proc/<pid>/stat` (in pages)
 * to bytes. Linux x86-64 defaults to 4 KiB; override for a 16 KiB/64 KiB page
 * kernel.
 */
export const PROC_PAGE_SIZE_BYTES = 4096;

/** Parsed CPU/thread/memory fields of `/proc/<pid>/stat`. */
export interface ProcStatSample {
	/** Process id the row belongs to (field 1). */
	pid: number;
	/** User-mode CPU time in clock ticks (field 14). */
	utimeTicks: number;
	/** Kernel-mode CPU time in clock ticks (field 15). */
	stimeTicks: number;
	/** Native thread count (field 20). */
	numThreads: number;
	/** Process start time in clock ticks since boot (field 22). */
	starttimeTicks: number;
	/** Virtual address space size in bytes (field 23). */
	vsizeBytes: number;
	/** Resident set size in pages (field 24) — multiply by {@link PROC_PAGE_SIZE_BYTES}. */
	rssPages: number;
}

/** Parsed memory/thread fields of `/proc/<pid>/status` (null when the row is absent). */
export interface ProcStatusSample {
	/** `Name:` value (comm, truncated to 15 chars by the kernel). */
	name: string | null;
	/** `VmPeak:` — peak virtual address space, bytes. */
	vmPeakBytes: number | null;
	/** `VmSize:` — current virtual address space, bytes. */
	vmSizeBytes: number | null;
	/** `VmRSS:` — current resident set, bytes. */
	vmRssBytes: number | null;
	/** `VmHWM:` — peak resident set (high-water mark), bytes. */
	vmHwmBytes: number | null;
	/** `Threads:` — native thread count. */
	threads: number | null;
}

/** One point-in-time observation of a process. */
export interface ProcSnapshot {
	pid: number;
	/** Wall-clock time the snapshot was taken (`Date.now()`). */
	sampledAtMs: number;
	stat: ProcStatSample | null;
	status: ProcStatusSample | null;
	/** Authoritative native thread count from `/proc/<pid>/task`. */
	nativeThreadCount: number;
	/** `utime + stime` in clock ticks; null when `stat` is unreadable. */
	cpuTicks: number | null;
	/** Resident set in bytes, preferring `/proc/<pid>/status` VmRSS. */
	vmRssBytes: number | null;
	/** Peak resident set in bytes, from `/proc/<pid>/status` VmHWM. */
	vmHwmBytes: number | null;
	/** Virtual address space in bytes, from `/proc/<pid>/status` VmSize. */
	vmSizeBytes: number | null;
}

/** CPU usage of a sampling window derived from two snapshots. */
export interface CpuWindow {
	/** CPU ticks consumed between the two snapshots (`next - prev`). */
	cpuTicks: number;
	/** Wall-clock duration of the window in ms. */
	wallMs: number;
	/**
	 * CPU busy percentage relative to ONE core: `cpuTicks / ticks-per-window`
	 * × 100. Values above 100 mean multiple threads ran in parallel.
	 */
	cpuPercent: number;
}

/**
 * Parse the `kB`-suffixed value of a `/proc/<pid>/status` line.
 *
 * @returns Bytes, or null when the line has no parseable numeric value.
 */
function parseStatusKb(value: string | undefined): number | null {
	if (value === undefined) return null;
	const match = /^\s*(\d+)\s*kB\s*$/.exec(value);
	if (!match) return null;
	return Number(match[1]) * 1024;
}

/**
 * Parse a `/proc/<pid>/status` dump.
 *
 * @param content - Raw file content.
 * @returns Parsed sample with nulls for absent rows, or null when no row parsed.
 */
export function parseProcStatus(content: string): ProcStatusSample | null {
	if (typeof content !== "string" || content.length === 0) return null;
	const fields = new Map<string, string>();
	for (const line of content.split("\n")) {
		const colon = line.indexOf(":");
		if (colon <= 0) continue;
		fields.set(line.slice(0, colon).trim(), line.slice(colon + 1));
	}
	const threadsRaw = fields.get("Threads");
	const threads = threadsRaw !== undefined && /^\s*\d+\s*$/.test(threadsRaw) ? Number(threadsRaw) : null;
	const name = fields.get("Name")?.trim() ?? null;
	const sample: ProcStatusSample = {
		name: name && name.length > 0 ? name : null,
		vmPeakBytes: parseStatusKb(fields.get("VmPeak")),
		vmSizeBytes: parseStatusKb(fields.get("VmSize")),
		vmRssBytes: parseStatusKb(fields.get("VmRSS")),
		vmHwmBytes: parseStatusKb(fields.get("VmHWM")),
		threads
	};
	const parsedAny =
		sample.vmSizeBytes !== null ||
		sample.vmRssBytes !== null ||
		sample.vmHwmBytes !== null ||
		sample.vmPeakBytes !== null ||
		sample.threads !== null;
	return parsedAny ? sample : null;
}

/**
 * Parse a `/proc/<pid>/stat` line.
 *
 * The `comm` field (2) is wrapped in parentheses and MAY contain spaces and
 * parentheses of its own, so the field split must start after the LAST `)`.
 *
 * @param content - Raw file content.
 * @returns Parsed sample, or null when the row is malformed.
 */
export function parseProcStat(content: string): ProcStatSample | null {
	if (typeof content !== "string") return null;
	const close = content.lastIndexOf(")");
	if (close < 0) return null;
	const open = content.indexOf("(");
	if (open < 0 || open > close) return null;
	// Fields after `comm` (field 3 onward) are space-separated; index 0 of the
	// remainder is field 3 (`state`), so field N maps to remainder[N - 3].
	const rest = content
		.slice(close + 1)
		.trim()
		.split(/\s+/);
	if (rest.length < 22) return null;
	const at = (field: number): number => Number(rest[field - 3]);
	const pid = Number(content.slice(0, open).trim());
	const utimeTicks = at(14);
	const stimeTicks = at(15);
	const numThreads = at(20);
	const starttimeTicks = at(22);
	const vsizeBytes = at(23);
	const rssPages = at(24);
	const values = [pid, utimeTicks, stimeTicks, numThreads, starttimeTicks, vsizeBytes, rssPages];
	if (values.some((value) => !Number.isFinite(value))) return null;
	return { pid, utimeTicks, stimeTicks, numThreads, starttimeTicks, vsizeBytes, rssPages };
}

/** Read and parse `/proc/<pid>/stat`. Returns null when unreadable/malformed. */
export function readProcStat(pid: number): ProcStatSample | null {
	try {
		return parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
	} catch {
		return null;
	}
}

/** Read and parse `/proc/<pid>/status`. Returns null when unreadable/malformed. */
export function readProcStatus(pid: number): ProcStatusSample | null {
	try {
		return parseProcStatus(fs.readFileSync(`/proc/${pid}/status`, "utf8"));
	} catch {
		return null;
	}
}

/**
 * Count native OS threads from `/proc/<pid>/task` (one directory entry per
 * thread). This is the authoritative count for "how many ORT/worker threads did
 * the process spawn" — `/proc/<pid>/status` `Threads:` mirrors it.
 *
 * @returns Thread count, or 0 when the task directory is unreadable.
 */
export function countNativeThreads(pid: number): number {
	try {
		return fs.readdirSync(`/proc/${pid}/task`).length;
	} catch {
		return 0;
	}
}

/** Take one snapshot of a process. Returns null when the process is gone. */
export function sampleProcess(pid: number): ProcSnapshot | null {
	const stat = readProcStat(pid);
	const status = readProcStatus(pid);
	const nativeThreadCount = countNativeThreads(pid);
	if (stat === null && status === null && nativeThreadCount === 0) return null;
	return {
		pid,
		sampledAtMs: Date.now(),
		stat,
		status,
		nativeThreadCount,
		cpuTicks: stat === null ? null : stat.utimeTicks + stat.stimeTicks,
		vmRssBytes: status?.vmRssBytes ?? (stat === null ? null : stat.rssPages * PROC_PAGE_SIZE_BYTES),
		vmHwmBytes: status?.vmHwmBytes ?? null,
		vmSizeBytes: status?.vmSizeBytes ?? stat?.vsizeBytes ?? null
	};
}

/**
 * CPU usage between two snapshots.
 *
 * @returns Tick delta, wall duration, and one-core-relative CPU percent.
 *   Returns null when either snapshot lacks a CPU counter or time did not advance.
 */
export function cpuWindow(prev: ProcSnapshot, next: ProcSnapshot): CpuWindow | null {
	if (prev.cpuTicks === null || next.cpuTicks === null) return null;
	const wallMs = next.sampledAtMs - prev.sampledAtMs;
	if (wallMs <= 0) return null;
	const cpuTicks = next.cpuTicks - prev.cpuTicks;
	const expectedTicks = (wallMs / 1000) * PROC_CLOCK_TICKS_PER_SECOND;
	return { cpuTicks, wallMs, cpuPercent: expectedTicks > 0 ? (cpuTicks / expectedTicks) * 100 : 0 };
}

/**
 * Aggregate a sample series into the per-scenario record shape the benchmark
 * persists. All memory fields are bytes; CPU is one-core-relative percent.
 */
export interface ProcSeriesSummary {
	samples: number;
	durationMs: number;
	peakCpuPercent: number;
	averageCpuPercent: number;
	peakThreadCount: number;
	finalThreadCount: number;
	peakVmRssBytes: number;
	finalVmRssBytes: number;
	peakVmHwmBytes: number;
	peakVmSizeBytes: number;
}

/**
 * Summarize a snapshot series.
 *
 * Peak CPU is computed over consecutive-sample windows (not an instantaneous
 * counter delta), so a short burst between two samples is still captured.
 *
 * @param series - Snapshots in chronological order.
 */
export function summarizeSeries(series: ProcSnapshot[]): ProcSeriesSummary {
	const summary: ProcSeriesSummary = {
		samples: series.length,
		durationMs: 0,
		peakCpuPercent: 0,
		averageCpuPercent: 0,
		peakThreadCount: 0,
		finalThreadCount: 0,
		peakVmRssBytes: 0,
		finalVmRssBytes: 0,
		peakVmHwmBytes: 0,
		peakVmSizeBytes: 0
	};
	if (series.length === 0) return summary;
	summary.durationMs = series[series.length - 1]!.sampledAtMs - series[0]!.sampledAtMs;
	let cpuTicks = 0;
	let wallMs = 0;
	for (let index = 1; index < series.length; index++) {
		const window = cpuWindow(series[index - 1]!, series[index]!);
		if (window === null) continue;
		cpuTicks += window.cpuTicks;
		wallMs += window.wallMs;
		if (window.cpuPercent > summary.peakCpuPercent) summary.peakCpuPercent = window.cpuPercent;
	}
	if (wallMs > 0) summary.averageCpuPercent = (cpuTicks / ((wallMs / 1000) * PROC_CLOCK_TICKS_PER_SECOND)) * 100;
	for (const snapshot of series) {
		if (snapshot.nativeThreadCount > summary.peakThreadCount) summary.peakThreadCount = snapshot.nativeThreadCount;
		if (snapshot.vmRssBytes !== null && snapshot.vmRssBytes > summary.peakVmRssBytes) {
			summary.peakVmRssBytes = snapshot.vmRssBytes;
		}
		if (snapshot.vmHwmBytes !== null && snapshot.vmHwmBytes > summary.peakVmHwmBytes) {
			summary.peakVmHwmBytes = snapshot.vmHwmBytes;
		}
		if (snapshot.vmSizeBytes !== null && snapshot.vmSizeBytes > summary.peakVmSizeBytes) {
			summary.peakVmSizeBytes = snapshot.vmSizeBytes;
		}
	}
	const last = series[series.length - 1]!;
	summary.finalThreadCount = last.nativeThreadCount;
	summary.finalVmRssBytes = last.vmRssBytes ?? summary.peakVmRssBytes;
	return summary;
}

/** Convenience: `path.join`-free check that a pid currently exists under /proc. */
export function processExists(pid: number): boolean {
	return fs.existsSync(path.join("/proc", String(pid)));
}
