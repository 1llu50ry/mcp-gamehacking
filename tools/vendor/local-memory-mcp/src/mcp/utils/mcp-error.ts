import { ZodError, z } from "zod";
import type { McpResponse } from "./mcp-response";

export type ToolErrorCode =
	| "VALIDATION_ERROR"
	| "NOT_FOUND"
	| "CONFLICT"
	| "UNSUPPORTED_OPERATION"
	| "CAPABILITY_UNAVAILABLE"
	| "INTERNAL_ERROR"
	| (string & {});

export interface ToolErrorEnvelope {
	schema: "tool-error";
	code: ToolErrorCode;
	message: string;
	retryable: boolean;
	details?: Record<string, unknown>;
}

export interface ToolErrorOptions {
	retryable?: boolean;
	details?: Record<string, unknown>;
}

export interface McpErrorResponseOptions extends ToolErrorOptions {
	/** Additional top-level fields retained for backward-compatible partial-result envelopes. */
	data?: Record<string, unknown>;
}

/** Expected, caller-actionable tool failure with a stable machine code. */
export class ToolError extends Error {
	readonly code: ToolErrorCode;
	readonly retryable: boolean;
	readonly details?: Record<string, unknown>;

	constructor(code: ToolErrorCode, message: string, options: ToolErrorOptions = {}) {
		super(message);
		this.name = "ToolError";
		this.code = code;
		this.retryable = options.retryable ?? false;
		this.details = options.details;
	}
}

export function createMcpErrorResponse(error: {
	code: ToolErrorCode;
	message: string;
	retryable?: boolean;
	details?: Record<string, unknown>;
	data?: Record<string, unknown>;
}): McpResponse {
	const envelope: ToolErrorEnvelope & Record<string, unknown> = {
		...error.data,
		...error.details,
		schema: "tool-error",
		code: error.code,
		message: error.message,
		retryable: error.retryable ?? false,
		// Backward-compatible alias used by existing dashboard and clients.
		error: error.message,
		...(error.details ? { details: error.details } : {})
	};
	return {
		content: [{ type: "text", text: error.message }],
		structuredContent: envelope,
		isError: true
	};
}

/**
 * ── Canonical error envelope (OPT-CODE-01) ────────────────────────────────
 *
 * Single source of truth for turning a thrown failure into an MCP tool error
 * result. BOTH dispatch transports call this:
 *
 *   - the native SDK path (tools/index.ts registerTool catch block), and
 *   - the upstream router (router.ts handleToolCall catch block),
 *
 * so the same failure class surfaces an identical
 * `{ content: [{ type: "text", text }], isError: true }` envelope regardless
 * of transport. Previously the SDK returned an envelope while the router
 * logged-and-rethrew a raw exception, and per-tool code hand-built `isError`
 * results with different text — all three shapes are now collapsed here.
 *
 * The message keeps the legacy `Error: ` prefix (SDK behavior) and, for Zod
 * failures, the friendly owner/repo-aware text (task-read/handoff-list
 * behavior), so existing consumers that match on message substrings keep
 * working.
 */
export function toErrorResponse(err: unknown): McpResponse {
	if (err instanceof ToolError) {
		return createMcpErrorResponse({
			code: err.code,
			message: err.message,
			retryable: err.retryable,
			details: err.details
		});
	}
	if (err instanceof ZodError) {
		return createMcpErrorResponse({
			code: "VALIDATION_ERROR",
			message: `Error: ${formatZodError(err)}`,
			retryable: false
		});
	}
	if (err instanceof Error) {
		const classified = classifyExpectedError(err);
		if (classified) return createMcpErrorResponse(classified);
	}
	return createMcpErrorResponse({
		code: "INTERNAL_ERROR",
		message: "Internal tool error",
		retryable: false
	});
}

/**
 * Maps a thrown Error to a stable machine code when it is a known,
 * caller-actionable failure; returns null for unexpected failures (the
 * transport then emits the sanitized generic INTERNAL_ERROR).
 *
 * Transient SQLite lock contention is surfaced with the real message and
 * `retryable: true`; task state-machine/children-gate violations are surfaced
 * as VALIDATION_ERROR so callers can correct the payload instead of retrying
 * the same invalid request against the generic "Internal tool error".
 */
