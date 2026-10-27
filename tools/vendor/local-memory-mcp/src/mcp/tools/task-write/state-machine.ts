import { TaskStatus, TASK_STATUSES } from "../../types";

// ---------------------------------------------------------------------------
// Status state machine validation
// ---------------------------------------------------------------------------
//
// POLICY (FIX-033 — decided after 89 live rejections of direct-to-completed):
//
//   * `backlog|pending|blocked -> completed` stays REJECTED on purpose.
//     `claim-manage` (backlog|pending -> in_progress) is the coordination gate
//     that establishes the task claim; skipping it would bypass that primitive
//     and contradict the canonical contract
//     (`src/mcp/prompts/server/instructions.md` — "NEVER skip in_progress").
//     FIX-022 reached the same conclusion: explicit guidance over silent state
//     manipulation. Reversing that would require changing the canonical
//     contract + its 4 companion policy docs, which is out of this task's scope.
//
//   * The rejection is a CALLER-ACTIONABLE VALIDATION_ERROR: it enumerates the
//     allowed next states, names the required `in_progress` hop, and gives the
//     exact retry call. A bare "Cannot transition" is never returned.
//
//   * Every OTHER transition is allowed — the guard is deliberately narrow so
//     it never adds friction beyond the documented claim gate.
//
//   * `force` stays INERT (TASK-061 / FIX-022): it does NOT bypass this guard.
// ---------------------------------------------------------------------------

/**
 * Validates that a status transition is allowed.
 * Returns a directive error message or null if valid.
 *
 * FIX-022: a comment is NO LONGER required on a status change. Callers that
 * omit one get a deterministic auto-comment (see
 * {@link resolveTransitionComment}) that is persisted to the task comment
 * trail, so transition history stays inspectable. This removed the single
 * highest live task-write failure ("comment is required when changing task
 * status", 90 hits) without losing the audit trail.
 *
 * The `_comment`/`_force`/`_estTokens` parameters are retained for API
 * back-compat with existing callers (the signature is re-exported from
 * `task-write/index.ts`) but are intentionally inert — comment derivation is
 * a separate concern handled at the write sites.
 */
export function validateStatusTransition(
	existingStatus: TaskStatus,
	newStatus: TaskStatus,
	_comment: string | undefined,
	_force: boolean | undefined,
	_estTokens: number | undefined,
	taskCode?: string
): string | null {
	if (existingStatus === newStatus) return null; // no-op

	// Directive retry shape — keep the leading substring stable for existing
	// tests/consumers, append the exact task-write call to unblock the caller.
	const codeArg = taskCode ? `code: "${taskCode}"` : 'code: "<CODE>"';

	// Validate transition paths.
	const isStartable = existingStatus === "backlog" || existingStatus === "pending" || existingStatus === "blocked";

	if (isStartable && newStatus === "completed") {
		// FIX-022 decision (reaffirmed by FIX-033): explicit guidance over silent
		// state manipulation. We do NOT auto-insert the `in_progress` hop behind
		// the caller's back (that would fabricate a transition the caller never
		// requested and could mask a real workflow mistake). Instead we return a
		// VALIDATION_ERROR that:
		//   1. names the exact required sequence (`<from> -> in_progress -> completed`),
		//   2. ENUMERATES the states actually reachable from `<from>` so the caller
		//      is never left with a bare "Cannot transition" (FIX-033), and
		//   3. gives the exact retry calls to complete the hop.
		// The `Must go through 'in_progress' first` + `Required sequence` substrings
		// are retained for existing consumers/tests.
		const allowedNext = TASK_STATUSES.filter((s) => s !== existingStatus && s !== "completed");
		return `Cannot transition from '${existingStatus}' directly to 'completed'. Required sequence: ${existingStatus} -> in_progress -> completed. Must go through 'in_progress' first. Allowed next states from '${existingStatus}': ${allowedNext.join(", ")}. — call task-write(${codeArg}, status: "in_progress", comment: "...") first, then status: "completed"`;
	}

	return null;
}

/**
 * Derives a deterministic default transition comment for a status change when
 * the caller supplied none (FIX-022).
 *
 * Format: `Status: <from> -> <to> (<agent>, <timestamp>)`
 * e.g.    `Status: pending -> in_progress (Agent-1, 2026-08-11T09:30:00.000Z)`
 */
export function deriveDefaultTransitionComment(
	existingStatus: TaskStatus,
	newStatus: TaskStatus,
	agent: string | undefined,
	timestamp: string
): string {
	return `Status: ${existingStatus} -> ${newStatus} (${agent || "unknown"}, ${timestamp})`;
}

/**
 * Resolves the comment to persist for a status change: an explicit, non-empty
 * caller comment is honored verbatim; otherwise the deterministic default from
 * {@link deriveDefaultTransitionComment} is used. Never returns an empty
 * string for a real transition, so the audit trail never gets a blank row.
 */
export function resolveTransitionComment(
	comment: string | undefined,
	existingStatus: TaskStatus,
	newStatus: TaskStatus,
	agent: string | undefined,
	timestamp: string
): string {
	if (comment !== undefined && comment.trim() !== "") return comment;
	return deriveDefaultTransitionComment(existingStatus, newStatus, agent, timestamp);
}

/**
 * Validates that a bulk task status is one of the allowed initial values.
 */
export function validateBulkStatus(status: string | undefined): string | null {
	if (!status) return null;
	if (status !== "backlog" && status !== "pending") {
		return `New tasks must be 'backlog' or 'pending'. Got '${status}'.`;
	}
	return null;
}
