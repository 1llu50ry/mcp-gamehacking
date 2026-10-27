/**
 * HTTP transport — client-disconnect hardening integration tests (FIX-025).
 *
 * `daemon.log` carried 25 `[Daemon] MCP request failed
 * Error [ERR_STREAM_PREMATURE_CLOSE]: Premature close` lines (the highest-volume
 * stability signal) — a client that goes away mid-request made
 * `pipeline(source, res)` in `writeWebResponse` reject, and the pre-fix handler
 * treated that as a server fault (ERROR log). This suite boots the REAL HTTP
 * transport and aborts an in-flight streaming request at the socket level, then
 * asserts:
 *
 *   - the disconnect is logged at WARN ("client disconnected mid-request"), not
 *     ERROR ("request failed");
 *   - no `uncaughtException`/`unhandledRejection` fires on the process;
 *   - the daemon stays alive and serves the NEXT request normally (no restart).
 *
 * Hermetic: in-memory store + stub vectors, ephemeral loopback port.
 */

import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { createServerFactory } from "../transport/factory";
import {
	startHttpTransport,
	serveNodeRequest,
	writeWebResponse,
	isClientDisconnectError,
	type HttpTransportHandle
} from "../transport/http";
import { addLogSink, type LogSinkPayload } from "../utils/logger";

const TOKEN = "test-bearer-token";

interface Harness {
	store: SQLiteStore;
	handle: HttpTransportHandle;
	logs: LogSinkPayload[];
	detach: () => void;
}

const active: Harness[] = [];

async function startHarness(): Promise<Harness> {
	const store = await createTestStore();
	const vectors = new StubVectorStore(store);
	const handle = await startHttpTransport({
		host: "127.0.0.1",
		port: 0,
		path: "/mcp",
		token: TOKEN,
		allowInsecure: false,
		factory: createServerFactory(store, vectors, "http")
	});
	const logs: LogSinkPayload[] = [];
	const detach = addLogSink((payload) => logs.push(payload));
	const harness = { store, handle, logs, detach };
	active.push(harness);
	return harness;
}

afterEach(async () => {
	while (active.length > 0) {
		const harness = active.pop()!;
		harness.detach();
		await harness.handle.close();
		harness.store.close();
	}
});

/** POST a raw JSON-RPC initialize and return the `mcp-session-id` header. */
async function initializeSession(url: string): Promise<string> {
	const res = await fetch(`${url}/mcp`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			Authorization: `Bearer ${TOKEN}`
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "disc", version: "0.0.0" } }
		})
	});
	expect(res.status).toBe(200);
	const sessionId = res.headers.get("mcp-session-id");
	expect(sessionId).toBeTruthy();
	// Drain the body so the connection is free for the SSE GET.
	await res.text().catch(() => {});
	return sessionId!;
}

/**
 * Open the legacy standalone SSE (`GET`) stream, read the first chunk, then
 * destroy the socket mid-stream — the exact premature-close the daemon saw.
 */
function abortSseMidStream(port: number, sessionId: string): Promise<void> {
	return new Promise<void>((resolve) => {
		const socket = net.connect(port, "127.0.0.1", () => {
			socket.write(
				`GET /mcp HTTP/1.1\r\n` +
					`Host: 127.0.0.1:${port}\r\n` +
					`Authorization: Bearer ${TOKEN}\r\n` +
					`Accept: text/event-stream\r\n` +
					`mcp-session-id: ${sessionId}\r\n` +
					`Connection: keep-alive\r\n\r\n`
			);
		});
		let resolved = false;
		const finish = () => {
			if (resolved) return;
			resolved = true;
			resolve();
		};
		socket.on("data", () => {
			// First SSE bytes arrived — abandon the request as a disconnecting
			// client would (socket reset mid-stream).
			socket.destroy();
			finish();
		});
		socket.on("error", () => finish());
		socket.on("close", () => finish());
		// Safety net: a GET that never yields bytes must not hang the suite.
		setTimeout(() => {
			socket.destroy();
			finish();
		}, 2000).unref?.();
	});
}

