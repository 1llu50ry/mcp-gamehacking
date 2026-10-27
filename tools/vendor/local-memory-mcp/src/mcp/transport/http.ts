/**
 * Streamable HTTP transport for the MCP server (opt-in via `MCP_TRANSPORT=http`).
 *
 * A single long-lived daemon serves MANY MCP clients over Streamable HTTP
 * instead of each client spawning its own stdio server process. That removes
 * duplicated embedding/maintenance/indexing workers and the cross-process
 * SQLite write contention they caused. stdio remains the default transport.
 *
 * This module is a THIN adapter around the SDK's web-standard
 * {@link createMcpHandler}: it bridges Node's `node:http` request/response to
 * the Web `Request`/`Response` the handler expects, enforces bearer auth and
 * localhost Host/Origin validation, and reuses the ONE shared store/worker
 * startup from `server.ts` via a per-session {@link McpServerFactory}.
 *
 * DUAL-HANDLER ROUTING (DEBT-423): the SDK entry has no handler-valued
 * `legacy` option, so 2025-era (legacy) traffic — which is what OpenCode and
 * most current MCP clients speak — must be routed by hand with
 * {@link isLegacyRequest} in front of a strict `legacy: "reject"` modern
 * handler. The modern path stays per-request; the legacy path is served by a
 * STATEFUL {@link WebStandardStreamableHTTPServerTransport} PER SESSION,
 * keyed by the `Mcp-Session-Id` header. That per-session transport retains the
 * initialized `McpServer`, so `oninitialized` (which applies MCP roots via
 * `applySessionRoots`, TASK-418) fires once on the REAL session and its scope
 * reaches every later tool call. A single shared transport cannot do this:
 * the SDK transport holds one `sessionId`/`_initialized` pair, so a second
 * concurrent `initialize` is rejected with "Server already initialized".
 */
import http from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
	createMcpHandler,
	hostHeaderValidationResponse,
	isInitializeRequest,
	isLegacyRequest,
	originValidationResponse,
	localhostAllowedHostnames,
	parseJSONRPCMessage,
	WebStandardStreamableHTTPServerTransport
} from "@modelcontextprotocol/server";
import type {
	JSONRPCMessage,
	McpHandlerRequestOptions,
	McpServer,
	McpServerFactory,
	Server
} from "@modelcontextprotocol/server";
import {
	MCP_HTTP_ALLOW_INSECURE,
	MCP_HTTP_PORT,
	MCP_HTTP_SESSION_IDLE_TTL_MS,
	MCP_HTTP_SSE_IDLE_TIMEOUT_MS,
	MCP_HTTP_SSE_KEEPALIVE_INTERVAL_MS,
	MCP_HTTP_STATELESS_RECOVERY
} from "../utils/constants";
import { logger } from "../utils/logger";

/** The two supported MCP transports. */
export type TransportMode = "stdio" | "http";

/** Default MCP HTTP bind host — loopback only. */
export const MCP_HTTP_DEFAULT_HOST = "127.0.0.1";
/** Default MCP HTTP endpoint path. */
export const MCP_HTTP_DEFAULT_PATH = "/mcp";

/**
 * Resolve the transport selected by `MCP_TRANSPORT`.
 *
 * `stdio` (the default when unset) and `http` are the only valid values; any
 * other value fails fast with a clear error so a typo never silently falls
 * back to the wrong transport.
 */
export function resolveTransportMode(value: string | undefined = process.env.MCP_TRANSPORT): TransportMode {
	const normalized = (value ?? "stdio").trim().toLowerCase();
	if (normalized === "stdio" || normalized === "http") return normalized;
	throw new Error(`Invalid MCP_TRANSPORT value ${JSON.stringify(value)}: expected "stdio" (default) or "http".`);
}

/** Fully-resolved HTTP transport configuration. */
export interface HttpTransportConfig {
	/** Bind host (loopback by default). */
	host: string;
	/** Bind port (`0` requests an ephemeral port). */
	port: number;
	/** Endpoint path (e.g. `/mcp`). */
	path: string;
	/** Required bearer token, or `undefined` when insecure mode is allowed. */
	token: string | undefined;
	/** When true, an unauthenticated listener is permitted (local dev only). */
	allowInsecure: boolean;
}

/** Options accepted by {@link startHttpTransport}. */
export interface HttpTransportOptions extends HttpTransportConfig {
	/** Per-session server factory (see {@link createServerFactory}). */
	factory: McpServerFactory;
}

/** Handle returned by {@link startHttpTransport} for lifecycle control. */
export interface HttpTransportHandle {
	/** Actual bound port (resolved when `port: 0` was requested). */
	readonly port: number;
	/** Base URL clients connect to (no trailing path). */
	readonly url: string;
	/** Close the HTTP listener, all sessions, and the underlying handler. */
	close(): Promise<void>;
}

/**
 * Resolve HTTP transport configuration from the environment.
 *
 * String values (`MCP_HTTP_HOST`, `MCP_HTTP_PATH`, `MCP_HTTP_TOKEN`) are read
 * inline per the repo convention; the numeric port and boolean insecure flag
 * come from the shared env constants.
 */
export function resolveHttpTransportConfig(): HttpTransportConfig {
	return {
		host: process.env.MCP_HTTP_HOST?.trim() || MCP_HTTP_DEFAULT_HOST,
		port: MCP_HTTP_PORT,
		path: normalizePath(process.env.MCP_HTTP_PATH),
		token: process.env.MCP_HTTP_TOKEN?.trim() || undefined,
		allowInsecure: MCP_HTTP_ALLOW_INSECURE
	};
}

/**
 * Normalize an endpoint path: ensure a single leading slash and no trailing
 * slash (except the root), so `/mcp` and `mcp/` both match requests to `/mcp`.
 */
function normalizePath(raw: string | undefined): string {
	const value = (raw ?? MCP_HTTP_DEFAULT_PATH).trim();
	if (value === "" || value === "/") return "/";
	const withLeading = value.startsWith("/") ? value : `/${value}`;
	return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
}

