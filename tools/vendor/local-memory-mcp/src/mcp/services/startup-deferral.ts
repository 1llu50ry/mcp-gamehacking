/**
 * Deferred, failure-isolated startup passes (FEAT-DAEMON-002E).
 *
 * PROBLEM this module fixes: the listener must bind and answer the MCP
 * `initialize` handshake BEFORE the optional heavy startup passes run. On a
 * cold start against a large DB the biggest offender was an INLINE, synchronous
 * `runStartupVacuum` (a full-DB rewrite: full write lock + ~2x free disk) that
 * ran BEFORE `server.listen(...)`, so the bind — and therefore the handshake —
 * was blocked until it finished. Maintenance, the semantic (ONNX) warm-up and
 * the codebase auto-index are already deferred (FIX-025 / FIX-034), but the
 * vacuum was not.
 *
 * This module centralizes the "run these AFTER the listener is up, on a later
 * event-loop turn, and never let a failure abort readiness" contract:
 *
 *   1. DEFERRED — every pass is scheduled with `setImmediate` (or an injected
 *      scheduler), so the turn that returns from `listen` (and lets the first
 *      client connect) completes first. The listener is ALREADY bound when a
 *      caller schedules passes, so "next tick" is strictly after the bind.
 *   2. ISOLATED — a pass that throws (synchronously or asynchronously) is
 *      logged at WARN and the remaining passes still run; the returned
 *      `settled` promise NEVER rejects, so a failed optional pass can never
 *      abort an already-ready server.
 *
 * Honesty about truly-blocking passes: a pass that performs a SYNCHRONOUS,
 * unbounded SQLite operation (a full `VACUUM`) still blocks the event loop for
 * its duration once it starts. Deferring it guarantees it never blocks the BIND
 * or the startup handshake — the listener is accepting connections and the
 * first request is served before the pass is scheduled. That pass is also
 * operator-opt-in (`VACUUM_ON_STARTUP`, default off), so a default deployment
 * never pays it at all.
 *
 * DB migrations + derived-schema setup are deliberately NOT routed through this
 * module: a usable schema is required to serve ANY request, so those stay
 * INLINE (see `SQLiteStore.create`). They are cheap when the DB is already
 * migrated — the migration runner reads `_schema_version` and skips applied
 * versions, and the derived attach/schema step is idempotent.
 */
import { logger } from "../utils/logger";

/** One unit of deferred startup work. */
export interface DeferredStartupPass {
	/** Short label used in the WARN when the pass fails. */
	name: string;
	/** The work to run. May be synchronous or asynchronous; the return value is ignored. */
	run: () => unknown;
}

/** Options for {@link scheduleDeferredStartupPasses}. */
export interface DeferredStartupOptions {
	/**
	 * Scheduler for the deferred run. Defaults to `setImmediate`, which fires on
	 * the next event-loop turn AFTER the listener is already bound. Tests inject
	 * a capturing scheduler to prove the ordering deterministically.
	 */
	schedule?: (run: () => void) => void;
}

/** Handle returned by {@link scheduleDeferredStartupPasses}. */
export interface DeferredStartupHandle {
	/**
	 * Resolves once every pass has settled. NEVER rejects — a pass failure is
	 * logged + swallowed. Exposed for tests and observability.
	 */
	settled: Promise<void>;
}

/**
 * Schedule `passes` to run on a later event-loop turn, isolating failures.
 *
 * The listener MUST already be bound when this is called (both callers invoke
 * it after `listen`). Passes run SEQUENTIALLY in the given order; a failure in
 * one does not stop the others and never rejects `settled`.
 */
export function scheduleDeferredStartupPasses(
	passes: readonly DeferredStartupPass[],
	options: DeferredStartupOptions = {}
): DeferredStartupHandle {
	const schedule = options.schedule ?? ((run: () => void) => setImmediate(run));
	const settled = new Promise<void>((resolve) => {
		schedule(() => {
			void runPasses(passes).then(resolve, resolve);
		});
	});
	return { settled };
}

/** Run every pass in order, logging + swallowing each failure. Never rejects. */
async function runPasses(passes: readonly DeferredStartupPass[]): Promise<void> {
	for (const pass of passes) {
		try {
			await pass.run();
		} catch (error) {
			logger.warn("[Startup] Deferred startup pass failed — continuing", {
				pass: pass.name,
				error: String(error)
			});
		}
	}
}
