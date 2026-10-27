/**
 * Queue Controller — Write-lock scope (TASK-102) subset (TASK-428 split from
 * controllers.integration.test.ts).
 *
 * Regression guard: every dashboard mutation endpoint must mutate through
 * db.withWrite. Read endpoints must NOT take the lock.
 *
 * Split from the original 2165-line file; the shared `vi.mock` + server
 * factory live in controllers.shared.ts. The `seedQueueRow`/`getQueueRow`
 * helpers are copied verbatim so this file seeds the same in-memory store.
 *
 * Tests are relocated verbatim — no behavior change.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
// Resolves to the mocked context module (vi.mock lives in controllers.shared.ts,
// which must be imported before any route module). `db` is re-exported from the
// shared module so the test seeds the SAME in-memory store the route mounts.
import { db } from "./controllers.shared";
import { startControllersServer } from "./controllers.shared";

describe("Dashboard Controllers — Queue Write-lock Scope", () => {
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

	// ── Write-lock scope (TASK-102) — Queue subset ─────────────────────────
	// Regression guard: every dashboard mutation endpoint must mutate through
	// db.withWrite. Read endpoints must NOT take the lock. See the shared
	// Write-lock scope describe in the original file for the full rationale.

	describe("Write-lock scope (TASK-102) — Queue subset", () => {
		let withWriteSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			withWriteSpy = vi.spyOn(db, "withWrite").mockImplementation(async (fn) => fn());
		});

		afterEach(() => {
			withWriteSpy.mockRestore();
		});

		it("GET /api/queue/jobs does NOT acquire the write lock", async () => {
			seedQueueRow({ status: "poison" });
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/queue/jobs`);
			expect(res.status).toBe(200);
			expect(withWriteSpy).not.toHaveBeenCalled();
		});

		it("POST /api/queue/jobs/:id/retry acquires the write lock", async () => {
			const id = seedQueueRow({ status: "poison", attempts: 5, last_error: "locked out" });
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/retry`, { method: "POST" });
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("POST /api/queue/jobs/:id/clear acquires the write lock", async () => {
			const id = seedQueueRow({ status: "poison" });
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/queue/jobs/${id}/clear`, { method: "POST" });
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});

		it("POST /api/queue/retry-all acquires the write lock", async () => {
			seedQueueRow({ status: "poison" });
			withWriteSpy.mockClear();
			const res = await fetch(`${baseUrl}/api/queue/retry-all`, { method: "POST" });
			expect(res.status).toBe(200);
			expect(withWriteSpy).toHaveBeenCalledTimes(1);
		});
	});
});