/** A live legacy (2025-era) session: one stateful transport plus its server. */
interface LegacySession {
	transport: WebStandardStreamableHTTPServerTransport;
	product: McpServer | Server;
	/** Epoch ms of the last request served for this session (idle-sweep clock). */
	lastSeen: number;
	/**
	 * Count of OPEN standalone SSE (`GET`) streams for this session. While
	 * `> 0` the idle sweep MUST NOT evict the session (FIX-028): the stream is
	 * live even if no NEW request has arrived, and the pre-fix sweep closed
	 * still-open streams, producing the `Session not found` (404) storm. The
	 * SSE-lifetime wrapper decrements this on stream close, so the session
	 * becomes sweepable again once it is genuinely idle.
	 */
	openStreams: number;
}

/**
 * Track a legacy session's open SSE stream (FIX-028). For a `GET` that opened a
 * `200 text/event-stream` response, this bumps the session's `openStreams`
 * (exempting it from the idle sweep), refreshes `lastSeen` on every real
 * server→client chunk, and bounds the stream's lifetime with
 * {@link withSseIdleTimeout}. Non-stream responses pass through untouched.
 *
 * @returns The (possibly wrapped) response to hand back to the caller.
 */
function trackOpenSseStream(session: LegacySession, webRequest: Request, response: Response): Response {
	if (webRequest.method.toUpperCase() !== "GET" || response.status !== 200) return response;
	if (!isStreamingResponse(response)) return response;

	session.openStreams += 1;
	session.lastSeen = Date.now();
	return withSseIdleTimeout(response, {
		onActivity: () => {
			session.lastSeen = Date.now();
		},
		onIdle: () => {
			logger.info("[MCP HTTP] closed idle SSE stream", {
				sessionId: session.transport.sessionId,
				idleTimeoutMs: MCP_HTTP_SSE_IDLE_TIMEOUT_MS
			});
		},
		onClose: () => {
			session.openStreams = Math.max(0, session.openStreams - 1);
			session.lastSeen = Date.now();
		}
	});
}

/** Whether a response's `Content-Type` marks it as a streaming response. */
function isStreamingResponse(response: Response): boolean {
	const contentType = response.headers.get("content-type");
	return contentType !== null && contentType.toLowerCase().includes("text/event-stream");
}

/**
 * Upper bound on standalone messages buffered while a legacy session's SSE
 * (`GET`) stream is closed. A client that initializes but never opens the SSE
 * stream would otherwise let the buffer grow without limit; when the cap is
 * exceeded the OLDEST entries are dropped so the most recent (most relevant)
 * messages survive.
 *
 * Exported so the bound can be asserted directly in tests.
 */
export const MCP_HTTP_STANDALONE_BUFFER_MAX = 100;

/**
 * Wrap a GET SSE `Response` so `onClose` fires exactly once when the stream
 * ends OR the consumer cancels/aborts it. Used to reset the session's
 * `sseOpen` flag so a later `GET` can re-arm buffering (the SDK itself allows
 * only one live SSE stream per session, so a re-armed buffer is only drained by
 * a genuinely new stream).
 */
function onResponseStreamClose(response: Response, onClose: () => void): Response {
	const body = response.body;
	if (body === null) return response;
	const reader = body.getReader();
	let settled = false;
	const finish = () => {
		if (settled) return;
		settled = true;
		onClose();
	};
	const wrapped = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done, value } = await reader.read();
				if (done) {
					finish();
					controller.close();
					return;
				}
				controller.enqueue(value);
			} catch (error) {
				finish();
				controller.error(error);
			}
		},
		cancel(reason) {
			finish();
			return reader.cancel(reason);
		}
	});
	return new Response(wrapped, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}

/** Callbacks/limits for {@link withSseIdleTimeout}. */
export interface SseIdleTimeoutOptions {
	/** Idle window (ms) with no server→client data before the stream is closed. */
	idleTimeoutMs?: number;
	/** Interval (ms) between SSE keep-alive comment frames (`0` disables). */
	keepAliveIntervalMs?: number;
	/** Fired once when the stream is opened (constructed). */
	onOpen?: () => void;
	/** Fired once when the stream ends/cancels/idles out. */
	onClose?: () => void;
	/** Fired once specifically when the idle timeout closed the stream. */
	onIdle?: () => void;
	/** Fired whenever a real (non-ping) server→client chunk flows. */
	onActivity?: () => void;
}

/**
 * Bound a streaming (`text/event-stream`) `Response`'s lifetime (FIX-028).
 *
 * The SDK transport serves the legacy standalone SSE (`GET`) stream with NO
 * idle/keep-alive/timeout, so an open stream is held for the client's ENTIRE
 * session lifetime. On the long-lived daemon this pinned `pipeline(source, res)`
 * for HOURS (`GET /mcp ms:27971702` ≈ 7.8h), polluted the dashboard's request
 * duration metric with the stream's whole lifetime, and let the idle session
 * sweep close a stream that was still live.
 *
 * This wrapper closes the stream once NO real server→client data has flowed for
 * `idleTimeoutMs` (`0` disables the bound), and optionally emits `: keep-alive`
 * comment frames every `keepAliveIntervalMs` so an idle-but-live stream is not
 * dropped by an intermediary. Keep-alive frames are transport-only and do NOT
 * reset the idle window, so the stream is still bounded. On idle the stream is
 * closed CLEANLY (`controller.close()`) so `pipeline` finishes normally — no
 * error, no uncaught rejection — and the underlying SDK stream is cancelled to
 * free its standalone-stream slot; the SDK client then reconnects on its own.
 */
