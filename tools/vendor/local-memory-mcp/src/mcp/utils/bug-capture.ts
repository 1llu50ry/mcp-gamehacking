import crypto from "crypto";
import os from "os";
import type { SQLiteStore } from "../storage/sqlite";
import type { LogSink, LogSinkPayload } from "./logger";
import { logger } from "./logger";
import { BUG_TELEMETRY_ENABLED, BUG_TELEMETRY_MAX_ROWS, BUG_TELEMETRY_RETENTION_DAYS } from "./constants";

/** Where a captured bug originated. Explicit sources win over the derived logger name. */
export type BugSource = "uncaught" | "unhandled_rejection" | "tool" | "dashboard" | "server" | "logger";

export interface BugCaptureInput {
	source: string;
	severity?: string;
	message: string;
	stack?: string | null;
	context?: Record<string, unknown>;
}

/**
 * Attribution scope for a captured bug. Threaded into the event `context` so a
 * bug_reports row can be tied back to the client/project/session that hit it.
 */
export interface BugScope {
	owner?: string;
	repo?: string;
	sessionId?: string;
}

/**
 * Supplies the "current" attribution scope for captures that did not carry
 * their own. Used as a FALLBACK only — an explicit `context.owner` /
 * `context.repo` / `context.sessionId` always wins.
 *
 * LIMITATION: a single process serves MANY sessions (HTTP transport), so a
 * process-global provider is inherently ambiguous — it can only ever reflect
 * the most-recently-initialized session. Call sites that know their scope
 * (e.g. the tool/logger wrappers) MUST pass owner/repo/sessionId explicitly;
 * this provider exists so process-level captures (uncaught errors, unhandled
 * rejections) at least attribute to *a* session rather than none.
 */
export type ScopeProvider = () => BugScope | undefined;

/** True only for a non-empty (post-trim) string. */
function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/** Fully-resolved, redacted event handed to every sink. */
export interface BugEvent {
	fingerprint: string;
	source: string;
	severity: string;
	message: string;
	stack: string | null;
	context: Record<string, unknown>;
	runtime: Record<string, unknown>;
	occurredAt: string;
}

/**
 * Pluggable bug-telemetry sink. The core ships exactly one sink — the local
 * SQLite writer — so the default is local-first with no network dependency.
 * A remote sink (e.g. a Sentry forwarder) can be attached at runtime via
 * {@link BugCapture.addSink} without touching the capture pipeline.
 */
export interface BugSink {
	name: string;
	capture(event: BugEvent): void;
}

const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|dsn)/i;

function redactString(input: string): string {
	let out = input;
	const home = os.homedir();
	if (home) out = out.split(home).join("~");
	out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]+/gi, "$1 ***");
	out = out.replace(/\b(sk|ghp|gho|ghs|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{6,}/gi, "***");
	return out;
}

/** Recursively redact a value: home-dir paths, bearer tokens, and secret-named keys. */
export function redact(value: unknown): unknown {
	if (typeof value === "string") return redactString(value);
	if (Array.isArray(value)) return value.map(redact);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
			out[key] = SECRET_KEY.test(key) ? "***" : redact(val);
		}
		return out;
	}
	return value;
}

/**
 * Strip volatile bits (line/column numbers, hex addresses) from a stack frame
 * so a fingerprint survives code edits that shift line numbers.
 */
function normalizeFrame(frame: string): string {
	return frame
		.trim()
		.replace(/:\d+:\d+/g, "")
		.replace(/:\d+/g, "")
		.replace(/0x[0-9a-f]+/gi, "");
}

/**
 * Stable dedup key: source + message + the first two normalized stack frames.
 * Two failures with the same shape (even at different line numbers) collapse
 * into one report with an incrementing count.
 */
export function computeFingerprint(source: string, message: string, stack?: string | null): string {
	const frames = (stack ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("at "))
		.slice(0, 2)
		.map(normalizeFrame)
		.join("|");
	return crypto.createHash("sha1").update(`${source}\n${message}\n${frames}`).digest("hex");
}

function resolveSource(payload: LogSinkPayload): string {
	const explicit = payload.data?.source;
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	switch (payload.logger) {
		case "tool":
			return "tool";
		case "dashboard":
			return "dashboard";
		case "server":
			return "server";
		default:
			return "logger";
	}
}

function isCapturableLevel(level: string): boolean {
	return level === "error" || level === "critical" || level === "alert" || level === "emergency";
}

class BugCapture {
	private store: SQLiteStore | null = null;
	private readonly sinks = new Map<string, BugSink>();
	private lastPruneAt = 0;
	private readonly enabled = BUG_TELEMETRY_ENABLED;
	private scopeProvider: ScopeProvider | null = null;

