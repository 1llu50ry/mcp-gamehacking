/**
 * Unified-graph route — route-level integration tests.
 *
 * Scope (REFACTOR-TST-008): route REGISTRATION (exact method+path via router
 * stack introspection), MOUNTING (prefix resolution over HTTP), and
 * PARAM/404 handling (400 for a missing owner, 404 for unknown paths /
 * method mismatches). Deep controller behavior is owned by
 * controllers.integration.test.ts and is NOT duplicated here.
 *
 * unified-graph.routes registers under the "/" prefix (mount `/api/*` paths)
 * — this file mounts it exactly like index.ts does, under `/api`.
 *
 * Conventions: mocked context with an in-memory SQLiteStore (same pattern as
 * controllers.integration.test.ts); `*.integration.test.ts` suffix and
 * module-mirrored path per .agents/documents/testing.md §2.1/§3.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Router } from "express";
import type { AddressInfo } from "node:net";

// ── Mock context.ts (must precede any import that transitively loads it) ──

vi.mock("../../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../../../mcp/storage/sqlite");
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
		// QueueController.status / SystemService.getMetrics read worker stats
		// (MEM-697): stub so those endpoints run without a real worker.
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

// ── Route table introspection (Express 5 router.stack) ────────────────────

interface RegisteredRoute {
	method: string;
	path: string;
}

/**
 * Collect every registered route as `{ method, path }`, in registration
 * order. The runtime `route.methods` map is not part of the @types surface;
 * narrow with an intersection, never `any`.
 */
function collectRouteTable(router: Router): RegisteredRoute[] {
	const table: RegisteredRoute[] = [];
	for (const layer of router.stack) {
		const route = layer.route as { path: string; methods?: Record<string, boolean> } | undefined;
		if (!route) continue;
		for (const method of Object.keys(route.methods ?? {})) {
			table.push({ method: method.toUpperCase(), path: route.path });
		}
	}
	return table;
}

// ── JSON:API response shapes ──────────────────────────────────────────────

interface JsonApiData {
	type?: string;
	id?: string;
	attributes?: Record<string, unknown>;
}

interface JsonApiBody {
	jsonapi?: { version?: string };
	data?: JsonApiData | JsonApiData[] | null;
}

interface JsonApiErrorBody {
	jsonapi?: { version?: string };
	errors?: Array<{ status?: string; detail?: string }>;
}

/** Assert an HttpError-produced JSON:API error response. */
async function expectJsonApiError(
	url: string,
	expectedStatus: number,
	expectedDetail?: RegExp,
	init?: RequestInit
): Promise<void> {
	const res = await fetch(url, init);
	expect(res.status).toBe(expectedStatus);
	const body = (await res.json()) as JsonApiErrorBody;
	expect(body.jsonapi?.version).toBe("1.1");
	expect(body.errors?.[0]?.status).toBe(String(expectedStatus));
	if (expectedDetail) expect(body.errors?.[0]?.detail).toMatch(expectedDetail);
}

describe("Unified-graph route", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const router = (await import("../../routes/unified-graph.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api", router); // unified-graph.routes mounts under "/" in index.ts
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	describe("route registration", () => {
		it("registers the unified-graph route", async () => {
			const { default: router } = await import("../../routes/unified-graph.routes");
			expect(collectRouteTable(router)).toEqual([{ method: "GET", path: "/unified-graph" }]);
		});
	});

	describe("mounting", () => {
		it("GET /api/unified-graph?owner=route-test resolves (200, graph data)", async () => {
			const res = await fetch(`${baseUrl}/api/unified-graph?owner=route-test`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			const data = Array.isArray(body.data) ? null : body.data;
			expect(data?.type).toBe("unified-graph");
			expect(data?.attributes).toHaveProperty("nodes");
			expect(data?.attributes).toHaveProperty("edges");
			expect(data?.attributes).toHaveProperty("stats");
		});
	});

	describe("param validation", () => {
		it("GET /api/unified-graph without owner returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/unified-graph`, 400, /owner/i);
		});
	});

	describe("404 handling", () => {
		it("GET /api/<unknown> returns 404 (unregistered path)", async () => {
			expect((await fetch(`${baseUrl}/api/not-a-graph`)).status).toBe(404);
		});

		it("POST /api/unified-graph returns 404 (GET-only route, method mismatch)", async () => {
			expect((await fetch(`${baseUrl}/api/unified-graph`, { method: "POST" })).status).toBe(404);
		});
	});
});
