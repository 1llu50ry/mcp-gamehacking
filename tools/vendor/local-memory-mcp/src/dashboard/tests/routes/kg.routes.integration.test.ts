/**
 * Knowledge-graph routes — route-level integration tests.
 *
 * Scope (REFACTOR-TST-008): route REGISTRATION (exact method+path table in
 * registration order via router stack introspection), MOUNTING (prefix
 * resolution over HTTP), and PARAM/404 handling (400 for missing required
 * params, 404 for unknown ids / unknown sub-paths / method mismatches).
 * Deep controller behavior is owned by controllers.integration.test.ts and
 * is NOT duplicated here.
 *
 * kg.routes registers under the "/" prefix (mount `/api/kg/*` paths) — this
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
 * order. Order is SEMANTIC here — the static `POST /kg/entities` must be
 * reachable before the dynamic `DELETE /kg/entities/:name` shadows nothing,
 * and `/kg/relations`/`/kg/observations/:id`/`/kg/graph` are all exact-path
 * siblings. The runtime `route.methods` map is not part of the @types
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

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";
const POST_JSON: RequestInit = {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: "{}"
};

describe("Knowledge-graph routes", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const router = (await import("../../routes/kg.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api", router); // kg.routes mounts under "/" in index.ts
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
		it("registers the full kg route table in order", async () => {
			const { default: router } = await import("../../routes/kg.routes");
			expect(collectRouteTable(router)).toEqual([
				{ method: "GET", path: "/kg/entities" },
				{ method: "GET", path: "/kg/entities/:name" },
				{ method: "POST", path: "/kg/entities" },
				{ method: "DELETE", path: "/kg/entities/:name" },
				{ method: "GET", path: "/kg/relations" },
				{ method: "POST", path: "/kg/relations" },
				{ method: "DELETE", path: "/kg/relations" },
				{ method: "DELETE", path: "/kg/observations/:id" },
				{ method: "GET", path: "/kg/graph" }
			]);
		});
	});

	describe("mounting + list", () => {
		it("GET /api/kg/entities?repo=route-test resolves (200, empty data)", async () => {
			const res = await fetch(`${baseUrl}/api/kg/entities?repo=route-test`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(body.data).toEqual([]);
		});

		it("GET /api/kg/relations?repo=route-test resolves (200, empty data)", async () => {
			const res = await fetch(`${baseUrl}/api/kg/relations?repo=route-test`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(body.data).toEqual([]);
		});

		it("GET /api/kg/graph?repo=route-test resolves (200)", async () => {
			const res = await fetch(`${baseUrl}/api/kg/graph?repo=route-test`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(body.data).not.toBeNull();
		});
	});

	describe("param validation", () => {
		it("GET /api/kg/entities without repo returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/kg/entities`, 400, /repo/);
		});

		it("GET /api/kg/relations without repo returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/kg/relations`, 400, /repo/);
		});

		it("GET /api/kg/entities/:name without repo returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/kg/entities/example`, 400, /repo/);
		});

		it("DELETE /api/kg/entities/:name without repo returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/kg/entities/example`, 400, /repo/, { method: "DELETE" });
		});

		it("GET /api/kg/graph without repo returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/kg/graph`, 400, /repo/);
		});

		it("GET /api/kg/graph with a non-positive graphLimit returns 400", async () => {
			await expectJsonApiError(
				`${baseUrl}/api/kg/graph?repo=route-test&graphLimit=0`,
				400,
				/graphLimit must be a positive integer/
			);
		});

		it("POST /api/kg/entities without identity fields returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/kg/entities`, 400, /name and repo are required/, POST_JSON);
		});

		it("POST /api/kg/relations without identity fields returns 400", async () => {
			await expectJsonApiError(
				`${baseUrl}/api/kg/relations`,
				400,
				/from_entity, to_entity, relation_type, and repo/,
				POST_JSON
			);
		});

		it("DELETE /api/kg/relations without identity fields returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/kg/relations`, 400, /from_entity, to_entity, relation_type, and repo/, {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: "{}"
			});
		});
	});

	describe("404 handling", () => {
		it("GET /api/kg/entities/:name with an unknown name returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/kg/entities/does-not-exist?repo=route-test`, 404, /Entity not found/);
		});

		it("DELETE /api/kg/entities/:name with an unknown name returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/kg/entities/does-not-exist?repo=route-test`, 404, /Entity not found/, {
				method: "DELETE"
			});
		});

		it("DELETE /api/kg/observations/:id with an unknown id returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/kg/observations/${UNKNOWN_ID}`, 404, /Observation not found/, {
				method: "DELETE"
			});
		});

		it("GET /api/kg/<unknown> returns 404 (unregistered sub-path)", async () => {
			expect((await fetch(`${baseUrl}/api/kg/unknown`)).status).toBe(404);
		});

		it("POST /api/kg/graph returns 404 (GET-only route, method mismatch)", async () => {
			expect((await fetch(`${baseUrl}/api/kg/graph`, POST_JSON)).status).toBe(404);
		});
	});
});
