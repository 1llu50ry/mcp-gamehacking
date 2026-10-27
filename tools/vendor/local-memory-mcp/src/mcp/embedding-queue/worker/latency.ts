/**
 * Embedding batch-latency series + rollup into the worker stats payload
 * (OPT-OBS-01; TASK-554 split out of `worker.ts`).
 *
 * The worker keeps its OWN `DurationSeries` (exposed as
 * `getStats().embedLatency` with p50/p95) AND feeds the process-wide metrics
 * registry (`metrics.recordEmbedLatency`). This module owns that double-write
 * so `batch.ts` and `worker.ts` stay thin.
 */
import { DurationSeries, metrics } from "../../utils/metrics";

/**
 * Timed ONNX batch embed: measure the batch, record into BOTH the per-worker
 * series (surfaced via `getStats().embedLatency`) and the process metrics
 * registry. Returns the elapsed ms.
 */
export async function timeEmbedBatch(series: DurationSeries, run: () => Promise<unknown>): Promise<number> {
	const startMs = performance.now();
	await run();
	const embedMs = performance.now() - startMs;
	series.add(embedMs);
	metrics.recordEmbedLatency(embedMs);
	return embedMs;
}
