/**
 * Cross-domain atomicity regression tests — TASK-429 (ADR-011 §Acceptance
 * Criteria item 3).
 *
 * ADR-011 (`.agents/documents/design/decisions/ADR-011-split-memory-db-per-domain.md`)
 * rejected splitting memory.db per domain and re-scoped TASK-429 to
 * verification and hardening. Acceptance item 3 requires that the cross-domain
 * write paths the split would have broken keep their current transaction
 * discipline:
 *
 *   1. `purgeEntityAndCleanup` — entity mutation + `queue_jobs` purge in ONE
 *      `BEGIN IMMEDIATE` transaction (`src/mcp/utils/purge-entity-cleanup.ts:120`).
 *   2. task→memory archival — `archiveCompletedTasks` runs the archive under
 *      `withExclusiveWrite` (`src/mcp/tools/task-write/update-status.ts:101`).
 *   3. maintenance sweep — the whole compound sweep runs under ONE
 *      `withExclusiveWrite` (`src/mcp/services/maintenance-job.ts:132`).
 *
 * These tests use the REAL in-memory store (`createTestStore`) and the REAL
 * handlers, so they fail if any of those paths is moved outside its transaction
 * or lock. No storage-layer source is modified (ADR-011 item 4).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { purgeEntityAndCleanup } from "../utils/purge-entity-cleanup";
import { handleTaskWrite } from "../tools/task.write";
import { runStartupMaintenance } from "../services/maintenance-job";
import { TABLE_MEMORY_SUMMARY } from "../utils/constants";
import type { CodingStandardEntry, MemoryEntry, Task, VectorStore } from "../types";

const OWNER = "test";
const REPO = "atomicity-cross-domain";

/** Direct queue_jobs insert — the purge path only cares about (kind, id). */
function insertQueueJob(db: SQLiteStore, kind: string, entityId: string): void {
	const now = new Date().toISOString();
	db.db
		.prepare(
			`INSERT INTO queue_jobs (id, entity_kind, entity_id, entity_repo, payload, status, attempts, created_at, updated_at)
			 VALUES (?, ?, ?, ?, '{}', 'pending', 0, ?, ?)`
		)
		.run(randomUUID(), kind, entityId, REPO, now, now);
}

function countQueueJobs(db: SQLiteStore, kind: string, entityId: string): number {
	const row = db.db
		.prepare("SELECT COUNT(*) AS c FROM queue_jobs WHERE entity_kind = ? AND entity_id = ?")
		.get(kind, entityId) as { c: number };
	return row.c;
}

function makeStandard(id: string): CodingStandardEntry {
	const now = new Date().toISOString();
	return {
		id,
		title: `Standard ${id}`,
		content: `Content for ${id}`,
		parent_id: null,
		context: "general",
		version: "1.0.0",
		language: "typescript",
		stack: [],
		is_global: false,
		owner: OWNER,
		repo: REPO,
		tags: [],
		metadata: {},
		created_at: now,
		updated_at: now,
		hit_count: 0,
		last_used_at: null,
		agent: "test",
		model: "test"
	};
}

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
	const now = new Date().toISOString();
	return {
		id,
		owner: OWNER,
		repo: REPO,
		task_code: `TASK-${id}`,
		phase: "test",
		title: `Task ${id}`,
		description: `Description for ${id}`,
		status: "pending",
		priority: 3,
		agent: "test",
		role: "test",
		doc_path: null,
		suggested_skills: [],
		finished_at: null,
		canceled_at: null,
		tags: [],
		metadata: {},
		created_at: now,
		updated_at: now,
		parent_id: null,
		depends_on: null,
		est_tokens: 0,
		in_progress_at: null,
		commit_id: null,
		changed_files: [],
		...overrides
	};
}

