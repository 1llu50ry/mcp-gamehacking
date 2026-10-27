/**
 * Queue Controller integration tests (TASK-428 split from controllers.integration.test.ts).
 *
 * Covers QueueController observability + admin endpoints (TASK-104 / TASK-296):
 * /api/queue/status, /api/queue/jobs (list/filter/paginate/repo-scope),
 * /api/queue/jobs/:id/retry|clear, DELETE /api/queue/jobs/:id, and
 * /api/queue/retry-all. Also the queue subset of the Write-lock scope
 * regression (TASK-102).
 *
 * Split from the original 2165-line file; the shared `vi.mock` + server
 * factory live in controllers.shared.ts. Tests are relocated verbatim — no
 * behavior change.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
// Resolves to the mocked context module (vi.mock lives in controllers.shared.ts,
// which must be imported before any route module). `db` and `embeddingWorker`
// are re-exported from the shared module so the test drives the SAME in-memory
// store + stubbed worker the route mounts.
import { db, embeddingWorker } from "./controllers.shared";
// EMBEDDING_QUEUE_POISON_THRESHOLD drives the max_attempts assertion on a
// seeded poison row (read at constants.ts module load under the shared mock).
import { EMBEDDING_QUEUE_POISON_THRESHOLD } from "../../mcp/utils/constants";
// Outbox helper used by the retry tests to prove a retried job is re-claimable
// by the worker (pure library import — no vi.mock interaction).
import { outboxFor } from "../../mcp/embedding-queue/outbox";
import { startControllersServer } from "./controllers.shared";

describe("Dashboard Controllers — Queue API", () => {
	let serverHandle: Awaited<ReturnType<typeof startControllersServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		serverHandle = await startControllersServer();
		baseUrl = serverHandle.baseUrl;
	});

	afterAll(async () => {
		await serverHandle.close();
	});

	// ── Queue-jobs seed helpers (TASK-296) ────────────────────────────────
	// The mocked context stubs embeddingWorker, so queue_jobs rows for the
	// queue-admin endpoints are inserted straight into the shared store here.
	// `status` values are the literal enum names (pending|claimed|done|poison).

	const seedQueueRow = (
		overrides: {
			id?: string;
			repo?: string;
			status?: "pending" | "claimed" | "done" | "poison";
			attempts?: number;
			last_error?: string | null;
			backoff_until?: string | null;
			created_at?: string;
		} = {}
	): string => {
		const id = overrides.id ?? randomUUID();
		const now = new Date().toISOString();
		db.db
			.prepare(
				`INSERT INTO queue_jobs
				(id, entity_kind, entity_id, entity_repo, payload, content_hash, status, attempts,
				 lease_until, locked_by, backoff_until, last_error, created_at, updated_at)
				VALUES (?, 'memory', ?, ?, '{}', NULL, ?, ?, NULL, NULL, ?, ?, ?, ?)`
			)
			.run(
				id,
				id,
				overrides.repo ?? "queue-admin-repo",
				overrides.status ?? "pending",
				overrides.attempts ?? 0,
				overrides.backoff_until ?? null,
				overrides.last_error ?? null,
				overrides.created_at ?? now,
				now
			);
		return id;
	};

	const getQueueRow = (id: string): Record<string, any> =>
		db.db.prepare("SELECT * FROM queue_jobs WHERE id = ?").get(id) as Record<string, any>;

	// ── Queue Controller (TASK-104) ────────────────────────────────────────
	// Embedding/KG outbox observability (TASK-013): exposes worker + queue
	// depth stats so the dashboard can surface backpressure.

	describe("Queue API", () => {
		it("GET /api/queue/status returns 200 with queue-status payload", async () => {
			const res = await fetch(`${baseUrl}/api/queue/status`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.type).toBe("queue-status");
			expect(body.data.attributes).toHaveProperty("pending");
			expect(body.data.attributes).toHaveProperty("poison");
			expect(body.data.attributes).toHaveProperty("total");
			expect(body.data.attributes).toHaveProperty("running");
			expect(body.data.attributes).toHaveProperty("started");
			expect(body.data.attributes).toHaveProperty("modelReady");
			expect(body.data.attributes).toHaveProperty("batchSize");
			expect(body.data.attributes).toHaveProperty("leaseMs");
		});

		it("GET /api/queue/status reflects worker depth + config from getStats", async () => {
			(embeddingWorker.getStats as ReturnType<typeof vi.fn>).mockReturnValue({
				pending: 7,
				claimed: 2,
				done: 10,
				poison: 1,
				total: 20,
				processed: 42,
				failed: 3,
				poisoned: 1,
				lastBatchSize: 5,
				lastRunAt: "2026-08-02T00:00:00.000Z",
				running: true,
				started: true,
				modelReady: true,
				pollIntervalMs: 5000,
				batchSize: 8,
				leaseMs: 60_000
			});

			const res = await fetch(`${baseUrl}/api/queue/status`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.attributes.pending).toBe(7);
			expect(body.data.attributes.poison).toBe(1);
			expect(body.data.attributes.running).toBe(true);
			expect(body.data.attributes.started).toBe(true);
			expect(body.data.attributes.modelReady).toBe(true);
			expect(body.data.attributes.batchSize).toBe(8);
			expect(body.data.attributes.leaseMs).toBe(60_000);
		});

		it("GET /api/queue/status is a read endpoint — does NOT acquire the write lock", async () => {
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			const res = await fetch(`${baseUrl}/api/queue/status`);
			expect(res.status).toBe(200);
			expect(withWriteSpy).not.toHaveBeenCalled();
			withWriteSpy.mockRestore();
		});

		// ── Queue job admin (TASK-296) ─────────────────────────────────────
		// List / retry / clear / retry-all for failed (poison) jobs. Wire
		// statuses are the LITERAL enum values ('pending'|'claimed'|'done'|
		// 'poison') — 'failed' exists only as a UI label.

		it("GET /api/queue/jobs returns paginated queue jobs — default filter shows pending + poison only", async () => {
			const pendingId = seedQueueRow({ status: "pending" });
			const poisonId = seedQueueRow({ status: "poison", attempts: 5, last_error: "worker poison" });
			seedQueueRow({ status: "done", attempts: 1 });

			const res = await fetch(`${baseUrl}/api/queue/jobs`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;

			expect(body.jsonapi.version).toBe("1.1");
			expect(Array.isArray(body.data)).toBe(true);
			expect(body.data[0].type).toBe("queue-job");
			const statuses = body.data.map((d: any) => (d.attributes as Record<string, any>).status as string);
			// default filter: pending + poison — done never leaks in
			expect(statuses.every((s: string) => s === "pending" || s === "poison")).toBe(true);

			// Full attribute set on a seeded row (id, entity_kind, entity_id,
			// status, attempts, max_attempts, enqueued_at, processed_at, last_error).
			const gotPending = body.data.find((d: any) => d.id === pendingId);
			expect(gotPending).toBeDefined();
			const attrs = gotPending.attributes as Record<string, any>;
			expect(attrs.status).toBe("pending");
			expect(attrs.entity_kind).toBe("memory");
			expect(attrs.entity_id).toBe(pendingId);
			expect(attrs.attempts).toBe(0);
			expect(attrs.max_attempts).toBe(EMBEDDING_QUEUE_POISON_THRESHOLD);
			expect(attrs.enqueued_at).toBeDefined();
			expect(attrs.processed_at).toBeDefined();

			const gotPoison = body.data.find((d: any) => d.id === poisonId);
			expect(gotPoison).toBeDefined();
			expect((gotPoison.attributes as Record<string, any>).status).toBe("poison");
			// Assert the exact seeded literal — the mapper passes last_error through
			// raw, so the assertion must match the fixture ("worker poison").
			expect((gotPoison.attributes as Record<string, any>).last_error).toBe("worker poison");

			expect(body.meta.totalItems).toBeGreaterThanOrEqual(2);
			expect(body.meta.page).toBe(1);
			expect(body.meta.pageSize).toBe(20);
		});

		it("GET /api/queue/jobs?status=done filters to the literal enum value (excludes pending/poison)", async () => {
			seedQueueRow({ status: "pending" });
			const doneId = seedQueueRow({ status: "done" });
			seedQueueRow({ status: "poison" });

			const res = await fetch(`${baseUrl}/api/queue/jobs?status=done`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;
			expect(body.data.every((d: any) => d.attributes.status === "done")).toBe(true);
			expect(body.data.find((d: any) => d.id === doneId)).toBeDefined();
		});

		it("GET /api/queue/jobs supports page/pageSize pagination (newest-first)", async () => {
			const ids = [
				seedQueueRow({ status: "poison" }),
				seedQueueRow({ status: "poison" }),
				seedQueueRow({ status: "poison" })
			];

			const page1 = await fetch(`${baseUrl}/api/queue/jobs?status=poison&pageSize=2`);
			const body1 = (await page1.json()) as Record<string, any>;
			expect(body1.data).toHaveLength(2);
			expect(body1.meta.totalItems).toBeGreaterThanOrEqual(3);

			const page2 = await fetch(`${baseUrl}/api/queue/jobs?status=poison&pageSize=2&page=2`);
			const body2 = (await page2.json()) as Record<string, any>;
			expect(body2.data.length).toBeGreaterThanOrEqual(1);

			const allIds = [...body1.data.map((d: any) => d.id), ...body2.data.map((d: any) => d.id)];
			expect(ids.every((id) => allIds.includes(id))).toBe(true);
		});

		it("GET /api/queue/jobs?status=bogus returns 400 with the valid literal enums", async () => {
			const res = await fetch(`${baseUrl}/api/queue/jobs?status=bogus`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toContain("bogus");
			expect(body.errors[0].detail).toContain("poison");
		});

		it("GET /api/queue/jobs is a read endpoint — does NOT acquire the write lock", async () => {
			seedQueueRow({ status: "poison" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs`);
				expect(res.status).toBe(200);
				expect(withWriteSpy).not.toHaveBeenCalled();
			} finally {
				withWriteSpy.mockRestore();
			}
		});

		it("POST /api/queue/jobs/:id/retry flips poison → pending (attempts=0, error/backoff cleared) and the row is re-claimable", async () => {
			const id = seedQueueRow({
				status: "poison",
				attempts: EMBEDDING_QUEUE_POISON_THRESHOLD,
				last_error: "database is locked",
				backoff_until: new Date(Date.now() + 60_000).toISOString()
			});
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry`, { method: "POST" });
				expect(res.status).toBe(200);
				expect(withWriteSpy).toHaveBeenCalledTimes(1);
			} finally {
				withWriteSpy.mockRestore();
			}

			const row = getQueueRow(id);
			expect(row.status).toBe("pending");
			expect(row.attempts).toBe(0);
			expect(row.last_error).toBeNull();
			expect(row.backoff_until).toBeNull();
			expect(row.lease_until).toBeNull();
			expect(row.locked_by).toBeNull();

			// Re-claimable: a fresh worker claim picks the row up again.
			const claimed = outboxFor(db).claim(10, 60_000);
			expect(claimed.some((job) => job.id === id)).toBe(true);
		});

		it("POST /api/queue/jobs/:id/retry also resets a done row to pending", async () => {
			const id = seedQueueRow({ status: "done", attempts: 1 });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry`, { method: "POST" });
				expect(res.status).toBe(200);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(id).status).toBe("pending");
			expect(getQueueRow(id).attempts).toBe(0);
		});

		it("POST /api/queue/jobs/:id/retry returns 404 for an unknown id", async () => {
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${randomUUID()}/retry`, { method: "POST" });
				expect(res.status).toBe(404);
			} finally {
				withWriteSpy.mockRestore();
			}
		});

		it("POST /api/queue/jobs/:id/retry returns 409 for a live (pending) job", async () => {
			const id = seedQueueRow({ status: "pending" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry`, { method: "POST" });
				expect(res.status).toBe(409);
			} finally {
				withWriteSpy.mockRestore();
			}
		});

		it("POST /api/queue/jobs/:id/clear deletes a poison row (write lock acquired)", async () => {
			const poisonId = seedQueueRow({ status: "poison", attempts: 5, last_error: "embed failed" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${poisonId}/clear`, { method: "POST" });
				expect(res.status).toBe(200);
				expect(withWriteSpy).toHaveBeenCalledTimes(1);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(poisonId)).toBeUndefined();
		});

		it("DELETE /api/queue/jobs/:id removes a done row", async () => {
			const doneId = seedQueueRow({ status: "done" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${doneId}`, { method: "DELETE" });
				expect(res.status).toBe(200);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(doneId)).toBeUndefined();
		});

		it("DELETE /api/queue/jobs/:id returns 409 for a claimed (live) job", async () => {
			const claimedId = seedQueueRow({ status: "claimed" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${claimedId}`, { method: "DELETE" });
				expect(res.status).toBe(409);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(claimedId)).toBeDefined();
		});

		it("POST /api/queue/retry-all flips every poisoned job to pending (live rows untouched)", async () => {
			const poisonA = seedQueueRow({ status: "poison", attempts: EMBEDDING_QUEUE_POISON_THRESHOLD });
			const poisonB = seedQueueRow({ status: "poison", attempts: 3 });
			const live = seedQueueRow({ status: "pending" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/retry-all`, { method: "POST" });
				expect(res.status).toBe(200);
				expect(withWriteSpy).toHaveBeenCalledTimes(1);
			} finally {
				withWriteSpy.mockRestore();
			}

			expect(getQueueRow(poisonA).status).toBe("pending");
			expect(getQueueRow(poisonA).attempts).toBe(0);
			expect(getQueueRow(poisonB).status).toBe("pending");
			expect(getQueueRow(live).status).toBe("pending");
		});

		// ── Repo scoping (TASK-360) ───────────────────────────────────────
		// Optional ?repo= filter on ALL admin endpoints, mirroring the other
		// dashboard controllers. Unique repo names per test keep the shared
		// suite DB isolated (rows persist across tests in this file).

		it("GET /api/queue/jobs?repo=B returns ONLY repo B rows (repo A excluded, total scoped)", async () => {
			const repoA = `repo-a-${randomUUID().slice(0, 8)}`;
			const repoB = `repo-b-${randomUUID().slice(0, 8)}`;
			const aPoison = seedQueueRow({ repo: repoA, status: "poison" });
			const bPoison = seedQueueRow({ repo: repoB, status: "poison", attempts: 5, last_error: "embed failed" });
			const bPending = seedQueueRow({ repo: repoB, status: "pending" });

			const res = await fetch(`${baseUrl}/api/queue/jobs?repo=${repoB}`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, any>;

			const ids = body.data.map((d: any) => d.id);
			expect(ids).toContain(bPoison);
			expect(ids).toContain(bPending);
			expect(ids).not.toContain(aPoison);
			// total is the repo-scoped window, not the global table.
			expect(body.meta.totalItems).toBe(2);
		});

		it("GET /api/queue/jobs?repo= (whitespace) returns 400 — malformed filter fails closed", async () => {
			const res = await fetch(`${baseUrl}/api/queue/jobs?repo=%20%20`);
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, any>;
			expect(body.errors[0].detail).toContain("repo");
		});

		it("POST /api/queue/jobs/:id/retry?repo=B returns 404 for a repo A job (no cross-repo retry, row untouched)", async () => {
			const id = seedQueueRow({ repo: "repo-a", status: "poison", attempts: 5, last_error: "embed failed" });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry?repo=other-repo`, { method: "POST" });
				expect(res.status).toBe(404);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(id).status).toBe("poison");
		});

		it("POST /api/queue/jobs/:id/retry?repo=A flips a repo A poison row to pending (scoped success)", async () => {
			const id = seedQueueRow({ repo: "repo-a", status: "poison", attempts: 5 });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry?repo=repo-a`, { method: "POST" });
				expect(res.status).toBe(200);
				expect(withWriteSpy).toHaveBeenCalledTimes(1);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(id).status).toBe("pending");
			expect(getQueueRow(id).attempts).toBe(0);
		});

		it("POST /api/queue/jobs/:id/clear?repo=B returns 404 for a repo A job (row kept)", async () => {
			const id = seedQueueRow({ repo: "repo-a", status: "poison", attempts: 5 });
			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/clear?repo=other-repo`, { method: "POST" });
				expect(res.status).toBe(404);
			} finally {
				withWriteSpy.mockRestore();
			}
			expect(getQueueRow(id)).toBeDefined();
		});

		it("POST /api/queue/retry-all?repo=B flips ONLY repo B poison rows (repo A untouched, scoped count)", async () => {
			const repoA = `repo-a-${randomUUID().slice(0, 8)}`;
			const repoB = `repo-b-${randomUUID().slice(0, 8)}`;
			const aPoison = seedQueueRow({ repo: repoA, status: "poison", attempts: 5 });
			const bPoison = seedQueueRow({ repo: repoB, status: "poison", attempts: 5 });
			seedQueueRow({ repo: repoB, status: "pending" });

			const withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
			try {
				const res = await fetch(`${baseUrl}/api/queue/retry-all?repo=${repoB}`, { method: "POST" });
				expect(res.status).toBe(200);
				expect(withWriteSpy).toHaveBeenCalledTimes(1);
				const body = (await res.json()) as Record<string, any>;
				expect(body.meta.retried).toBe(1);
			} finally {
				withWriteSpy.mockRestore();
			}

			expect(getQueueRow(bPoison).status).toBe("pending");
			expect(getQueueRow(bPoison).attempts).toBe(0);
			expect(getQueueRow(aPoison).status).toBe("poison");
		});
	});
});
