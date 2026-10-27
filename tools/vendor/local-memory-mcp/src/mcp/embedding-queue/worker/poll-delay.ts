/**
 * Exponential poll-delay computation for the embedding worker's idle loop
 * (TASK-064 / MEM-475 / TASK-069; TASK-554 split out of `worker.ts`).
 *
 * Pure function over the worker's streak state — no timer, no instance state —
 * so the cadence contract is unit-testable in isolation and identical in the
 * MCP-server and dashboard workers.
 *
 * Cadence:
 * - Non-empty batches: the first `nonEmptyBackoffStreak` (default 5) consecutive
 *   non-empty cycles poll at half the configured interval (floored at 50ms —
 *   fast drain). Once the streak passes the threshold the queue is provably
 *   deep, so the worker backs off to `pollIntervalMs` — it keeps draining at a
 *   bounded rate without polling between every batch (TASK-068 S1 / TASK-069).
 * - An empty batch resets the streak and grows the delay exponentially from
 *   `pollIntervalMs` up to `maxPollIntervalMs`, with 0.5–1.0× random jitter to
 *   decorrelate the MCP-server and dashboard workers in the same DB.
 *
 * `nextDelay` is public on the worker for tests/observability and delegates
 * here.
 */

export interface PollState {
	/** Consecutive empty claim cycles — drives the idle poll backoff. */
	idleStreak: number;
	/** Consecutive non-empty claim cycles — drives the deep-queue backoff. */
	nonEmptyStreak: number;
}

/** Bounds that keep the streak counters from growing unboundedly. */
export const IDLE_STREAK_CAP = 16;
export const NON_EMPTY_STREAK_CAP = 32;
/** Fast-drain floor: never poll faster than every 50ms (TASK-068 S1). */
export const FAST_DRAIN_FLOOR_MS = 50;

export function createPollState(): PollState {
	return { idleStreak: 0, nonEmptyStreak: 0 };
}

/**
 * Compute the next poll delay from the current streak state. MUTATES `state`
 * (the streak bookkeeping is a side effect of each poll decision) and returns
 * the delay in ms.
 */
export function nextPollDelay(
	state: PollState,
	processed: number,
	opts: {
		pollIntervalMs: number;
		maxPollIntervalMs: number;
		nonEmptyBackoffStreak: number;
	}
): number {
	if (processed > 0) {
		state.idleStreak = 0;
		state.nonEmptyStreak = Math.min(state.nonEmptyStreak + 1, NON_EMPTY_STREAK_CAP);
		if (state.nonEmptyStreak >= opts.nonEmptyBackoffStreak) {
			return opts.pollIntervalMs;
		}
		return Math.max(FAST_DRAIN_FLOOR_MS, opts.pollIntervalMs / 2);
	}
	state.nonEmptyStreak = 0;
	const base = Math.min(opts.pollIntervalMs * 2 ** state.idleStreak, opts.maxPollIntervalMs);
	state.idleStreak = Math.min(state.idleStreak + 1, IDLE_STREAK_CAP);
	return base * (0.5 + Math.random() * 0.5);
}
