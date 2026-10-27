/**
 * TASK-423 — Streamable HTTP multi-session isolation (integration).
 *
 * ONE HTTP daemon serves MANY MCP clients. Two properties must hold:
 *   1. each served session gets its OWN SessionContext (no cross-session state
 *      can bleed between concurrent clients); and
 *   2. a client's MCP roots scope its writes to that client's project, while a
 *      roots-less client fails LOUD instead of silently writing to the daemon
 *      working directory (TASK-420).
 *
 * E2E vs unit-level split:
 *   - E2E (real HTTP transport + real SDK clients):
 *       a. two concurrent roots-advertising sessions resolve DIFFERENT
 *          (owner, repo) from their distinct roots and their scope-less writes
 *          land in their own project with no cross-leakage (DEBT-423 fixed:
 *          roots now flow end-to-end — see below);
 *       b. a roots-less session's write is refused (`isError`) with the
 *          TASK-420 message and leaks nothing into the daemon CWD scope;
 *       c. two explicitly-scoped sessions share the ONE store without any
 *          cross-scope leakage (memories AND tasks).
 *   - Unit-level: the root → (owner, repo) derivation via the real
 *     `applySessionRoots` + `normalizeToolArguments`, plus the write fail-loud
 *     guard — the exact boundary the E2E tests exercise over the wire.
 *
 * DEBT-423 (fixed): `transport/http.ts` previously let `createMcpHandler`
 * default to `legacy: "stateless"`, so every 2025-era POST — the era OpenCode
 * and most current MCP clients speak — was served by a THROWAWAY
 * `McpServer` + stateless transport. The per-session `oninitialized` hook
 * (`refreshSessionRoots` → `applySessionRoots`, TASK-418) fired on that
 * discarded instance, so MCP roots never reached later tool calls. The
 * transport now routes legacy traffic via `isLegacyRequest` to a PER-SESSION
 * stateful `WebStandardStreamableHTTPServerTransport` keyed by
 * `Mcp-Session-Id`, so `oninitialized` fires once on the REAL session and the
 * roots stick. The E2E roots-scoped write below is therefore asserted directly.
 *
 * Hermetic: `createTestStore` + `StubVectorStore` (no ONNX, no network), an
 * ephemeral loopback port, and synthetic `/tmp` roots that need no on-disk
 * state — owner falls back to the parent-dir name deterministically there
 * because /tmp has no `.git` remote.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { createServerFactory } from "../transport/factory";
import { startHttpTransport, type HttpTransportHandle } from "../transport/http";
import * as sessionModule from "../session";
import { applySessionRoots, createSessionContext, type SessionContext } from "../session";
import { normalizeToolArguments } from "../utils/normalize-args";
import { inferOwnerFromGitRemote } from "../utils/owner";

// Synthetic absolute roots — no disk state required. Single-root inference gives
// repo = basename(root) and owner = parent-dir name (no .git remote under /tmp),
// so the expected scopes are fully deterministic.
const ALICE_ROOT = "/tmp/task423-alice/proj-a";
const BOB_ROOT = "/tmp/task423-bob/proj-b";
const ALICE = { owner: "task423-alice", repo: "proj-a" };
const BOB = { owner: "task423-bob", repo: "proj-b" };

const ALICE_TITLE = "Proj A secret";
const ALICE_CONTENT = "Isolation marker written from project A session.";
const BOB_TITLE = "Proj B secret";
const BOB_CONTENT = "Isolation marker written from project B session.";
const ALICE_ROOT_TITLE = "Proj A roots-scoped marker";
const BOB_ROOT_TITLE = "Proj B roots-scoped marker";
const ALICE_TASK_TITLE = "Proj A task marker";
const BOB_TASK_TITLE = "Proj B task marker";
const ROOTLESS_TITLE = "Rootless leak marker";

/** Build a `file://` URI from an already-absolute path (paths here are absolute). */
function fileUri(absPath: string): string {
	return `file://${absPath}`;
}

/**
 * The single shared daemon for the whole file: one in-memory store + one stub
 * vector store + one ephemeral HTTP transport, wired through the PRODUCTION
 * `createServerFactory` (never reimplemented here).
 */
let store: SQLiteStore;
let handle: HttpTransportHandle;
const clients: Client[] = [];

/**
 * Every SessionContext the instrumented factory builds. Captured by spying on
 * `createSessionContext` (the real factory function is still invoked) — the
 * same technique as transport.factory.test.ts.
 */
const capturedContexts: SessionContext[] = [];

