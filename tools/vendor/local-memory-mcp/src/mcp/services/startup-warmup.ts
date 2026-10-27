/**
 * Non-fatal, deferred semantic (ONNX) warm-up (FIX-034).
 *
 * ROOT CAUSE this module fixes: the `full`-profile eager warm-up raced
 * `runtimeCapabilities.ensure("semantic")` against a HARD-CODED 30s cap and
 * awaited it INLINE during startup. On large DBs (the reported deployment ran
 * a ~897 MB `codebase.db` and a ~2.7 GB `memory.db`) loading the ONNX runtime +
 * embedding model exceeded that cap, so startup logged
 * `Semantic warm-up timed out after 30s` and the awaited failure sat on the
 * critical path to first tool calls.
 *
 * Two properties make the warm-up non-blocking now:
 *
 *   1. NON-FATAL — {@link warmSemanticNonFatal} NEVER throws and NEVER marks
 *      the capability degraded. A timeout / load failure only logs a single
 *      WARN and bumps a counter; the in-flight `ensure("semantic")` promise is
 *      left running, so the capability still flips to `ready` when the load
 *      finally settles and any first semantic call loads it lazily. (Calling
 *      `markDegraded` here would be WRONG: a `degraded` state makes
 *      `RuntimeCapabilityRegistry.ensure` short-circuit to `false` forever,
 *      which would permanently disable semantic search instead of loading it.)
 *
 *   2. DEFERRED — {@link scheduleDeferredSemanticWarmup} waits one
 *      `setImmediate` tick before starting, mirroring FIX-025's deferral of the
 *      embedding backfill (`embedding-queue/worker.ts`). Callers schedule it
 *      AFTER the listener is bound, so `initialize` / first requests are
 *      answered before the heavy ONNX load competes for the event loop.
 *
 * The wall-clock ceiling is env-configurable via `SEMANTIC_WARMUP_TIMEOUT_MS`
 * (0 disables the cap — wait for the load to settle).
 */
import { logger } from "../utils/logger";
import { metrics, METRIC_SEMANTIC_WARMUP_FAILURES } from "../utils/metrics";
import { SEMANTIC_WARMUP_TIMEOUT_MS } from "../utils/constants";
import type { RuntimeCapabilityRegistry } from "../runtime-capabilities";

/** Outcome of a non-fatal semantic warm-up attempt. */
export interface SemanticWarmupResult {
	/** `ready` when the capability loaded in time; `degraded` otherwise. */
	status: "ready" | "degraded";
	/** Human-readable reason when `status === "degraded"`. */
	reason?: string;
	/** Wall-clock duration of the attempt (ms). */
	durationMs: number;
}

/** Handle returned by {@link scheduleDeferredSemanticWarmup}. */
export interface DeferredSemanticWarmup {
	/**
	 * Resolves with the warm-up outcome once the deferred attempt settles
	 * (`null` only if the attempt itself unexpectedly rejected). Exposed so
	 * tests can await the deferred run instead of polling.
	 */
	settled: Promise<SemanticWarmupResult | null>;
}

/**
 * Load the semantic capability without blocking or aborting startup.
 *
 * Races `ensure("semantic")` against an optional timeout. On timeout or load
 * failure it logs a single WARN, increments
 * {@link METRIC_SEMANTIC_WARMUP_FAILURES}, and returns `degraded` — it NEVER
 * throws and NEVER marks the capability degraded, so semantic features remain
 * lazily available (the in-flight load keeps running; a first-use call retries
 * after a hard failure).
 *
 * @param capabilities - Registry that owns the `semantic` loader.
 * @param timeoutMs - Wall-clock ceiling; `<= 0` waits for the load to settle.
 */
export async function warmSemanticNonFatal(
	capabilities: RuntimeCapabilityRegistry,
	timeoutMs: number = SEMANTIC_WARMUP_TIMEOUT_MS
): Promise<SemanticWarmupResult> {
	const started = Date.now();
	let timer: NodeJS.Timeout | undefined;

	try {
		const load = capabilities.ensure("semantic");

		if (timeoutMs <= 0) {
			// Cap disabled — wait for the load to settle, still non-fatal.
			const ready = await load;
			return ready
				? { status: "ready", durationMs: Date.now() - started }
				: degrade("Semantic warm-up failed to load — will retry on first use", started);
		}

		const timeout = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), timeoutMs);
			// Never keep the process alive solely for the warm-up timer.
			timer.unref?.();
		});

		const outcome = await Promise.race([
			load.then((ready) => (ready ? ("ready" as const) : ("failed" as const))),
			timeout
		]);

		if (outcome === "ready") {
			return { status: "ready", durationMs: Date.now() - started };
		}
		if (outcome === "timeout") {
			return degrade(`Semantic warm-up exceeded ${timeoutMs}ms — continuing; loads lazily on first use`, started);
		}
		return degrade("Semantic warm-up failed to load — will retry on first use", started);
	} catch (error) {
		// Defensive: `ensure` resolves (never rejects) today, but the warm-up
		// must never be able to escape into startup regardless.
		return degrade(`Semantic warm-up threw: ${String(error)}`, started);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Schedule {@link warmSemanticNonFatal} on the next `setImmediate` tick so the
 * listener can become ready first (FIX-025 pattern). Fire-and-forget — the
 * returned handle exposes a `settled` promise for tests/observability.
 */
export function scheduleDeferredSemanticWarmup(
	capabilities: RuntimeCapabilityRegistry,
	timeoutMs: number = SEMANTIC_WARMUP_TIMEOUT_MS
): DeferredSemanticWarmup {
	const settled = new Promise<SemanticWarmupResult | null>((resolve) => {
		setImmediate(() => {
			void warmSemanticNonFatal(capabilities, timeoutMs).then(
				(result) => resolve(result),
				() => resolve(null)
			);
		});
	});
	return { settled };
}

/** Build a degraded result, logging once + counting the failure. */
function degrade(reason: string, started: number): SemanticWarmupResult {
	metrics.incrementCounter(METRIC_SEMANTIC_WARMUP_FAILURES);
	logger.warn("[Server] Semantic warm-up failed. Will retry on first use.", { reason });
	return { status: "degraded", reason, durationMs: Date.now() - started };
}
