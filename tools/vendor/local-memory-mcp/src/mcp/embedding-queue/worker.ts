/**
 * In-process lease-based embedding/KG worker (TASK-013 / MEM-368).
 *
 * Runs in BOTH the MCP server and the dashboard. It claims batches of
 * `queue_jobs` (K=32 by default) with an atomic SQLite UPDATE (60s lease),
 * embeds the snapshot payloads with batched ONNX inference, runs compromise
 * KG extraction, then conditionally completes each job. The worker never
 * holds the proper-lockfile write lock — only brief SQLite writes for
 * claim/complete/fail — so writes stay fast while enrichment drains in the
 * background.
 *
 * SQLITE-safety of the unlocked writes (TASK-064 / MEM-475): claim/complete/
 * fail are single conditional UPDATE statements, which cannot hit
 * SQLITE_BUSY_SNAPSHOT (no stale read snapshot) and wait at most
 * busy_timeout=5000 for a transient writer; backfillMissingVectors is a
 * read-then-write transaction and therefore runs with BEGIN IMMEDIATE
 * (enqueue.ts). The idle poll loop uses exponential backoff + jitter so two
 * workers never busy-spin or thundering-herd the same poll times.
 *
 * SQLITE_BUSY tolerance (TASK-457): a sibling process (dashboard / another
 * per-client MCP server / the codebase indexer) holding the write lock past
 * busy_timeout surfaces as a better-sqlite3 SqliteError with `code`
 * 'SQLITE_BUSY' or 'SQLITE_BUSY_SNAPSHOT' on any of the outbox writes. Those
 * are TRANSIENT — they are never a job attempt and never poison: the cycle
 * backs off with jitter instead of logging a fatal "cycle failed", a per-job
 * BUSY releases the claim (attempts/backoff untouched) so it is retried, and
 * the outbox writes are wrapped so their own BUSY can never kill the cycle.
 *
 * Crash-safety: a lease expires after 60s; the next claim cycle (or startup
 * reconcile) re-queues the job. KG observation inserts are idempotent
 * (unique index + INSERT OR IGNORE), so reprocessing never duplicates data.
 * Startup also backfills rows with missing/stale vectors and sweeps finished
 * rows (purge).
 *
 * Layout (TASK-554): the claim→embed→extract→complete pipeline lives in
 * `worker/batch.ts`; poll scheduling in `worker/poll-delay.ts`; job counters
 * in `worker/counters.ts`; outbox-write BUSY tolerance in
 * `worker/sqlite-busy.ts` + `worker/batch.ts`; batch latency in
 * `worker/latency.ts`; startup maintenance + purge in `worker/maintenance.ts`;
 * and option resolution in `worker/options.ts`. `worker.ts` is now a thin
 * lifecycle shell over those collaborators and re-exports the module's
 * public surface (`EmbeddingWorker`, `EmbeddingWorkerOptions`, `isBusyError`)
 * so all existing importers (index.ts barrel, dashboard context, tests) are
 * unchanged.
 */
import type { RealVectorStore } from "../storage/vectors";
import type { SQLiteStore } from "../storage/sqlite";
import { logger } from "../utils/logger";
import { DurationSeries } from "../utils/metrics";
import { Outbox } from "./outbox";
import type { EmbeddingWorkerStats } from "./types";
import {
	createPollState,
	createWorkerCounters,
	drainClaimedBatch,
	isBusyError,
	nextPollDelay,
	runPurgeSweep,
	runStartupMaintenance
} from "./worker/index";
import type { WorkerCounters } from "./worker/index";
import type { EmbeddingWorkerOptions, ResolvedWorkerOptions } from "./worker/options";
import { resolveWorkerOptions } from "./worker/options";
export { isBusyError } from "./worker/index";
export type { EmbeddingWorkerOptions } from "./worker/options";

export class EmbeddingWorker {
	private readonly outbox: Outbox;
	private readonly opts: ResolvedWorkerOptions;
	private readonly pollState = createPollState();
	private readonly counters: WorkerCounters = createWorkerCounters();
	private timer: NodeJS.Timeout | null = null;
	private purgeTimer: NodeJS.Timeout | null = null;
	private started = false;
	private running = false;
	private stopped = false;
	private modelReady = false;
	/**
	 * Resolves when the (deferred) startup maintenance sweep has settled.
	 * Exposed so callers/tests can await the one-time reconcile/backfill/purge
	 * without polling the queue (FIX-025 latency reduction).
	 */
	private startupMaintenancePromise: Promise<void> = Promise.resolve();
	/** Embedding batch latency samples (OPT-OBS-01) — surfaced as p50/p95. */
	private readonly embedLatency = new DurationSeries();

