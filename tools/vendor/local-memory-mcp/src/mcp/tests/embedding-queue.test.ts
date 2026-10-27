import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { createTestStore, SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { Outbox, enqueueTask } from "../embedding-queue/outbox";
import { observationText, saveExtractions } from "../tools/kg-archivist";
import { handleMemoryDelete } from "../tools/memory.delete";
import { makeTask, getJob, countRows } from "./embedding-queue.helpers";

describe("Outbox — claim/complete/fail bound to the claim batch token (TASK-044)", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("complete with a stale (expired-lease) token cannot finish a job re-claimed by another worker", () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		const [claimA] = outbox.claim(10, 60_000);
		expect(claimA).toBeDefined();
		const tokenA = claimA!.locked_by as string;

		// Simulate lease expiry + re-claim by worker B (new batch token).
		const tokenB = "worker-B-token";
		db.db
			.prepare("UPDATE queue_jobs SET status = 'claimed', locked_by = ?, lease_until = ? WHERE id = ?")
			.run(tokenB, new Date(Date.now() + 60_000).toISOString(), claimA!.id);

		// Worker A's stale complete must no-op...
		expect(outbox.complete(claimA!.id, tokenA)).toBe(false);
		const row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("claimed");
		expect(row.locked_by).toBe(tokenB);

		// ...while worker B's complete (owning token) succeeds.
		expect(outbox.complete(claimA!.id, tokenB)).toBe(true);
		expect(getJob(db, "task", task.id)!.status).toBe("done");
	});

	it("fail with a stale token is a no-op — attempts never double-increment across workers", () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		const [claimA] = outbox.claim(10, 60_000);
		const tokenA = claimA!.locked_by as string;
		const tokenB = "worker-B-token";
		db.db
			.prepare("UPDATE queue_jobs SET status = 'claimed', locked_by = ?, lease_until = ? WHERE id = ?")
			.run(tokenB, new Date(Date.now() + 60_000).toISOString(), claimA!.id);

		// Worker A fails with its expired token → no-op (no attempt increment).
		outbox.fail(claimA!.id, tokenA, "boom", 3, 1_000, 60_000);
		let row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("claimed");
		expect(row.attempts).toBe(0);
		expect(row.locked_by).toBe(tokenB);

		// Worker B (owner) fails → single atomic increment to 1 + backoff.
		outbox.fail(claimA!.id, tokenB, "boom", 3, 1_000, 60_000);
		row = getJob(db, "task", task.id)!;
		expect(row.attempts).toBe(1);
		expect(row.status).toBe("pending");
		expect(row.locked_by).toBeNull();
		expect(row.backoff_until).not.toBeNull();
	});

	it("fail poisons at the threshold via atomic increments, clearing backoff", () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		// Attempt 1 → backoff.
		const [claim1] = outbox.claim(10, 60_000);
		outbox.fail(claim1!.id, claim1!.locked_by as string, "e1", 2, 1_000, 60_000);
		let row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("pending");
		expect(row.attempts).toBe(1);

		// Attempt 2 → poison at threshold (backoff_until cleared). Simulate the
		// 1s backoff window elapsing before the next claim.
		db.db.prepare("UPDATE queue_jobs SET backoff_until = NULL WHERE id = ?").run(claim1!.id);
		const [claim2] = outbox.claim(10, 60_000);
		outbox.fail(claim2!.id, claim2!.locked_by as string, "e2", 2, 1_000, 60_000);
		row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("poison");
		expect(row.attempts).toBe(2);
		expect(row.backoff_until).toBeNull();
	});

	it("release returns a claim to pending with attempts/backoff untouched (TASK-457)", () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		const [claim] = outbox.claim(10, 60_000);
		const token = claim!.locked_by as string;

		// Give the row an existing attempt history to prove release preserves it
		// (a lock contention must never accumulate attempts toward poison).
		const futureBackoff = new Date(Date.now() + 60_000).toISOString();
		db.db
			.prepare("UPDATE queue_jobs SET attempts = 2, backoff_until = ?, last_error = 'prev' WHERE id = ?")
			.run(futureBackoff, claim!.id);

		expect(outbox.release(claim!.id, token)).toBe(true);

		const row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("pending");
		expect(row.locked_by).toBeNull();
		expect(row.lease_until).toBeNull();
		// attempts + backoff_until preserved verbatim.
		expect(row.attempts).toBe(2);
		expect(row.backoff_until).toBe(futureBackoff);
		expect(row.last_error).toBe("prev");
	});

	it("release with a foreign (stale) token is a no-op — never releases another worker's claim (TASK-457)", () => {
		const task = makeTask();
		db.tasks.insertTask(task);
		enqueueTask(db, task);

		const [claim] = outbox.claim(10, 60_000);
		const token = claim!.locked_by as string;

		// A sibling worker's token must NOT release this claim.
		expect(outbox.release(claim!.id, "other-worker-token")).toBe(false);

		const row = getJob(db, "task", task.id)!;
		expect(row.status).toBe("claimed");
		expect(row.locked_by).toBe(token);
	});
});

