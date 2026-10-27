// Feature: mcp-transport-dual-handler (DEBT-423)
//
// Unit tests for the shared dual-era handler `createDualHandler` extracted from
// `transport/http.ts`. The helper routes modern (2026-07-28) traffic to a strict
// `legacy: "reject"` handler and 2025-era traffic to a PER-SESSION stateful
// `WebStandardStreamableHTTPServerTransport` keyed by `Mcp-Session-Id`, so the
// initialize-time `oninitialized` hook (and the MCP roots it applies, TASK-418)
// survives into later tool calls.
//
// These tests drive the helper DIRECTLY over the web-standard `fetch` face —
// no HTTP listener, no jsdom. The SDK client is bridged in-process via its
// `fetch` option, so the same code path the standalone transport and the
// combined daemon server share is exercised here.
//
// Convention follows transport.factory.test.ts: pure TS, in-memory SQLite
// (`createTestStore`) + `StubVectorStore`.

import { describe, it, expect, afterEach } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { createServerFactory } from "../transport/factory";
import { createDualHandler, type DualHandler, type DualHandlerOptions } from "../transport/http";
import { MCP_HTTP_SESSION_IDLE_TTL_MS } from "../utils/constants";

const ENDPOINT = "http://localhost/mcp";
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

// Synthetic absolute root — no disk state required. Single-root inference gives
// repo = basename(root) and owner = parent-dir name (no .git remote under /tmp).
const ROOT = "/tmp/debt423-dual/proj-a";
const SCOPED = { owner: "debt423-dual", repo: "proj-a" };

const active: Array<{ store: SQLiteStore; handler: DualHandler }> = [];

/** Start a dual handler on a fresh in-memory store + stub vectors. */
async function startHarness(options?: DualHandlerOptions): Promise<{ store: SQLiteStore; handler: DualHandler }> {
	const store = await createTestStore();
	const vectors = new StubVectorStore(store);
	const handler = createDualHandler(createServerFactory(store, vectors, "http"), undefined, options);
	const harness = { store, handler };
	active.push(harness);
	return harness;
}

afterEach(async () => {
	while (active.length > 0) {
		const harness = active.pop()!;
		await harness.handler.close();
		harness.store.close();
	}
});

/** Bridge an SDK client onto the handler's web-standard `fetch` face in-process. */
function bridgedTransport(handler: DualHandler): StreamableHTTPClientTransport {
	return new StreamableHTTPClientTransport(new URL(ENDPOINT), {
		fetch: (url, init) => handler.fetch(new Request(url, init))
	});
}

/** Build a `file://` URI from an already-absolute path (paths here are absolute). */
function fileUri(absPath: string): string {
	return `file://${absPath}`;
}

describe("createDualHandler — legacy session retention (DEBT-423)", () => {
	/**
	 * Raw-wire proof that a 2025-era exchange is served by the stateful legacy
	 * transport, not a throwaway stateless instance: the `initialize` POST
	 * returns an `Mcp-Session-Id` which is then REUSED, and a subsequent
	 * `tools/list` on that id succeeds — while the SAME request without the id
	 * is refused with a clean "Mcp-Session-Id header is required" (a stateless
	 * fallback would have answered it).
	 */
	it("retains the initialized session across requests keyed by Mcp-Session-Id", async () => {
		const { handler } = await startHarness();

		// 1. initialize → a session id must be issued and retained.
		const init = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "debt423-dual-raw", version: "1.0.0" }
					}
				})
			})
		);
		expect(init.status).toBe(200);
		const sessionId = init.headers.get("mcp-session-id");
		expect(sessionId).toBeTruthy();
		await init.text();

		// 2. notifications/initialized on the SAME session → 202.
		const notif = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { ...JSON_HEADERS, "mcp-session-id": sessionId! },
				body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
			})
		);
		expect(notif.status).toBe(202);
		await notif.text();

		// 3. tools/list on the SAME session → the retained, initialized server
		// answers (a throwaway stateless instance could not have kept the id).
		const list = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { ...JSON_HEADERS, "mcp-session-id": sessionId! },
				body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
			})
		);
		expect(list.status).toBe(200);
		expect(list.headers.get("mcp-session-id")).toBe(sessionId);
		expect(await list.text()).toContain('"tools"');

		// 4. The same call WITHOUT the session id is now RECOVERED (FIX-110-C):
		// a fresh stateless transport serves it instead of a 400/404, so a client
		// that cached an evicted id self-heals without re-initializing. The
		// response must be a successful tools/list, never "Server not initialized".
		const noSession = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
			})
		);
		expect(noSession.status).toBe(200);
		const noSessionBody = await noSession.text();
		expect(noSessionBody).toContain('"tools"');
		expect(noSessionBody).not.toContain("Server not initialized");
		expect(noSessionBody).not.toContain("Mcp-Session-Id header is required");
	});
});

