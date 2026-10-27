/**
 * Embedding worker maintenance sweep (TASK-554 split out of `worker.ts`).
 *
 * Startup maintenance (reconcile + backfill + purge) and the periodic purge
 * sweep both delegate to the `Outbox`. The startup scope + queue-depth logging
 * contract (TASK-069 / TASK-412) is preserved verbatim: the backfill scope is
 * logged BEFORE it runs because `backfillMissingVectors` is intentionally
 * GLOBAL (no repo filter — enqueue.ts:393) — it scans memories, standards, and
 * tasks across every repo in the store, so the cross-repo nature must be
 * visible in logs. cap/gate are surfaced so the log is actionable.
 */
import type { Outbox } from "../outbox";
import type { ResolvedWorkerOptions } from "./options";
import { logger } from "../../utils/logger";

/** Startup maintenance: reconcile expired leases, backfill, purge finished rows. */
export async function runStartupMaintenance(outbox: Outbox, opts: ResolvedWorkerOptions): Promise<void> {
	try {
		const reconciled = outbox.reconcileExpiredLeases();
		const counts = outbox.countByStatus();
		logger.info("[EmbeddingWorker] startup backfill scope: GLOBAL across all repos", {
			scope: "global",
			cap: opts.backfillCap,
			minQueue: opts.backfillMinQueue
		});
		const backfilled = outbox.backfillMissingVectors(opts.backfillCap, opts.backfillMinQueue);
		const purged = outbox.purge(opts.doneTtlMs, opts.poisonTtlMs);
		logger.info("[EmbeddingWorker] startup maintenance complete", {
			reconciled,
			backfilled,
			queueDepth: {
				pending: counts.pending,
				claimed: counts.claimed,
				done: counts.done,
				poison: counts.poison,
				total: counts.total
			},
			purgedDone: purged.purgedDone,
			purgedPoison: purged.purgedPoison
		});
	} catch (err) {
		logger.warn("[EmbeddingWorker] startup maintenance failed", { error: String(err) });
	}
}

/** Periodic purge sweep — debug-logged only when rows were actually purged. */
export async function runPurgeSweep(outbox: Outbox, opts: ResolvedWorkerOptions): Promise<void> {
	try {
		const purged = outbox.purge(opts.doneTtlMs, opts.poisonTtlMs);
		if (purged.purgedDone > 0 || purged.purgedPoison > 0) {
			logger.debug("[EmbeddingWorker] purge sweep", purged);
		}
	} catch (err) {
		logger.warn("[EmbeddingWorker] purge sweep failed", { error: String(err) });
	}
}