export function withSseIdleTimeout(response: Response, options: SseIdleTimeoutOptions = {}): Response {
	const body = response.body;
	if (body === null) return response;
	const idleTimeoutMs = options.idleTimeoutMs ?? MCP_HTTP_SSE_IDLE_TIMEOUT_MS;
	const keepAliveIntervalMs = options.keepAliveIntervalMs ?? MCP_HTTP_SSE_KEEPALIVE_INTERVAL_MS;

	const reader = body.getReader();
	const encoder = new TextEncoder();
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	let idleTimer: NodeJS.Timeout | undefined;
	let keepAliveTimer: NodeJS.Timeout | undefined;
	let settled = false;

	const clearTimers = (): void => {
		if (idleTimer !== undefined) clearTimeout(idleTimer);
		if (keepAliveTimer !== undefined) clearInterval(keepAliveTimer);
		idleTimer = undefined;
		keepAliveTimer = undefined;
	};

	const finish = (reason: "idle" | "close" | "error" | "cancel"): void => {
		if (settled) return;
		settled = true;
		clearTimers();
		if (reason === "idle") options.onIdle?.();
		options.onClose?.();
	};

	/** (Re)arm the idle timer. Real data resets it; keep-alive pings do NOT. */
	const armIdle = (): void => {
		if (idleTimeoutMs <= 0) return;
		if (idleTimer !== undefined) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			// Clean close: the consumer's `pipeline` finishes normally and the
			// SDK stream slot is released. The client reconnects on its own.
			finish("idle");
			try {
				controller?.close();
			} catch {
				/* already closed */
			}
			void reader.cancel().catch(() => {});
		}, idleTimeoutMs);
		idleTimer.unref?.();
	};

	const wrapped = new ReadableStream<Uint8Array>({
		start(streamController) {
			controller = streamController;
			options.onOpen?.();
			armIdle();
			if (keepAliveIntervalMs > 0) {
				keepAliveTimer = setInterval(() => {
					try {
						controller?.enqueue(encoder.encode(": keep-alive\n\n"));
					} catch {
						/* stream closed between ticks */
					}
				}, keepAliveIntervalMs);
				keepAliveTimer.unref?.();
			}
		},
		async pull(streamController) {
			try {
				const { done, value } = await reader.read();
				// The idle timer may have closed the stream while this read was
				// pending; do not touch an already-settled controller.
				if (settled) return;
				if (done) {
					finish("close");
					streamController.close();
					return;
				}
				options.onActivity?.();
				armIdle();
				streamController.enqueue(value);
			} catch (error) {
				if (settled) return;
				finish("error");
				streamController.error(error);
			}
		},
		cancel(reason) {
			finish("cancel");
			return reader.cancel(reason);
		}
	});

	return new Response(wrapped, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}

/**
 * Wrap a legacy session transport so server→client messages emitted before the
 * client's standalone SSE (`GET`) stream is open are BUFFERED, not dropped.
 *
 * The SDK transport routes standalone messages — server→client requests such
 * as `roots/list`, and unsolicited notifications — to the single `_GET_stream`
 * registered by a `GET` request, and its `send()` SILENTLY DISCARDS such a
 * message while that stream is closed. A 2025-era client opens the `GET` stream
 * only AFTER its `notifications/initialized` POST returns `202` — strictly
 * after the server's `oninitialized` hook runs — so the initialize-time
 * `roots/list` (which applies the session's MCP roots, TASK-418) would
 * otherwise be lost and the roots would never reach later tool calls. Buffering
 * until the stream opens closes that window deterministically (no timers).
 *
 * The buffer is BOUNDED ({@link MCP_HTTP_STANDALONE_BUFFER_MAX}); a client that
 * initializes but never opens the SSE stream cannot grow it without limit. The
 * `sseOpen` flag is reset when the SSE stream ends or is cancelled, so a later
 * `GET` can re-arm buffering for the (new) stream.
 *
 * Only standalone traffic is buffered; request/response traffic (anything with
 * a `relatedRequestId`, plus result/error responses) passes straight through,
 * so normal tool-call round-trips are unaffected.
 *
 * @returns A small handle exposing the buffer size and `sseOpen` state, so the
 *   bound and the reset can be asserted directly in tests.
 */
export function bufferStandaloneUntilSse(transport: WebStandardStreamableHTTPServerTransport): {
	bufferedCount: () => number;
	isSseOpen: () => boolean;
} {
	const buffered: JSONRPCMessage[] = [];
	let sseOpen = false;
	const send = transport.send.bind(transport);
	const handleRequest = transport.handleRequest.bind(transport);

	transport.send = (message, options) => {
		// Mirror the SDK's own routing: a message is standalone when it is not a
		// result/error response and carries no related request id.
		const isResponse = "id" in message && !("method" in message);
		if (!isResponse && options?.relatedRequestId === undefined && !sseOpen) {
			buffered.push(message);
			// Bound memory: keep only the most recent messages.
			if (buffered.length > MCP_HTTP_STANDALONE_BUFFER_MAX) {
				buffered.splice(0, buffered.length - MCP_HTTP_STANDALONE_BUFFER_MAX);
			}
			return Promise.resolve();
		}
		return send(message, options);
	};

	transport.handleRequest = async (request, options) => {
		const response = await handleRequest(request, options);
		if (request.method === "GET" && response.status === 200) {
			// Reset `sseOpen` once this SSE stream ends/cancels so a subsequent
			// GET can re-arm buffering.
			const wrapped = onResponseStreamClose(response, () => {
				sseOpen = false;
			});
			if (!sseOpen) {
				sseOpen = true;
				for (const message of buffered.splice(0)) await send(message);
			}
			return wrapped;
		}
		return response;
	};

	return { bufferedCount: () => buffered.length, isSseOpen: () => sseOpen };
}

