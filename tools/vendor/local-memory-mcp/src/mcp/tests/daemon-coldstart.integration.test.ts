/**
 * FEAT-DAEMON-002E — cold-start handshake ordering integration test.
 *
 * Proves the acceptance criterion: the HTTP listener binds and answers MCP
 * `initialize` BEFORE the heavy, optional startup passes (VACUUM / maintenance /
 * auto-index) run, so a cold start on a large DB cannot block the handshake.
 *
 * Strategy (deterministic, no timing races): boot the real combined server with
 * a CAPTURING scheduler seam that records the deferred-pass runner WITHOUT
 * invoking it, and with `VACUUM_ON_STARTUP` enabled. Then:
 *
 *   1. `initialize` over the wire succeeds while EVERY deferred pass is still
 *      pending — the listener is up and serving before any heavy pass runs.
 *   2. The deferred runner only runs when released; it then executes the
 *      operator-gated VACUUM (proven via the `[Daemon] VACUUM_ON_STARTUP ran`
 *      log) and a simulated heavy rewrite pass.
 *   3. After the passes run, the server still serves `initialize` (a slow/failed
 *      pass degrades, never aborts readiness).
 *
 * Hermetic: the dashboard context is mocked (in-memory store + stub vectors),
 * the port is ephemeral, and auto-index/watcher are disabled via env.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// MUST be set before combined-server (and thus utils/constants) is imported so
// the VACUUM gate + lazy-warmup flags are read at module init.
process.env.VACUUM_ON_STARTUP = "true";
process.env.EMBEDDING_LAZY_WARMUP = "true";
process.env.CODEBASE_AUTO_INDEX = "false";
process.env.ENABLE_FILE_WATCHER = "false";

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

import type { CombinedServerHandle } from "../cli/combined-server";
import { addLogSink, type LogSinkPayload } from "../utils/logger";

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

function initializeBody(): string {
	return JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "initialize",
		params: {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "cold-start-test", version: "1.0.0" }
		}
	});
}

describe("combined server — cold-start handshake ordering (FEAT-DAEMON-002E)", () => {
	let handle: CombinedServerHandle;
	/** The captured deferred-pass runner (held until we explicitly release it). */
	let releaseDeferred: (() => void) | undefined;
	let heavyPassRan = false;
	const logs: LogSinkPayload[] = [];
	let detachLogs: () => void;

	beforeAll(async () => {
		const { startCombinedServer } = await import("../cli/combined-server");
		detachLogs = addLogSink((payload) => logs.push(payload));
		handle = await startCombinedServer({
			host: "127.0.0.1",
			port: 0,
			enableEngines: true,
			startupDeferral: {
				// Capture the runner; do NOT invoke it yet. This models "the
				// listener is bound, but the heavy passes have not started".
				schedule: (run) => {
					releaseDeferred = run;
				},
				extraPasses: [
					{
						name: "simulated-heavy-vacuum",
						run: () => {
							// Simulate the cost of a full VACUUM rewrite on a large DB:
							// block the event loop for 3s. If this ran before the
							// listener served initialize, the handshake would stall.
							const end = Date.now() + 3000;
							while (Date.now() < end) {
								/* spin */
							}
							heavyPassRan = true;
						}
					}
				]
			}
		});
	});

	afterAll(async () => {
		detachLogs?.();
		await handle?.close();
	});

	it("answers initialize while EVERY deferred pass is still pending (listener-first)", async () => {
		// The deferred runner was scheduled but not invoked.
		expect(releaseDeferred).toBeDefined();
		expect(heavyPassRan).toBe(false);

		const started = Date.now();
		const res = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: JSON_HEADERS,
			body: initializeBody()
		});
		const elapsed = Date.now() - started;

		expect(res.status).toBe(200);
		await res.text();
		// The initialize was served while the 3s simulated heavy pass is still
		// pending (proven by `heavyPassRan` below). The generous bound guards
		// against a hang without being flaky under parallel test-fork load.
		expect(elapsed).toBeLessThan(2000);
		// Still pending — nothing heavy has run yet.
		expect(heavyPassRan).toBe(false);
	});

	it("runs the deferred passes (incl. the operator-gated VACUUM) only after release", async () => {
		expect(releaseDeferred).toBeDefined();
		releaseDeferred!();

		// Let the deferred pass chain run (heavy pass = 3s + chain).
		const deadline = Date.now() + 10000;
		while (!heavyPassRan && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 20));
		}

		expect(heavyPassRan).toBe(true);
		// The vacuum pass was part of the deferred list and ran (in-memory store →
		// skipped with reason 'in_memory', but the pass itself executed and logged).
		expect(logs.some((l) => l.data.message === "[Daemon] VACUUM_ON_STARTUP ran")).toBe(true);
	});

	it("still serves initialize after the heavy passes ran (degrade, never abort)", async () => {
		const res = await fetch(`${handle.url}/mcp`, {
			method: "POST",
			headers: JSON_HEADERS,
			body: initializeBody()
		});
		expect(res.status).toBe(200);
		await res.text();
	});
});
