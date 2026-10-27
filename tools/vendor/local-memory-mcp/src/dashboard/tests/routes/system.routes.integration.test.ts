/**
 * System routes (health/repos/stats/metrics/recent-actions/capabilities/
 * export/tools + arena overview) — route-level integration tests.
 *
 * Scope (REFACTOR-TST-008): route REGISTRATION (exact method+path table in
 * registration order via router stack introspection), MOUNTING (prefix
 * resolution over HTTP), and PARAM/404 handling (400 for missing required
 * params, 404 for unknown sub-paths / method mismatches). Deep controller
 * behavior is owned by controllers.integration.test.ts and is NOT duplicated
 * here.
 *
 * system.routes registers under the "/" prefix (mount `/api/*` paths) — this
 * file mounts it exactly like index.ts does, under `/api`.
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
 * order. Order is SEMANTIC here — the static `GET /real` paths must not be
 * shadowed, and `GET /dashboard/overview` must stay reachable before
 * `/export`. The runtime `route.methods` map is not part of the @types
 * surface; narrow with an intersection, never `any`.
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

interface JsonApiBody {
	jsonapi?: { version?: string };
	data?: { type?: string; id?: string; attributes?: Record<string, unknown> } | unknown[] | null;
	meta?: Record<string, unknown>;
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

describe("System routes", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const router = (await import("../../routes/system.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api", router); // system.routes mounts under "/" in index.ts
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
		it("registers the full system route table in order", async () => {
			const { default: router } = await import("../../routes/system.routes");
			expect(collectRouteTable(router)).toEqual([
				{ method: "GET", path: "/health" },
				{ method: "GET", path: "/repos" },
				{ method: "GET", path: "/stats" },
				{ method: "GET", path: "/metrics" },
				{ method: "GET", path: "/recent-actions" },
				{ method: "GET", path: "/dashboard/overview" },
				{ method: "GET", path: "/capabilities" },
				{ method: "GET", path: "/export" },
				{ method: "POST", path: "/tools/:name/call" }
			]);
		});
	});

	describe("mounting + read-only endpoints", () => {
		it("GET /api/health resolves (200, type health)", async () => {
			const res = await fetch(`${baseUrl}/api/health`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(!Array.isArray(body.data) && body.data?.type).toBe("health");
		});

		it("GET /api/repos resolves (200, repository array)", async () => {
			const res = await fetch(`${baseUrl}/api/repos`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(Array.isArray(body.data)).toBe(true);
		});

		it("GET /api/stats resolves (200, type system-stats)", async () => {
			const res = await fetch(`${baseUrl}/api/stats`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(!Array.isArray(body.data) && body.data?.type).toBe("system-stats");
		});

		it("GET /api/metrics resolves (200, type system-metrics — stubbed worker stats)", async () => {
			const res = await fetch(`${baseUrl}/api/metrics`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(!Array.isArray(body.data) && body.data?.type).toBe("system-metrics");
		});

		it("GET /api/recent-actions resolves (200, empty data)", async () => {
			const res = await fetch(`${baseUrl}/api/recent-actions`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(body.data).toEqual([]);
		});

		it("GET /api/capabilities resolves (200, type capability)", async () => {
			const res = await fetch(`${baseUrl}/api/capabilities`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(!Array.isArray(body.data) && body.data?.type).toBe("capability");
		});

		it("GET /api/dashboard/overview resolves (200, type arena-overview)", async () => {
			const res = await fetch(`${baseUrl}/api/dashboard/overview`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(!Array.isArray(body.data) && body.data?.type).toBe("arena-overview");
		});

		it("POST /api/tools/:name/call is wired to the handler (200 via mocked mcp client)", async () => {
			const res = await fetch(`${baseUrl}/api/tools/route-test/call`, jsonBody({ some: "arg" }));
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(!Array.isArray(body.data) && body.data?.type).toBe("tool-result");
		});
	});

	describe("param validation", () => {
		it("GET /api/export without repo returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/export`, 400, /repo/);
		});

		it("GET /api/export with a bare (non owner/repo) repo returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/export?repo=plainname`, 400, /owner is required/);
		});
	});

	describe("404 handling", () => {
		it("GET /api/<unknown> returns 404 (unregistered path)", async () => {
			expect((await fetch(`${baseUrl}/api/unknown-route`)).status).toBe(404);
		});

		it("POST /api/health returns 404 (GET-only route, method mismatch)", async () => {
			expect((await fetch(`${baseUrl}/api/health`, { method: "POST" })).status).toBe(404);
		});
	});
});

/** Build a JSON POST request init from a plain payload. */
function jsonBody(payload: Record<string, unknown>): RequestInit {
	return {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload)
	};
}