/**
 * Whether a legacy request is an `initialize` exchange — the ONLY exchange that
 * may open a fresh session. A `POST` body is parsed from a clone, so the
 * original request stays readable for whichever handler it is routed to.
 *
 * Validation mirrors the SDK's own boundary (`JSONRPCMessageSchema`): a body
 * that is not valid JSON, or that is JSON but not a valid JSON-RPC message,
 * returns `null` so the SDK still owns the precise parse-error response. Only a
 * valid JSON-RPC body without an `initialize` is classified `false` (and so
 * answered with a session error rather than a freshly-minted dead server).
 *
 * @returns `true` when an `initialize` message is present, `false` for a valid
 *   JSON-RPC body without one, and `null` when the SDK should handle parsing.
 */
async function isInitializeExchange(webRequest: Request): Promise<boolean | null> {
	if (webRequest.method.toUpperCase() !== "POST") return false;
	let body: unknown;
	try {
		body = await webRequest.clone().json();
	} catch {
		return null;
	}
	const candidates = Array.isArray(body) ? body : [body];
	const messages: JSONRPCMessage[] = [];
	for (const candidate of candidates) {
		try {
			messages.push(parseJSONRPCMessage(candidate));
		} catch {
			return null;
		}
	}
	return messages.some((message) => isInitializeRequest(message));
}

/**
 * Build a JSON-RPC error response in the SDK transport's shape
 * (`{jsonrpc, error: {code, message}, id: null}`) so a client parses it exactly
 * like any other transport-level error.
 */
function jsonRpcErrorResponse(status: number, code: number, message: string): Response {
	return Response.json(
		{ jsonrpc: "2.0", error: { code, message }, id: null },
		{ status, headers: { "Content-Type": "application/json" } }
	);
}

/** JSON-RPC error for an unknown `Mcp-Session-Id`: `404` (client re-initializes). */
function sessionNotFoundResponse(): Response {
	return jsonRpcErrorResponse(404, -32001, "Session not found");
}

/**
 * Build the reporting error for a recoverable session rejection. The message
 * carries the offending session id and the expected recovery so the daemon log
 * explains the event instead of showing a bare "Session not found" (PERF-009).
 * The HTTP response body stays the canonical JSON-RPC error (see
 * {@link sessionNotFoundResponse} / {@link missingSessionIdResponse}).
 */
function sessionRecoveryError(reason: "unknown_session" | "missing_session_id", sessionId: string | null): Error {
	if (reason === "unknown_session") {
		return new Error(
			`Session not found (mcp-session-id=${sessionId ?? "?"}); the client will re-initialize and retry. ` +
				"If this repeats, the client is holding an evicted id — restart the client, or restart the daemon on the current build."
		);
	}
	return new Error("Bad Request: Mcp-Session-Id header is required (the client sends one on initialize).");
}

/** JSON-RPC error for a non-initialize request with no session header: `400`. */
function missingSessionIdResponse(): Response {
	return jsonRpcErrorResponse(400, -32000, "Bad Request: Mcp-Session-Id header is required");
}

/**
 * Serve a NON-initialize legacy request with a fresh short-lived STATELESS
 * transport (FIX-110-C).
 *
 * This is the safest auto-create point: the transport is constructed with
 * `sessionIdGenerator: undefined`, so the SDK's `validateSession` returns early
 * — no "Server not initialized" and no "Session not found" — and the request is
 * served in place. Because `Protocol` does not require an `initialize` before
 * handling requests, a tool call with an unknown/evicted session id succeeds.
 *
 * Mirrors the SDK's own `legacyStatelessFallback` teardown so neither the
 * server nor the transport leaks: the exchange is torn down once the (possibly
 * streaming) response body completes, errors, or the request aborts.
 */
