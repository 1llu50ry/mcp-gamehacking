/**
 * Task routes — route-level integration tests.
 *
 * Scope (REFACTOR-TST-008): route REGISTRATION (exact method+path table in
 * registration order via router stack introspection), MOUNTING (prefix
 * resolution over HTTP), and PARAM/404 handling (400 for missing required
 * params, 404 for unknown ids / unknown sub-paths / method mismatches).
 * Deep controller behavior is owned by controllers.integration.test.ts and
 * is NOT duplicated here.
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
 * order. Order is SEMANTIC here — e.g. the static `GET /stats/time` and
 * `GET /by-code` must be registered before `GET /:id` so they win over the
 * dynamic param route. The runtime `route.methods` map is not part of the
 * @types surface; narrow with an intersection, never `any`.
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

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";
const POST_JSON: RequestInit = {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: "{}"
};
const PUT_JSON: RequestInit = {
	method: "PUT",
	headers: { "content-type": "application/json" },
	body: "{}"
};

describe("Task routes", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const router = (await import("../../routes/task.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api/tasks", router);
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
		it("registers the full task route table in order", async () => {
			const { default: router } = await import("../../routes/task.routes");
			expect(collectRouteTable(router)).toEqual([
				{ method: "GET", path: "/" },
				{ method: "POST", path: "/" },
				{ method: "POST", path: "/import" },
				{ method: "POST", path: "/action" },
				{ method: "GET", path: "/stats/time" },
				{ method: "GET", path: "/by-code" },
				{ method: "GET", path: "/:id" },
				{ method: "PUT", path: "/:id" },
				{ method: "DELETE", path: "/:id" },
				{ method: "PUT", path: "/comments/:id" },
				{ method: "DELETE", path: "/comments/:id" }
			]);
		});
	});

	describe("mounting + list", () => {
		it("GET /api/tasks?repo=route-test resolves (200, empty data, jsonapi 1.1)", async () => {
			const res = await fetch(`${baseUrl}/api/tasks?repo=route-test`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(body.data).toEqual([]);
			expect(body.meta?.totalItems).toBe(0);
		});

		it("GET /api/tasks without repo returns 400 (required param)", async () => {
			await expectJsonApiError(`${baseUrl}/api/tasks`, 400, /repo/);
		});

		it("GET /api/tasks/stats/time resolves (static route not shadowed by /:id)", async () => {
			const res = await fetch(`${baseUrl}/api/tasks/stats/time`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(!Array.isArray(body.data) && body.data?.type).toBe("performance-stats");
		});
	});

	describe("param validation", () => {
		it("GET /api/tasks/by-code without repo/task_code returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/tasks/by-code`, 400, /repo and task_code/);
		});

		it("POST /api/tasks without body attributes returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/tasks`, 400, /Required fields missing/, POST_JSON);
		});

		it("POST /api/tasks/import without items/repo returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/tasks/import`, 400, /items/, POST_JSON);
		});

		it("POST /api/tasks/action without ids/action returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/tasks/action`, 400, /ids/, POST_JSON);
		});
	});

	describe("404 handling", () => {
		it("GET /api/tasks/:id with an unknown id returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/tasks/${UNKNOWN_ID}`, 404, /Task not found/);
		});

		it("PUT /api/tasks/:id with an unknown id returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/tasks/${UNKNOWN_ID}`, 404, /Task not found/, PUT_JSON);
		});

		it("DELETE /api/tasks/:id with an unknown id returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/tasks/${UNKNOWN_ID}`, 404, /Task not found/, {
				method: "DELETE"
			});
		});

		it("PUT /api/tasks/comments/:id with an unknown comment id returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/tasks/comments/${UNKNOWN_ID}`, 404, /Comment not found/, PUT_JSON);
		});

		it("DELETE /api/tasks/comments/:id with an unknown comment id returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/tasks/comments/${UNKNOWN_ID}`, 404, /Comment not found/, {
				method: "DELETE"
			});
		});

		it("GET /api/tasks/<unknown>/deeper returns 404 (unregistered sub-path)", async () => {
			expect((await fetch(`${baseUrl}/api/tasks/unknown/deeper`)).status).toBe(404);
		});

		it("POST /api/tasks/stats/time returns 404 (GET-only route, method mismatch)", async () => {
			expect((await fetch(`${baseUrl}/api/tasks/stats/time`, POST_JSON)).status).toBe(404);
		});
	});
});
