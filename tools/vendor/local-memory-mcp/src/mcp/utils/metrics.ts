/**
 * In-process observability metrics registry (OPT-OBS-01).
 *
 * Records `performance.now()` deltas for the single tool-dispatch core
 * (tools/index.ts) and the embedding worker (embedding-queue/worker.ts), so
 * the OPT-PERF-01..11 optimizations become measurable and regression-testable.
 *
 * The registry is a module singleton that is **process-local by design**:
 * the MCP server and the dashboard run in separate processes, each feeding
 * its own instance. The dashboard `/api/system/metrics` endpoint reads the
 * dashboard process's instance (embed latency from its worker + any dispatch
 * that happens inside the dashboard process) and merges it with the worker's
 * own `getStats()`.
 *
 * Distribution tracking keeps a bounded sample reservoir per series so the
 * p50/p95 percentiles stay accurate without unbounded memory growth.
 */

/** Caps the number of samples retained per series (drives percentile math). */
const MAX_SAMPLES = 1_000;

/**
 * Counter names for the discrete startup events FIX-034 makes observable.
 * Exported so call sites (startup warm-up, auto-index isolation) and tests
 * share one spelling instead of stringly-duplicating it.
 */
export const METRIC_SEMANTIC_WARMUP_FAILURES = "semantic_warmup_failures";
export const METRIC_AUTOINDEX_FAILURES = "autoindex_failures";
/**
 * Counts the times a worker pool entered the crash-storm DISABLED state (H1,
 * FEAT-DAEMON-002 review): N consecutive worker crashes within the window made
 * the pool stop respawning and reject with a non-retryable error.
 */
export const METRIC_WORKER_POOL_CRASH_STORM = "worker_pool_crash_storm";

export interface DurationStats {
	/** Number of recorded samples. */
	count: number;
	/** Cumulative duration across all samples (ms). */
	totalMs: number;
	/** Arithmetic mean (ms). */
	avgMs: number;
	/** Fastest sample (ms). */
	minMs: number;
	/** Slowest sample (ms). */
	maxMs: number;
	/** 50th-percentile (median) sample (ms). */
	p50Ms: number;
	/** 95th-percentile sample (ms). */
	p95Ms: number;
	/** Duration of the most recent sample (ms). */
	lastMs: number;
}

/** Round a millisecond value to two decimals (stable, readable log/metrics). */
function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * Nearest-rank percentile over an ascending-sorted sample array. Returns the
 * observed sample at the quantile boundary; empty input yields 0.
 */
function percentile(sorted: number[], q: number): number {
	if (sorted.length === 0) return 0;
	const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
	return sorted[rank];
}

/**
 * Accumulates sampled durations into a fixed summary plus bounded samples for
 * p50/p95. Sample retention uses reservoir sampling once the cap is reached,
 * so long-running processes keep a bounded, unbiased percentile window.
 */
export class DurationSeries {
	private readonly samples: number[];
	private readonly capacity: number;

	/** Total samples recorded. */
	count = 0;
	/** Running sum of recorded durations (ms). */
	totalMs = 0;
	/** Running min (ms). */
	minMs = Infinity;
	/** Running max (ms). */
	maxMs = -Infinity;
	/** Most recent sample (ms). */
	lastMs = 0;

	constructor(capacity: number = MAX_SAMPLES) {
		this.capacity = capacity;
		this.samples = [];
	}

	/** Number of samples retained for percentile math (≤ capacity). */
	get sampleCount(): number {
		return this.samples.length;
	}

	add(ms: number): void {
		this.count++;
		this.totalMs += ms;
		this.lastMs = ms;
		if (ms < this.minMs) this.minMs = ms;
		if (ms > this.maxMs) this.maxMs = ms;
		if (this.samples.length < this.capacity) {
			this.samples.push(ms);
		} else {
			// Reservoir replacement — unbiased sample of the full stream.
			this.samples[(Math.random() * this.samples.length) | 0] = ms;
		}
	}

	/** Clear samples and counters (tests / process-window resets). */
	reset(): void {
		this.samples.length = 0;
		this.count = 0;
		this.totalMs = 0;
		this.minMs = Infinity;
		this.maxMs = -Infinity;
		this.lastMs = 0;
	}

	/** Immutable snapshot of the current distribution. */
	snapshot(): DurationStats {
		if (this.count === 0) {
			return {
				count: 0,
				totalMs: 0,
				avgMs: 0,
				minMs: 0,
				maxMs: 0,
				p50Ms: 0,
				p95Ms: 0,
				lastMs: 0
			};
		}
		const sorted = [...this.samples].sort((a, b) => a - b);
		return {
			count: this.count,
			totalMs: round2(this.totalMs),
			avgMs: round2(this.totalMs / this.count),
			minMs: round2(this.minMs),
			maxMs: round2(this.maxMs),
			p50Ms: round2(percentile(sorted, 0.5)),
			p95Ms: round2(percentile(sorted, 0.95)),
			lastMs: round2(this.lastMs)
		};
	}
}

/** Write-handler duration distribution — aggregated + broken down per tool. */
export interface WriteHandlerSnapshot {
	total: DurationStats;
	byTool: Record<string, DurationStats>;
}