	/**
	 * Register (or clear, with `null`) the process-level fallback scope provider.
	 * See {@link ScopeProvider} for the multi-session limitation: this is a
	 * best-effort fallback, not a substitute for passing explicit scope.
	 */
	setScopeProvider(fn: ScopeProvider | null): void {
		this.scopeProvider = fn;
	}

	/**
	 * Merge the provider scope into an explicit context WITHOUT overwriting any
	 * non-empty value the caller already supplied. Only non-empty values are
	 * merged, so a partially-known provider never blanks a known key.
	 */
	private mergeScope(context: Record<string, unknown>): Record<string, unknown> {
		if (!this.scopeProvider) return context;
		let scope: BugScope | undefined;
		try {
			scope = this.scopeProvider();
		} catch {
			return context;
		}
		if (!scope) return context;
		const merged = { ...context };
		for (const key of ["owner", "repo", "sessionId"] as const) {
			if (isNonEmptyString(merged[key])) continue;
			if (isNonEmptyString(scope[key])) merged[key] = scope[key];
		}
		return merged;
	}

	/**
	 * Attach the local SQLite sink. Called once per process (MCP server and
	 * dashboard) after the store is created. No-op when telemetry is disabled.
	 */
	bind(store: SQLiteStore): void {
		if (!this.enabled) return;
		this.store = store;
		this.sinks.set("local", {
			name: "local",
			capture: (event) => this.persist(event)
		});
	}

	/** Register an additional sink (e.g. a Sentry forwarder). Returns an unsubscribe fn. */
	addSink(sink: BugSink): () => void {
		this.sinks.set(sink.name, sink);
		return () => this.sinks.delete(sink.name);
	}

	/** Capture a bug. Never throws — bug telemetry must not break the caller. */
	capture(input: BugCaptureInput): void {
		if (!this.enabled || !this.store) return;
		try {
			const message = String(redact(input.message));
			const stack = input.stack ? String(redact(input.stack)) : null;
			const scopedContext = this.mergeScope(input.context ?? {});
			const event: BugEvent = {
				fingerprint: computeFingerprint(input.source, message, stack),
				source: input.source,
				severity: input.severity ?? "error",
				message,
				stack,
				context: (redact(scopedContext) as Record<string, unknown>) ?? {},
				runtime: {
					node: process.version,
					platform: process.platform,
					arch: process.arch,
					pid: process.pid
				},
				occurredAt: new Date().toISOString()
			};
			for (const sink of this.sinks.values()) {
				try {
					sink.capture(event);
				} catch (error) {
					logger.warn("[BugCapture] sink failed", { sink: sink.name, error: String(error) });
				}
			}
		} catch {
			/* never throw from telemetry */
		}
	}

	/**
	 * Logger sink adapter: captures error-and-above log entries. Registered as
	 * a log sink so tool failures, dashboard 5xx errors, and the process-level
	 * uncaught/unhandled handlers (all of which log via `logger.error`) flow
	 * into the bug store automatically.
	 */
	readonly logSink: LogSink = (payload) => {
		if (!isCapturableLevel(payload.level)) return;
		const data = payload.data ?? {};
		const message = typeof data.message === "string" ? data.message : "unknown error";
		const stack =
			typeof data.stack === "string"
				? data.stack
				: typeof data.error === "string" && data.error.includes("\n")
					? data.error
					: null;
		this.capture({ source: resolveSource(payload), severity: payload.level, message, stack, context: data });
	};

	/** Test/maintenance hook: drop the store binding, sinks, and scope provider. */
	reset(): void {
		this.store = null;
		this.sinks.clear();
		this.lastPruneAt = 0;
		this.scopeProvider = null;
	}

	private persist(event: BugEvent): void {
		if (!this.store) return;
		try {
			this.store.bugReports.upsert({
				fingerprint: event.fingerprint,
				source: event.source,
				severity: event.severity,
				message: event.message,
				stack: event.stack,
				context: event.context,
				runtime: event.runtime
			});
			this.pruneIfNeeded();
		} catch (error) {
			logger.warn("[BugCapture] persist failed", { error: String(error) });
		}
	}

	private pruneIfNeeded(): void {
		if (!this.store) return;
		const now = Date.now();
		if (now - this.lastPruneAt < 3_600_000) return;
		this.lastPruneAt = now;
		try {
			this.store.bugReports.prune(BUG_TELEMETRY_RETENTION_DAYS, BUG_TELEMETRY_MAX_ROWS);
		} catch {
			/* best effort */
		}
	}
}

export const bugCapture = new BugCapture();
