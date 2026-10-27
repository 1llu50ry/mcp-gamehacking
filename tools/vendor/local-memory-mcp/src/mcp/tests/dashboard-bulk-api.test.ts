import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { randomUUID } from "crypto";
import type { AddressInfo } from "node:net";
import type { Task } from "../types";
import type { CodingStandardEntry } from "../types";

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

const REPO = "dashboard-bulk-api";

function makeTask(overrides: Partial<Task> = {}): Task {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		owner: "test",
		repo: REPO,
		task_code: `BULK-${randomUUID().slice(0, 6)}`,
		phase: "test",
		title: "Bulk API task",
		description: "Bulk API task description",
		status: "backlog",
		priority: 3,
		agent: "test",
		role: "test",
		doc_path: null,
		created_at: now,
		updated_at: now,
		in_progress_at: null,
		finished_at: null,
		canceled_at: null,
		est_tokens: 0,
		commit_id: null,
		changed_files: [],
		tags: [],
		suggested_skills: [],
		metadata: {},
		parent_id: null,
		depends_on: null,
		...overrides
	};
}

function makeStandard(overrides: Partial<CodingStandardEntry> = {}): CodingStandardEntry {
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		title: "Bulk API standard",
		content: "Bulk API standard content",
		parent_id: null,
		context: "general",
		version: "1.0.0",
		language: null,
		stack: [],
		is_global: true,
		owner: "test",
		repo: null,
		tags: [],
		metadata: {},
		created_at: now,
		updated_at: now,
		hit_count: 0,
		last_used_at: null,
		agent: "test",
		model: "test-model",
		...overrides
	};
}

describe("Dashboard Bulk Action API", () => {
	let app: express.Express;
	let server: ReturnType<express.Express["listen"]>;
	let baseUrl: string;

	beforeAll(async () => {
		const taskRoutes = (await import("../../dashboard/routes/task.routes")).default;
		const standardRoutes = (await import("../../dashboard/routes/standard.routes")).default;
		app = express();
		app.use(express.json());
		app.use("/api/tasks", taskRoutes);
		app.use("/api/standards", standardRoutes);
		server = app.listen(0);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	describe("POST /api/tasks/action bulk delete", () => {
		it("positive: deletes multiple tasks and returns the count", async () => {
			const { db } = await import("../../dashboard/lib/context");
			const task1 = makeTask({ task_code: "BULK-T1", title: "Bulk task 1" });
			const task2 = makeTask({ task_code: "BULK-T2", title: "Bulk task 2", status: "pending" });
			db.tasks.insertTask(task1);
			db.tasks.insertTask(task2);

			const res = await fetch(`${baseUrl}/api/tasks/action`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "delete", ids: [task1.id, task2.id] })
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.attributes.count).toBe(2);
		});

		it("negative: returns 400 when ids is missing", async () => {
			const res = await fetch(`${baseUrl}/api/tasks/action`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "delete" })
			});

			expect(res.status).toBe(400);
		});

		it("positive: updates multiple tasks and returns the count", async () => {
			const { db } = await import("../../dashboard/lib/context");
			const task1 = makeTask({ task_code: "BULK-U1", title: "Bulk update task 1" });
			const task2 = makeTask({ task_code: "BULK-U2", title: "Bulk update task 2" });
			db.tasks.insertTask(task1);
			db.tasks.insertTask(task2);

			const res = await fetch(`${baseUrl}/api/tasks/action`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action: "update",
					ids: [task1.id, task2.id],
					updates: { status: "pending" }
				})
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.attributes.count).toBe(2);
		});

		it("negative: returns 400 for an invalid action", async () => {
			const res = await fetch(`${baseUrl}/api/tasks/action`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "bogus", ids: [randomUUID()] })
			});

			expect(res.status).toBe(400);
		});

		it("negative: returns 400 when update action has no updates", async () => {
			const res = await fetch(`${baseUrl}/api/tasks/action`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "update", ids: [randomUUID()] })
			});

			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/standards/action bulk", () => {
		it("positive: deletes multiple standards and returns the count", async () => {
			const { db } = await import("../../dashboard/lib/context");
			const standard1 = makeStandard({ title: "Bulk standard 1" });
			const standard2 = makeStandard({ title: "Bulk standard 2" });
			db.standards.insert(standard1);
			db.standards.insert(standard2);

			const res = await fetch(`${baseUrl}/api/standards/action`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "delete", ids: [standard1.id, standard2.id] })
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.attributes.count).toBe(2);
		});

		it("positive: updates multiple standards and returns the count", async () => {
			const { db } = await import("../../dashboard/lib/context");
			const standard1 = makeStandard({ title: "Updateable standard 1" });
			const standard2 = makeStandard({ title: "Updateable standard 2" });
			db.standards.insert(standard1);
			db.standards.insert(standard2);

			const res = await fetch(`${baseUrl}/api/standards/action`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "update", ids: [standard1.id, standard2.id], updates: { tags: ["updated"] } })
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.attributes.count).toBe(2);
		});

		it("negative: returns 400 for an invalid action", async () => {
			const res = await fetch(`${baseUrl}/api/standards/action`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "invalid", ids: [randomUUID()] })
			});

			expect(res.status).toBe(400);
		});
	});
});