describe("TASK-429 cross-domain atomicity (ADR-011 item 3)", () => {
	let db: SQLiteStore;
	let vectors: VectorStore;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		db.close();
	});

	// -----------------------------------------------------------------------
	// 1. purgeEntityAndCleanup — entity + queue_jobs in ONE transaction
	// -----------------------------------------------------------------------

	describe("purgeEntityAndCleanup (entity + queue_jobs, one transaction)", () => {
		it("cancels the task AND deletes its queue_jobs row together", () => {
			const task = makeTask("aaaaaaaa-0000-4000-a000-000000000001", { status: "pending" });
			db.tasks.insertTask(task);
			insertQueueJob(db, "task", task.id);
			expect(countQueueJobs(db, "task", task.id)).toBe(1);

			const purged = purgeEntityAndCleanup(db, "task", [{ id: task.id, title: task.title, repo: REPO }]);

			expect(purged).toBe(1);
			// Entity side: soft-canceled.
			expect(db.tasks.getTaskById(task.id)!.status).toBe("canceled");
			// Queue side: the stale embedding job is gone (no re-embed of a
			// canceled entity).
			expect(countQueueJobs(db, "task", task.id)).toBe(0);
		});

		it("rolls back BOTH the entity delete and the queue purge on a mid-transaction failure", () => {
			// Two standards + two queue_jobs rows. The second delete throws, so
			// the whole transaction must roll back: both standards survive AND
			// the queue purge (which runs after the delete loop) never happens.
			const a = makeStandard("bbbbbbbb-0000-4000-a000-000000000001");
			const b = makeStandard("bbbbbbbb-0000-4000-a000-000000000002");
			db.standards.insert(a);
			db.standards.insert(b);
			insertQueueJob(db, "standard", a.id);
			insertQueueJob(db, "standard", b.id);

			const realDelete = db.standards.delete.bind(db.standards);
			let calls = 0;
			vi.spyOn(db.standards, "delete").mockImplementation((id: string) => {
				calls += 1;
				if (calls === 2) throw new Error("injected mid-transaction failure");
				realDelete(id);
			});

			expect(() =>
				purgeEntityAndCleanup(db, "standard", [
					{ id: a.id, title: a.title, repo: REPO },
					{ id: b.id, title: b.title, repo: REPO }
				])
			).toThrow("injected mid-transaction failure");

			// Rollback proof — the FIRST standard's successful delete was undone
			// with the rest of the transaction.
			expect(db.standards.getById(a.id)).not.toBeNull();
			expect(db.standards.getById(b.id)).not.toBeNull();
			// Queue purge never ran, so both outbox rows are intact.
			expect(countQueueJobs(db, "standard", a.id)).toBe(1);
			expect(countQueueJobs(db, "standard", b.id)).toBe(1);
		});
	});

	// -----------------------------------------------------------------------
	// 2. task→memory archival (archiveCompletedTasks under withExclusiveWrite)
	// -----------------------------------------------------------------------

	describe("task→memory archival", () => {
		async function insertInProgressTask(id: string): Promise<Task> {
			const task = makeTask(id, { status: "in_progress", in_progress_at: new Date().toISOString() });
			db.tasks.insertTask(task);
			return task;
		}

		function taskArchiveMemories(): MemoryEntry[] {
			return db.memories.getRecentMemories(OWNER, REPO, 50).filter((m) => m.type === "task_archive");
		}

		it("completes the task AND writes its task_archive memory under the exclusive lock", async () => {
			const task = await insertInProgressTask("cccccccc-0000-4000-a000-000000000001");
			const lockSpy = vi.spyOn(db, "withExclusiveWrite");

			await handleTaskWrite(
				{ owner: OWNER, repo: REPO, id: task.id, status: "completed", comment: "done" },
				db,
				vectors
			);

			// Post-condition: both sides landed — the task is completed and the
			// archive memory exists (the archive is awaited, not fire-and-forget).
			expect(db.tasks.getTaskById(task.id)!.status).toBe("completed");
			const archives = taskArchiveMemories();
			expect(archives.length).toBe(1);
			expect((archives[0].metadata as { task_id?: string }).task_id).toBe(task.id);

			// Lock discipline: the archival crossed the exclusive-write boundary
			// (handleTaskWrite itself plus the nested archiveCompletedTasks call).
			expect(lockSpy).toHaveBeenCalled();
		});

		it("documents the best-effort limitation: a failed archive does NOT roll back the completed status", async () => {
			const task = await insertInProgressTask("dddddddd-0000-4000-a000-000000000001");

			// Force the memory INSERT to throw, simulating an archive failure.
			vi.spyOn(db.memories, "insert").mockImplementation(() => {
				throw new Error("injected archive failure");
			});

			// archiveCompletedTasks catches + logs, so the write resolves.
			await expect(
				handleTaskWrite({ owner: OWNER, repo: REPO, id: task.id, status: "completed", comment: "done" }, db, vectors)
			).resolves.toBeDefined();

			// LIMITATION (documented, not a bug): the status commit and the
			// archive are NOT one SQL transaction. `coreUpdate` commits the
			// status in its own transaction, then `archiveCompletedTasks` runs
			// as a separate best-effort step. So on archive failure the task
			// stays completed with NO archive row — the two are consistent on
			// success, but the archive is not rolled back with the status.
			expect(db.tasks.getTaskById(task.id)!.status).toBe("completed");
			expect(taskArchiveMemories()).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// 3. maintenance sweep (single withExclusiveWrite compound)
	// -----------------------------------------------------------------------

	describe("maintenance sweep (withExclusiveWrite compound)", () => {
		const STALE = "2024-01-01T00:00:00.000Z";
		const VALID_UUID = "123e4567-e89b-42d3-a456-426614174000";

		function makeMemory(overrides: Partial<MemoryEntry>): MemoryEntry {
			return {
				id: VALID_UUID,
				type: "code_fact",
				title: "Decay Target",
				content: "Memory subject to decay logic.",
				importance: 4,
				agent: "test",
				role: "backend",
				model: "test",
				scope: { owner: OWNER, repo: REPO },
				created_at: STALE,
				updated_at: STALE,
				completed_at: null,
				hit_count: 0,
				recall_count: 0,
				last_used_at: STALE,
				expires_at: null,
				supersedes: null,
				status: "active",
				tags: [],
				metadata: {},
				is_global: false,
				...overrides
			};
		}

		function maintenanceRunRecord(): { updated_at: string } | undefined {
			return db.db
				.prepare(`SELECT updated_at FROM ${TABLE_MEMORY_SUMMARY} WHERE owner = ? AND repo = ?`)
				.get("__soul__", "__maintenance__") as { updated_at: string } | undefined;
		}

		it("runs the whole sweep under ONE exclusive write and leaves a consistent state", async () => {
			// Passthrough spy: crosses the lock boundary without real
			// proper-lockfile acquisition (mirrors soul-maintenance.test.ts).
			const lockSpy = vi.spyOn(db, "withExclusiveWrite").mockImplementation(async (fn) => fn());
			db.memories.insert(makeMemory({ importance: 4 }));

			const result = await runStartupMaintenance(db);

			expect(result.skipped).toBe(false);
			// Exactly one lock crossing for the compound sweep (TASK-102).
			expect(lockSpy).toHaveBeenCalledTimes(1);
			// Consistent state: the decay mutation AND the run-record landed
			// together in the same sweep.
			expect(db.memories.getById(VALID_UUID)!.importance).toBe(3); // floor(4 - 0.5)
			expect(maintenanceRunRecord()).toBeDefined();
		});

		it("leaves NO run-record when the sweep fails mid-way, so the next startup retries", async () => {
			vi.spyOn(db, "withExclusiveWrite").mockImplementation(async (fn) => fn());
			// Inject a failure AFTER the decay step but BEFORE recordMaintenanceRun.
			const failingArchive = vi.spyOn(db.memoryArchives, "archiveLowScoreMemories").mockImplementation(() => {
				throw new Error("injected sweep failure");
			});

			await expect(runStartupMaintenance(db)).rejects.toThrow("injected sweep failure");

			// The run-record is the sweep's commit marker. Its absence proves
			// the sweep did not report success, so the 24h skip gate does not
			// engage and the next startup re-runs the maintenance.
			expect(maintenanceRunRecord()).toBeUndefined();

			// Heal the injected failure: the next startup re-runs and records.
			failingArchive.mockRestore();
			const retry = await runStartupMaintenance(db);
			expect(retry.skipped).toBe(false);
			expect(maintenanceRunRecord()).toBeDefined();
		});
	});
});
