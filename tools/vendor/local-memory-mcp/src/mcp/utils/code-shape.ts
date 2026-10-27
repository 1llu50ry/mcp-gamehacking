import { UUID_REGEX } from "./uuid";

/**
 * Task-code shape detection (FIX-027).
 *
 * A live task-write failure was `Invalid id format: 'TASK-431'` — the caller
 * passed a real short code (`PREFIX-NNN`, e.g. `TASK-431`, `FIX-021`,
 * `BULK-001`) into the `id` slot, which only accepts a UUID. The error named
 * the value but never told the caller the fix: use `code` instead of `id`.
 *
 * This helper recognises the short-code shape so the update path can surface
 * that corrective hint. It is deliberately separate from the orchestrator
 * placeholder detector (`placeholder-code.ts`) — that one flags unsubstituted
 * template tokens (`T01`), this one flags a genuine code misrouted to `id`.
 *
 * Shape: a leading letter, then alphanumeric segments joined by `-`
 * (`TASK-431`, `FIX-559-2`, `T44-1`). A UUID is excluded explicitly (its hex
 * segments also satisfy the generic pattern).
 */
const SHORT_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+$/;

/** True when `value` looks like a short task code rather than a UUID. */
export function looksLikeTaskCode(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (UUID_REGEX.test(trimmed)) return false;
	return SHORT_CODE_PATTERN.test(trimmed);
}
