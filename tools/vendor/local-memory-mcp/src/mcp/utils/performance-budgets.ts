/**
 * Performance budgets — single source of truth for the benchmark tiers
 * (TASK-482).
 *
 * Every number here is a measured latency/throughput budget that maps to one
 * of the two benchmark tiers:
 *
 *   - `PR_SMOKE` — fast, deterministic, network-free checks executed on every
 *     pull request (see src/mcp/tests/performance-smoke.perf.test.ts). These
 *     use the real DB code paths (FTS5, hybrid orchestration, writes) with a
 *     deterministic fixture corpus and a STUBBED vector model, so they are
 *     machine-stable and never depend on an ONNX model download.
 *   - `FULL` — large-scale execution (10K memories, 20K codebase files,
 *     real ONNX embedding batches) run nightly and before every release (see
 *     scripts/benchmark/run-full-benchmarks.mjs). These are the budgets that
 *     regression gate on real embeddings and large corpora.
 *
 * The FULL budgets are intentionally generous headroom over the numbers the
 * implementation is designed to meet (documented in
 * .agents/documents/operations/codebase-index.md §1 and
 * .agents/documents/optimization/optimization-offload-embeddings.md §5/§7):
 * they exist to catch ORDER-OF-MAGNITUDE regressions, not to fail CI on
 * machine noise. All values are ms unless stated otherwise.
 *
 * Budget philosophy (do not change without a task):
 *   - a regression is a violation of a FULL budget, OR a PR smoke budget
 *     crossed on the reference runner (2-vCPU CI) with the deterministic seed;
 *   - budgets are env-tunable (same pattern as utils/constants.ts) so a
 *     slow-but-correct test runner can raise the PR tier without a code diff;
 *   - error-rate budgets gate the NIGHTLY run (a deterministic PR corpus has
 *     ~zero expected failures); FTS search is 100% successful by contract
 *     (the LIKE fallback absorbs every FTS error — see src/mcp/entities/
 *     memory/search.ts), so its error rate is measured at the query layer.
 */

function envInt(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** Parse a percentage (0-100) from env, clamped to the [0, 100] range. */
function envPct(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") return fallback;
	const parsed = Number.parseFloat(raw);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(100, Math.max(0, parsed));
}

// ── PR smoke tier (fast, deterministic, network-free) ─────────────────────
export const PR_BUDGETS = {
	/** FTS5 search over a seeded 2K-memory corpus (p95, ms). */
	ftsSearchP95Ms: envInt("BUDGET_PR_FTS_P95_MS", 50),
	/** Hybrid search orchestration with a stub vector store (p95, ms). */
	hybridSearchP95Ms: envInt("BUDGET_PR_HYBRID_P95_MS", 150),
	/** Single memory-write handler latency (p95, ms). */
	writeP95Ms: envInt("BUDGET_PR_WRITE_P95_MS", 50),
	/** Vector availability after a synchronous write (stub worker, ms). */
	embeddingAvailabilityMs: envInt("BUDGET_PR_EMBED_AVAIL_MS", 5_000),
	/** Deterministic re-index of the 100-file fixture tree (ms). */
	reindexMs: envInt("BUDGET_PR_REINDEX_MS", 60_000)
} as const;

// ── Full tier (nightly + release, large scale, real embeddings) ───────────
export const FULL_BUDGETS = {
	/** FTS5 search over a 10K-memory corpus (p95, ms). */
	ftsSearchP95Ms: envInt("BUDGET_FULL_FTS_P95_MS", 100),
	/** Hybrid search with the real ONNX vector store (p95, ms). */
	hybridSearchP95Ms: envInt("BUDGET_FULL_HYBRID_P95_MS", 500),
	/** Memory-write handler latency (p95, ms) — enqueue is off the lock. */
	writeP95Ms: envInt("BUDGET_FULL_WRITE_P95_MS", 100),
	/** Per-item vector availability (write → vector row visible, ms). */
	embeddingAvailabilityMs: envInt("BUDGET_FULL_EMBED_AVAIL_MS", 10_000),
	/** First-time index of a 10K-file tree (ms). */
	reindexMs: envInt("BUDGET_FULL_REINDEX_MS", 120_000),
	/** Incremental re-index of a 10K-file tree with few changed files (ms). */
	reindexIncrementalMs: envInt("BUDGET_FULL_REINDEX_INCREMENTAL_MS", 30_000),
	/** FTS queries must succeed (never silently fail) — % per run. */
	ftsSuccessRatePct: envPct("BUDGET_FULL_FTS_SUCCESS_PCT", 100),
	/** Embedding queue error rate (poison + failed) — % of jobs per run. */
	embeddingErrorRatePct: envPct("BUDGET_FULL_EMBED_ERROR_PCT", 1)
} as const;

// ── Benchmark corpus sizes (keep the PR tier fast, the full tier large) ──
export const BENCHMARK_CORPUS = {
	/** Memory rows seeded for the PR smoke FTS/hybrid/write tiers. */
	prMemories: envInt("BENCHMARK_PR_MEMORIES", 2_000),
	/** Codebase fixture files generated for the PR re-index tier. */
	prIndexFiles: envInt("BENCHMARK_PR_INDEX_FILES", 100),
	/** Memories seeded for the nightly/release full tiers. */
	fullMemories: envInt("BENCHMARK_FULL_MEMORIES", 10_000),
	/** Codebase files generated for the nightly/release index tiers. */
	fullIndexFiles: envInt("BENCHMARK_FULL_INDEX_FILES", 10_000)
} as const;

/**
 * Snapshot of every budget — serialized to the benchmark report
 * (scripts/benchmark/benchmark-report.mjs) so baselines are comparable across
 * runs and machines.
 */
export function getBudgetSnapshot(): {
	pr: typeof PR_BUDGETS;
	full: typeof FULL_BUDGETS;
	corpus: typeof BENCHMARK_CORPUS;
} {
	return { pr: PR_BUDGETS, full: FULL_BUDGETS, corpus: BENCHMARK_CORPUS };
}
