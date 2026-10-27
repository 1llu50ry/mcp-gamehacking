/**
 * Arena Overview aggregate integration tests (TASK-428 split from controllers.integration.test.ts).
 *
 * Covers the DashboardController /api/dashboard/overview endpoint (TASK-269 /
 * audit F7) — the merged tasks/claims/handoffs aggregate that replaces the
 * old ~5×N per-repo fan-out.
 *
 * Split from the original 2165-line file; the shared `vi.mock` + server
 * factory live in controllers.shared.ts. Tests are relocated verbatim — no
 * behavior change.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
// Resolves to the mocked context module (vi.mock lives in controllers.shared.ts,
// which must be imported before any route module). `db` is re-exported from the
// shared module so the test seeds the SAME in-memory store the route mounts.
import { db } from "./controllers.shared";
// Arena overview aggregate cache (TASK-269 / audit F7) — cleared between tests
// so each case starts from a cold cache regardless of run order.
import { clearArenaOverviewCache } from "../services/arena.service";
import { startControllersServer } from "./controllers.shared";

describe("Dashboard Controllers — Arena Overview", () => {
	let serverHandle: Awaited<ReturnType<typeof startControllersServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		serverHandle = await startControllersServer();
		baseUrl = serverHandle.baseUrl;
	});

	afterAll(async () => {
		await serverHandle.close();
	});

	// ── Arena Overview aggregate (TASK-269 / audit F7) ───────────────────
	// ONE /api/dashboard/overview response replaces the ~5×N per-repo fan-out
	// the Agent Arena fired on first load. It must return the same merged
	// task/claim/handoff rows across all repos.

	describe("Dashboard API — arena overview aggregate (TASK-269)", () => {
		const now = new Date().toISOString();

		const seedTask = (repo: string, status: string, code: string) => {
			const id = randomUUID();
			db.tasks.insertTask({
				id,
				owner: "",
				repo,
				task_code: code,
				phase: "test",
				title: `arena task ${code}`,
				description: null,
				status,
				priority: 3,
				agent: "probe-agent",
				role: "backend",
				doc_path: null,
				created_at: now,
				updated_at: now,
				in_progress_at: null,
				finished_at: null,
				canceled_at: null,
				est_tokens: 100,
				commit_id: null,
				changed_files: [],
				tags: [],
				suggested_skills: [],
				metadata: {},
				parent_id: null,
				depends_on: null
			} as never);
			return id;
		};

		beforeEach(() => {
			clearArenaOverviewCache();
		});

		it("returns merged tasks/claims/handoffs across all repos in ONE response", async () => {
			const repoA = "arena-overview-a";
			const repoB = "arena-overview-b";
			const tA = seedTask(repoA, "in_progress", "AROV-A-1");
			seedTask(repoB, "pending", "AROV-B-1");
			db.handoffs.claimTask({ owner: "", repo: repoA, task_id: tA, agent: "probe-agent" });
			db.handoffs.createHandoff({
				owner: "",
				repo: repoB,
				from_agent: "probe-agent",
				to_agent: "other-agent",
				summary: "arena handoff B"
			});

			const res = await fetch(`${baseUrl}/api/dashboard/overview`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("arena-overview");
			const attrs = body.data.attributes as Record<string, any>;
			expect(Array.isArray(attrs.tasks)).toBe(true);
			expect(Array.isArray(attrs.claims)).toBe(true);
			expect(Array.isArray(attrs.handoffs)).toBe(true);
			const taskCodes = (attrs.tasks as Array<{ task_code: string }>).map((t) => t.task_code);
			expect(taskCodes).toContain("AROV-A-1");
			expect(taskCodes).toContain("AROV-B-1");
			expect((attrs.tasks as unknown[]).length).toBeGreaterThan(0);
			expect((attrs.claims as unknown[]).length).toBeGreaterThan(0);
			expect((attrs.handoffs as Array<{ summary: string }>).some((h) => h.summary === "arena handoff B")).toBe(true);
		});

		it("respects the per-status/per-repo caps of the old fan-out", async () => {
			const repo = "arena-overview-caps";
			// 12 in_progress tasks — the old client only pulled 10 per repo.
			for (let i = 0; i < 12; i++) {
				seedTask(repo, "in_progress", `AROV-CAP-${i}`);
			}

			const res = await fetch(`${baseUrl}/api/dashboard/overview`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			const attrs = body.data.attributes as Record<string, any>;
			const ipTasks = (attrs.tasks as Array<{ status: string }>).filter((t) => t.status === "in_progress");
			// 12 seeded + any other in_progress rows from earlier tests in this
			// process — the per-repo cap still binds at 10 for this repo.
			const ipForRepo = (attrs.tasks as Array<{ repo: string; status: string }>).filter(
				(t) => t.repo === repo && t.status === "in_progress"
			);
			expect(ipForRepo.length).toBe(10);
			expect(ipTasks.length).toBeGreaterThanOrEqual(10);
		});
	});
});
