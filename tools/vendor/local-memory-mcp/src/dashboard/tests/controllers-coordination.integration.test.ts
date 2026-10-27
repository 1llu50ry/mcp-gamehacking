/**
 * Coordination Controller integration tests (TASK-428 split from controllers.integration.test.ts).
 *
 * Covers CoordinationController read endpoints (Coordination API) and the
 * coordination subset of the Write-lock scope regression (TASK-102 /
 * OPT-FEAT-01 — coordination mutations must acquire db.withWrite).
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
import { db } from "./controllers.shared";
import { startControllersServer } from "./controllers.shared";

describe("Dashboard Controllers — Coordination API", () => {
	let serverHandle: Awaited<ReturnType<typeof startControllersServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		serverHandle = await startControllersServer();
		baseUrl = serverHandle.baseUrl;
	});

	afterAll(async () => {
		await serverHandle.close();
	});

	// ── Coordination Controller ────────────────────────────────────────────

	describe("Coordination API", () => {
		it("GET /api/coordination/claims returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/coordination/claims`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/coordination/claims?repo=test-repo returns 200 with array", async () => {
			const res = await fetch(`${baseUrl}/api/coordination/claims?repo=test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.meta).toHaveProperty("page");
			expect(body.meta).toHaveProperty("totalItems");
		});
	});

	// ── Write-lock scope (TASK-102) — Coordination subset ──────────────────

	describe("Write-lock scope (TASK-102) — Coordination subset", () => {
		let withWriteSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
		});

		afterEach(() => {
			withWriteSpy.mockRestore();
		});

		it("GET /api/coordination/handoffs does NOT acquire the write lock", async () => {
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/coordination/handoffs?repo=lock-test-repo`);
			expect(res.status).toBe(200);
			expect(withWriteSpy).not.toHaveBeenCalled();
		});

		it("POST /api/coordination/handoffs/status acquires the write lock", async () => {
			// Seed a handoff directly via the real store (mocked mcpClient
			// doesn't persist, so HTTP seeding would yield no DB row).
			const handoff = db.handoffs.createHandoff({
				owner: "test-owner",
				repo: "lock-test-repo",
				from_agent: "backend",
				summary: "handoff-status write lock target"
			});
			withWriteSpy.mockClear();

			const res = await fetch(`${baseUrl}/api/coordination/handoffs/status`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "tool-result",
						attributes: { id: handoff.id, status: "expired" }
					}
				})
			});
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("POST /api/coordination/claims/release acquires the write lock", async () => {
			// Seed a task directly, then claim it via the real store so the
			// release has a real target in the DB.
			const now = new Date().toISOString();
			const taskId = randomUUID();
			db.tasks.insertTask({
				id: taskId,
				owner: "test-owner",
				repo: "lock-test-repo",
				task_code: "T-LOCK-RELEASE",
				phase: "test",
				title: "claim-release lock target",
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
			});
			db.handoffs.claimTask({
				owner: "test-owner",
				repo: "lock-test-repo",
				task_id: taskId,
				agent: "backend"
			});
			withWriteSpy.mockClear();

			const released = await fetch(`${baseUrl}/api/coordination/claims/release`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "tool-result",
						attributes: {
							owner: "test-owner",
							repo: "lock-test-repo",
							task_id: taskId
						}
					}
				})
			});
			expect(released.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});
	});
});
