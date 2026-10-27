/**
 * Unit tests for src/dashboard/request-logging.ts (FIX-028).
 *
 * The dashboard's `[Dashboard] request` logger used to sample the request
 * duration at `res.on("finish")` for EVERY response. For a streaming SSE
 * response (`text/event-stream` — the MCP `GET /mcp` served by the combined
 * daemon) `finish` fires when the STREAM ENDS, so the whole stream lifetime was
 * logged as latency (`GET /mcp ms:27971702` ≈ 7.8h) and tripped bogus
 * `slow request` WARNs. These tests pin the fix: a streaming response reports
 * time-to-first-byte as `ms` (flagged `stream: true`, full lifetime in
 * `streamMs`) and never trips the slow-request warning on stream duration,
 * while a normal response keeps reporting its full duration.
 */

import { describe, it, expect, vi } from "vitest";
import type { ServerResponse } from "node:http";
import {
	buildRequestLogContext,
	isStreamingContentType,
	createRequestLogger,
	SLOW_REQUEST_THRESHOLD_MS
} from "../request-logging";

const logs = vi.hoisted(() => ({ info: [] as unknown[], warn: [] as unknown[] }));
vi.mock("../../mcp/utils/logger", () => ({
	logger: {
		info: (message: string, context?: unknown) => logs.info.push({ message, context }),
		warn: (message: string, context?: unknown) => logs.warn.push({ message, context })
	}
}));

describe("isStreamingContentType", () => {
	it("recognises the SSE content type (case-insensitive, parameterised)", () => {
		expect(isStreamingContentType("text/event-stream")).toBe(true);
		expect(isStreamingContentType("TEXT/EVENT-STREAM; charset=utf-8")).toBe(true);
	});

	it("rejects non-streaming / absent content types (negative)", () => {
		expect(isStreamingContentType("application/json")).toBe(false);
		expect(isStreamingContentType(undefined)).toBe(false);
		expect(isStreamingContentType(null)).toBe(false);
	});
});

describe("buildRequestLogContext", () => {
	it("reports time-to-first-byte (not the whole lifetime) for a streaming response", () => {
		const context = buildRequestLogContext({
			method: "GET",
			path: "/mcp",
			status: 200,
			firstByteMs: 5,
			totalMs: 27_971_702,
			streaming: true
		});
		expect(context.ms).toBe(5);
		expect(context.stream).toBe(true);
		expect(context.streamMs).toBe(27_971_702);
	});

	it("falls back to the total lifetime for a stream that never emitted a byte", () => {
		const context = buildRequestLogContext({
			method: "GET",
			path: "/mcp",
			status: 200,
			firstByteMs: undefined,
			totalMs: 10_000,
			streaming: true
		});
		expect(context.ms).toBe(10_000);
		expect(context.stream).toBe(true);
	});

	it("reports the full duration for a non-streaming response", () => {
		const context = buildRequestLogContext({
			method: "GET",
			path: "/api/stats",
			status: 200,
			firstByteMs: 3,
			totalMs: 42,
			streaming: false
		});
		expect(context.ms).toBe(42);
		expect(context.stream).toBeUndefined();
	});
});

/** Minimal Express-like request/response doubles for the middleware. */
function makeDoubles(): {
	req: { method: string; path: string };
	res: ServerResponse & { emitFinish: () => void; setContentType: (value: string) => void };
	next: () => void;
} {
	const headers: Record<string, string> = {};
	const listeners: Record<string, Array<() => void>> = {};
	const res = {
		statusCode: 200,
		writeHead: vi.fn(),
		getHeader: (name: string) => headers[name.toLowerCase()],
		on: (event: string, cb: () => void) => {
			(listeners[event] ??= []).push(cb);
		}
	} as unknown as ServerResponse & { emitFinish: () => void; setContentType: (value: string) => void };
	(res as unknown as { setContentType: (value: string) => void }).setContentType = (value) => {
		headers["content-type"] = value;
	};
	(res as unknown as { emitFinish: () => void }).emitFinish = () => {
		for (const cb of listeners.finish ?? []) cb();
	};
	return { req: { method: "GET", path: "/x" }, res, next: vi.fn() };
}

describe("createRequestLogger middleware", () => {
	it("logs a streaming response with TTFB and does NOT warn on the long stream lifetime", () => {
		logs.info.length = 0;
		logs.warn.length = 0;
		const { req, res, next } = makeDoubles();
		res.setContentType("text/event-stream");

		// Controllable clock: start → +5ms (writeHead/TTFB) → +7.8h (finish).
		let now = 1_000;
		const clock = vi.spyOn(Date, "now").mockImplementation(() => now);

		try {
			createRequestLogger()(req as never, res as never, next as never);
			expect(next).toHaveBeenCalled();

			now += 5; // time-to-first-byte
			(res as unknown as { writeHead: () => void }).writeHead();
			now += 27_971_702; // the stream ran for ~7.8h before finishing
			res.emitFinish();
		} finally {
			clock.mockRestore();
		}

		expect(logs.info).toHaveLength(1);
		const info = logs.info[0] as { message: string; context: { ms: number; stream?: boolean } };
		expect(info.message).toBe("[Dashboard] request");
		expect(info.context.stream).toBe(true);
		expect(info.context.ms).toBe(5);
		// The slow-request warning must NOT fire for a stream's lifetime.
		expect(logs.warn).toHaveLength(0);
	});

	it("warns when a NON-streaming response is genuinely slow", () => {
		logs.info.length = 0;
		logs.warn.length = 0;
		const { req, res, next } = makeDoubles();
		res.setContentType("application/json");

		let now = 1_000;
		const clock = vi.spyOn(Date, "now").mockImplementation(() => now);

		try {
			createRequestLogger()(req as never, res as never, next as never);
			expect(next).toHaveBeenCalled();

			now += SLOW_REQUEST_THRESHOLD_MS + 1;
			res.emitFinish();
		} finally {
			clock.mockRestore();
		}

		expect(logs.warn).toHaveLength(1);
		const warn = logs.warn[0] as { message: string; context: { ms: number } };
		expect(warn.message).toBe("[Dashboard] slow request");
		expect(warn.context.ms).toBe(SLOW_REQUEST_THRESHOLD_MS + 1);
	});
});