describe("createDualHandler — roots reach later tool calls (DEBT-423)", () => {
	/**
	 * A roots-advertising client's declared root must flow through the retained
	 * per-session context so a scope-LESS write is auto-scoped from it — the
	 * exact end-to-end property the standalone transport's integration test
	 * asserts, here driven directly against the shared helper.
	 */
	it("scopes a roots-advertising session's scope-less write to its own project", async () => {
		const { store, handler } = await startHarness();

		const client = new Client(
			{ name: "debt423-roots", version: "1.0.0" },
			{ capabilities: { roots: { listChanged: true } } }
		);
		client.setRequestHandler("roots/list", async () => ({
			roots: [{ uri: fileUri(ROOT), name: "workspace" }]
		}));
		await client.connect(bridgedTransport(handler));
		try {
			await client.listTools();
			const write = await client.callTool({
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: "Dual handler roots marker",
					content: "Written with no explicit scope; scoped from the session's MCP roots.",
					importance: 3
				}
			});
			// Roots supplied the scope — the TASK-420 fail-loud guard must not trip.
			expect(write.isError).toBeFalsy();

			const titles = store.memories.getRecentMemories(SCOPED.owner, SCOPED.repo, 50).map((row) => row.title);
			expect(titles).toContain("Dual handler roots marker");
		} finally {
			await client.close();
		}
	});

	/**
	 * A roots-less client must fail LOUD instead of silently writing to the
	 * daemon working directory (TASK-420) — the same guard the standalone
	 * transport's integration test exercises.
	 */
	it("refuses a roots-less scope-less write instead of writing to the daemon CWD", async () => {
		const { handler } = await startHarness();

		const client = new Client({ name: "debt423-rootless", version: "1.0.0" });
		await client.connect(bridgedTransport(handler));
		try {
			const result = await client.callTool({
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: "Dual handler rootless marker",
					content: "This write must be refused because its scope is undeterminable.",
					importance: 3
				}
			});
			expect(result.isError).toBe(true);
			expect(JSON.stringify(result)).toMatch(/could not be determined/);
		} finally {
			await client.close();
		}
	});
});

/**
 * Open a legacy session via a raw 2025-era `initialize` POST and return its
 * `Mcp-Session-Id`. Reuses the same wire shape as the retention test above.
 */
async function openLegacySession(handler: DualHandler): Promise<string> {
	const init = await handler.fetch(
		new Request(ENDPOINT, {
			method: "POST",
			headers: JSON_HEADERS,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "idle-sweep", version: "1.0.0" }
				}
			})
		})
	);
	expect(init.status).toBe(200);
	const sessionId = init.headers.get("mcp-session-id");
	expect(sessionId).toBeTruthy();
	await init.text();
	return sessionId!;
}

/** A `tools/list` POST on a given legacy session id. */
function listOnSession(handler: DualHandler, sessionId: string): Promise<Response> {
	return handler.fetch(
		new Request(ENDPOINT, {
			method: "POST",
			headers: { ...JSON_HEADERS, "mcp-session-id": sessionId },
			body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
		})
	);
}

