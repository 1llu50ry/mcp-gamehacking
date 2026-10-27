/**
 * Queue routes (embedding/KG outbox admin) — route-level integration tests.
 *
 * Scope (REFACTOR-TST-008): route REGISTRATION (exact method+path table in
 * registration order via router stack introspection), MOUNTING (prefix
 * resolution over HTTP), and PARAM/404 handling (400 for invalid filters,
 * 404 for unknown jobs / unknown sub-paths / method mismatches). Deep
 * controller behavior is owned by controllers.integration.test.ts and is
 * NOT duplicated here.
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
		// QueueController.status reads worker stats (MEM-697): stub so the
		// endpoint runs without a real worker.
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
 * order. Order is SEMANTIC here — the static `POST /jobs/:id/retry` and
 * `POST /jobs/:id/clear` are exact-path routes; `DELETE /jobs/:id` must not
 * be reordered ahead of them. The runtime `route.methods` map is not part of
 * the @types surface; narrow with an intersection, never `any`.
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

describe("Queue routes", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const router = (await import("../../routes/queue.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api/queue", router);
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
		it("registers the full queue route table in order", async () => {
			const { default: router } = await import("../../routes/queue.routes");
			expect(collectRouteTable(router)).toEqual([
				{ method: "GET", path: "/status" },
				{ method: "GET", path: "/jobs" },
				{ method: "POST", path: "/jobs/:id/retry" },
				{ method: "POST", path: "/jobs/:id/clear" },
				{ method: "DELETE", path: "/jobs/:id" },
				{ method: "POST", path: "/retry-all" }
			]);
		});
	});

	describe("mounting + read-only endpoints", () => {
		it("GET /api/queue/status resolves (200, type queue-status)", async () => {
			const res = await fetch(`${baseUrl}/api/queue/status`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(!Array.isArray(body.data) && body.data?.type).toBe("queue-status");
		});

		it("GET /api/queue/jobs resolves (200, empty data)", async () => {
			const res = await fetch(`${baseUrl}/api/queue/jobs`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
			expect(body.data).toEqual([]);
		});

		it("POST /api/queue/retry-all resolves (200, 0 retried on an empty queue)", async () => {
			const res = await fetch(`${baseUrl}/api/queue/retry-all`, { method: "POST" });
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(!Array.isArray(body.data) && body.data?.type).toBe("queue-retry-all");
			expect(body.meta?.retried).toBe(0);
		});
	});

	describe("param validation", () => {
		it("GET /api/queue/jobs with a non-enum status returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/queue/jobs?status=bogus`, 400, /Invalid status value/);
		});

		it("GET /api/queue/jobs with a whitespace-only repo filter returns 400", async () => {
			await expectJsonApiError(`${baseUrl}/api/queue/jobs?repo=%20`, 400, /repo must not be empty/);
		});
	});

	describe("404 handling", () => {
		it("POST /api/queue/jobs/:id/retry with an unknown id returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/queue/jobs/${UNKNOWN_ID}/retry`, 404, /Queue job not found/, {
				method: "POST"
			});
		});

		it("POST /api/queue/jobs/:id/clear with an unknown id returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/queue/jobs/${UNKNOWN_ID}/clear`, 404, /Queue job not found/, {
				method: "POST"
			});
		});

		it("DELETE /api/queue/jobs/:id with an unknown id returns 404", async () => {
			await expectJsonApiError(`${baseUrl}/api/queue/jobs/${UNKNOWN_ID}`, 404, /Queue job not found/, {
				method: "DELETE"
			});
		});

		it("GET /api/queue/<unknown> returns 404 (unregistered sub-path)", async () => {
			expect((await fetch(`${baseUrl}/api/queue/unknown`)).status).toBe(404);
		});

		it("PATCH /api/queue/status returns 404 (GET-only route, method mismatch)", async () => {
			expect((await fetch(`${baseUrl}/api/queue/status`, { method: "PATCH" })).status).toBe(404);
		});
	});
});