/** Serializable snapshot of everything the registry currently tracks. */
export type ToolOutcome = "success" | "error" | "partial" | "degraded";

export interface ToolOutcomeCounts {
	success: number;
	error: number;
	partial: number;
	degraded: number;
}

export interface MetricsSnapshot {
	/** Per-tool dispatch latency, keyed by tool name. */
	tools: Record<string, DurationStats>;
	/** Outcome counts keyed by tool name; error-shaped responses are never counted as success. */
	toolOutcomes: Record<string, ToolOutcomeCounts>;
	/** Write-handler duration (store.withWrite fast path — no file lock held) — aggregate + per tool. */
	writeHandler: WriteHandlerSnapshot;
	/** Embedding batch latency (embedding-queue/worker.ts). */
	embedLatency: DurationStats;
	/**
	 * Monotonic event counters keyed by metric name (FIX-034). Used for
	 * discrete non-latency events (e.g. `semantic_warmup_failures`,
	 * `autoindex_failures`) where a duration distribution is meaningless.
	 */
	counters: Record<string, number>;
}

export class MetricsRegistry {
	private readonly tools = new Map<string, DurationSeries>();
	private readonly toolOutcomes = new Map<string, ToolOutcomeCounts>();
	private readonly writeHandlerTotal = new DurationSeries();
	private readonly writeHandlerByTool = new Map<string, DurationSeries>();
	private readonly embedLatency = new DurationSeries();
	private readonly counters = new Map<string, number>();

	private seriesFor(map: Map<string, DurationSeries>, key: string): DurationSeries {
		let series = map.get(key);
		if (!series) {
			series = new DurationSeries();
			map.set(key, series);
		}
		return series;
	}

	/** Record a completed tool dispatch, its latency, and classified outcome. */
	recordTool(toolName: string, ms: number, outcome: ToolOutcome = "success"): void {
		this.seriesFor(this.tools, toolName).add(ms);
		const counts = this.toolOutcomes.get(toolName) ?? { success: 0, error: 0, partial: 0, degraded: 0 };
		counts[outcome]++;
		this.toolOutcomes.set(toolName, counts);
	}

	/**
	 * Record how long a write-tool handler took to execute (ms).
	 *
	 * NOT a lock-hold metric (TASK-161): since OPT-PERF-09 the fast-path
	 * withWrite does not acquire a proper-lockfile — BEGIN IMMEDIATE +
	 * busy_timeout provides exclusion — so this measures handler dispatch
	 * latency, not lock contention.
	 */
	recordWriteHandler(toolName: string, ms: number): void {
		this.writeHandlerTotal.add(ms);
		this.seriesFor(this.writeHandlerByTool, toolName).add(ms);
	}

	/** Record one embedding batch latency (ms). */
	recordEmbedLatency(ms: number): void {
		this.embedLatency.add(ms);
	}

	/**
	 * Increment a monotonic event counter by `delta` (default 1). Counters are
	 * for discrete events where latency is irrelevant (FIX-034: warm-up and
	 * auto-index failures). Negative/zero deltas are ignored so a counter can
	 * never move backwards.
	 */
	incrementCounter(name: string, delta = 1): void {
		if (delta <= 0) return;
		this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
	}

	/** Read a counter's current value (0 when never incremented). */
	getCounter(name: string): number {
		return this.counters.get(name) ?? 0;
	}

	/** Serialized current view of all tracked metrics. */
	snapshot(): MetricsSnapshot {
		const writeHandlerByTool: Record<string, DurationStats> = {};
		for (const [tool, series] of this.writeHandlerByTool) {
			writeHandlerByTool[tool] = series.snapshot();
		}
		const tools: Record<string, DurationStats> = {};
		for (const [tool, series] of this.tools) {
			tools[tool] = series.snapshot();
		}
		const toolOutcomes = Object.fromEntries(
			[...this.toolOutcomes].map(([tool, counts]) => [tool, { ...counts }])
		) as Record<string, ToolOutcomeCounts>;
		return {
			tools,
			toolOutcomes,
			writeHandler: {
				total: this.writeHandlerTotal.snapshot(),
				byTool: writeHandlerByTool
			},
			embedLatency: this.embedLatency.snapshot(),
			counters: Object.fromEntries(this.counters)
		};
	}

	/** Clear every series — used by tests / process-window resets. */
	reset(): void {
		for (const series of this.tools.values()) series.reset();
		this.tools.clear();
		this.toolOutcomes.clear();
		for (const series of this.writeHandlerByTool.values()) series.reset();
		this.writeHandlerByTool.clear();
		this.writeHandlerTotal.reset();
		this.embedLatency.reset();
		this.counters.clear();
	}
}

/** Process-wide shared registry — imported by the dispatch core and the worker. */
export const metrics = new MetricsRegistry();

/**
 * Test-facing alias that returns a fresh registry for isolated assertions.
 * Kept tiny so only test code depends on construction internals.
 */
export function createMetricsRegistry(): MetricsRegistry {
	return new MetricsRegistry();
}