describe("createDualHandler — idle legacy session eviction", () => {
	/**
	 * The SDK client's normal `close()` never sends a `DELETE`, so an abandoned
	 * legacy session would pin its server + transport forever without an idle
	 * sweep. Driving the sweep past the TTL must evict the session. With
	 * stateless recovery ON (default, FIX-110-C) a subsequent request on that
	 * evicted id is RECOVERED by a fresh stateless transport (200) rather than
	 * stalling the client — the eviction no longer produces a dead end.
	 */
	it("evicts a session idle past the TTL and a later request is recovered statelessly", async () => {
		const { handler } = await startHarness();

		const sessionId = await openLegacySession(handler);
		// The session is live right after initialize.
		expect((await listOnSession(handler, sessionId)).status).toBe(200);

		// Drive the sweep just past the TTL using an injected clock.
		handler.sweepIdleLegacySessions(Date.now() + MCP_HTTP_SESSION_IDLE_TTL_MS + 1);

		// The id is gone, but the request is served by a fresh stateless
		// transport (FIX-110-C) — NOT a 404 dead end, and never the
		// un-initialized server's "Server not initialized".
		const afterEviction = await listOnSession(handler, sessionId);
		expect(afterEviction.status).toBe(200);
		const afterEvictionBody = await afterEviction.text();
		expect(afterEvictionBody).toContain('"tools"');
		expect(afterEvictionBody).not.toContain("Server not initialized");
		expect(afterEvictionBody).not.toContain("Session not found");
	});

	it("keeps a recently-used session alive", async () => {
		const { handler } = await startHarness();

		const sessionId = await openLegacySession(handler);
		// Touch the session so `lastSeen` is current, then sweep with a `now`
		// that is within the TTL of that touch.
		expect((await listOnSession(handler, sessionId)).status).toBe(200);
		handler.sweepIdleLegacySessions(Date.now() + MCP_HTTP_SESSION_IDLE_TTL_MS - 1_000);

		// Still retained — the same initialized server answers.
		expect((await listOnSession(handler, sessionId)).status).toBe(200);
	});
});

describe("createDualHandler — SSE stream lifetime + sweep exemption (FIX-028)", () => {
	/**
	 * A live standalone SSE (`GET`) stream keeps its session pinned even when no
	 * new request arrives. Pre-FIX-028 the 30-min idle sweep closed the still-open
	 * stream (`Session not found` 404 storm); the session must now be EXEMPT from
	 * eviction while its stream is open.
	 */
	it("does NOT sweep a session whose standalone SSE stream is open", async () => {
		const { handler } = await startHarness();
		const sessionId = await openLegacySession(handler);

		// Open the standalone SSE GET stream and keep it open (do not drain it).
		const sse = await handler.fetch(
			new Request(ENDPOINT, {
				method: "GET",
				headers: { Accept: "text/event-stream", "mcp-session-id": sessionId }
			})
		);
		expect(sse.status).toBe(200);
		expect(sse.headers.get("content-type")).toContain("text/event-stream");

		// Sweep FAR past the idle TTL: the open stream must exempt the session
		// from eviction, so a subsequent request still finds the retained server.
		handler.sweepIdleLegacySessions(Date.now() + MCP_HTTP_SESSION_IDLE_TTL_MS * 10);

		const list = await listOnSession(handler, sessionId);
		expect(list.status).toBe(200);
		expect(await list.text()).toContain('"tools"');

		// Clean up the stream so afterEach teardown is prompt.
		await sse.body?.cancel().catch(() => {});
	});

	/**
	 * The exemption is released once the stream closes: an idle session is then
	 * swept normally and a later request is recovered statelessly (FIX-110-C) —
	 * the negative case proving the exemption is scoped to the open stream, not
	 * permanent. Here recovery is DISABLED to assert the raw sweep/404 contract.
	 */
	it("sweeps the session again once its SSE stream is closed", async () => {
		const { handler } = await startHarness({ statelessRecovery: false });
		const sessionId = await openLegacySession(handler);

		const sse = await handler.fetch(
			new Request(ENDPOINT, {
				method: "GET",
				headers: { Accept: "text/event-stream", "mcp-session-id": sessionId }
			})
		);
		expect(sse.status).toBe(200);

		// Closing the stream releases the exemption.
		await sse.body?.cancel();

		// Now the sweep past the TTL evicts the session.
		handler.sweepIdleLegacySessions(Date.now() + MCP_HTTP_SESSION_IDLE_TTL_MS + 1);

		const after = await listOnSession(handler, sessionId);
		expect(after.status).toBe(404);
		expect(await after.text()).toContain("Session not found");
	});
});