function classifyExpectedError(error: Error): {
	code: ToolErrorCode;
	message: string;
	retryable: boolean;
	details?: Record<string, unknown>;
} | null {
	const structured = (error as Error & { structured?: Record<string, unknown> }).structured;
	if (structured && typeof structured.error === "string" && typeof structured.message === "string") {
		const { error: code, message, success: _success, ...details } = structured;
		return { code, message, retryable: false, ...(Object.keys(details).length > 0 ? { details } : {}) };
	}
	if (/\bnot found\b/i.test(error.message)) {
		return { code: "NOT_FOUND", message: error.message, retryable: false };
	}
	// FIX-CLAIM-AGENT-INJECT: a "No <entity> found" failure ("No active claim
	// found for task X" from claim-manage RELEASE) is the same caller-actionable
	// not-found class as "… not found", but the reversed word order missed the
	// `\bnot found\b` test above and fell through to the opaque
	// "Internal tool error". Surface the real message under NOT_FOUND so the
	// caller can tell "no such row" from a genuine server fault.
	if (/^no .* found\b/i.test(error.message)) {
		return { code: "NOT_FOUND", message: error.message, retryable: false };
	}
	// Client-capability gaps (issue #108): the caller asked for a feature the
	// connected client does not advertise (MCP sampling / elicitation). The
	// request cannot succeed on this transport, but it is not a server crash —
	// surface the real message under a dedicated code.
	if (/\bdoes not advertise\b/i.test(error.message)) {
		return { code: "CAPABILITY_UNAVAILABLE", message: error.message, retryable: false };
	}
	if (
		/^(?:Missing|required|Either|At least|Provide|Invalid|No .* provided|New .* must|CREATE requires|UPDATE requires|Could not infer operation|Detected)/i.test(
			error.message
		) ||
		/\bmust be\b|\bmust identify\b|\bis required\b|\brequire(?:s)? type=|\bvalidation\b|\bappears to contain metadata\b|\bcompleted-work summaries\b/i.test(
			error.message
		) ||
		// Task state-machine + children-gate violations (FIX-ERRCLASS) are
		// caller-actionable: surface the real message instead of masking it.
		/\bcannot transition\b|\bmust go through\b|\bincomplete child task/i.test(error.message) ||
		// Additional caller-actionable request-shape failures that previously
		// fell through to the generic INTERNAL_ERROR (issue #108): a missing
		// discriminator ("CLAIM requires agent", "neither 'id' nor 'code'"),
		// an out-of-place field ("status is not valid for CREATE"), a plural
		// "are required", or a scope mismatch ("Repository mismatch").
		/\brequires agent\b|\bneither 'id' nor 'code'|\brepository mismatch\b|\bare required\b|\bnot valid for\b/i.test(
			error.message
		) ||
		// FIX-021: an unsubstituted orchestrator template placeholder
		// ("'T01' looks like an unsubstituted orchestrator template
		// placeholder…") is a caller-actionable request-shape error — surface
		// the real message under VALIDATION_ERROR instead of masking it.
		/\bunsubstituted orchestrator template placeholder\b/i.test(error.message) ||
		// FIX-024: a task-write parent_id/depends_on reference to a task that
		// does not exist ("parent_id references 'FIX-559-2' which does not
		// exist in owner/repo") is a caller-actionable request-shape error —
		// surface the real message under VALIDATION_ERROR. The bulk path
		// re-wraps the item error into a plain Error with the same message, so
		// classifying by message keeps both transports consistent.
		/\breferences '[^']*' which does not exist\b/i.test(error.message)
	) {
		return { code: "VALIDATION_ERROR", message: error.message, retryable: false };
	}
	if (/\b(?:already exists|duplicate|conflict)\b/i.test(error.message)) {
		return { code: "CONFLICT", message: error.message, retryable: false };
	}
	// SQLite constraint violations (FIX-020): better-sqlite3 throws SqliteError
	// with a stable `code` (SQLITE_CONSTRAINT_NOTNULL / _CHECK / _UNIQUE /
	// _FOREIGNKEY) and a schema-level message ("NOT NULL constraint failed:
	// memories.importance"). These are caller-actionable request-shape failures
	// — surface the real message under VALIDATION_ERROR instead of masking it
	// behind the generic "Internal tool error". The message names only the
	// table/column (no stack trace, no secrets), so it is safe to return; the
	// raw SQLite code is carried in `details.constraint` for machine handling.
	const sqliteCode = (error as Error & { code?: unknown }).code;
	const constraintCode =
		typeof sqliteCode === "string" && /^SQLITE_CONSTRAINT/.test(sqliteCode) ? sqliteCode : undefined;
	if (constraintCode || /\bconstraint failed\b/i.test(error.message)) {
		return {
			code: "VALIDATION_ERROR",
			message: error.message,
			retryable: false,
			...(constraintCode ? { details: { constraint: constraintCode } } : {})
		};
	}
	if (/\bunsupported\b/i.test(error.message)) {
		return { code: "UNSUPPORTED_OPERATION", message: error.message, retryable: false };
	}
	// Transient SQLite write-lock contention (FIX-ERRCLASS): better-sqlite3
	// surfaces SQLITE_BUSY / SQLITE_BUSY_SNAPSHOT as "database is locked". The
	// operation may succeed on retry, so keep the real message and flag it.
	if (/database is locked|\bSQLITE_BUSY\b/i.test(error.message)) {
		return { code: "INTERNAL_ERROR", message: error.message, retryable: true };
	}
	// Sampling loop returned no usable text (issue #108): a transient
	// model-side failure that may succeed on retry — keep the real message
	// rather than masking it behind the generic "Internal tool error".
	if (/\bsampling did not return\b/i.test(error.message)) {
		return { code: "INTERNAL_ERROR", message: error.message, retryable: true };
	}
	return null;
}

