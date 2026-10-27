/**
 * Standards Controller integration tests (TASK-428 split from controllers.integration.test.ts).
 *
 * Covers StandardsController read/create endpoints (Standards API), the
 * standards subset of the Write-lock scope regression (TASK-102), the
 * standards subset of the Bulk actions API (OPT-FEAT-04 / STR-01 — POST
 * /api/standards/action), and the standard subset of the Action-log policy
 * (TASK-186 / OPT-PERF-05).
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

describe("Dashboard Controllers — Standards API", () => {
	let serverHandle: Awaited<ReturnType<typeof startControllersServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		serverHandle = await startControllersServer();
		baseUrl = serverHandle.baseUrl;
	});

	afterAll(async () => {
		await serverHandle.close();
	});

	// ── Standards Controller ───────────────────────────────────────────────

	describe("Standards API", () => {
		it("GET /api/standards returns 200 with results", async () => {
			const res = await fetch(`${baseUrl}/api/standards`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.meta).toHaveProperty("page");
			expect(body.meta).toHaveProperty("totalItems");
		});

		it("GET /api/standards/nonexist returns 404", async () => {
			const res = await fetch(`${baseUrl}/api/standards/00000000-0000-0000-0000-000000000000`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/not found/i);
		});

		it("POST /api/standards returns 400 when required fields missing", async () => {
			const res = await fetch(`${baseUrl}/api/standards`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "incomplete" })
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/required fields/i);
		});

		it("GET /api/standards/export returns 200 with export payload", async () => {
			const res = await fetch(`${baseUrl}/api/standards/export`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("standard-export");
			expect(body.data.attributes).toHaveProperty("schema");
			expect(body.data.attributes).toHaveProperty("standards");
			expect(Array.isArray(body.data.attributes.standards)).toBe(true);
		});
	});

	// ── Write-lock scope (TASK-102) — Standards subset ─────────────────────

	describe("Write-lock scope (TASK-102) — Standards subset", () => {
		let withWriteSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
		});

		afterEach(() => {
			withWriteSpy.mockRestore();
		});

		it("POST /api/standards (create) acquires the write lock", async () => {
			const res = await fetch(`${baseUrl}/api/standards`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "standard",
						attributes: {
							title: "Lock scope standard",
							content: "must be inserted under withWrite",
							tags: ["lock-scope"],
							metadata: { source: "regression-test" }
						}
					}
				})
			});
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("POST /api/standards/import acquires the write lock", async () => {
			// TASK-160 / FIX-164: the compound import loop routes through the
			// EXCLUSIVE path (withExclusiveWrite) so the getById/getByCode →
			// update/insert per-iteration sequence serializes cross-process; it
			// no longer crosses the fast-path withWrite.
			const exclusiveSpy = vi.spyOn(db, "withExclusiveWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/standards/import`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						standards: [{ title: "Imported standard", content: "imported body" }]
					})
				});
				expect(res.status).toBe(200);
				expect(exclusiveSpy).toHaveBeenCalledTimes(1);
				expect(withWriteSpy).not.toHaveBeenCalled();
			} finally {
				exclusiveSpy.mockRestore();
			}
		});

		it("PUT + DELETE /api/standards/:id acquire the write lock", async () => {
			const created = await fetch(`${baseUrl}/api/standards`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "standard",
						attributes: {
							title: "Update me",
							content: "seed standard",
							tags: ["lock-scope"],
							metadata: { source: "regression-test" }
						}
					}
				})
			});
			expect(created.status).toBe(200);
			const id = ((await created.json()) as Record<string, any>).data.id as string;
			withWriteSpy.mockClear();

			const updated = await fetch(`${baseUrl}/api/standards/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ data: { type: "standard", attributes: { title: "Updated" } } })
			});
			expect(updated.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);

			const deleted = await fetch(`${baseUrl}/api/standards/${id}`, { method: "DELETE" });
			expect(deleted.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(2);
		});
	});

	// ── Bulk actions API (OPT-FEAT-04 / STR-01) — Standards subset ────────

	describe("Bulk actions API (OPT-FEAT-04 / STR-01) — Standards subset", () => {
		let exclusiveSpy: ReturnType<typeof vi.spyOn>;

		const seedStandard = (overrides: Record<string, unknown> = {}) => {
			const now = new Date().toISOString();
			const id = randomUUID();
			db.standards.insert({
				id,
				title: "Bulk standard",
				content: "bulk standard body",
				parent_id: null,
				context: "general",
				version: "1.0.0",
				language: null,
				stack: [],
				is_global: false,
				owner: "test-owner",
				repo: "bulk-test-repo",
				tags: ["bulk"],
				metadata: {},
				created_at: now,
				updated_at: now,
				hit_count: 0,
				last_used_at: null,
				agent: "test",
				model: "test",
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

		describe("POST /api/standards/action", () => {
			it("delete hard-deletes standards (getById → null)", async () => {
				const id = seedStandard();

				const res = await postAction("/api/standards/action", { action: "delete", ids: [id] });
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(1);

				// Hard-delete contract: the row is gone, not soft-marked.
				expect(db.standards.getById(id)).toBeNull();
			});

			it("update applies bulkUpdateStandards — field actually changed", async () => {
				const id = seedStandard();

				const res = await postAction("/api/standards/action", {
					action: "update",
					ids: [id],
					updates: { title: "Renamed bulk standard" }
				});
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(1);

				const updated = db.standards.getById(id);
				expect(updated?.title).toBe("Renamed bulk standard");
			});

			it("invalid action → 400", async () => {
				const res = await postAction("/api/standards/action", {
					action: "explode",
					ids: [randomUUID()]
				});
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/invalid action/i);
			});

			it("non-array ids → 400", async () => {
				const res = await postAction("/api/standards/action", {
					action: "delete",
					ids: "not-an-array"
				});
				expect(res.status).toBe(400);
				const body = (await res.json()) as Record<string, any>;
				expect(body.errors[0].detail).toMatch(/ids/i);
			});
		});
	});

	// ── Action-log policy (TASK-186 / OPT-PERF-05) — Standards subset ─────

	describe("Action-log policy (TASK-186 / OPT-PERF-05) — Standards subset", () => {
		const actionCountForRepo = (repo: string): number => db.actions.getRecentActions("", repo, 10_000).length;

		it("GET /api/standards/:id (read) does NOT write an action-log row", async () => {
			const repo = "policy-read-standard-repo";
			const created = await fetch(`${baseUrl}/api/standards`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "standard",
						attributes: {
							repo,
							title: "Read-only standard",
							content: "reads must not log",
							tags: ["policy"],
							metadata: { source: "policy-test" }
						}
					}
				})
			});
			expect(created.status).toBe(200);
			const id = ((await created.json()) as Record<string, any>).data.id as string;

			const before = actionCountForRepo(repo);
			const res = await fetch(`${baseUrl}/api/standards/${id}`);
			expect(res.status).toBe(200);
			expect(actionCountForRepo(repo)).toBe(before);
		});
	});
});
