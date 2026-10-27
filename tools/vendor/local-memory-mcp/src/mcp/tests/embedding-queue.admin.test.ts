import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { Outbox } from "../embedding-queue/outbox";
import type { QueueJobStatus } from "../embedding-queue/types";

// ---------------------------------------------------------------------------
// Failed-job admin list/retry/clear regression tests (TASK-296).
// The admin surface (Outbox.listJobs / retryJob / retryAllPoison / deleteJob)
// exposes poison/done/claimed queue management to operators. These tests lock
// in the reset semantics (attempts/error/backoff/lease/locked cleared), the
// guarded no-op behavior on live rows, repo scoping (TASK-360), and the
// pagination/status-filter shape of listJobs.
//
// Split out from embedding-queue.test.ts (TASK-427 refactor) as its own file
// to stay within the 500-line maintainability limit; the queue_jobs rows are
// inserted directly via a local helper rather than through the enqueue sites.
// ---------------------------------------------------------------------------

describe("Outbox — failed-job admin list/retry/clear (TASK-296)", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	/** Direct queue_jobs insert (status values are the literal enum names). */
	function insertQueueJob(
		overrides: {
			id?: string;
			repo?: string;
			status?: QueueJobStatus;
			attempts?: number;
			last_error?: string | null;
			backoff_until?: string | null;
			created_at?: string;
		} = {}
	): string {
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
	}

	const getRow = (id: string): Record<string, unknown> =>
		db.db.prepare("SELECT * FROM queue_jobs WHERE id = ?").get(id) as Record<string, unknown>;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("retryJob flips poison → pending with ENQUEUE_SQL reset semantics (attempts=0, error/backoff/lease/locked cleared)", () => {
		const id = insertQueueJob({
			status: "poison",
			attempts: 5,
			last_error: "database is locked",
			backoff_until: new Date(Date.now() + 60_000).toISOString()
		});

		expect(outbox.retryJob(id)).toBe(true);

		const row = getRow(id);
		expect(row.status).toBe("pending");
		expect(row.attempts).toBe(0);
		expect(row.last_error).toBeNull();
		expect(row.backoff_until).toBeNull();
		expect(row.lease_until).toBeNull();
		expect(row.locked_by).toBeNull();

		// Payload/content_hash are untouched — the worker re-processes the SAME
		// snapshot it failed on, only the retry state is reset.
		expect(row.payload).toBe("{}");
	});

	it("retryJob also flips a done row back to pending", () => {
		const id = insertQueueJob({ status: "done", attempts: 1 });
		expect(outbox.retryJob(id)).toBe(true);
		expect(getRow(id).status).toBe("pending");
		expect(getRow(id).attempts).toBe(0);
	});

	it("retryJob returns false for live (pending/claimed) rows and unknown ids — single guarded UPDATE", () => {
		const pendingId = insertQueueJob({ status: "pending" });
		const claimedId = insertQueueJob({ status: "claimed" });

		expect(outbox.retryJob(pendingId)).toBe(false);
		expect(outbox.retryJob(claimedId)).toBe(false);
		expect(outbox.retryJob(randomUUID())).toBe(false);

		expect(getRow(pendingId).status).toBe("pending");
		expect(getRow(claimedId).status).toBe("claimed");
	});

	it("a retried poison job is re-claimable by the worker", () => {
		const id = insertQueueJob({ status: "poison", attempts: 5 });
		outbox.retryJob(id);

		const claimed = outbox.claim(10, 60_000);
		expect(claimed.some((job) => job.id === id)).toBe(true);
	});

	it("retryAllPoison flips ONLY poison rows and returns the count", () => {
		const poisonA = insertQueueJob({ status: "poison", attempts: 3 });
		const poisonB = insertQueueJob({ status: "poison", attempts: 4 });
		const pendingId = insertQueueJob({ status: "pending" });
		const doneId = insertQueueJob({ status: "done" });

		expect(outbox.retryAllPoison()).toBe(2);
		expect(getRow(poisonA).status).toBe("pending");
		expect(getRow(poisonA).attempts).toBe(0);
		expect(getRow(poisonB).status).toBe("pending");
		expect(getRow(pendingId).status).toBe("pending");
		expect(getRow(doneId).status).toBe("done");
	});

	it("retryAllPoison is idempotent — 0 when nothing is poisoned", () => {
		insertQueueJob({ status: "pending" });
		insertQueueJob({ status: "done" });
		expect(outbox.retryAllPoison()).toBe(0);
	});

	it("deleteJob removes poison/done rows only; live rows and unknown ids are a no-op", () => {
		const poisonId = insertQueueJob({ status: "poison" });
		const doneId = insertQueueJob({ status: "done" });
		const pendingId = insertQueueJob({ status: "pending" });

		expect(outbox.deleteJob(poisonId)).toBe(true);
		expect(db.db.prepare("SELECT id FROM queue_jobs WHERE id = ?").get(poisonId)).toBeUndefined();

		expect(outbox.deleteJob(doneId)).toBe(true);
		expect(db.db.prepare("SELECT id FROM queue_jobs WHERE id = ?").get(doneId)).toBeUndefined();

		expect(outbox.deleteJob(pendingId)).toBe(false);
		expect(outbox.deleteJob(randomUUID())).toBe(false);
		expect(getRow(pendingId).status).toBe("pending");
	});

	it("listJobs is unfiltered (all statuses) by default, newest-first; statuses filter the window + total", () => {
		const older = insertQueueJob({ status: "poison", created_at: new Date(Date.now() - 10_000).toISOString() });
		const newer = insertQueueJob({ status: "pending", created_at: new Date().toISOString() });
		// Explicit created_at for done/claimed: insertQueueJob stamps its own
		// Date.now() at insert time when omitted, which would make these rows
		// STRICTLY newer than `newer` and break the newest-first fixture.
		const mid = new Date(Date.now() - 5_000).toISOString();
		insertQueueJob({ status: "done", created_at: mid });
		insertQueueJob({ status: "claimed", created_at: mid });

		// no statuses → full table
		const all = outbox.listJobs({ limit: 10, offset: 0 });
		expect(all.total).toBe(4);
		expect(all.items).toHaveLength(4);
		expect(all.items[0].id).toBe(newer); // newest first (created_at DESC)
		expect(all.items[3].id).toBe(older);

		// filter → matching rows only, correct total
		const poison = outbox.listJobs({ statuses: ["poison"], limit: 10, offset: 0 });
		expect(poison.total).toBe(1);
		expect(poison.items[0].id).toBe(older);

		const pendingPoison = outbox.listJobs({ statuses: ["pending", "poison"], limit: 10, offset: 0 });
		expect(pendingPoison.total).toBe(2);

		// pagination slices the filtered set (total stays full-filter count)
		const page = outbox.listJobs({ statuses: ["pending", "poison"], limit: 1, offset: 0 });
		expect(page.items).toHaveLength(1);
		expect(page.total).toBe(2);
	});

	// ── Repo scoping (TASK-360) ───────────────────────────────────────────
	// Optional `repo` argument restricts every admin mutation / read to a
	// single `entity_repo` via parameterized `AND entity_repo = ?` — absent →
	// global behavior (back-compat).

	it("retryJob is repo-scoped: a mismatched repo is a no-op, the matching repo flips", () => {
		const id = insertQueueJob({ repo: "repo-a", status: "poison", attempts: 5 });

		expect(outbox.retryJob(id, "repo-b")).toBe(false);
		expect(getRow(id).status).toBe("poison");
		expect(getRow(id).attempts).toBe(5);

		expect(outbox.retryJob(id, "repo-a")).toBe(true);
		expect(getRow(id).status).toBe("pending");
		expect(getRow(id).attempts).toBe(0);
	});

	it("retryJob without a repo stays global (back-compat)", () => {
		const id = insertQueueJob({ status: "poison", attempts: 5 });
		expect(outbox.retryJob(id)).toBe(true);
		expect(getRow(id).status).toBe("pending");
	});

	it("deleteJob is repo-scoped: a mismatched repo keeps the row, the matching repo deletes it", () => {
		const id = insertQueueJob({ repo: "repo-a", status: "poison" });

		expect(outbox.deleteJob(id, "repo-b")).toBe(false);
		expect(db.db.prepare("SELECT id FROM queue_jobs WHERE id = ?").get(id)).toBeDefined();

		expect(outbox.deleteJob(id, "repo-a")).toBe(true);
		expect(db.db.prepare("SELECT id FROM queue_jobs WHERE id = ?").get(id)).toBeUndefined();
	});

	it("retryAllPoison is repo-scoped: flips ONLY the matching repo's poison rows", () => {
		const aPoison = insertQueueJob({ repo: "repo-a", status: "poison", attempts: 5 });
		const bPoison = insertQueueJob({ repo: "repo-b", status: "poison", attempts: 3 });
		const bPending = insertQueueJob({ repo: "repo-b", status: "pending" });

		expect(outbox.retryAllPoison("repo-b")).toBe(1);

		expect(getRow(bPoison).status).toBe("pending");
		expect(getRow(bPoison).attempts).toBe(0);
		expect(getRow(aPoison).status).toBe("poison"); // other repo untouched
		expect(getRow(bPending).status).toBe("pending"); // live rows untouched
	});

	it("listJobs scopes the window + total by repo; combines with the status filter", () => {
		insertQueueJob({ repo: "repo-a", status: "poison" });
		const bPoison = insertQueueJob({ repo: "repo-b", status: "poison" });
		const bPending = insertQueueJob({ repo: "repo-b", status: "pending" });
		const bDone = insertQueueJob({ repo: "repo-b", status: "done" });

		const allB = outbox.listJobs({ repo: "repo-b", limit: 10, offset: 0 });
		expect(allB.total).toBe(3);
		expect(allB.items.map((r) => r.id).sort()).toEqual([bPoison, bPending, bDone].sort());

		const bPoisonOnly = outbox.listJobs({ repo: "repo-b", statuses: ["poison"], limit: 10, offset: 0 });
		expect(bPoisonOnly.total).toBe(1);
		expect(bPoisonOnly.items[0].id).toBe(bPoison);

		// absent repo → global (back-compat): all four rows across both repos
		const global = outbox.listJobs({ limit: 10, offset: 0 });
		expect(global.total).toBe(4);
	});
});
