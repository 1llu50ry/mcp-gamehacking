/**
 * Coordination routes (claims + handoffs) — route-level integration tests.
 *
 * Scope (REFACTOR-TST-008): route REGISTRATION (exact method+path table in
 * registration order via router stack introspection), MOUNTING (prefix
 * resolution over HTTP), and PARAM/404 handling (400 for missing required
 * params, 404 for unknown ids / unknown sub-paths / method mismatches).
 * Deep controller behavior is owned by controllers.integration.test.ts and
 * is NOT duplicated here.
 *
 * createHandoff/releaseClaim delegate to the MCP client — here the mocked
 * `mcpClient.callTool` proves only that the route is wired to the handler
 * (the MCP protocol itself is out of route-level scope).
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
 * order. Order is SEMANTIC here — the static `POST /claims/release`,
 * `POST /handoffs` and `POST /handoffs/status` are all exact-path routes and
 * must not be reordered against each other. The runtime `route.methods` map
 * is not part of the @types surface; narrow with an intersection, never `any`.
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

const POST_JSON: RequestInit = {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: "{}"
};

describe("Coordination routes", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const router = (await import("../../routes/coordination.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api/coordination", router);
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
		it("registers the full coordination route table in order", async () => {
			const { default: router } = await import("../../routes/coordination.routes");
			expect(collectRouteTable(router)).toEqual([
				{ method: "GET", path: "/claims" },
				{ method: "POST", path: "/claims/release" },
				{ method: "POST", path: "/handoffs" },
				{ method: "GET", path: "/handoffs" },
				{ method: "POST", path: "/handoffs/status" }
			]);
		});
	});

	describe("mounting + list", () => {
		it("GET /api/coordination/claims?repo=route-test resolves (200, empty data)", async () => {
			const res = await fetch(`${baseUrl}/api/coordination/claims?repo=route-test`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(body.data).toEqual([]);
		});

		it("GET /api/coordination/handoffs?repo=route-test resolves (200, empty data)", async () => {
			const res = await fetch(`${baseUrl}/api/coordination/handoffs?repo=route-test`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(body.data).toEqual([]);
		});

		it("POST /api/coordination/handoffs is wired to the handler (200 via mocked mcp client)", async () => {
			const res = await fetch(`${baseUrl}/api/coordination/handoffs`, POST_JSON);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(!Array.isArray(body.data) && body.data?.type).toBe("handoff-create");
		});
	});

	describe("param validation", () => {
		it("GET /api/coordination/claims without repo returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/coordination/claims`, 400, /repo/);
		});

		it("GET /api/coordination/handoffs without repo returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/coordination/handoffs`, 400, /repo/);
		});

		it("POST /api/coordination/handoffs/status without id returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/coordination/handoffs/status`, 400, /id is required/, POST_JSON);
		});

		it("POST /api/coordination/handoffs/status with an invalid status value returns 400", async () => {
			await expectJsonApiError(
				`${baseUrl}/api/coordination/handoffs/status`,
				400,
				/Invalid status/,
				jsonBody({ id: "00000000-0000-0000-0000-000000000000", status: "bogus" })
			);
		});
	});

	describe("404 handling", () => {
		it("POST /api/coordination/handoffs/status with an unknown id returns 404", async () => {
			await expectJsonApiError(
				`${baseUrl}/api/coordination/handoffs/status`,
				404,
				/Handoff not found/,
				jsonBody({ id: "00000000-0000-0000-0000-000000000000", status: "pending" })
			);
		});

		it("GET /api/coordination/<unknown> returns 404 (unregistered sub-path)", async () => {
			expect((await fetch(`${baseUrl}/api/coordination/unknown`)).status).toBe(404);
		});

		it("DELETE /api/coordination/claims returns 404 (GET-only route, method mismatch)", async () => {
			expect((await fetch(`${baseUrl}/api/coordination/claims`, { method: "DELETE" })).status).toBe(404);
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
