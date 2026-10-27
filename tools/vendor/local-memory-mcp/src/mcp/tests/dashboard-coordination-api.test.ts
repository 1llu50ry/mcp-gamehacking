import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { randomUUID } from "crypto";
import type { AddressInfo } from "node:net";

vi.mock("../../dashboard/lib/context", async () => {
	const { SQLiteStore } = await import("../../mcp/storage/sqlite");
	const { StubVectorStore } = await import("../../mcp/storage/vectors.stub");
	const { createRouter } = await import("../../mcp/router");
	const db = new SQLiteStore(":memory:");
	const vectors = new StubVectorStore(db);
	const router = createRouter(db, vectors);

	return {
		db,
		vectors,
		mcpClient: {
			start: vi.fn(),
			stop: vi.fn(),
			isConnected: vi.fn(() => true),
			getPendingCount: vi.fn(() => 0),
			callTool: vi.fn(async (name: string, args: Record<string, unknown>) =>
				router("tools/call", {
					name,
					arguments: { owner: "test", ...args, json: true }
				})
			)
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

describe("Dashboard Coordination API", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const taskRoutes = (await import("../../dashboard/routes/task.routes")).default;
		const coordinationRoutes = (await import("../../dashboard/routes/coordination.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api/tasks", taskRoutes);
		app.use("/api/coordination", coordinationRoutes);
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	it("lists and releases claims through dashboard coordination API", async () => {
		const { db } = await import("../../dashboard/lib/context");
		const taskId = randomUUID();
		const now = new Date().toISOString();

		db.tasks.insertTask({
			id: taskId,
			owner: "test",
			repo: "dashboard-coordination",
			task_code: "COORD-101",
			phase: "implementation",
			title: "Coordination visible task",
			description: "Used to validate claims API",
			status: "in_progress",
			priority: 3,
			agent: "agent-a",
			role: "worker",
			doc_path: null,
			suggested_skills: [],
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: null,
			canceled_at: null,
			est_tokens: 5,
			tags: [],
			commit_id: null,
			changed_files: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});
		db.handoffs.claimTask({
			owner: "test",
			repo: "dashboard-coordination",
			task_id: taskId,
			agent: "agent-a",
			role: "worker"
		});

		const listRes = await fetch(`${baseUrl}/api/coordination/claims?repo=dashboard-coordination`);
		expect(listRes.ok).toBe(true);
		const listed = (await listRes.json()) as any;
		expect(listed.data).toHaveLength(1);
		expect(listed.data[0].attributes.task_code).toBe("COORD-101");

		const releaseRes = await fetch(`${baseUrl}/api/coordination/claims/release`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				repo: "dashboard-coordination",
				task_code: "COORD-101",
				agent: "agent-a",
				release: true
			})
		});
		expect(releaseRes.ok).toBe(true);
		expect(db.handoffs.getClaim(taskId)).toBeNull();
	});

	it("updates tasks via MCP task-update flow so claims and handoffs are cleaned up", async () => {
		const { db } = await import("../../dashboard/lib/context");
		const taskId = randomUUID();
		const now = new Date().toISOString();

		db.tasks.insertTask({
			id: taskId,
			owner: "test",
			repo: "dashboard-update-flow",
			task_code: "FLOW-101",
			phase: "implementation",
			title: "Task updated via dashboard route",
			description: "Used to validate MCP update flow",
			status: "in_progress",
			priority: 3,
			agent: "agent-b",
			role: "worker",
			doc_path: null,
			suggested_skills: [],
			created_at: now,
			updated_at: now,
			in_progress_at: now,
			finished_at: null,
			canceled_at: null,
			est_tokens: 42,
			tags: [],
			commit_id: null,
			changed_files: [],
			metadata: {},
			parent_id: null,
			depends_on: null
		});
		db.handoffs.claimTask({
			owner: "test",
			repo: "dashboard-update-flow",
			task_id: taskId,
			agent: "agent-b",
			role: "worker"
		});
		const handoff = db.handoffs.createHandoff({
			owner: "test",
			repo: "dashboard-update-flow",
			from_agent: "agent-b",
			task_id: taskId,
			summary: "Hand off remaining review",
			context: { remaining_work: "Resolve review comments" }
		});

		const updateRes = await fetch(`${baseUrl}/api/tasks/${taskId}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "completed", est_tokens: 100 })
		});

		expect(updateRes.ok).toBe(true);
		const updated = (await updateRes.json()) as any;
		expect(updated.data.attributes.status).toBe("completed");
		expect(db.handoffs.getClaim(taskId)).toBeNull();
		expect(db.handoffs.getHandoffById(handoff.id)?.status).toBe("expired");
	});
});
