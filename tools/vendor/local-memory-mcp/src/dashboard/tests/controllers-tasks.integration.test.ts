/**
 * Tasks Controller integration tests (TASK-428 split from controllers.integration.test.ts).
 *
 * Covers TasksController read endpoints (Tasks API), the tasks subset of the
 * Bulk actions API (OPT-FEAT-04 / STR-01 — POST /api/tasks/action), and the
 * task subset of the Action-log policy (TASK-186 / OPT-PERF-05).
 *
 * Split from the original 2165-line file; the shared `vi.mock` + server
 * factory live in controllers.shared.ts. Tests are relocated verbatim — no
 * behavior change.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
// Resolves to the mocked context module (vi.mock lives in controllers.shared.ts,
// which must be imported before any route module). `db` is re-exported from the
// shared module so the test seeds the SAME in-memory store the route mounts.
import { db, mcpClient } from "./controllers.shared";
import { startControllersServer } from "./controllers.shared";

describe("Dashboard Controllers — Tasks API", () => {
	let serverHandle: Awaited<ReturnType<typeof startControllersServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		serverHandle = await startControllersServer();
		baseUrl = serverHandle.baseUrl;
	});

	afterAll(async () => {
		await serverHandle.close();
	});

	// ── Tasks Controller ──────────────────────────────────────────────────

	describe("Tasks API", () => {
		it("GET /api/tasks returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/tasks`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/tasks?repo=test-repo returns 200 with paginated results", async () => {
			const res = await fetch(`${baseUrl}/api/tasks?repo=test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.meta).toHaveProperty("page");
			expect(body.meta).toHaveProperty("totalItems");
		});

		it("GET /api/tasks/nonexist returns 404", async () => {
			const res = await fetch(`${baseUrl}/api/tasks/00000000-0000-0000-0000-000000000000`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/not found/i);
		});

		it("GET /api/tasks/by-code returns 400 when repo or task_code missing", async () => {
			const res = await fetch(`${baseUrl}/api/tasks/by-code`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo and task_code/i);
		});

		it("GET /api/tasks/stats/time returns 200 with time stats", async () => {
			const res = await fetch(`${baseUrl}/api/tasks/stats/time`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("performance-stats");
			expect(body.data.attributes).toHaveProperty("daily");
			expect(body.data.attributes).toHaveProperty("weekly");
			expect(body.data.attributes).toHaveProperty("monthly");
			expect(body.data.attributes).toHaveProperty("overall");
		});
	});

	// ── Bulk actions API (OPT-FEAT-04 / STR-01) — Task subset ─────────────
	// Zero-test-coverage bulk paths. The compound delete/update bodies route
	// through the EXCLUSIVE write path (withExclusiveWrite) — passthrough-spied
	// exactly like the Write-lock scope describe so parallel forks don't
	// contend on the real proper-lockfile target.

	describe("Bulk actions API (OPT-FEAT-04 / STR-01) — Task subset", () => {
		let exclusiveSpy: ReturnType<typeof vi.spyOn>;

		const seedTask = (overrides: Record<string, unknown> = {}) => {
			const now = new Date().toISOString();
			const id = randomUUID();
			db.tasks.insertTask({
				id,
				owner: "test-owner",
				repo: "bulk-test-repo",
				task_code: `T-BULK-${id.slice(0, 8)}`,
				phase: "test",
				title: "bulk action target",
				description: null,
				status: "pending",
				priority: 3,
				agent: "",
				role: "",
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
			} as never);
			return id;
		};

		const postAction = (path: string, attributes: Record<string, unknown>) =>
			fetch(`${baseUrl}${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ data: { type: "action", attributes } })
			});

		beforeEach(async () => {
			exclusiveSpy = vi.spyOn(db, "withExclusiveWrite").mockImplementation(async (fn) => fn());
			(mcpClient.callTool as ReturnType<typeof vi.fn>).mockClear();
		});

		afterEach(() => {
			exclusiveSpy.mockRestore();
		});

		describe("POST /api/tasks/action", () => {
			it("delete soft-cancels existing tasks (status → canceled) and returns count", async () => {
				const id = seedTask();

				const res = await postAction("/api/tasks/action", { action: "delete", ids: [id] });
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(1);

				// Soft-cancel contract (OPT-DRY-03): the row survives with
				// status canceled — not a hard delete.
				const task = db.tasks.getTaskById(id);
				expect(task).not.toBeNull();
				expect(task?.status).toBe("canceled");
			});

			it("canceled tasks are excluded from the default list unless ?status=canceled (TASK-209)", async () => {
				const repo = "task-read-repo";
				const id = seedTask({ repo, owner: "test-owner", status: "canceled" });

				// Default list hides canceled (soft-deleted) tasks…
				const list = await fetch(`${baseUrl}/api/tasks?repo=${repo}`);
				expect(list.status).toBe(200);
				const listBody = (await list.json()) as Record<string, any>;
				expect((listBody.data as Array<{ id: string }>).map((d) => d.id)).not.toContain(id);

				// …but an explicit ?status=canceled filter still returns them.
				const listCanceled = await fetch(`${baseUrl}/api/tasks?repo=${repo}&status=canceled`);
				expect(listCanceled.status).toBe(200);
				const canceledBody = (await listCanceled.json()) as Record<string, any>;
				expect((canceledBody.data as Array<{ id: string }>).map((d) => d.id)).toContain(id);
			});

			it("delete with phantom ids returns count 0 and cancels nothing", async () => {
				const res = await postAction("/api/tasks/action", {
					action: "delete",
					ids: [randomUUID()]
				});
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(0);
			});

			it("status/update routes each id through mcpClient.callTool('task-update', …)", async () => {
				const id1 = seedTask();
				const id2 = seedTask();

				const res = await postAction("/api/tasks/action", {
					action: "status",
					ids: [id1, id2],
					updates: { status: "completed" }
				});
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(2);

				// The dashboard delegates task mutations to the MCP client —
				// assert the mocked callTool got the right tool + per-id args.
				expect(mcpClient.callTool).toHaveBeenCalledTimes(2);
				expect(mcpClient.callTool).toHaveBeenCalledWith(
					"task-update",
					expect.objectContaining({ id: id1, status: "completed", agent: "dashboard", structured: true })
				);
				expect(mcpClient.callTool).toHaveBeenCalledWith(
					"task-update",
					expect.objectContaining({ id: id2, status: "completed", agent: "dashboard", structured: true })
				);
			});

			it("update with no updates payload → 400", async () => {
				const id = seedTask();

				const res = await postAction("/api/tasks/action", { action: "update", ids: [id] });
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/updates/i);
			});

			it("invalid action → 400", async () => {
				const res = await postAction("/api/tasks/action", {
					action: "explode",
					ids: [randomUUID()]
				});
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/invalid action/i);
			});

			it("non-array ids → 400", async () => {
				const res = await postAction("/api/tasks/action", {
					action: "delete",
					ids: "not-an-array"
				});
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/ids/i);
			});

			it("status with all-unknown ids → 422", async () => {
				const res = await postAction("/api/tasks/action", {
					action: "status",
					ids: [randomUUID(), randomUUID()],
					updates: { status: "completed" }
				});
				expect(res.status).toBe(422);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/all tasks failed/i);
			});
		});
	});

	// ── Action-log policy (TASK-186 / OPT-PERF-05) — Task subset ──────────
	// POLICY 2: reads never write. Dashboard GET detail endpoints must NOT emit
	// action_log rows — only mutations do.

	describe("Action-log policy (TASK-186 / OPT-PERF-05) — Task subset", () => {
		const actionCountForRepo = (repo: string): number => db.actions.getRecentActions("", repo, 10_000).length;

		it("GET /api/tasks/:id (read) does NOT write an action-log row", async () => {
			const repo = "policy-read-task-repo";
			const now = new Date().toISOString();
			const id = randomUUID();
			db.tasks.insertTask({
				id,
				owner: "test-owner",
				repo,
				task_code: "T-POLICY-READ",
				phase: "test",
				title: "read-only task",
				description: null,
				status: "pending",
				priority: 3,
				agent: "",
				role: "",
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
				depends_on: null
			} as never);

			const before = actionCountForRepo(repo);
			const res = await fetch(`${baseUrl}/api/tasks/${id}`);
			expect(res.status).toBe(200);
			expect(actionCountForRepo(repo)).toBe(before);
		});
	});
});