async function serveLegacyStateless(factory: McpServerFactory, request: Request): Promise<Response> {
	const product = await factory({ era: "legacy", requestInfo: request });
	const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
	await product.connect(transport);

	let toreDown = false;
	const teardown = () => {
		if (toreDown) return;
		toreDown = true;
		void transport.close().catch(() => {});
		void product.close().catch(() => {});
	};
	request.signal?.addEventListener("abort", teardown, { once: true });

	let response: Response;
	try {
		response = await transport.handleRequest(request);
	} catch (error) {
		teardown();
		throw error;
	}

	// Non-streaming response: the exchange is complete, so tear down now.
	if (response.body === null || !isStreamingResponse(response)) {
		teardown();
		return response;
	}

	// Streaming response: keep the transport alive until the body is fully
	// consumed (or cancelled), then tear down exactly once.
	const reader = response.body.getReader();
	const monitoredBody = new ReadableStream({
		pull: async (controller) => {
			try {
				const { done, value } = await reader.read();
				if (done) {
					teardown();
					controller.close();
					return;
				}
				if (value !== undefined) controller.enqueue(value);
			} catch (error) {
				teardown();
				controller.error(error);
			}
		},
		cancel: (reason) => {
			teardown();
			return reader.cancel(reason).catch(() => {});
		}
	});
	return new Response(monitoredBody, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}

/** The web-standard face returned by {@link createDualHandler}. */
export interface DualHandler {
	/** Serve one HTTP request, routing by protocol era (modern vs legacy). */
	fetch: (request: Request, options?: McpHandlerRequestOptions) => Promise<Response>;
	/** Tear down BOTH the modern handler and every live legacy session. */
	close: () => Promise<void>;
	/**
	 * Evict legacy sessions idle for longer than the configured TTL. Exposed so
	 * tests can drive eviction deterministically with an injected `now`; the
	 * handler also calls it lazily on every `serveLegacy` and on a timer.
	 */
	sweepIdleLegacySessions: (now?: number) => void;
}

/**
 * Options for {@link createDualHandler} (FIX-110-C).
 */
export interface DualHandlerOptions {
	/**
	 * Idle TTL (ms) for a retained legacy session. Defaults to
	 * {@link MCP_HTTP_SESSION_IDLE_TTL_MS}; the daemon passes the longer
	 * {@link MCP_DAEMON_SESSION_IDLE_TTL_MS} so remote clients that hold one
	 * session id for their whole lifetime are evicted far less often.
	 */
	sessionIdleTtlMs?: number;
	/**
	 * Stateless session recovery. When ON (default, or via
	 * `MCP_HTTP_STATELESS_RECOVERY`), a non-initialize request carrying an
	 * unknown/absent `mcp-session-id` is served by a fresh short-lived stateless
	 * transport instead of a 404/400 — so a client that cached an evicted id
	 * self-heals WITHOUT re-initializing (no >60s stall). When OFF, the
	 * historical 404/-32001 / 400/-32000 bodies are returned.
	 */
	statelessRecovery?: boolean;
}

/**
 * Build the dual-era MCP handler shared by the standalone HTTP transport and
 * the combined daemon server (FEAT-DAEMON-001).
 *
 * The SDK entry ({@link createMcpHandler}) has no handler-valued `legacy`
 * option, so 2025-era traffic — the era OpenCode and most current MCP clients
 * speak — is routed by hand with {@link isLegacyRequest} in front of a strict
 * `legacy: "reject"` modern handler (DEBT-423). The modern path stays
 * per-request; the legacy path is served by a STATEFUL
 * {@link WebStandardStreamableHTTPServerTransport} PER SESSION, keyed by the
 * `Mcp-Session-Id` header. That per-session transport retains the initialized
 * `McpServer`, so `oninitialized` (which applies MCP roots via
 * `applySessionRoots`, TASK-418) fires once on the REAL session and its scope
 * reaches every later tool call. A single shared transport cannot do this: the
 * SDK transport holds one `sessionId`/`_initialized` pair, so a second
 * concurrent `initialize` is rejected with "Server already initialized".
 *
 * Extracted so both mounts (the plain Node listener in
 * {@link startHttpTransport} and the Express pre-route in `combined-server.ts`)
 * share ONE implementation and cannot drift apart.
 *
 * @param factory - Per-session server factory (see {@link createServerFactory}).
 * @param onerror - Reporting callback for out-of-band errors on either leg
 *   (never alters the response). The same callback serves both the modern
 *   handler and each legacy session's transport.
 * @param options - TTL + recovery tuning (see {@link DualHandlerOptions}).
 * @returns A {@link DualHandler} exposing `fetch` and a `close()` that tears
 *   down both legs.
 */
export function createDualHandler(
	factory: McpServerFactory,
	onerror?: (error: Error) => void,
	options?: DualHandlerOptions
): DualHandler {
	const sessionIdleTtlMs = options?.sessionIdleTtlMs ?? MCP_HTTP_SESSION_IDLE_TTL_MS;
	const statelessRecovery = options?.statelessRecovery ?? MCP_HTTP_STATELESS_RECOVERY;
	// Modern (2026-07-28) face. Strict: 2025-era traffic is routed by hand
	// (below) rather than served by the SDK's throwaway stateless fallback.
	const modernHandler = createMcpHandler(factory, { legacy: "reject", onerror });

	/**
	 * Live legacy sessions keyed by `Mcp-Session-Id`. Each entry owns ONE
	 * stateful transport (which retains its initialized server) so per-session
	 * state — most importantly the MCP roots applied on `oninitialized` —
	 * persists across that session's requests. A single shared transport cannot
	 * do this: the SDK transport tracks one `sessionId`/`_initialized` pair, so
	 * a second concurrent `initialize` is rejected with "Server already
	 * initialized".
	 */
	const legacySessions = new Map<string, LegacySession>();

	/**
	 * Evict legacy sessions idle (no `serveLegacy` hit) for longer than
	 * {@link MCP_HTTP_SESSION_IDLE_TTL_MS}. Each entry pins a stateful transport
	 * + an initialized `McpServer`; the MCP client SDK's normal `close()` does
	 * NOT send a `DELETE` (only `terminateSession()` does, which this repo never
	 * calls), so without this sweep an abandoned session would live forever —
	 * unbounded map growth on a long-lived daemon. Exposed on the returned
	 * {@link DualHandler} so tests can drive it with an injected `now`.
	 */
	function sweepIdleLegacySessions(now: number = Date.now()): void {
		for (const [id, session] of legacySessions) {
			// FIX-028: NEVER evict a session with an open SSE stream — the
			// stream is live even when no new request has arrived, and the
			// pre-fix sweep closed it mid-stream (the `Session not found` 404
			// storm). `lastSeen` is also refreshed on every stream chunk, so a
			// busy stream keeps the session warm regardless.
			if (session.openStreams > 0) continue;
			if (now - session.lastSeen > sessionIdleTtlMs) {
				legacySessions.delete(id);
				try {
					void session.transport.close().catch(() => {});
				} catch {
					/* best effort */
				}
				try {
					void session.product.close().catch(() => {});
				} catch {
					/* best effort */
				}
			}
		}
	}

	// Idle eviction also runs on a timer so an abandoned session is reclaimed
	// even when no further traffic arrives. `unref()` keeps the timer from
	// holding the process open; it is cleared in `close()`.
	const idleSweepTimer = setInterval(() => sweepIdleLegacySessions(), sessionIdleTtlMs);
	idleSweepTimer.unref?.();

	/**
	 * Serve one legacy request. A request carrying a KNOWN `Mcp-Session-Id` goes
	 * straight to that session's transport. An `initialize` (with or without a
	 * session id) gets a fresh factory server + transport, retained once the
	 * exchange opens a session. Any OTHER request with an unknown or absent
	 * session id is answered with the clean session error (404 "Session not
	 * found" / 400 "Mcp-Session-Id header is required") rather than a freshly
	 * minted un-initialized server (PERF-006).
	 */
	async function serveLegacy(webRequest: Request): Promise<Response> {
		// Lazy idle sweep: deterministic and testable, and it reclaims an
		// abandoned session the moment new traffic arrives.
		sweepIdleLegacySessions();

		const sessionId = webRequest.headers.get("mcp-session-id");
		const existing = sessionId !== null ? legacySessions.get(sessionId) : undefined;
		if (existing !== undefined) {
			existing.lastSeen = Date.now();
			const response = await existing.transport.handleRequest(webRequest);
			// FIX-028: bound a standalone SSE stream's lifetime and exempt the
			// session from the idle sweep while it is open.
			return trackOpenSseStream(existing, webRequest, response);
		}

		// Unknown (or absent) session id on a NON-initialize exchange.
		const isInitialize = await isInitializeExchange(webRequest);
		if (isInitialize === false) {
			// FIX-110-C: stateless recovery. A remote client (e.g. Zed) caches
			// ONE session id for its whole lifetime; when the idle sweep evicts
			// it the next call carries an unknown id. Returning 404/400 makes a
			// client that never re-initializes stall. Serving the request with a
			// fresh stateless transport lets it succeed with NO re-initialize and
			// NO stall. This branch is POST-only in practice (non-initialize
			// requests are POSTs); a stateless transport would 405 a GET/DELETE,
			// which is the same contract the SDK's own stateless fallback uses.
			if (statelessRecovery) {
				// Preserve observability: report the eviction so the daemon log
				// explains WHY a stateless recovery happened (PERF-009).
				onerror?.(sessionRecoveryError(sessionId !== null ? "unknown_session" : "missing_session_id", sessionId));
				try {
					return await serveLegacyStateless(factory, webRequest);
				} catch (error) {
					onerror?.(error instanceof Error ? error : new Error(String(error)));
					return jsonRpcErrorResponse(500, -32603, "Internal error");
				}
			}
			// Recovery disabled: preserve the strict 404/400 contract so a
			// client whose transport re-initializes on 404 still recovers.
			//
			// Preserve the observability the SDK provided: it reported these
			// session rejections through `onerror` (the daemon logs them). The
			// message names the offending id + the recovery path so the daemon
			// log explains the wedge instead of showing a bare session error
			// (PERF-009).
			if (sessionId !== null) {
				onerror?.(sessionRecoveryError("unknown_session", sessionId));
				return sessionNotFoundResponse();
			}
			onerror?.(sessionRecoveryError("missing_session_id", null));
			return missingSessionIdResponse();
		}

		const product = await factory({ era: "legacy", requestInfo: webRequest });
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (id) => {
				legacySessions.set(id, { transport, product, lastSeen: Date.now(), openStreams: 0 });
			}
		});
		// Assign BEFORE connect(): `Protocol.connect` captures the transport's
		// current `onclose`/`onerror` and chains them, so setting these after
		// connect would clobber the server's own teardown hooks.
		transport.onclose = () => {
			if (transport.sessionId !== undefined) legacySessions.delete(transport.sessionId);
		};
		transport.onerror = (error) => onerror?.(error);
		bufferStandaloneUntilSse(transport);
		await product.connect(transport);

		try {
			return await transport.handleRequest(webRequest);
		} finally {
			// Only an `initialize` opens a session (setting `sessionId`); any
			// other un-keyed exchange is one-shot and must not leak its server.
			if (transport.sessionId === undefined) {
				void transport.close().catch(() => {});
				void product.close().catch(() => {});
			}
		}
	}

	return {
		// `isLegacyRequest` classifies from an internal clone, so `request`
		// stays fully readable for whichever handler it is routed to.
		fetch: async (request, options) =>
			(await isLegacyRequest(request)) ? await serveLegacy(request) : await modernHandler.fetch(request, options),
		sweepIdleLegacySessions,
		close: async () => {
			clearInterval(idleSweepTimer);
			await modernHandler.close();
			const closingLegacy = [...legacySessions.values()].map(async ({ transport, product }) => {
				await transport.close().catch(() => {});
				await product.close().catch(() => {});
			});
			legacySessions.clear();
			await Promise.all(closingLegacy);
		}
	};
}

