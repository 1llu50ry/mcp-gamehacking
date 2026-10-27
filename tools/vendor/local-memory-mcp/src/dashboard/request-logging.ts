/**
 * Dashboard request-logging middleware (extracted for FIX-028).
 *
 * The dashboard logs one `[Dashboard] request` INFO line per exchange and a
 * `[Dashboard] slow request` WARN when the measured duration exceeds a
 * threshold. Pre-FIX-028 the duration was ALWAYS `Date.now() - start` sampled at
 * `res.on("finish")`. For a STREAMING response (`Content-Type:
 * text/event-stream` — the MCP standalone SSE `GET /mcp` served by the combined
 * daemon) `finish` fires when the STREAM ENDS, not when the request is served,
 * so the whole stream lifetime was logged as the request's latency. On a
 * long-lived daemon that produced `GET /mcp ms:27971702` (~7.8h) and 64 bogus
 * `slow request` WARNs — a pure MEASUREMENT ARTIFACT.
 *
 * This middleware measures **time-to-first-byte** (the moment the response
 * headers/first body byte are flushed) and reports THAT as `ms`, so a streaming
 * response's `ms` reflects real request latency. A streaming response is still
 * flagged (`stream: true`) with its full `streamMs` lifetime carried alongside,
 * so the long-lived stream stays observable without polluting the latency
 * metric or tripping the slow-request warning.
 *
 * Extracted from `app.ts` so the timing/classification logic is unit-testable
 * without booting the full Express app (which resolves the heavy dashboard DI
 * context at import time).
 */
import type { RequestHandler } from "express";
import type { ServerResponse } from "node:http";
import { logger } from "../mcp/utils/logger";

/** Content type that marks a response as a long-lived stream. */
export const STREAMING_CONTENT_TYPE = "text/event-stream";

/** Duration (ms) above which a request is reported as slow. */
export const SLOW_REQUEST_THRESHOLD_MS = 1_000;

/**
 * Whether a `Content-Type` header value denotes a streaming response. Case-
 * insensitive substring match so a parameterised value (`text/event-stream;
 * charset=utf-8`) is still classified as a stream.
 */
export function isStreamingContentType(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	return String(value).toLowerCase().includes(STREAMING_CONTENT_TYPE);
}

/** The log context emitted for one finished request. */
export interface RequestLogContext {
	method: string;
	path: string;
	status: number;
	ms: number;
	stream?: boolean;
	streamMs?: number;
}

/**
 * Build the `[Dashboard] request` context for a finished exchange.
 *
 * @param options.firstByteMs - Time-to-first-byte in ms, when known.
 * @param options.totalMs - Whole exchange lifetime in ms (finish − start).
 * @param options.streaming - Whether the response is a streaming response.
 * @returns The context to log. For a streaming response `ms` is the
 *   time-to-first-byte and `streamMs` carries the full lifetime; otherwise
 *   `ms` is the full lifetime.
 */
export function buildRequestLogContext(options: {
	method: string;
	path: string;
	status: number;
	firstByteMs: number | undefined;
	totalMs: number;
	streaming: boolean;
}): RequestLogContext {
	const { method, path, status, firstByteMs, totalMs, streaming } = options;
	if (streaming) {
		// TTFB is the real latency; fall back to the total when no byte was ever
		// written (a stream that ended without emitting).
		return { method, path, status, ms: firstByteMs ?? totalMs, stream: true, streamMs: totalMs };
	}
	return { method, path, status, ms: totalMs };
}

/**
 * Express middleware that logs one INFO line per finished request and a WARN
 * when the (latency) duration exceeds {@link SLOW_REQUEST_THRESHOLD_MS}.
 *
 * Time-to-first-byte is captured by wrapping `res.writeHead`, which Node calls
 * (directly, or implicitly on the first `res.write`/`res.end(data)`) when the
 * response headers are flushed.
 */
export function createRequestLogger(): RequestHandler {
	return (req, res, next) => {
		const start = Date.now();
		let firstByteAt: number | undefined;
		const markFirstByte = (): void => {
			if (firstByteAt === undefined) firstByteAt = Date.now();
		};

		const originalWriteHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
		res.writeHead = ((...args: unknown[]): ServerResponse => {
			markFirstByte();
			return originalWriteHead(...args);
		}) as typeof res.writeHead;

		res.on("finish", () => {
			const totalMs = Date.now() - start;
			const streaming = isStreamingContentType(res.getHeader("content-type"));
			const context = buildRequestLogContext({
				method: req.method,
				path: req.path,
				status: res.statusCode,
				firstByteMs: firstByteAt === undefined ? undefined : firstByteAt - start,
				totalMs,
				streaming
			});
			logger.info("[Dashboard] request", context as unknown as Record<string, unknown>);
			if (context.ms > SLOW_REQUEST_THRESHOLD_MS) {
				logger.warn("[Dashboard] slow request", {
					method: req.method,
					path: req.path,
					ms: context.ms
				});
			}
		});
		next();
	};
}