	constructor(
		private readonly store: SQLiteStore,
		private readonly vectors: RealVectorStore,
		options: EmbeddingWorkerOptions = {}
	) {
		this.outbox = new Outbox(store);
		this.opts = resolveWorkerOptions(options);
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	start(): void {
		if (this.started) return;
		this.started = true;
		this.stopped = false;

		// Startup maintenance: reconcile expired leases, backfill missing/stale
		// vectors, purge finished rows.
		//
		// DEFERRED (FIX-025): `runStartupMaintenance` is fully synchronous on a
		// 2.6GB DB (reconcile + backfill scan + purge), so running it inline here
		// blocked the event loop for the whole sweep at boot — exactly the window
		// in which the HTTP listener is binding and clients send `initialize`.
		// Deferring to `setImmediate` lets the listener become ready (and answer
		// its first requests) BEFORE the heavy sweep, so `initialize` is no
		// longer starved into a client-side timeout/disconnect.
		this.startupMaintenancePromise = new Promise<void>((resolve) => {
			setImmediate(() => {
				if (this.stopped) {
					resolve();
					return;
				}
				void runStartupMaintenance(this.outbox, this.opts).finally(resolve);
			});
		});

		// Warm the ONNX model in the background (shares the RealVectorStore
		// extractor, so it is loaded once per process). PERF-005: when
		// lazyWarmup is enabled the model is NOT loaded here — the first
		// claimed batch (vectors.embed → getExtractor) or the first semantic
		// tool call loads it on demand, keeping an idle daemon lean. The
		// maintenance/poll/purge loops below always run either way.
		if (!this.opts.lazyWarmup) {
			void this.vectors
				.initialize()
				.then(() => {
					this.modelReady = true;
				})
				.catch((err) => {
					logger.warn("[EmbeddingWorker] model warm-up failed — will retry on first batch", {
						error: String(err)
					});
				});
		}

		this.schedule(this.opts.pollIntervalMs);
		this.purgeTimer = setInterval(() => void runPurgeSweep(this.outbox, this.opts), this.opts.purgeIntervalMs);
		this.purgeTimer.unref?.();

		logger.info("[EmbeddingWorker] started", {
			batchSize: this.opts.batchSize,
			leaseMs: this.opts.leaseMs,
			pollIntervalMs: this.opts.pollIntervalMs,
			backfillCap: this.opts.backfillCap,
			lazyWarmup: this.opts.lazyWarmup
		});
	}

	/**
	 * Resolve when the deferred startup maintenance sweep (reconcile + backfill
	 * + purge) has settled. `start()` defers it to a later tick (FIX-025), so
	 * callers/tests that must observe the sweep await this instead of polling.
	 */
	whenStartupMaintenanceSettled(): Promise<void> {
		return this.startupMaintenancePromise;
	}

	stop(): void {
		this.stopped = true;
		this.started = false;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.purgeTimer) {
			clearInterval(this.purgeTimer);
			this.purgeTimer = null;
		}
		logger.info("[EmbeddingWorker] stopped");
	}

	// -----------------------------------------------------------------------
	// Main loop
	// -----------------------------------------------------------------------

	private schedule(delayMs: number): void {
		if (this.stopped) return;
		this.timer = setTimeout(() => void this.loop(), delayMs);
		this.timer.unref?.();
	}

	private async loop(): Promise<void> {
		if (this.stopped) {
			return;
		}
		if (this.running) {
			this.schedule(this.opts.pollIntervalMs);
			return;
		}
		this.running = true;
		try {
			const processed = await this.runOnce();
			// Drain while the queue is non-empty (bounded interval — never the
			// old 10ms spin), exponential backoff + jitter while idle so two
			// workers don't busy-poll or thundering-herd (TASK-064 / MEM-475).
			this.schedule(nextPollDelay(this.pollState, processed, this.opts));
		} catch (err) {
			if (isBusyError(err)) {
				// Transient SQLite lock contention (TASK-457): a sibling
				// process holds the write lock past busy_timeout. The queue is
				// untouched — a failed claim leaves jobs pending, and rows
				// interrupted mid-batch self-heal via lease expiry. This is NOT
				// a cycle failure: no attempt was consumed and nothing was
				// poisoned, so log a calm retry and back off with jitter
				// instead of the old fatal "cycle failed" every 5.5s.
				const delayMs = nextPollDelay(this.pollState, 0, this.opts);
				logger.warn("[EmbeddingWorker] cycle deferred (database busy) — retrying with backoff", {
					error: String(err),
					nextDelayMs: delayMs
				});
				this.schedule(delayMs);
			} else {
				logger.warn("[EmbeddingWorker] cycle failed", { error: String(err) });
				this.schedule(this.opts.pollIntervalMs);
			}
		} finally {
			this.running = false;
		}
	}

	/**
	 * Compute the next poll delay — delegating to the pure poll-delay state
	 * machine (worker/poll-delay.ts) which documents the full cadence
	 * contract. Public for tests/observability.
	 */
	nextDelay(processed: number): number {
		return nextPollDelay(this.pollState, processed, this.opts);
	}

	/**
	 * One claim→embed→extract→complete cycle. Returns the number of jobs
	 * claimed (0 when the queue is empty). Public for tests/observability.
	 */
	async runOnce(): Promise<number> {
		const jobs = this.outbox.claim(this.opts.batchSize, this.opts.leaseMs);
		this.counters.lastRunAt = new Date().toISOString();
		this.counters.lastBatchSize = jobs.length;
		if (jobs.length === 0) return 0;

		return drainClaimedBatch({
			store: this.store,
			vectors: this.vectors,
			outbox: this.outbox,
			jobs,
			poisonThreshold: this.opts.poisonThreshold,
			backoffBaseMs: this.opts.backoffBaseMs,
			backoffMaxMs: this.opts.backoffMaxMs,
			counters: this.counters,
			embedLatency: this.embedLatency
		});
	}

	// -----------------------------------------------------------------------
	// Observability
	// -----------------------------------------------------------------------

	getStats(): EmbeddingWorkerStats {
		const counts = this.outbox.countByStatus();
		const latency = this.embedLatency.snapshot();
		return {
			...counts,
			...this.counters,
			embedLatency: {
				count: latency.count,
				avgMs: latency.avgMs,
				p50Ms: latency.p50Ms,
				p95Ms: latency.p95Ms,
				maxMs: latency.maxMs
			},
			running: this.running,
			started: this.started,
			modelReady: this.modelReady,
			pollIntervalMs: this.opts.pollIntervalMs,
			batchSize: this.opts.batchSize,
			leaseMs: this.opts.leaseMs
		};
	}
}