/**
 * Start the Streamable HTTP transport and begin accepting MCP sessions.
 *
 * The store and process-wide workers are NOT touched here — they are already
 * initialized exactly once by the caller (`server.ts`). Each session gets its
 * own `McpServer`/`SessionContext` from `factory`, sharing the single store.
 *
 * Traffic is split by era via {@link createDualHandler} (DEBT-423): modern
 * (2026-07-28) requests go to a strict `legacy: "reject"`
 * {@link createMcpHandler}; 2025-era requests — the era OpenCode and most
 * current clients speak — go to a per-session stateful
 * {@link WebStandardStreamableHTTPServerTransport} so the initialize-time
 * `oninitialized` hook (and the MCP roots it applies) survives into later tool
 * calls instead of being torn down with a throwaway stateless instance.
 *
 * @param options - Resolved config plus the per-session server factory.
 * @returns A handle exposing the bound port/url and a `close()` method.
 * @throws When bearer auth is required but no token is configured.
 */
export async function startHttpTransport(options: HttpTransportOptions): Promise<HttpTransportHandle> {
	const { host, port, path: endpointPath, token, allowInsecure, factory } = options;

	if (!allowInsecure && !token) {
		throw new Error(
			"MCP HTTP transport requires a bearer token (MCP_HTTP_TOKEN) unless MCP_HTTP_ALLOW_INSECURE=true " +
				"is explicitly set for local development. Refusing to start an unauthenticated HTTP listener."
		);
	}

	const handler = createDualHandler(factory, (error) =>
		logger.warn("[MCP HTTP] handler error", { error: error.message })
	);

	const allowedHostnames = buildAllowedHostnames(host);

	const server = http.createServer((req, res) => {
		// FIX-025: client disconnects (ERR_STREAM_PREMATURE_CLOSE / ECONNRESET /
		// aborted body) abort only this request and log at WARN — they never
		// reach the process-level uncaught handler.
		serveNodeRequest(req, res, handleNodeRequest, { logTag: "[MCP HTTP]" });
	});

	await listen(server, host, port);
	const boundPort = (server.address() as AddressInfo).port;

	/**
	 * Handle one Node HTTP exchange: path gate → auth → Host/Origin validation →
	 * route by era → bridge the Web response back to Node.
	 */
	async function handleNodeRequest(nodeReq: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = buildRequestUrl(nodeReq, host, boundPort);

		if (new URL(url).pathname !== endpointPath) {
			res.statusCode = 404;
			res.setHeader("Content-Type", "text/plain; charset=utf-8");
			res.end("Not Found");
			return;
		}

		if (!allowInsecure) {
			const provided = extractBearerToken(nodeReq.headers.authorization);
			if (provided === undefined || token === undefined || !tokensMatch(provided, token)) {
				res.statusCode = 401;
				res.setHeader("WWW-Authenticate", 'Bearer realm="local-memory-mcp"');
				res.setHeader("Content-Type", "text/plain; charset=utf-8");
				res.end("Unauthorized");
				return;
			}
		}

		const webRequest = toWebRequest(nodeReq, url);
		const rejected =
			hostHeaderValidationResponse(webRequest, allowedHostnames) ??
			originValidationResponse(webRequest, allowedHostnames);
		if (rejected !== undefined) {
			await writeWebResponse(res, rejected);
			return;
		}

		const webResponse = await handler.fetch(webRequest);
		await writeWebResponse(res, webResponse);
	}

	logger.info("[MCP HTTP] listening", {
		host,
		port: boundPort,
		path: endpointPath,
		auth: allowInsecure ? "insecure" : "bearer"
	});

	return {
		port: boundPort,
		url: `http://${host}:${boundPort}`,
		close: async () => {
			await handler.close();
			const closed = new Promise<void>((resolve) => server.close(() => resolve()));
			// Terminate lingering keep-alive / SSE connections so close() resolves.
			server.closeAllConnections();
			await closed;
		}
	};
}