/**
 * Centralized validation wrapper — replaces the per-tool
 * `schema.safeParse(args) -> custom message + manual isError` duplication
 * (task-read/index.ts) AND the raw `Schema.parse` throw
 * (memory.read.ts).
 *
 * On failure it throws an `Error` whose message is the SAME friendly text the
 * old per-tool code produced; the transport-level catch + {@link toErrorResponse}
 * then yields an identical envelope. Handlers keep the fail-loud throw
 * contract (OPT-CODE-04) — only the transport converts to an envelope.
 */
export function parseArgs<TSchema extends z.ZodTypeAny>(schema: TSchema, data: unknown): z.output<TSchema> {
	const parsed = schema.safeParse(data);
	if (!parsed.success) {
		throw new Error(formatZodError(parsed.error));
	}
	return parsed.data;
}

/**
 * Formats a Zod failure into the established friendly text. If any issue
 * touches the `owner`/`repo` path (auto-inference failure), the missing-fields
 * message — which was previously hand-built per tool — is produced, preserving
 * its exact wording for downstream consumers.
 */
export function formatZodError(error: ZodError): string {
	const missing = error.issues
		.filter((issue) => issue.path.some((p) => p === "owner" || p === "repo"))
		.map((issue) => issue.message)
		.filter((message): message is string => Boolean(message));
	if (missing.length > 0) {
		return (
			`Missing required fields: ${missing.join("; ")}. Owner/repo could not be auto-inferred ` +
			`(no explicit args, no MCP workspace roots, and no daemon working directory). Resolve it by any ONE of: ` +
			`(1) pass owner/repo explicitly in the tool call; ` +
			`(2) configure MCP workspace roots (a roots-capable client); ` +
			`(3) set LOCAL_MEMORY_DEFAULT_OWNER and LOCAL_MEMORY_DEFAULT_REPO in the daemon environment; ` +
			`(4) set GITHUB_REPOSITORY="owner/repo"; ` +
			`(5) start the daemon with a WorkingDirectory that points at the project.`
		);
	}
	return `Validation error: ${error.message}`;
}
