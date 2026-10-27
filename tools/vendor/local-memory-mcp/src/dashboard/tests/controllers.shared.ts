/**
 * Shared setup for the dashboard controllers integration tests.
 *
 * Extracted from controllers.integration.test.ts (TASK-428) so the per-controller
 * suites (system, memories, tasks, standards, kg, arena, coordination,
 * unified-graph, queue) can each live in their own < 500-line file. Each split
 * file imports `startControllersServer` plus whichever helpers it needs.
 *
 * The `vi.mock("../../dashboard/lib/context", ...)` factory is hoisted to the
 * top of THIS module; because every split file imports from here first, the
 * mock is registered before any route/context module loads — mirroring the
 * original single-file ordering.
 */

import express from "express";
import type { AddressInfo } from "node:net";
import { vi } from "vitest";

// KG_MAX_GRAPH_EDGES must be set BEFORE constants.ts loads so the truncated
// graph test (KG API) sees the small test cap (10) instead of the production
// 4000. Set at module top (runs during this module's evaluation, before any
// split file imports constants) and again inside the mock factory below.
process.env.KG_MAX_GRAPH_EDGES = "10";

// ── Mock context.ts (must be BEFORE any imports that transitively load it) ──

vi.mock("../../dashboard/lib/context", async () => {
	// OPT-FEAT-03 test hook: KG_MAX_GRAPH_EDGES is captured at constants.ts
	// module load, so the cap MUST be set BEFORE sqlite.ts → constants.ts is
	// imported. A small cap lets the truncated graph test seed a handful of
	// relations instead of 4000+. No other test in these files depends on the
	// default 4000 cap (the existing graph tests only assert shape/empty), so
	// the override is safe for the whole run (vitest workers are isolated).
	process.env.KG_MAX_GRAPH_EDGES = "10";
	const { SQLiteStore } = await import("../../mcp/storage/sqlite");
	const db = new SQLiteStore(":memory:");

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
			getPendingCount: vi.fn(() => 0),
			callTool: vi.fn().mockResolvedValue({ structuredContent: { success: true } })
		},
		// Embedding/KG outbox worker (TASK-013): QueueController.status reads
		// embeddingWorker.getStats() — stubbed so the endpoint is exercised
		// without starting a real worker.
		embeddingWorker: {
			getStats: vi.fn().mockReturnValue({
				pending: 0,
				claimed: 0,
				done: 0,
				poison: 0,
				total: 0,
				processed: 0,
				failed: 0,
				poisoned: 0,
				lastBatchSize: 0,
				lastRunAt: null,
				running: false,
				started: false,
				modelReady: false,
				pollIntervalMs: 5000,
				batchSize: 8,
				leaseMs: 60_000
			})
		},
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		},
		startTime: Date.now()
	};
});

// Re-export the mocked context singletons so every split file shares the SAME
// in-memory store instance the route mounts against (the route is loaded via
// startControllersServer, which imports it through THIS module's mocked graph).
// A DYNAMIC import is used here on purpose: vitest resolves a vi.mock'd module
// for dynamic imports (the pattern codebase-api.shared.ts uses for its seed
// helpers), whereas a static import of a helper-module mock can resolve to the
// real module — which would give a `db` with no `.knowledgeGraph`. The route's
// context import (inside startControllersServer) goes through the same mocked
// graph, so the instances match.
const mockedContext = await import("../../dashboard/lib/context");
export const db = mockedContext.db;
export const embeddingWorker = mockedContext.embeddingWorker;
export const mcpClient = mockedContext.mcpClient;

/**
 * Poll until `predicate` holds — replaces fixed sleeps so completion is
 * detected, not guessed (TASK-391 hardening precedent, mirroring
 * file-watcher.test.ts / indexing-service.test.ts). 20 ms poll / 4000 ms
 * default timeout, well under vitest's 30 s testTimeout.
 */
export async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error("waitFor timed out");
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

// ── Server factory ─────────────────────────────────────────────────────────

export interface ControllersServer {
	baseUrl: string;
	close: () => Promise<void>;
}

/**
 * Spin up an isolated express app mounting the full dashboard router against
 * the mocked in-memory context. Returns the base URL and a close handle; call
 * the latter in `afterAll`. Each split file owns its own server + store.
 */
export async function startControllersServer(): Promise<ControllersServer> {
	const router = (await import("../../dashboard/routes/index")).default;
	const app = express();
	app.use(express.json());
	app.use("/api", router);
	const server = app.listen(0);
	const { port } = server.address() as AddressInfo;
	const baseUrl = `http://127.0.0.1:${port}`;
	return {
		baseUrl,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			})
	};
}
