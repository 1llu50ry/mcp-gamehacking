import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { randomUUID } from "crypto";
import type { AddressInfo } from "node:net";

vi.mock("../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../../mcp/storage/sqlite");
	const { StubVectorStore } = await import("../../mcp/storage/vectors.stub");
	const db = new SQLiteStore(":memory:");
	const vectors = new StubVectorStore(db);

	return {
		db,
		vectors,
		mcpClient: { start: vi.fn(), stop: vi.fn(), isConnected: vi.fn(() => false), getPendingCount: vi.fn(() => 0) },
		// OPT-OBS-01: SystemController.getMetrics imports embeddingWorker and
		// calls getStats() — required stub, else any /metrics test fails on
		// undefined.getStats. Shape mirrors EmbeddingWorkerStats.
		embeddingWorker: {
			getStats: vi.fn(() => ({
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
				embedLatency: { count: 1, avgMs: 42, p50Ms: 40, p95Ms: 60, maxMs: 70 },
				running: false,
				started: false,
				modelReady: true,
				pollIntervalMs: 5000,
				batchSize: 8,
				leaseMs: 60_000
			}))
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

describe("Dashboard System API", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const systemRoutes = (await import("../../dashboard/routes/system.routes")).default;
		const taskRoutes = (await import("../../dashboard/routes/task.routes")).default;
		// TASK-187: mounted so the recent-actions tests can dispatch a real
		// memory create (MemoryService.create logs the action) and a detail read
		// (MemoryService.getById — the POLICY 2 read path) over HTTP.
		const memoryRoutes = (await import("../../dashboard/routes/memory.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api", systemRoutes);
		app.use("/api/tasks", taskRoutes);
		// memory.routes registers RELATIVE paths (POST "/" -> create, GET
		// "/:id" -> get), so it must mount at "/memories" under "/api" — same
		// wiring as production routes/index.ts (router.use("/memories", ...)).
		// Mounting at bare "/api" would 404 POST /api/memories and
		// GET /api/memories/:id.
		app.use("/api/memories", memoryRoutes);
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	it("returns global orchestration stats and aggregate throughput without repo filter", async () => {
		const { db } = await import("../../dashboard/lib/context");
		const now = new Date().toISOString();

		const activeTaskId = randomUUID();
		db.tasks.insertTask({
			id: activeTaskId,
			owner: "test",
			repo: "orchestrator-a",
			task_code: "ORCH-A-1",
			phase: "implementation",
			title: "Repo A active task",
			description: "active",
			status: "in_progress",
			priority: 4,
			agent: "agent-a",
			role: "worker",
			doc_path: null,
			suggested_skills: [],
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: null,
			canceled_at: null,
			est_tokens: 50,
			tags: [],
			commit_id: null,
			changed_files: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});

		const completedTaskId = randomUUID();
		db.tasks.insertTask({
			id: completedTaskId,
			owner: "test",
			repo: "orchestrator-b",
			task_code: "ORCH-B-1",
			phase: "testing",
			title: "Repo B completed task",
			description: "done",
			status: "completed",
			priority: 3,
			agent: "agent-b",
			role: "worker",
			doc_path: null,
			suggested_skills: [],
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: now,
			canceled_at: null,
			est_tokens: 120,
			tags: [],
			commit_id: null,
			changed_files: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});

		db.handoffs.claimTask({
			owner: "test",
			repo: "orchestrator-a",
			task_id: activeTaskId,
			agent: "agent-orchestrator",
			role: "worker"
		});

		db.handoffs.createHandoff({
			owner: "test",
			repo: "orchestrator-a",
			from_agent: "agent-a",
			summary: "Need follow-up on review findings",
			context: { next_steps: ["continue"] }
		});

		const statsRes = await fetch(`${baseUrl}/api/stats`);
		expect(statsRes.ok).toBe(true);
		const statsBody = (await statsRes.json()) as any;
		expect(statsBody.data.attributes.scope).toBe("global");
		expect(statsBody.data.attributes.repoCount).toBeGreaterThanOrEqual(2);
		expect(statsBody.data.attributes.coordination.activeClaims).toBeGreaterThanOrEqual(1);
		expect(statsBody.data.attributes.coordination.pendingHandoffs).toBeGreaterThanOrEqual(1);
		expect(statsBody.data.attributes.repos.length).toBeGreaterThanOrEqual(2);

		const timeRes = await fetch(`${baseUrl}/api/tasks/stats/time`);
		expect(timeRes.ok).toBe(true);
		const timeBody = (await timeRes.json()) as any;
		expect(timeBody.data.attributes.daily.added).toBeGreaterThanOrEqual(2);
		expect(timeBody.data.attributes.overall.completed).toBeGreaterThanOrEqual(1);
		expect(timeBody.data.attributes.overall.tokens).toBeGreaterThanOrEqual(120);
	});

	it("returns system metrics with worker embed latency and skips DB refresh (OPT-OBS-01)", async () => {
		const { db } = await import("../../dashboard/lib/context");
		// refresh:false must mean SystemController.getMetrics never touches the DB.
		const refreshSpy = vi.spyOn(db, "refresh");

		// System routes mount under `/api` (routes/index.ts + server.ts), so the
		// endpoint serves at /api/metrics — same prefix as /api/stats below.
		const res = await fetch(`${baseUrl}/api/metrics`);
		expect(res.ok).toBe(true);
		const body = (await res.json()) as any;
		expect(body.data.type).toBe("system-metrics");
		const attrs = body.data.attributes;

		expect(attrs.process).toBe("dashboard");
		expect(typeof attrs.uptimeSeconds).toBe("number");
		expect(typeof attrs.pid).toBe("number");
		// Dispatch-side series are empty-by-design in the dashboard process;
		// they are populated by the MCP child process (process-local registry).
		expect(attrs.tools).toEqual({});
		expect(attrs.writeHandler.total.count).toBe(0);
		expect(Array.isArray(attrs.writeHandler.byTool) ? true : typeof attrs.writeHandler.byTool).toBe("object");
		// embedLatency mirrors the (stubbed) worker stats.
		expect(attrs.embedLatency.count).toBeGreaterThanOrEqual(0);

		const worker = attrs.worker;
		expect(worker.embedLatency).toEqual({ count: 1, avgMs: 42, p50Ms: 40, p95Ms: 60, maxMs: 70 });

		expect(refreshSpy).not.toHaveBeenCalled();
		refreshSpy.mockRestore();
	});

	// ── Recent-actions feed (TASK-187 / POLICY 2) ──────────────────────────
	// Direct endpoint-level proof that GET /api/recent-actions mirrors the
	// mutation-only action log: a dispatched create surfaces in the feed
	// (action type + entity id + JSON:API feed shape), while a GET detail read
	// on the same repo adds no row. The in-memory store is shared across the
	// file, so every test uses its own repo to keep the feed scoped/isolated.

	describe("Recent-actions feed (TASK-187 / POLICY 2)", () => {
		const fetchRecentActions = async (repo: string) => {
			const res = await fetch(`${baseUrl}/api/recent-actions?repo=${encodeURIComponent(repo)}&page=1&pageSize=100`);
			expect(res.ok).toBe(true);
			const body = (await res.json()) as any;
			return { body, items: body.data as Array<Record<string, any>>, totalItems: body.meta.totalItems as number };
		};

		const createMemory = (repo: string, title: string) =>
			fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo,
							type: "code_fact",
							title,
							content: "recent-actions feed target",
							importance: 3
						}
					}
				})
			});

		it("GET /api/recent-actions returns the mutation row for a dispatched create", async () => {
			const repo = `recent-actions-write-${randomUUID().slice(0, 8)}`;

			const created = await createMemory(repo, "Feed visibility target");
			expect(created.status).toBe(200);
			const memoryId = ((await created.json()) as any).data.id as string;

			const { body, items, totalItems } = await fetchRecentActions(repo);
			expect(totalItems).toBe(1);
			expect(items.length).toBe(1);

			// Feed contract (SystemController.getRecentActions → jsonApiRes):
			// data[].type is "recent-action", id is the action-log id, and the
			// attributes carry the action fields joined with memory title/type.
			const item = items[0];
			expect(item.type).toBe("recent-action");
			expect(typeof item.id).toBe("string");
			expect(item.attributes.action).toBe("write");
			expect(item.attributes.memory_id).toBe(memoryId);
			expect(item.attributes.memory_title).toBe("Feed visibility target");
			expect(item.attributes.memory_type).toBe("code_fact");
			expect(typeof item.attributes.created_at).toBe("string");
			expect(item.attributes.burstCount).toBe(1);

			expect(body.meta.page).toBe(1);
			expect(body.meta.pageSize).toBe(100);
			expect(body.jsonapi.version).toBe("1.1");
		});

		it("GET /api/memories/:id (read) does NOT add a row to the recent-actions feed", async () => {
			const repo = `recent-actions-read-${randomUUID().slice(0, 8)}`;

			const created = await createMemory(repo, "Read-only feed target");
			expect(created.status).toBe(200);
			const memoryId = ((await created.json()) as any).data.id as string;

			const before = await fetchRecentActions(repo);
			expect(before.totalItems).toBe(1);

			// POLICY 2 (TASK-186): the detail read is side-effect-free — it must
			// NOT emit an action_log row, so the feed stays unchanged.
			const read = await fetch(`${baseUrl}/api/memories/${memoryId}`);
			expect(read.status).toBe(200);

			const after = await fetchRecentActions(repo);
			expect(after.totalItems).toBe(before.totalItems);
			expect(after.items.length).toBe(1);
			expect(after.items[0].attributes.action).toBe("write");
			expect(after.items[0].attributes.memory_id).toBe(memoryId);
			// A merged burst (same action + memory_id) would still keep totalItems
			// at 1 via condenseRecentActions, so pin burstCount to catch a read
			// that logs a row with an identical action label.
			expect(after.items[0].attributes.burstCount).toBe(1);
		});
	});
});
