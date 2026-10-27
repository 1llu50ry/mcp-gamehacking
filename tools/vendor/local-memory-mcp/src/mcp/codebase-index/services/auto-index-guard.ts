/**
 * AutoIndex failure containment (FIX-034).
 *
 * `autoIndexIfStale` fires `indexRepository` in the background (it can run for
 * minutes and may throw — e.g. a transient DB error, a permission-denied walk,
 * or an unexpected parser failure). Before this module the rejection was logged
 * with a bare `[AutoIndex] indexRepository threw` and nothing counted it, and a
 * SYNCHRONOUS throw from the freshness check could escape into the awaited
 * startup path (the reported `[AutoIndex] indexRepository threw` /
 * `[AutoIndex] check failed` log burst on large DBs).
 *
 * This module centralises the isolation so that:
 *   - an AutoIndex failure is logged at WARN exactly ONCE per repo (repeat
 *     failures for the same repo drop to DEBUG — no log flood), and
 *   - every failure increments {@link METRIC_AUTOINDEX_FAILURES} so a degraded
 *     index is observable via `/api/metrics`, and
 *   - the failure NEVER propagates into the caller (startup keeps serving).
 *
 * Kept free of imports from `indexing-service` to avoid a circular dependency
 * (indexing-service imports THIS module for its fire-and-forget containment).
 */
import { logger } from "../../utils/logger";
import { metrics, METRIC_AUTOINDEX_FAILURES } from "../../utils/metrics";

/** Repos already reported at WARN — repeat failures for them drop to DEBUG. */
const reportedRepos = new Set<string>();

/** Test/reset seam: forget which repos have been reported. */
export function resetAutoIndexFailureDedup(): void {
	reportedRepos.clear();
}

/**
 * Record one AutoIndex failure: increment the counter and log it once per repo.
 * Never throws (logging must never be the thing that breaks startup).
 */
export function logAutoIndexFailure(repo: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	metrics.incrementCounter(METRIC_AUTOINDEX_FAILURES);
	if (reportedRepos.has(repo)) {
		logger.debug("[AutoIndex] indexRepository threw (repeat suppressed)", { repo, error: message });
		return;
	}
	reportedRepos.add(repo);
	logger.warn("[AutoIndex] indexRepository threw", { repo, error: message });
}

/**
 * Attach non-fatal containment to a background `indexRepository` promise.
 *
 * Resolves (never rejects) once the run settles: success is a no-op, failure is
 * counted + logged via {@link logAutoIndexFailure}. This is the fire-and-forget
 * seam `autoIndexIfStale` uses, and it is the unit under test for the
 * "AutoIndex throw is caught" contract.
 */
export function containIndexRepositoryFailure(repo: string, run: Promise<unknown>): Promise<void> {
	return run.then(
		() => undefined,
		(error: unknown) => {
			logAutoIndexFailure(repo, error);
		}
	);
}