describe("Outbox — backfill chunking across transactions (TASK-457)", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("backfill with cap > 200 enqueues every row across multiple chunks", () => {
		// BACKFILL_TXN_CHUNK = 200 (enqueue.ts): 250 candidates → 2 immediate
		// write transactions. Every candidate must still land exactly once —
		// chunking must not drop or duplicate any row.
		const COUNT = 250;
		for (let i = 0; i < COUNT; i++) {
			db.tasks.insertTask(makeTask({ title: `Chunked backfill task ${i}` }));
		}

		const enqueued = outbox.backfillMissingVectors(COUNT);
		expect(enqueued).toBe(COUNT);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs")).toBe(COUNT);
	});
});

describe("Outbox — backfill excludes canceled tasks (TASK-042)", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("backfill enqueues active tasks but never canceled tasks", () => {
		const now = new Date().toISOString();
		const canceled = makeTask({ status: "canceled", canceled_at: now });
		const active = makeTask({ title: "Active backfill task" });
		db.tasks.insertTask(canceled);
		db.tasks.insertTask(active);

		const enqueued = outbox.backfillMissingVectors(100);
		expect(enqueued).toBe(1);

		expect(getJob(db, "task", active.id)).toBeDefined();
		expect(getJob(db, "task", canceled.id)).toBeUndefined();
	});
});

describe("Outbox — backfill backpressure: gate + preserve backoff (TASK-069)", () => {
	let db: SQLiteStore;
	let outbox: Outbox;

	beforeEach(async () => {
		db = await createTestStore();
		outbox = new Outbox(db);
	});

	afterEach(() => {
		db.close();
	});

	it("backfill is gated when pending + claimed already exceed the threshold — no double-refill on a deep queue", () => {
		// A deep queue: 3 pending jobs (all still vector-less so backfill would
		// otherwise select them).
		const tasks = [makeTask(), makeTask(), makeTask()];
		for (const t of tasks) {
			db.tasks.insertTask(t);
			enqueueTask(db, t);
		}
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs")).toBe(3);

		// Gate at 2: pending+claimed (3) >= 2 → backfill must not enqueue.
		const enqueued = outbox.backfillMissingVectors(100, 2);
		expect(enqueued).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM queue_jobs")).toBe(3);
	});

	it("backfill inserts ONLY rows absent from queue_jobs — live attempts/backoff are never reset", () => {
		// Task A is already queued and in exponential backoff (attempts=3,
		// backoff_until in the future). Task B is vector-less and NOT queued.
		const taskA = makeTask();
		const taskB = makeTask({ title: "Absent task B" });
		db.tasks.insertTask(taskA);
		db.tasks.insertTask(taskB);
		enqueueTask(db, taskA);

		const futureBackoff = new Date(Date.now() + 60_000).toISOString();
		db.db
			.prepare("UPDATE queue_jobs SET attempts = 3, backoff_until = ?, last_error = 'FK failure' WHERE entity_id = ?")
			.run(futureBackoff, taskA.id);

		// Shallow queue (1 pending < default gate 500) → backfill runs.
		const enqueued = outbox.backfillMissingVectors(100);
		expect(enqueued).toBe(1); // only the absent task B

		// Live row A: attempts/backoff/last_error/status fully preserved.
		const rowA = getJob(db, "task", taskA.id)!;
		expect(rowA.status).toBe("pending");
		expect(rowA.attempts).toBe(3);
		expect(rowA.backoff_until).toBe(futureBackoff);
		expect(rowA.last_error).toBe("FK failure");

		// Absent task B inserted fresh: attempts=0, no backoff.
		const rowB = getJob(db, "task", taskB.id)!;
		expect(rowB).toBeDefined();
		expect(rowB.attempts).toBe(0);
		expect(rowB.backoff_until).toBeNull();
	});
});

