/**
 * Route index (routes/index.ts) — mount registry integration tests.
 *
 * Scope (REFACTOR-TST-008): verifies the composite router WIRING — each of
 * the 10 sub-routers is mounted at the production prefix, in the production
 * order, and every prefix resolves over HTTP. Also verifies global 404
 * handling (unknown paths + method mismatches at the /api boundary).
 * Deep controller behavior is owned by the per-group integration tests and
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

// ── JSON:API response shapes ──────────────────────────────────────────────

interface JsonApiBody {
	jsonapi?: { version?: string };
	data?: unknown;
}

interface JsonApiErrorBody {
	jsonapi?: { version?: string };
	errors?: Array<{ status?: string; detail?: string }>;
}

describe("Route index (mount registry)", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const router = (await import("../../routes/index")).default;
		app = express();
		app.use(express.json());
		app.use("/api", router);
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	describe("mount registration", () => {
		it("mounts all 10 sub-routers in order (no direct routes on the index router)", async () => {
			const { default: router } = await import("../../routes/index");
			const { default: systemRoutes } = await import("../../routes/system.routes");
			const { default: memoryRoutes } = await import("../../routes/memory.routes");
			const { default: taskRoutes } = await import("../../routes/task.routes");
			const { default: standardRoutes } = await import("../../routes/standard.routes");
			const { default: coordinationRoutes } = await import("../../routes/coordination.routes");
			const { default: kgRoutes } = await import("../../routes/kg.routes");
			const { default: codebaseRoutes } = await import("../../routes/codebase.routes");
			const { default: unifiedGraphRoutes } = await import("../../routes/unified-graph.routes");
			const { default: queueRoutes } = await import("../../routes/queue.routes");
			const { default: bugReportRoutes } = await import("../../routes/bug-report.routes");

			// All 10 layers are sub-router mounts (no layer carries a route).
			expect(router.stack).toHaveLength(10);
			expect(router.stack.every((layer) => !layer.route)).toBe(true);

			// The mount handle is the exact sub-router instance, in the
			// production order from routes/index.ts.
			const handles = router.stack.map((layer) => layer.handle as Router);
			expect(handles).toEqual([
				systemRoutes,
				memoryRoutes,
				taskRoutes,
				standardRoutes,
				coordinationRoutes,
				kgRoutes,
				codebaseRoutes,
				unifiedGraphRoutes,
				queueRoutes,
				bugReportRoutes
			]);
		});
	});

	describe("mounting (prefix resolution)", () => {
		it("GET /api/health resolves (system mounted at /)", async () => {
			const res = await fetch(`${baseUrl}/api/health`);
			expect(res.status).toBe(200);
		});

		it("GET /api/memories?repo=route-test resolves (memories mounted at /memories)", async () => {
			const res = await fetch(`${baseUrl}/api/memories?repo=route-test`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as JsonApiBody;
			expect(body.jsonapi?.version).toBe("1.1");
		});

		it("GET /api/tasks?repo=route-test resolves (tasks mounted at /tasks)", async () => {
			const res = await fetch(`${baseUrl}/api/tasks?repo=route-test`);
			expect(res.status).toBe(200);
		});

		it("GET /api/standards resolves (standards mounted at /standards)", async () => {
			const res = await fetch(`${baseUrl}/api/standards`);
			expect(res.status).toBe(200);
		});

		it("GET /api/coordination/claims?repo=route-test resolves (coordination mounted at /coordination)", async () => {
			const res = await fetch(`${baseUrl}/api/coordination/claims?repo=route-test`);
			expect(res.status).toBe(200);
		});

		it("GET /api/kg/entities?repo=route-test resolves (kg mounted at /)", async () => {
			const res = await fetch(`${baseUrl}/api/kg/entities?repo=route-test`);
			expect(res.status).toBe(200);
		});

		it("GET /api/codebase/index-status?repo=... resolves (codebase mounted at /codebase)", async () => {
			const res = await fetch(`${baseUrl}/api/codebase/index-status?repo=test-owner/test-repo`);
			expect(res.status).toBe(200);
		});

		it("GET /api/unified-graph?owner=route-test resolves (unified-graph mounted at /)", async () => {
			const res = await fetch(`${baseUrl}/api/unified-graph?owner=route-test`);
			expect(res.status).toBe(200);
		});

		it("GET /api/queue/status resolves (queue mounted at /queue)", async () => {
			const res = await fetch(`${baseUrl}/api/queue/status`);
			expect(res.status).toBe(200);
		});

		it("GET /api/bugs/stats resolves (bugs mounted at /bugs)", async () => {
			const res = await fetch(`${baseUrl}/api/bugs/stats`);
			expect(res.status).toBe(200);
		});

		it("GET /api/memories without repo returns 400 from the mounted memories router", async () => {
			// Proves the /memories mount was reached (its own validation ran)
			// rather than falling through to a sibling mount.
			const res = await fetch(`${baseUrl}/api/memories`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as JsonApiErrorBody;
			expect(body.errors?.[0]?.status).toBe("400");
			expect(body.errors?.[0]?.detail).toMatch(/repo/);
		});
	});

	describe("global 404 handling", () => {
		it("GET /api/<unknown> returns 404 (no mount matches)", async () => {
			expect((await fetch(`${baseUrl}/api/not-a-route`)).status).toBe(404);
		});

		it("POST /api/health returns 404 (GET-only route, method mismatch at the /api boundary)", async () => {
			expect((await fetch(`${baseUrl}/api/health`, { method: "POST" })).status).toBe(404);
		});
	});
});
