// Log-sink lifecycle regression (branch fix).
//
// `createMcpServer` registers a process-global log sink (utils/logger.ts
// `addLogSink`) that forwards payloads to the connected client via
// `server.sendLoggingMessage`. Under HTTP, `createServerFactory` runs per
// session (legacy) and per request (modern); without an unsubscribe every
// served unit would permanently leak a sink (linear memory growth + O(N) log
// fan-out per line). The sink is now removed on the server's `onclose` hook.
//
// These tests prove the wiring: a log reaches the server while it is live, and
// no longer reaches it after the connection is closed.
//
// Convention follows sdk-resources.test.ts: pure TS, no jsdom, in-memory SQLite
// (`createTestStore`) + `StubVectorStore`, SDK Client over InMemoryTransport.

import { describe, it, expect, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../mcp-server";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { createSessionContext } from "../session";
import { logger } from "../utils/logger";
import type { VectorStore } from "../types";

describe("log sink is removed when the server closes", () => {
	it("stops forwarding logs after the connection closes", async () => {
		const db = await createTestStore();
		const vectors: VectorStore = new StubVectorStore(db);
		const { server } = createMcpServer(db, vectors, createSessionContext());

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const client = new Client({ name: "log-sink-test", version: "1.0.0" });
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

		// Observe the server-side forward path. The sink closure calls the
		// McpServer's `sendLoggingMessage`, so spying on it tells us whether the
		// sink is still registered.
		const sendSpy = vi.spyOn(server, "sendLoggingMessage").mockResolvedValue(undefined);

		try {
			// While live, a log line reaches the server's forward path.
			logger.info("[Tool] log-sink-lifecycle-marker-live");
			expect(sendSpy).toHaveBeenCalledTimes(1);

			// Close the connection → the server's onclose hook removes the sink.
			await server.close();
			sendSpy.mockClear();

			// After close the sink is gone: the same log no longer reaches it.
			logger.info("[Tool] log-sink-lifecycle-marker-after-close");
			expect(sendSpy).not.toHaveBeenCalled();
		} finally {
			await client.close().catch(() => {});
			await server.close().catch(() => {});
			sendSpy.mockRestore();
			db.close();
		}
	});
});
