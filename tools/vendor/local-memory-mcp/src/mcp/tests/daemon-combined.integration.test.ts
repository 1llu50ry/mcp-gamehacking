/**
 * Combined daemon server integration test (FEAT-DAEMON-001).
 *
 * Boots the real combined server (Express dashboard app + MCP Streamable HTTP
 * handler on ONE loopback port) against a mocked dashboard context singleton
 * backed by an in-memory store, then exercises BOTH faces over the wire:
 *
 *   - GET  /api/health            → dashboard route served by the same app
 *   - POST /mcp  (SDK client)     → initialize + tools/list round-trip, no auth
 *
 * Hermetic: the context module is mocked (in-memory SQLiteStore + stub
 * vectors), engines are disabled, and the port is ephemeral.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { CombinedServerHandle } from "../cli/combined-server";

// ── Mock the dashboard context BEFORE any route/server import ───────────────
// The combined server reuses this singleton (dynamic import) and every
// dashboard route resolves `db` from it (static import), so the mock must be
// registered first — mirroring dashboard/tests/controllers.shared.ts.
vi.mock("../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../storage/sqlite");
	const { RuntimeCapabilityRegistry } = await import("../runtime-capabilities");
	const db = new SQLiteStore(":memory:");
	const runtimeCapabilities = new RuntimeCapabilityRegistry();

	return {
		db,
		vectors: {
			upsert: vi.fn(),
			remove: vi.fn(),
			search: vi.fn().mockResolvedValue([])
		},
		mcpClient: {
			start: vi.fn(),
			stop: vi.fn(),
			isConnected: vi.fn(() => false),
			getPendingCount: vi.fn(() => 0)
		},
		embeddingWorker: {
			start: vi.fn(),
			stop: vi.fn(),
			getStats: vi.fn().mockReturnValue({ pending: 0, claimed: 0, done: 0 })
		},
		runtimeCapabilities,
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		startTime: Date.now()
	};
});

let handle: CombinedServerHandle;

beforeAll(async () => {
	const { startCombinedServer } = await import("../cli/combined-server");
	handle = await startCombinedServer({ host: "127.0.0.1", port: 0, enableEngines: false });
});

afterAll(async () => {
	await handle?.close();
});

describe("combined server — dashboard face", () => {
	it("serves the dashboard API on the same port as MCP", async () => {
		const res = await fetch(`${handle.url}/api/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data?: { type?: string } };
		expect(body.data?.type).toBe("health");
	});

	it("serves the dashboard API under /api on the combined port", async () => {
		const res = await fetch(`${handle.url}/api/stats`);
		expect(res.status).toBe(200);
	});
});

describe("combined server — MCP face", () => {
	it("completes an initialize + tools/list + tools/call round-trip over /mcp with no auth", async () => {
		const transport = new StreamableHTTPClientTransport(new URL(`${handle.url}/mcp`));
		const client = new Client({ name: "daemon-test-client", version: "1.0.0" });

		await client.connect(transport);
		try {
			const tools = await client.listTools();
			expect(Array.isArray(tools.tools)).toBe(true);
			expect(tools.tools.length).toBeGreaterThan(0);

			// PERF-006: the live failure was a `tools/call` on a session the daemon
			// no longer recognized. On a healthy session it must reach the tool.
			const call = await client.callTool({
				name: "memory-read",
				arguments: { owner: "perf006", repo: "daemon-handshake", query: "handshake" }
			});
			expect(call.isError).toBeFalsy();
			expect(Array.isArray(call.content)).toBe(true);
		} finally {
			await client.close();
		}
	});

	it("answers a raw initialize POST without a bearer token", async () => {
		const res = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "raw", version: "0.0.0" }
				}
			})
		});
		expect(res.status).toBe(200);
	});

	/**
	 * DEBT-423: the daemon is the PRIMARY deployment, so its 2025-era traffic
	 * must be served by a PER-SESSION stateful transport — not the SDK's
	 * throwaway stateless fallback. A raw `initialize` POST must issue an
	 * `Mcp-Session-Id` that is then REUSED; a `tools/list` on that id succeeds,
	 * while the same call WITHOUT the id is recovered statelessly (FIX-110-C)
	 * instead of the un-actionable "Server not initialized" dead end (PERF-006).
	 */
	it("retains a legacy (2025-era) session across requests keyed by Mcp-Session-Id", async () => {
		const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

		const init = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "daemon-legacy-raw", version: "1.0.0" }
				}
			})
		});
		expect(init.status).toBe(200);
		const sessionId = init.headers.get("mcp-session-id");
		expect(sessionId).toBeTruthy();
		await init.text();

		const notif = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: { ...jsonHeaders, "mcp-session-id": sessionId! },
			body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
		});
		expect(notif.status).toBe(202);
		await notif.text();

		const list = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: { ...jsonHeaders, "mcp-session-id": sessionId! },
			body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
		});
		expect(list.status).toBe(200);
		expect(list.headers.get("mcp-session-id")).toBe(sessionId);
		expect(await list.text()).toContain('"tools"');

		const noSession = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
		});
		// FIX-110-C: an absent session id is RECOVERED statelessly (200) rather
		// than refused, so a client that dropped the header never stalls.
		expect(noSession.status).toBe(200);
		const noSessionBody = await noSession.text();
		expect(noSessionBody).toContain('"tools"');
		expect(noSessionBody).not.toContain("Server not initialized");
		expect(noSessionBody).not.toContain("Mcp-Session-Id header is required");
	});

	/**
	 * PERF-006 + FIX-110-C: the live failure was a `tools/call` POSTed with a
	 * session id the daemon no longer recognized, which the daemon answered by
	 * minting a fresh un-initialized server and returning `Server not initialized`
	 * (-32000). The fix now serves such a request with a fresh STATELESS
	 * transport (FIX-110-C) — the client never stalls and never has to
	 * re-initialize. This drives the full handshake first
	 * (initialize → tools/list → tools/call) to prove the healthy path, then
	 * sends the stale id.
	 */
	it("completes initialize → tools/list → tools/call, then answers an unknown session id cleanly", async () => {
		const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

		const init = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: jsonHeaders,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "perf006-handshake", version: "1.0.0" }
				}
			})
		});
		expect(init.status).toBe(200);
		const sessionId = init.headers.get("mcp-session-id");
		expect(sessionId).toBeTruthy();
		await init.text();

		const sessionHeaders = { ...jsonHeaders, "mcp-session-id": sessionId! };

		await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: sessionHeaders,
			body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
		}).then((res) => res.text());

		const list = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: sessionHeaders,
			body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
		});
		expect(list.status).toBe(200);
		expect(await list.text()).toContain('"tools"');

		// tools/call on the SAME retained session must succeed.
		const call = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: sessionHeaders,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name: "memory-read",
					arguments: { owner: "perf006", repo: "daemon-handshake", query: "handshake" }
				}
			})
		});
		expect(call.status).toBe(200);
		const callBody = await call.text();
		// A tool-level failure is still a JSON-RPC `result` (with `isError:true`),
		// so asserting `result` alone would be a false green — require success.
		expect(callBody).toContain('"result"');
		expect(callBody).not.toContain('"isError":true');

		// A stale/unknown session id must be RECOVERED statelessly (FIX-110-C):
		// the daemon serves the tool call with a fresh stateless transport (200)
		// rather than returning 404/-32001, so a remote client that cached an
		// evicted id self-heals with NO re-initialize and NO >60s stall.
		const unknown = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: { ...jsonHeaders, "mcp-session-id": "00000000-0000-4000-8000-000000000000" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: { name: "memory-read", arguments: { owner: "perf006", repo: "daemon-handshake", query: "x" } }
			})
		});
		expect(unknown.status).toBe(200);
		const unknownBody = await unknown.text();
		expect(unknownBody).toContain('"result"');
		expect(unknownBody).not.toContain("Session not found");
		expect(unknownBody).not.toContain("Server not initialized");
	});
});