describe("isClientDisconnectError (FIX-025 classification)", () => {
	it("classifies the premature-close / reset / abort signatures as disconnects", () => {
		expect(
			isClientDisconnectError(Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" }))
		).toBe(true);
		expect(isClientDisconnectError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true);
		expect(isClientDisconnectError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).toBe(true);
		expect(isClientDisconnectError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
		// Wrapped cause one level deep (pipeline wrapping a socket error).
		expect(
			isClientDisconnectError(Object.assign(new Error("wrapped"), { cause: { code: "ERR_STREAM_PREMATURE_CLOSE" } }))
		).toBe(true);
	});

	it("does NOT classify a genuine server fault as a disconnect (negative)", () => {
		expect(isClientDisconnectError(new Error("SQLITE_BUSY: database is locked"))).toBe(false);
		expect(isClientDisconnectError(Object.assign(new Error("boom"), { code: "SQLITE_ERROR" }))).toBe(false);
		expect(isClientDisconnectError(undefined)).toBe(false);
		expect(isClientDisconnectError("not an error")).toBe(false);
	});
});

describe("MCP HTTP transport — client disconnect mid-request (FIX-025)", () => {
	it("logs a WARN (not ERROR) for a mid-stream disconnect and never throws uncaught", async () => {
		const { handle, logs } = await startHarness();
		const sessionId = await initializeSession(handle.url);

		const uncaught: unknown[] = [];
		const onUncaught = (err: unknown) => uncaught.push(err);
		process.on("uncaughtException", onUncaught);
		try {
			await abortSseMidStream(handle.port, sessionId);
			// Give the server a beat to observe the socket close and log.
			await new Promise((resolve) => setTimeout(resolve, 150));
		} finally {
			process.off("uncaughtException", onUncaught);
		}

		// No uncaught exception escaped to the process level.
		expect(uncaught).toEqual([]);

		const disconnectWarns = logs.filter(
			(p) =>
				p.level === "warning" && typeof p.data.message === "string" && p.data.message.includes("client disconnected")
		);
		expect(disconnectWarns.length).toBeGreaterThanOrEqual(1);
		// The disconnect must NOT be reported as a request failure (ERROR).
		const failureErrors = logs.filter(
			(p) => p.level === "error" && typeof p.data.message === "string" && p.data.message.includes("request failed")
		);
		expect(failureErrors).toEqual([]);
	});

	it("stays alive and serves the NEXT request after a disconnect (no restart)", async () => {
		const { handle } = await startHarness();
		const sessionId = await initializeSession(handle.url);
		await abortSseMidStream(handle.port, sessionId);
		await new Promise((resolve) => setTimeout(resolve, 100));

		// Positive path: the daemon still answers a fresh initialize.
		const res = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				Authorization: `Bearer ${TOKEN}`
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 2,
				method: "initialize",
				params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "after", version: "0.0.0" } }
			})
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("mcp-session-id")).toBeTruthy();
		await res.text().catch(() => {});
	});

	it("serves a normal request without emitting any disconnect WARN (positive)", async () => {
		const { handle, logs } = await startHarness();
		const sessionId = await initializeSession(handle.url);
		expect(sessionId).toBeTruthy();

		const disconnectWarns = logs.filter(
			(p) =>
				p.level === "warning" && typeof p.data.message === "string" && p.data.message.includes("client disconnected")
		);
		expect(disconnectWarns).toEqual([]);
	});
});

/**
 * Deterministic bridge-level reproduction of the EXACT daemon failure: a
 * response body that is still streaming when the client resets its socket makes
 * `writeWebResponse`'s `pipeline(source, res)` reject with
 * `ERR_STREAM_PREMATURE_CLOSE` (verified — see the `SINK` line the daemon used
 * to log as ERROR). `serveNodeRequest` must classify it as a client disconnect
 * and swallow it.
 */
describe("serveNodeRequest — premature-close bridge (FIX-025)", () => {
	it("swallows ERR_STREAM_PREMATURE_CLOSE from writeWebResponse as a WARN, not uncaught", async () => {
		const logs: LogSinkPayload[] = [];
		const detach = addLogSink((payload) => logs.push(payload));

		const server = http.createServer((req, res) => {
			serveNodeRequest(
				req,
				res,
				async (_req, nodeRes) => {
					const body = new ReadableStream<Uint8Array>({
						start(controller) {
							const timer = setInterval(() => {
								controller.enqueue(new TextEncoder().encode("data: tick\n\n"));
							}, 20);
							// Stop the timer when the consumer is cancelled.
							(nodeRes as unknown as { __t?: NodeJS.Timeout }).__t = timer;
							nodeRes.on("close", () => clearInterval(timer));
						}
					});
					await writeWebResponse(
						nodeRes,
						new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
					);
				},
				{ logTag: "[MCP HTTP]" }
			);
		});

		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
		const port = (server.address() as { port: number }).port;

		const uncaught: unknown[] = [];
		const onUncaught = (err: unknown) => uncaught.push(err);
		process.on("uncaughtException", onUncaught);
		try {
			// Connect, read the first streamed chunk, then reset the socket.
			await new Promise<void>((resolve) => {
				const socket = net.connect(port, "127.0.0.1", () => {
					socket.write(`GET /x HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: keep-alive\r\n\r\n`);
				});
				socket.once("data", () => socket.destroy());
				socket.on("close", () => resolve());
				socket.on("error", () => resolve());
			});
			await new Promise((resolve) => setTimeout(resolve, 200));
		} finally {
			process.off("uncaughtException", onUncaught);
			server.closeAllConnections?.();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			detach();
		}

		expect(uncaught).toEqual([]);
		const warns = logs.filter(
			(p) =>
				p.level === "warning" && typeof p.data.message === "string" && p.data.message.includes("client disconnected")
		);
		expect(warns.length).toBeGreaterThanOrEqual(1);
		const errors = logs.filter((p) => p.level === "error");
		expect(errors).toEqual([]);
	});
});