describe("KnowledgeGraphEntity — repo-scoped orphan sweep (TASK-043)", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => {
		db.close();
	});

	it("deleteObservationsAndOrphans scoped to repo A never touches repo B entities or observations", () => {
		const now = new Date().toISOString();
		const text = observationText("memory", "Shared Title");

		// Repo A: entity + observation to be removed.
		db.db
			.prepare(
				"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			)
			.run("Alice", "person", null, "repoA", "test", now, now);
		db.db
			.prepare(
				"INSERT INTO observations (id, entity_name, observation, repo, owner, created_at) VALUES (?, ?, ?, ?, ?, ?)"
			)
			.run(randomUUID(), "Alice", text, "repoA", "test", now);

		// Repo B: standalone dashboard-created entity (no observations at all).
		db.db
			.prepare(
				"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			)
			.run("DashboardOnly", "concept", null, "repoB", "test", now, now);

		// Repo B: entity whose observation has the IDENTICAL text (title clash).
		db.db
			.prepare(
				"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			)
			.run("Bob", "person", null, "repoB", "test", now, now);
		db.db
			.prepare(
				"INSERT INTO observations (id, entity_name, observation, repo, owner, created_at) VALUES (?, ?, ?, ?, ?, ?)"
			)
			.run(randomUUID(), "Bob", text, "repoB", "test", now);

		// Repo-A-scoped delete of the shared observation text.
		const orphans = db.knowledgeGraph.deleteObservationsAndOrphans([{ text, repo: "repoA" }]);

		// Repo A observation gone + Alice became an orphan (deleted).
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ? AND repo = ?", [text, "repoA"])
		).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = ?", ["Alice"])).toBe(0);
		expect(orphans).toBe(1);

		// Repo B fully untouched — no FK cascade, no cross-repo deletion.
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = ?", ["DashboardOnly"])).toBe(1);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = ?", ["Bob"])).toBe(1);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ? AND repo = ?", [text, "repoB"])
		).toBe(1);
	});

	it("a memory delete in repo A leaves repo-B entities and same-title observations intact", async () => {
		const now = new Date().toISOString();
		const repoA = "repoA";
		const repoB = "repoB";

		const memoryId = randomUUID();

		// Memory in repo A + extraction → entity + observation in repo A.
		db.memories.insert({
			id: memoryId,
			type: "code_fact",
			title: "Cross Repo Title",
			content: "Alice worked on the deployment for Acme Corp",
			importance: 3,
			agent: "test",
			role: "tester",
			model: "test",
			scope: { owner: "test", repo: repoA },
			created_at: now,
			updated_at: now,
			completed_at: null,
			hit_count: 0,
			recall_count: 0,
			last_used_at: null,
			expires_at: null,
			supersedes: null,
			status: "active",
			tags: [],
			metadata: {},
			is_global: false
		});
		await saveExtractions(
			"Alice worked on the deployment for Acme Corp",
			"Cross Repo Title",
			"test",
			repoA,
			db,
			"memory"
		);
		const repoAObs = observationText("memory", "Cross Repo Title");
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE repo = ?", [repoA])).toBeGreaterThan(0);

		// Repo B: standalone entity + identical-title observation.
		db.db
			.prepare(
				"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			)
			.run("RepoBStandalone", "concept", null, repoB, "test", now, now);
		db.db
			.prepare(
				"INSERT INTO entities (name, type, description, repo, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
			)
			.run("RepoBEntity", "concept", null, repoB, "test", now, now);
		db.db
			.prepare(
				"INSERT INTO observations (id, entity_name, observation, repo, owner, created_at) VALUES (?, ?, ?, ?, ?, ?)"
			)
			.run(randomUUID(), "RepoBEntity", repoAObs, repoB, "test", now);

		// Delete the repo-A memory.
		await handleMemoryDelete({ id: memoryId, owner: "test", repo: repoA, json: true }, db, new StubVectorStore(db));

		// Repo A observations gone; repo B entity + observation intact.
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE repo = ?", [repoA])).toBe(0);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = ?", ["RepoBStandalone"])).toBe(1);
		expect(countRows(db, "SELECT COUNT(*) as cnt FROM entities WHERE name = ?", ["RepoBEntity"])).toBe(1);
		expect(
			countRows(db, "SELECT COUNT(*) as cnt FROM observations WHERE observation = ? AND repo = ?", [repoAObs, repoB])
		).toBe(1);
	});
});