describe("createDualHandler — stateless session recovery (FIX-110-C)", () => {
	/**
	 * A NON-initialize request carrying an UNKNOWN session id is served by a
	 * fresh stateless transport (200) instead of the historical 404 — so a
	 * remote client that cached an evicted id self-heals with no re-initialize
	 * and no >60s stall.
	 */
	it("serves an unknown session id with a stateless recovery (200, not 404)", async () => {
		const { handler } = await startHarness();

		const response = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { ...JSON_HEADERS, "mcp-session-id": "evicted-session-id" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
			})
		);

		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('"tools"');
		expect(body).not.toContain("Session not found");
		expect(body).not.toContain("Server not initialized");
	});

	/**
	 * A NON-initialize request with an ABSENT session id is likewise recovered
	 * (200) rather than 400 — the same stall-free behavior for a client that
	 * dropped the header.
	 */
	it("serves an absent session id with a stateless recovery (200, not 400)", async () => {
		const { handler } = await startHarness();

		const response = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
			})
		);

		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('"tools"');
		expect(body).not.toContain("Mcp-Session-Id header is required");
	});

	/**
	 * Fallback path: with recovery DISABLED the strict 404/-32001 body is
	 * returned again, so a client whose transport re-initializes on 404 still
	 * recovers (the escape hatch).
	 */
	it("returns the strict 404 when stateless recovery is disabled", async () => {
		const { handler } = await startHarness({ statelessRecovery: false });

		const response = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { ...JSON_HEADERS, "mcp-session-id": "evicted-session-id" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
			})
		);

		expect(response.status).toBe(404);
		expect(await response.text()).toContain("Session not found");
	});

	/** Fallback path: absent id + recovery disabled → the strict 400 body. */
	it("returns the strict 400 when stateless recovery is disabled and no id is sent", async () => {
		const { handler } = await startHarness({ statelessRecovery: false });

		const response = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
			})
		);

		expect(response.status).toBe(400);
		expect(await response.text()).toContain("Mcp-Session-Id header is required");
	});
});

describe("createDualHandler — session-rejection reporting (PERF-009)", () => {
	/**
	 * An unknown session id must still report the offending id + recovery via
	 * `onerror` so the daemon log explains the wedge. Recovery is DISABLED here
	 * to assert the raw fallback contract (404 body) alongside the report; with
	 * recovery ON the same report fires but the response is a 200 (FIX-110-C).
	 */
	it("reports the unknown session id + re-initialize hint on the 404 path", async () => {
		const store = await createTestStore();
		const vectors = new StubVectorStore(store);
		const reported: Error[] = [];
		const handler = createDualHandler(createServerFactory(store, vectors, "http"), (error) => reported.push(error), {
			statelessRecovery: false
		});
		active.push({ store, handler });

		const response = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { ...JSON_HEADERS, "mcp-session-id": "evicted-session-id" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
			})
		);

		// The response body stays the canonical JSON-RPC session error.
		expect(response.status).toBe(404);
		expect(await response.text()).toContain("Session not found");

		// The report carries the id + recovery, so the log is actionable.
		expect(reported).toHaveLength(1);
		expect(reported[0].message).toContain("evicted-session-id");
		expect(reported[0].message).toMatch(/re-initialize/i);
	});

	it("reports the missing-header case with a re-initialize hint", async () => {
		const store = await createTestStore();
		const vectors = new StubVectorStore(store);
		const reported: Error[] = [];
		const handler = createDualHandler(createServerFactory(store, vectors, "http"), (error) => reported.push(error), {
			statelessRecovery: false
		});
		active.push({ store, handler });

		const response = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: JSON_HEADERS,
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
			})
		);

		expect(response.status).toBe(400);
		expect(await response.text()).toContain("Mcp-Session-Id header is required");
		expect(reported).toHaveLength(1);
		expect(reported[0].message).toContain("Mcp-Session-Id header is required");
	});

	/**
	 * With recovery ON, an unknown session id is still REPORTED (observability)
	 * even though the response is a successful 200 — so the daemon log explains
	 * every stateless recovery.
	 */
	it("still reports the unknown session id when stateless recovery serves it", async () => {
		const store = await createTestStore();
		const vectors = new StubVectorStore(store);
		const reported: Error[] = [];
		const handler = createDualHandler(createServerFactory(store, vectors, "http"), (error) => reported.push(error));
		active.push({ store, handler });

		const response = await handler.fetch(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { ...JSON_HEADERS, "mcp-session-id": "evicted-session-id" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
			})
		);

		expect(response.status).toBe(200);
		await response.text();
		expect(reported).toHaveLength(1);
		expect(reported[0].message).toContain("evicted-session-id");
	});
});