describe("runDaemonWorker — never resolves (no double-boot)", () => {
	it("does NOT settle after booting, so server.ts never falls into the [Server] path", async () => {
		const { runDaemonWorker } = await import("../cli/combined-server");

		// Inject a stub boot so this stays hermetic — no real listener, no second
		// store. The contract under test is purely "the promise never settles".
		let booted = false;
		const fakeHandle = {
			server: {} as never,
			port: 0,
			url: "http://127.0.0.1:0",
			close: vi.fn().mockResolvedValue(undefined)
		};

		let settled = false;
		void runDaemonWorker({
			installProcessHandlers: false,
			startServer: async () => {
				booted = true;
				return fakeHandle;
			}
		}).then(
			() => (settled = true),
			() => (settled = true)
		);

		// Let the boot + several macrotasks elapse. Pre-fix the function RETURNED,
		// so `await runDaemonWorker()` in server.ts fell through and booted a
		// SECOND SQLiteStore + EmbeddingWorker in the same pid.
		await new Promise((r) => setTimeout(r, 50));
		expect(booted).toBe(true);
		expect(settled).toBe(false);
	});
});

describe("runDaemonWorker — recoverable lock error containment (FIX-025)", () => {
	it("logs a WARN and does NOT exit when a lock refresh error reaches the process handler", async () => {
		const { runDaemonWorker } = await import("../cli/combined-server");
		const { addLogSink } = await import("../utils/logger");

		// Capture the process handlers the worker installs without triggering a
		// real boot/listener (startServer is stubbed and parks).
		const captured: Record<string, ((arg: unknown) => void)[]> = {};
		const onSpy = vi.spyOn(process, "on").mockImplementation(((event: string, handler: (arg: unknown) => void) => {
			(captured[event] ??= []).push(handler);
			return process;
		}) as never);
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		const logs: Array<{ level: string; message: string }> = [];
		const detach = addLogSink((payload) => {
			if (typeof payload.data.message === "string") logs.push({ level: payload.level, message: payload.data.message });
		});

		let settled = false;
		const fakeHandle = { server: {} as never, port: 0, url: "http://127.0.0.1:0", close: vi.fn() };
		const workerPromise = runDaemonWorker({ startServer: async () => fakeHandle });
		void workerPromise.then(() => (settled = true));

		try {
			// Let boot settle and the handlers install.
			await new Promise((r) => setTimeout(r, 30));
			expect(captured.uncaughtException?.length).toBeGreaterThanOrEqual(1);

			// Fire a recoverable proper-lockfile failure through the handler.
			const handler = captured.uncaughtException![0]!;
			handler(Object.assign(new Error("Unable to update lock within the stale threshold"), { code: "ECOMPROMISED" }));

			// Contained: WARN logged, process.exit NOT called, worker still parked.
			expect(exitSpy).not.toHaveBeenCalled();
			expect(logs.some((l) => l.level === "warning" && l.message.includes("Recoverable lock error contained"))).toBe(
				true
			);
			expect(logs.some((l) => l.level === "error" && l.message.includes("Uncaught exception"))).toBe(false);
			expect(settled).toBe(false);
		} finally {
			onSpy.mockRestore();
			exitSpy.mockRestore();
			detach();
			void workerPromise.catch(() => {});
		}
	});

	it("still logs ERROR + exits for a non-lock uncaught exception before startup (negative)", async () => {
		const { runDaemonWorker } = await import("../cli/combined-server");

		const captured: Record<string, ((arg: unknown) => void)[]> = {};
		const onSpy = vi.spyOn(process, "on").mockImplementation(((event: string, handler: (arg: unknown) => void) => {
			(captured[event] ??= []).push(handler);
			return process;
		}) as never);
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

		// A startServer that never settles keeps serverStarted=false while the
		// handler runs, so a genuine error must trigger exit(1).
		const workerPromise = runDaemonWorker({ startServer: () => new Promise(() => {}) });
		try {
			await new Promise((r) => setTimeout(r, 20));
			const handler = captured.uncaughtException![0]!;
			handler(new Error("boom: genuine fault"));

			expect(exitSpy).toHaveBeenCalledWith(1);
		} finally {
			onSpy.mockRestore();
			exitSpy.mockRestore();
			void workerPromise.catch(() => {});
		}
	});
});