/**
 * Build the allowlist for Host/Origin validation: the standard localhost trio
 * plus the configured bind host (so a non-loopback bind is still accepted).
 *
 * Exported for reuse by the combined daemon server (FEAT-DAEMON-001), which
 * mounts the same handler inside Express and must apply identical validation.
 */
export function buildAllowedHostnames(host: string): string[] {
	const allowed = new Set(localhostAllowedHostnames());
	if (host) allowed.add(host);
	return [...allowed];
}

/**
 * Reconstruct the request URL from the Node request. Prefers the `Host`
 * header (which carries the real port) and falls back to the bound host/port.
 *
 * Exported for the combined daemon server (FEAT-DAEMON-001) so both transports
 * reconstruct the request URL identically.
 */
export function buildRequestUrl(nodeReq: IncomingMessage, host: string, port: number): string {
	const hostHeader = nodeReq.headers.host ?? `${host}:${port}`;
	return `http://${hostHeader}${nodeReq.url ?? "/"}`;
}

/**
 * Convert Node request headers into a plain string record suitable for the Web
 * `Headers` constructor. Multi-valued headers (arrays) are joined with `, `
 * per HTTP semantics; `undefined` values are dropped. Returns a plain
 * `Record<string, string>` so the value is assignable under BOTH the Node
 * (undici) and DOM `HeadersInit` definitions (the test tsconfig adds `DOM`).
 */
function nodeHeadersToRecord(headers: IncomingHttpHeaders): Record<string, string> {
	const record: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value === undefined) continue;
		record[key] = Array.isArray(value) ? value.join(", ") : value;
	}
	return record;
}

/** `RequestInit` plus Node's `duplex` field, which the DOM lib lacks. */
type NodeRequestInit = RequestInit & { duplex?: "half" };

/**
 * Convert a Node `IncomingMessage` into a Web `Request`. Bodies (POST) are
 * streamed via `Readable.toWeb` with `duplex: "half"`; body-less methods omit
 * the body so the request stays a simple non-streaming request.
 *
 * Exported for the combined daemon server (FEAT-DAEMON-001): Express's
 * `Request` extends `IncomingMessage`, so the same bridge applies unchanged.
 */
export function toWebRequest(nodeReq: IncomingMessage, url: string): Request {
	const method = nodeReq.method ?? "GET";
	const hasBody = method !== "GET" && method !== "HEAD";
	const init: NodeRequestInit = {
		method,
		headers: nodeHeadersToRecord(nodeReq.headers)
	};
	if (hasBody) {
		init.body = Readable.toWeb(nodeReq) as ReadableStream<Uint8Array>;
		init.duplex = "half";
	}
	return new Request(url, init as RequestInit);
}

/**
 * Bridge a Web `Response` back to the Node response: copy status/headers and
 * pipe the (possibly SSE-streamed) body. `pipeline` tears the source down if
 * the client disconnects mid-stream. `headers.forEach` is used instead of
 * iteration so it compiles under both the Node and DOM `Headers` definitions.
 *
 * Exported for the combined daemon server (FEAT-DAEMON-001): Express's
 * `Response` extends `ServerResponse`, so the same bridge applies unchanged.
 */
export async function writeWebResponse(res: ServerResponse, web: Response): Promise<void> {
	res.statusCode = web.status;
	web.headers.forEach((value, key) => {
		if (key.toLowerCase() === "transfer-encoding") return;
		res.setHeader(key, value);
	});
	if (web.body === null) {
		res.end();
		return;
	}
	const source = Readable.fromWeb(web.body as NodeWebReadableStream<Uint8Array>);
	await pipeline(source, res);
}

/**
 * Error codes that mean "the CLIENT went away mid-request" — a socket reset,
 * a half-closed stream, or a client that stopped reading a streaming response.
 *
 * These are EXPECTED on a long-lived daemon that streams SSE (and whose
 * clients are short-lived agent processes that exit without a clean
 * `DELETE`/`close`). They must abort ONLY the affected request and log at
 * WARN — never be treated as a server fault or, worse, escape as an uncaught
 * exception (FIX-025: `ERR_STREAM_PREMATURE_CLOSE` was the highest-volume
 * stability signal in `daemon.log`).
 */