/**
 * Connect a client over real Streamable HTTP. When `rootPath` is given the
 * client advertises the roots capability and answers the server's `roots/list`
 * request with that single synthetic root; otherwise it is a roots-less client.
 *
 * The `roots/list` handler MUST be registered BEFORE `connect()`: the factory
 * requests roots immediately after the initialize handshake, so a handler
 * registered later could miss the server's request.
 */
async function connectClient(name: string, rootPath?: string): Promise<Client> {
	const client = rootPath
		? new Client({ name, version: "1.0.0" }, { capabilities: { roots: { listChanged: true } } })
		: new Client({ name, version: "1.0.0" });
	if (rootPath) {
		client.setRequestHandler("roots/list", async () => ({
			roots: [{ uri: fileUri(rootPath), name: "workspace" }]
		}));
	}
	await client.connect(new StreamableHTTPClientTransport(new URL(`${handle.url}/mcp`)));
	clients.push(client);
	return client;
}

describe("TASK-423 — HTTP multi-session project isolation", () => {
	beforeAll(async () => {
		store = await createTestStore();
		const vectors = new StubVectorStore(store);

		// Instrument the factory: delegate to the real createSessionContext but
		// record every context the daemon builds for the shared store.
		const realCreateSessionContext = sessionModule.createSessionContext;
		vi.spyOn(sessionModule, "createSessionContext").mockImplementation((transport?: "stdio" | "http") => {
			const ctx = realCreateSessionContext(transport);
			capturedContexts.push(ctx);
			return ctx;
		});

		handle = await startHttpTransport({
			host: "127.0.0.1",
			port: 0,
			path: "/mcp",
			token: undefined,
			allowInsecure: true,
			factory: createServerFactory(store, vectors, "http")
		});
	});

	afterAll(async () => {
		vi.restoreAllMocks();
		await Promise.all(clients.map((client) => client.close().catch(() => {})));
		await handle?.close();
		store?.close();
	});

	describe("E2E: one daemon serves concurrent sessions as distinct contexts", () => {
		it("serves two concurrent roots-advertising clients as DISTINCT SessionContexts", async () => {
			capturedContexts.length = 0;

			// Connect both roots-advertising clients concurrently — one daemon,
			// two independent sessions, two independent roots.
			const [clientA, clientB] = await Promise.all([
				connectClient("task423-a", ALICE_ROOT),
				connectClient("task423-b", BOB_ROOT)
			]);

			// Both sessions complete the full initialize + tools/list handshake.
			const [toolsA, toolsB] = await Promise.all([clientA.listTools(), clientB.listTools()]);
			expect(toolsA.tools.length).toBeGreaterThan(0);
			expect(toolsB.tools.length).toBeGreaterThan(0);

			// The daemon built each served unit from its own SessionContext: every
			// captured context is a distinct object with its own non-empty,
			// unique opaque sessionId — no per-connection state can be shared.
			expect(capturedContexts.length).toBeGreaterThanOrEqual(2);
			for (const ctx of capturedContexts) {
				expect(ctx.sessionId).toBeTruthy();
			}
			const sessionIds = capturedContexts.map((ctx) => ctx.sessionId);
			expect(new Set(sessionIds).size).toBe(sessionIds.length);
			expect(capturedContexts[0]).not.toBe(capturedContexts[1]);
		});

		it("scopes each roots-advertising session's write to its OWN project (no cross-leak)", async () => {
			// DEBT-423 fixed: roots declared by each client now flow over HTTP into
			// the retained per-session context, so a scope-LESS write (no explicit
			// owner/repo) is auto-scoped from that session's own MCP roots — and
			// must NOT touch the other session's project.
			const [clientA, clientB] = await Promise.all([
				connectClient("task423-roots-a", ALICE_ROOT),
				connectClient("task423-roots-b", BOB_ROOT)
			]);
			await Promise.all([clientA.listTools(), clientB.listTools()]);

			const [writeA, writeB] = await Promise.all([
				clientA.callTool({
					name: "memory-write",
					arguments: {
						type: "code_fact",
						title: ALICE_ROOT_TITLE,
						content: "Written with no explicit scope; scoped from session A's MCP roots.",
						importance: 3
					}
				}),
				clientB.callTool({
					name: "memory-write",
					arguments: {
						type: "code_fact",
						title: BOB_ROOT_TITLE,
						content: "Written with no explicit scope; scoped from session B's MCP roots.",
						importance: 3
					}
				})
			]);
			// Scope-less writes succeed because roots supplied the scope — the
			// TASK-420 fail-loud guard must NOT trip here.
			expect(writeA.isError).toBeFalsy();
			expect(writeB.isError).toBeFalsy();

			// Each roots-derived (owner, repo) holds exactly its own marker and
			// none of the other session's — the crux of DEBT-423.
			const aliceTitles = store.memories.getRecentMemories(ALICE.owner, ALICE.repo, 50).map((row) => row.title);
			const bobTitles = store.memories.getRecentMemories(BOB.owner, BOB.repo, 50).map((row) => row.title);

			expect(aliceTitles).toContain(ALICE_ROOT_TITLE);
			expect(aliceTitles).not.toContain(BOB_ROOT_TITLE);
			expect(bobTitles).toContain(BOB_ROOT_TITLE);
			expect(bobTitles).not.toContain(ALICE_ROOT_TITLE);
		});
	});

	describe("E2E: a roots-less session fails loud instead of writing to the daemon CWD", () => {
		it("refuses the write and leaks nothing into the daemon scope", async () => {
			const daemonRepo = path.basename(process.cwd());
			// Owner resolution mirrors the production CWD fallback chain: git
			// remote owner when present, else "" (which makes getRecentMemories
			// search every owner within the daemon repo).
			const daemonOwner = inferOwnerFromGitRemote(process.cwd()) ?? "";

			const rootless = await connectClient("task423-rootless");

			const result = await rootless.callTool({
				name: "memory-write",
				arguments: {
					type: "code_fact",
					title: ROOTLESS_TITLE,
					content: "This write must be refused because its scope is undeterminable.",
					importance: 3
				}
			});

			// TASK-420 fail-loud — NOT a silent daemon-CWD write.
			expect(result.isError).toBe(true);
			expect(JSON.stringify(result)).toMatch(/could not be determined/);

			// Nothing leaked to the daemon's CWD-derived scope.
			const daemonRows = store.memories.getRecentMemories(daemonOwner, daemonRepo, 50);
			expect(daemonRows.map((row) => row.title)).not.toContain(ROOTLESS_TITLE);
		});
	});

	describe("E2E: two explicitly-scoped sessions share ONE store without leakage", () => {
		it("keeps each session's memories and tasks scoped to its own (owner, repo)", async () => {
			// Scope supplied EXPLICITLY per call (independent of the roots path
			// covered above): this exercises the real dispatch path and the
			// shared store while proving cross-session isolation.
			const [clientA, clientB] = await Promise.all([connectClient("task423-seed-a"), connectClient("task423-seed-b")]);

			const [memA, memB] = await Promise.all([
				clientA.callTool({
					name: "memory-write",
					arguments: {
						type: "code_fact",
						title: ALICE_TITLE,
						content: ALICE_CONTENT,
						importance: 3,
						owner: ALICE.owner,
						repo: ALICE.repo
					}
				}),
				clientB.callTool({
					name: "memory-write",
					arguments: {
						type: "code_fact",
						title: BOB_TITLE,
						content: BOB_CONTENT,
						importance: 3,
						owner: BOB.owner,
						repo: BOB.repo
					}
				})
			]);
			expect(memA.isError).toBeFalsy();
			expect(memB.isError).toBeFalsy();

			// ── Memories: each scope holds exactly its own marker ──
			const aliceTitles = store.memories.getRecentMemories(ALICE.owner, ALICE.repo, 10).map((row) => row.title);
			const bobTitles = store.memories.getRecentMemories(BOB.owner, BOB.repo, 10).map((row) => row.title);

			expect(aliceTitles).toContain(ALICE_TITLE);
			expect(aliceTitles).not.toContain(BOB_TITLE);
			expect(bobTitles).toContain(BOB_TITLE);
			expect(bobTitles).not.toContain(ALICE_TITLE);

			// ── Tasks: the same shared-store isolation holds for a second entity ──
			const [taskA, taskB] = await Promise.all([
				clientA.callTool({
					name: "task-write",
					arguments: {
						owner: ALICE.owner,
						repo: ALICE.repo,
						phase: "backlog",
						title: ALICE_TASK_TITLE,
						description: "Scoped to project A only."
					}
				}),
				clientB.callTool({
					name: "task-write",
					arguments: {
						owner: BOB.owner,
						repo: BOB.repo,
						phase: "backlog",
						title: BOB_TASK_TITLE,
						description: "Scoped to project B only."
					}
				})
			]);
			expect(taskA.isError).toBeFalsy();
			expect(taskB.isError).toBeFalsy();

			const aliceTasks = store.tasks.getTasksByRepo(ALICE.owner, ALICE.repo, undefined, 50).map((task) => task.title);
			const bobTasks = store.tasks.getTasksByRepo(BOB.owner, BOB.repo, undefined, 50).map((task) => task.title);

			expect(aliceTasks).toContain(ALICE_TASK_TITLE);
			expect(aliceTasks).not.toContain(BOB_TASK_TITLE);
			expect(bobTasks).toContain(BOB_TASK_TITLE);
			expect(bobTasks).not.toContain(ALICE_TASK_TITLE);
		});
	});

	describe("unit: root→scope derivation + write fail-loud (boundary the E2E tests cover)", () => {
		it("derives distinct (owner, repo) for two synthetic roots", () => {
			const sessionA = createSessionContext();
			applySessionRoots(sessionA, [{ uri: fileUri(ALICE_ROOT) }]);
			const sessionB = createSessionContext();
			applySessionRoots(sessionB, [{ uri: fileUri(BOB_ROOT) }]);

			const argsA = normalizeToolArguments({ content: "x" }, sessionA, { toolName: "memory-write" });
			const argsB = normalizeToolArguments({ content: "x" }, sessionB, { toolName: "memory-write" });

			expect({ owner: argsA.owner, repo: argsA.repo }).toEqual(ALICE);
			expect({ owner: argsB.owner, repo: argsB.repo }).toEqual(BOB);
			expect([argsA.owner, argsA.repo]).not.toEqual([argsB.owner, argsB.repo]);
		});

		it("throws for a rootless write with no explicit owner/repo (TASK-420)", () => {
			// The fail-loud guard is HTTP-only (the daemon CWD is not the
			// caller's project); a stdio session stays permissive.
			const rootless = createSessionContext("http");
			expect(() => normalizeToolArguments({ content: "x" }, rootless, { toolName: "memory-write" })).toThrow(
				/could not be determined/
			);
		});
	});

	describe("unit: legacy POSTs are routed to a STATEFUL session (DEBT-423)", () => {
		/**
		 * Raw-wire proof that a 2025-era exchange is served by the stateful legacy
		 * transport, not a throwaway stateless instance: the `initialize` POST
		 * returns an `Mcp-Session-Id` which is then REUSED, and a subsequent
		 * `tools/list` on that id succeeds — while the SAME request without the id
		 * is RECOVERED statelessly (FIX-110-C) — a stateless fallback answers it
		 * instead of returning "Mcp-Session-Id header is required". `isLegacyRequest`
		 * routes this traffic
		 * (2025-06-18 initialize) to the stateful path, keeping the initialized
		 * server — and the roots it applied — alive across the session's requests.
		 */
		it("retains the initialized session across requests keyed by Mcp-Session-Id", async () => {
			const endpoint = `${handle.url}/mcp`;
			const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

			// 1. initialize → a session id must be issued and retained.
			const init = await fetch(endpoint, {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "task423-legacy-raw", version: "1.0.0" }
					}
				})
			});
			expect(init.status).toBe(200);
			const sessionId = init.headers.get("mcp-session-id");
			expect(sessionId).toBeTruthy();
			await init.text();

			// 2. notifications/initialized on the SAME session → 202.
			const notif = await fetch(endpoint, {
				method: "POST",
				headers: { ...jsonHeaders, "mcp-session-id": sessionId! },
				body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
			});
			expect(notif.status).toBe(202);
			await notif.text();

			// 3. tools/list on the SAME session → the retained, initialized server
			// answers (a throwaway stateless instance could not have kept the id).
			const list = await fetch(endpoint, {
				method: "POST",
				headers: { ...jsonHeaders, "mcp-session-id": sessionId! },
				body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
			});
			expect(list.status).toBe(200);
			expect(list.headers.get("mcp-session-id")).toBe(sessionId);
			expect(await list.text()).toContain('"tools"');

			// 4. The same call WITHOUT the session id is RECOVERED (FIX-110-C): a
			// fresh stateless transport serves it instead of a 400, so a client
			// that dropped the header self-heals with no stall.
			const noSession = await fetch(endpoint, {
				method: "POST",
				headers: jsonHeaders,
				body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
			});
			expect(noSession.status).toBe(200);
			const noSessionBody = await noSession.text();
			expect(noSessionBody).toContain('"tools"');
			expect(noSessionBody).not.toContain("Server not initialized");
			expect(noSessionBody).not.toContain("Mcp-Session-Id header is required");

			// 5. An UNKNOWN session id is likewise RECOVERED statelessly (200) —
			// never the "Server not initialized" dead end, and never a 404 that
			// would stall a client which does not re-initialize (FIX-110-C).
			const unknown = await fetch(endpoint, {
				method: "POST",
				headers: { ...jsonHeaders, "mcp-session-id": "00000000-0000-4000-8000-000000000000" },
				body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} })
			});
			expect(unknown.status).toBe(200);
			const unknownBody = await unknown.text();
			expect(unknownBody).toContain('"tools"');
			expect(unknownBody).not.toContain("Session not found");
			expect(unknownBody).not.toContain("Server not initialized");
		});
	});
});