describe("runDaemonWorker — EADDRINUSE (TASK-425)", () => {
	it("prints an actionable message and exits once instead of crash-looping", async () => {
		const { runDaemonWorker } = await import("../cli/combined-server");

		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lmc-eaddrinuse-"));
		const prevDir = process.env.LOCAL_MEMORY_DAEMON_DIR;
		process.env.LOCAL_MEMORY_DAEMON_DIR = dir;
		const lockFile = path.join(dir, "daemon.lock");
		fs.writeFileSync(lockFile, "1234\n", "utf8");

		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		try {
			await runDaemonWorker({
				installProcessHandlers: false,
				port: 3456,
				startServer: async () => {
					throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
				}
			});

			expect(exitSpy).toHaveBeenCalledWith(1);
			const output = stderrSpy.mock.calls.map((call) => String(call[0])).join("");
			expect(output).toContain("Daemon port 3456 is already in use");
			expect(output).toContain('Run "daemon status"');
			// The single-instance lock is released so the next start is not blocked.
			expect(fs.existsSync(lockFile)).toBe(false);
		} finally {
			exitSpy.mockRestore();
			stderrSpy.mockRestore();
			if (prevDir === undefined) delete process.env.LOCAL_MEMORY_DAEMON_DIR;
			else process.env.LOCAL_MEMORY_DAEMON_DIR = prevDir;
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});
