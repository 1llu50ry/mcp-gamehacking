import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeCapabilityRegistry } from "../../runtime-capabilities";
import { scheduleDeferredSemanticWarmup, warmSemanticNonFatal } from "../../services/startup-warmup";
import { metrics, METRIC_SEMANTIC_WARMUP_FAILURES } from "../../utils/metrics";

/**
 * FIX-034 — non-fatal, deferred semantic warm-up.
 *
 * The eager warm-up used to race `ensure("semantic")` against a hard-coded 30s
 * cap and AWAIT it inline during startup, so a large DB logged
 * `Semantic warm-up timed out after 30s` and the awaited failure sat on the
 * critical path to first tool calls. These tests pin the new contract:
 *   - a timeout returns `degraded` (never throws, never marks the capability
 *     degraded), so the server keeps serving and semantic stays lazy;
 *   - a fast load returns `ready` (positive);
 *   - a hard load failure is `degraded` but the capability is retried on next
 *     demand rather than being permanently disabled;
 *   - the failure counter increments;
 *   - the deferred scheduler resolves without ever rejecting.
 */
describe("warmSemanticNonFatal (FIX-034)", () => {
	afterEach(() => {
		metrics.reset();
		vi.restoreAllMocks();
	});

	it("returns ready when the semantic capability loads in time (positive)", async () => {
		const registry = new RuntimeCapabilityRegistry("full");
		registry.register("semantic", () => Promise.resolve());

		const result = await warmSemanticNonFatal(registry, 5_000);

		expect(result.status).toBe("ready");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(metrics.getCounter(METRIC_SEMANTIC_WARMUP_FAILURES)).toBe(0);
	});

	it("returns degraded (not fatal) when the warm-up exceeds the timeout", async () => {
		const registry = new RuntimeCapabilityRegistry("full");
		// Never resolves — forces the timeout branch.
		registry.register("semantic", () => new Promise<void>(() => {}));

		const result = await warmSemanticNonFatal(registry, 10);

		expect(result.status).toBe("degraded");
		expect(result.reason).toContain("exceeded 10ms");
		expect(metrics.getCounter(METRIC_SEMANTIC_WARMUP_FAILURES)).toBe(1);
		// CRITICAL: the capability must NOT be marked degraded — that would make
		// `ensure("semantic")` short-circuit to false forever and permanently
		// disable semantic search instead of loading it lazily.
		expect(registry.snapshot().capabilities.semantic.state).toBe("loading");
	});

	it("returns degraded but keeps retrying after a hard load failure", async () => {
		const registry = new RuntimeCapabilityRegistry("full");
		const loader = vi.fn().mockRejectedValueOnce(new Error("model unavailable")).mockResolvedValueOnce(undefined);
		registry.register("semantic", loader);

		const first = await warmSemanticNonFatal(registry, 5_000);
		expect(first.status).toBe("degraded");
		expect(first.reason).toContain("failed to load");
		expect(metrics.getCounter(METRIC_SEMANTIC_WARMUP_FAILURES)).toBe(1);

		// A later first-use demand must retry and succeed — the warm-up did not
		// poison the capability.
		expect(await registry.ensure("semantic")).toBe(true);
		expect(loader).toHaveBeenCalledTimes(2);
	});

	it("never throws even when the registry surfaces an unexpected error", async () => {
		const registry = new RuntimeCapabilityRegistry("full");
		// Simulate a registry whose ensure() rejects (defensive path).
		vi.spyOn(registry, "ensure").mockRejectedValueOnce(new Error("boom"));

		await expect(warmSemanticNonFatal(registry, 5_000)).resolves.toMatchObject({ status: "degraded" });
		expect(metrics.getCounter(METRIC_SEMANTIC_WARMUP_FAILURES)).toBe(1);
	});

	it("waits for the load when the timeout cap is disabled (0)", async () => {
		const registry = new RuntimeCapabilityRegistry("full");
		registry.register("semantic", () => Promise.resolve());

		const result = await warmSemanticNonFatal(registry, 0);
		expect(result.status).toBe("ready");
	});
});

describe("scheduleDeferredSemanticWarmup (FIX-034)", () => {
	afterEach(() => metrics.reset());

	it("defers the attempt and resolves with the outcome (never rejects)", async () => {
		const registry = new RuntimeCapabilityRegistry("full");
		registry.register("semantic", () => new Promise<void>(() => {}));

		const { settled } = scheduleDeferredSemanticWarmup(registry, 10);
		const result = await settled;

		expect(result).toMatchObject({ status: "degraded" });
	});
});
