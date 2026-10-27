/**
 * Orchestrator template placeholder-code detection (FIX-021).
 *
 * The orchestrator prompt template (`~/.config/opencode/agents/orchestrator.md`,
 * Phase 2) uses literal placeholder codes — `T01` (lifecycle task), `R01`
 * (review), `Q01` (test), plus `FIX01`/`FEAT01`/`PERF01`/`DEBT01`/`P01`/`G01`
 * — that a caller is expected to substitute with the real task code. When the
 * template is executed verbatim, the MCP call reaches the server carrying the
 * literal placeholder and previously surfaced a bare, misleading
 * `Task not found: T01` (~8×/day in daemon.log) that looked like a genuine
 * missing task rather than an unsubstituted template.
 *
 * The reserved shape is deliberately narrow — `PREFIX` + EXACTLY two digits,
 * with NO separator — so it can NEVER collide with a real code in this repo,
 * which is either `PREFIX-NNN` (`TASK-426`, `FIX-021`) or an arbitrary user
 * code. A genuinely unknown real code therefore keeps the normal not-found.
 */

/** Reserved placeholder shapes: prefix immediately followed by exactly 2 digits. */
export const ORCHESTRATOR_PLACEHOLDER_CODE_PATTERN = /^(?:T|R|Q|FIX|FEAT|PERF|DEBT|P|G)[0-9]{2}$/;

/** True when `value` is a reserved orchestrator template placeholder code. */
export function isOrchestratorPlaceholderCode(value: unknown): value is string {
	return typeof value === "string" && ORCHESTRATOR_PLACEHOLDER_CODE_PATTERN.test(value.trim());
}

/** The actionable message surfaced for an unsubstituted placeholder code. */
export function orchestratorPlaceholderMessage(code: string): string {
	return `'${code.trim()}' looks like an unsubstituted orchestrator template placeholder. Replace it with the real task code from task-read (query: ...) or the orchestrator comment before calling this tool.`;
}

/**
 * Throws the actionable placeholder error when `code` matches a reserved
 * template shape; returns normally for every other value (including genuinely
 * unknown real codes, which keep their normal not-found handling).
 *
 * The thrown message is classified as VALIDATION_ERROR by
 * `classifyExpectedError` (mcp-error.ts) — a caller-actionable request-shape
 * error, never a generic INTERNAL_ERROR.
 */
export function assertNotOrchestratorPlaceholder(code: string | null | undefined): void {
	if (isOrchestratorPlaceholderCode(code)) {
		throw new Error(orchestratorPlaceholderMessage(code));
	}
}