const CLIENT_DISCONNECT_CODES = new Set([
	"ERR_STREAM_PREMATURE_CLOSE",
	"ERR_STREAM_DESTROYED",
	"ERR_STREAM_WRITE_AFTER_END",
	"ECONNRESET",
	"EPIPE",
	"ABORT_ERR"
]);

/**
 * Whether an error represents a client disconnect (socket close/reset, aborted
 * request body, or a premature close while writing a streaming response).
 *
 * Checks the error `code`, the DOM `AbortError` name (Node's `Readable.toWeb`
 * rejects request-body reads with an `AbortError`), and — as a last resort —
 * the message, since `pipeline()` wraps some socket failures in an
 * `ERR_STREAM_PREMATURE_CLOSE` whose message is `"Premature close"`. One level
 * of `cause` is inspected so a wrapped transport error still classifies.
 */
export function isClientDisconnectError(error: unknown, depth = 0): boolean {
	if (error === null || typeof error !== "object") return false;
	const err = error as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
	if (typeof err.code === "string" && CLIENT_DISCONNECT_CODES.has(err.code)) return true;
	if (err.name === "AbortError") return true;
	if (typeof err.message === "string" && /premature close|aborted|socket hang up/i.test(err.message)) return true;
	if (depth < 2 && "cause" in err) return isClientDisconnectError(err.cause, depth + 1);
	return false;
}

/**
 * Serve one Node HTTP exchange through the Web-standard MCP handler WITHOUT
 * ever letting a client disconnect become an uncaught exception (FIX-025).
 *
 * Two hazards are handled:
 *
 *   1. **Unhandled stream errors.** An `IncomingMessage`/`ServerResponse`
 *      `'error'` event with no listener is re-emitted as an uncaught
 *      exception that kills the daemon. Persistent listeners are attached to
 *      BOTH streams so a late socket error (after the response was partially
 *      written) is logged and swallowed instead.
 *
 *   2. **Disconnect rejection.** `writeWebResponse` pipes the response body
 *      through `pipeline(source, res)`; a client that goes away mid-stream
 *      makes that reject with `ERR_STREAM_PREMATURE_CLOSE`. That rejection is
 *      EXPECTED — it aborts only this request and is logged at WARN, with a
 *      per-request id + duration so it can be correlated to a slow request.
 *      Any OTHER rejection is a genuine server fault → 500 + error log.
 *
 * Shared by the standalone HTTP transport ({@link startHttpTransport}) and the
 * combined daemon server (`combined-server.ts`) so both mounts behave
 * identically.
 *
 * @param nodeReq - The Node request.
 * @param res - The Node response (Express's `Response` subclass is accepted).
 * @param handle - The async body that serves the exchange and ends the
 *   response. Rejections are classified here.
 * @param options - `logTag` prefixes every emitted log line.
 */
export function serveNodeRequest(
	nodeReq: IncomingMessage,
	res: ServerResponse,
	handle: (nodeReq: IncomingMessage, res: ServerResponse) => Promise<void>,
	options: { logTag: string }
): void {
	const tag = options.logTag;
	const requestId = randomUUID();
	const startedAt = Date.now();
	let disconnectLogged = false;

	/** Warn ONCE per request even if several disconnect signals fire. */
	const logDisconnect = (error: unknown, where: string): void => {
		if (disconnectLogged) return;
		disconnectLogged = true;
		logger.warn(`${tag} client disconnected mid-request`, {
			requestId,
			method: nodeReq.method,
			url: nodeReq.url,
			where,
			durationMs: Date.now() - startedAt,
			error: String(error)
		});
	};

	// Persistent guards: an unlistened `'error'` on either stream is an uncaught
	// exception. A disconnect is a WARN; anything else is a real error.
	nodeReq.on("error", (error: unknown) => {
		if (isClientDisconnectError(error)) logDisconnect(error, "request");
		else logger.error(`${tag} request stream error`, { requestId, error: String(error) });
	});
	res.on("error", (error: unknown) => {
		if (isClientDisconnectError(error)) logDisconnect(error, "response");
		else logger.error(`${tag} response stream error`, { requestId, error: String(error) });
	});

	void handle(nodeReq, res)
		.then(() => {
			// Concise per-request observability (debug: the dashboard already
			// logs one INFO line per request). The disconnect/error WARNs above
			// carry the SAME requestId + durationMs, so a premature close can be
			// correlated to a slow request.
			logger.debug(`${tag} request complete`, {
				requestId,
				method: nodeReq.method,
				url: nodeReq.url,
				status: res.statusCode,
				durationMs: Date.now() - startedAt
			});
		})
		.catch((error: unknown) => {
			if (isClientDisconnectError(error)) {
				logDisconnect(error, "handler");
				return;
			}
			logger.error(`${tag} request failed`, {
				requestId,
				error: String(error),
				durationMs: Date.now() - startedAt
			});
			if (!res.headersSent) {
				res.statusCode = 500;
				res.setHeader("Content-Type", "text/plain; charset=utf-8");
			}
			if (!res.writableEnded) res.end("Internal Server Error");
		});
}

/**
 * Extract the token from an `Authorization: Bearer <token>` header, or
 * `undefined` when the header is absent or not a bearer scheme.
 */
function extractBearerToken(header: string | string[] | undefined): string | undefined {
	if (typeof header !== "string") return undefined;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match ? match[1].trim() : undefined;
}

/**
 * Constant-time bearer-token comparison. Both values are hashed first so the
 * comparison is length-independent and cannot leak the token length via a
 * timing side channel. The token value is never logged.
 */
function tokensMatch(provided: string, expected: string): boolean {
	const a = createHash("sha256").update(provided).digest();
	const b = createHash("sha256").update(expected).digest();
	return timingSafeEqual(a, b);
}

/**
 * Promisified `server.listen` that rejects on bind errors (e.g. EADDRINUSE)
 * with the original error so the caller can surface a clear startup failure.
 */
function listen(server: http.Server, host: string, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});
}
