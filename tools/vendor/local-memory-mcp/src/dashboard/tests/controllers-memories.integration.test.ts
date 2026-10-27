/**
 * Memories Controller integration tests (TASK-428 split from controllers.integration.test.ts).
 *
 * Covers MemoriesController read endpoints (Memories API), the memory subset of
 * the Write-lock scope regression (TASK-102), the memory subset of the Bulk
 * actions API (OPT-FEAT-04 / STR-01 — soft-archive reads, TASK-207/209), and
 * the memory subset of the Action-log policy (TASK-186 / OPT-PERF-05).
 *
 * Split from the original 2165-line file; the shared `vi.mock` + server
 * factory live in controllers.shared.ts. Tests are relocated verbatim — no
 * behavior change.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// Resolves to the mocked context module (vi.mock lives in controllers.shared.ts,
// which must be imported before any route module). `db` is re-exported from the
// shared module so the test seeds the SAME in-memory store the route mounts.
import { db, mcpClient } from "./controllers.shared";
import { startControllersServer } from "./controllers.shared";

describe("Dashboard Controllers — Memories API", () => {
	let serverHandle: Awaited<ReturnType<typeof startControllersServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		serverHandle = await startControllersServer();
		baseUrl = serverHandle.baseUrl;
	});

	afterAll(async () => {
		await serverHandle.close();
	});

	// ── Memories Controller ────────────────────────────────────────────────

	describe("Memories API", () => {
		it("GET /api/memories returns 400 when repo is missing", async () => {
			const res = await fetch(`${baseUrl}/api/memories`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/repo/i);
		});

		it("GET /api/memories?repo=test-repo returns 200 with paginated results", async () => {
			const res = await fetch(`${baseUrl}/api/memories?repo=test-repo`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.meta).toBeDefined();
			expect(body.meta).toHaveProperty("page");
			expect(body.meta).toHaveProperty("totalItems");
		});

		it("GET /api/memories/nonexist returns 404", async () => {
			const res = await fetch(`${baseUrl}/api/memories/00000000-0000-0000-0000-000000000000`);
			expect(res.status).toBe(404);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toMatch(/not found/i);
		});
	});

	// ── Write-lock scope (TASK-102) — Memory subset ────────────────────────
	// Regression guard: every dashboard mutation endpoint must mutate through
	// db.withWrite — the same file-lock boundary used by MCP write tools
	// (router.ts / tools/index.ts) — so HTTP writes serialize with tool writes
	// instead of racing them. Read endpoints must NOT take the lock.

	describe("Write-lock scope (TASK-102) — Memory subset", () => {
		let withWriteSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
		});

		afterEach(() => {
			withWriteSpy.mockRestore();
		});

		it("POST /api/memories (create) acquires the write lock", async () => {
			const res = await fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo: "lock-test-repo",
							type: "code_fact",
							title: "lock-scope regression",
							content: "created through the dashboard — must run under withWrite",
							importance: 3
						}
					}
				})
			});
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("PUT + DELETE /api/memories/:id acquire the write lock", async () => {
			// Seed through the locked create path so the row exists for update/delete.
			const created = await fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo: "lock-test-repo",
							type: "pattern",
							title: "to be updated",
							content: "seed content",
							importance: 2
						}
					}
				})
			});
			expect(created.status).toBe(200);
			const id = ((await created.json()) as Record<string, any>).data.id as string;
			withWriteSpy.mockClear();

			const updated = await fetch(`${baseUrl}/api/memories/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ data: { type: "memory", attributes: { title: "renamed" } } })
			});
			expect(updated.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);

			const deleted = await fetch(`${baseUrl}/api/memories/${id}`, { method: "DELETE" });
			expect(deleted.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(2);
		});

		it("POST /api/memories/import (bulk insert) acquires the write lock", async () => {
			const res = await fetch(`${baseUrl}/api/memories/import`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo: "lock-test-repo",
							items: [{ title: "bulk one", content: "bulk body", type: "code_fact", importance: 3 }]
						}
					}
				})
			});
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("POST /api/memories/action (bulk delete) acquires the write lock", async () => {
			const created = await fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo: "lock-test-repo",
							type: "decision",
							title: "bulk-action target",
							content: "to be bulk-deleted",
							importance: 2
						}
					}
				})
			});
			expect(created.status).toBe(200);
			const id = ((await created.json()) as Record<string, any>).data.id as string;
			withWriteSpy.mockClear();

			// TASK-160 / FIX-164: the compound bulkAction body routes through the
			// EXCLUSIVE path (withExclusiveWrite) so the getByIds→purge sequence
			// serializes cross-process; it no longer crosses the fast-path withWrite.
			const exclusiveSpy = vi.spyOn(db, "withExclusiveWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/memories/action`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						data: { type: "memory", attributes: { action: "delete", ids: [id] } }
					})
				});
				expect(res.status).toBe(200);
				expect(exclusiveSpy).toHaveBeenCalledTimes(1);
				expect(withWriteSpy).not.toHaveBeenCalled();
			} finally {
				exclusiveSpy.mockRestore();
			}
		});

		it("read endpoints do NOT acquire the write lock", async () => {
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/memories?repo=lock-test-repo`);
			expect(res.status).toBe(200);
			expect(withWriteSpy).not.toHaveBeenCalled();
		});
	});

	// ── Bulk actions API (OPT-FEAT-04 / STR-01) — Memory subset ────────────
	// Zero-test-coverage bulk paths. The compound delete bodies route through
	// the EXCLUSIVE write path (withExclusiveWrite) — passthrough-spied exactly
	// like the Write-lock scope describe above so parallel forks don't contend
	// on the real proper-lockfile target.

	describe("Bulk actions API (OPT-FEAT-04 / STR-01) — Memory subset", () => {
		let exclusiveSpy: ReturnType<typeof vi.spyOn>;

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

		describe("POST /api/memories/action + single delete — soft-archive reads (TASK-207/209)", () => {
			const seedMemory = async (repo: string, overrides: Record<string, unknown> = {}) => {
				const created = await fetch(`${baseUrl}/api/memories`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						data: {
							type: "memory",
							attributes: {
								repo,
								type: "code_fact",
								title: "soft-archive read target",
								content: "must disappear from default dashboard reads after delete",
								importance: 3,
								...overrides
							}
						}
					})
				});
				expect(created.status).toBe(200);
				const body = (await created.json()) as Record<string, any>;
				return body.data.id as string;
			};

			const listIds = async (url: string): Promise<string[]> => {
				const res = await fetch(url);
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				return (body.data as Array<{ id: string }>).map((d) => d.id);
			};

			it("DELETE /api/memories/:id archives, then GET returns 404 unless includeArchived=true", async () => {
				const repo = "soft-delete-read-repo";
				const id = await seedMemory(repo);

				const del = await fetch(`${baseUrl}/api/memories/${id}`, { method: "DELETE" });
				expect(del.status).toBe(200);

				// Soft-archive contract (TASK-207): the row survives with
				// status archived — not a hard delete.
				const stored = db.memories.getById(id);
				expect(stored).not.toBeNull();
				expect(stored?.status).toBe("archived");

				// TASK-209 regression: the previously-returned 200 is now 404
				// by default (matches the pre-soft-delete hard-delete behavior).
				const get = await fetch(`${baseUrl}/api/memories/${id}`);
				expect(get.status).toBe(404);

				// Still restorable: explicit includeArchived=true serves it.
				const getArchived = await fetch(`${baseUrl}/api/memories/${id}?includeArchived=true`);
				expect(getArchived.status).toBe(200);
				const archivedBody = (await getArchived.json()) as Record<string, any>;
				expect(archivedBody.data.id).toBe(id);

				// List excludes archived by default…
				expect(await listIds(`${baseUrl}/api/memories?repo=${repo}`)).not.toContain(id);
				// …and includeArchived=true brings it back.
				expect(await listIds(`${baseUrl}/api/memories?repo=${repo}&includeArchived=true`)).toContain(id);
			});

			it("bulk delete soft-archives and hides from reads; includeArchived=true restores", async () => {
				const repo = "soft-delete-bulk-repo";
				const id = await seedMemory(repo);

				const res = await postAction("/api/memories/action", { action: "delete", ids: [id] });
				expect(res.status).toBe(200);
				const body = (await res.json()) as Record<string, any>;
				expect(body.data.attributes.count).toBe(1);

				expect(db.memories.getById(id)?.status).toBe("archived");
				expect((await fetch(`${baseUrl}/api/memories/${id}`)).status).toBe(404);
				expect(await listIds(`${baseUrl}/api/memories?repo=${repo}`)).not.toContain(id);
				expect(await listIds(`${baseUrl}/api/memories?repo=${repo}&includeArchived=true`)).toContain(id);
			});
		});
	});

	// ── Action-log policy (TASK-186 / OPT-PERF-05) — Memory subset ────────
	// POLICY 2: reads never write. Dashboard GET detail endpoints must NOT emit
	// action_log rows — only mutations do.

	describe("Action-log policy (TASK-186 / OPT-PERF-05) — Memory subset", () => {
		const actionCountForRepo = (repo: string): number => db.actions.getRecentActions("", repo, 10_000).length;

		it("POST /api/memories (create) still writes an action-log row", async () => {
			const repo = "policy-write-test-repo";
			const before = actionCountForRepo(repo);

			const res = await fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo,
							type: "code_fact",
							title: "policy write target",
							content: "create must keep logging an action",
							importance: 3
						}
					}
				})
			});
			expect(res.status).toBe(200);
			expect(actionCountForRepo(repo)).toBe(before + 1);
		});

		it("GET /api/memories/:id (read) does NOT write an action-log row", async () => {
			const repo = "policy-read-memory-repo";
			const created = await fetch(`${baseUrl}/api/memories`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					data: {
						type: "memory",
						attributes: {
							repo,
							type: "code_fact",
							title: "read target",
							content: "reads must not log",
							importance: 2
						}
					}
				})
			});
			expect(created.status).toBe(200);
			const id = ((await created.json()) as Record<string, any>).data.id as string;

			const before = actionCountForRepo(repo);
			const res = await fetch(`${baseUrl}/api/memories/${id}`);
			expect(res.status).toBe(200);
			expect(actionCountForRepo(repo)).toBe(before);
		});
	});
});
