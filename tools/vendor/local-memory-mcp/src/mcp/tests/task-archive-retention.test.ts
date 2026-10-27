/**
 * TASK-039 — write-time growth bound for task_archive memories.
 *
 * task_archive was the single largest memory class (65% of all rows on a real
 * deployment) and completely unbounded: archiveTaskToMemory wrote archives with
 * no TTL, so the existing archiveExpiredMemories sweep had nothing to expire.
 *
 * Coverage:
 *   (a) an archived task memory now carries a non-null expires_at ~180 days out;
 *   (b) TASK_ARCHIVE_TTL_DAYS is env-overridable;
 *   (c) a multi-task archive (bulk update by ids) coalesces into ONE
 *       task_archive memory with metadata.task_ids.
 *
 * Strategy: real in-memory SQLiteStore (createTestStore) + StubVectorStore —
 * the exact write path used by the task tools.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleTaskWrite } from "../tools/task.write";
import { TASK_ARCHIVE_AGGREGATE_MAX_CHARS, TASK_ARCHIVE_TTL_DAYS } from "../utils/constants";
import type { VectorStore } from "../types";

const REPO = "archive-retention-repo";
const MS_PER_DAY = 86_400_000;

describe("TASK-039 task_archive write-time growth bound", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
	});

	afterEach(() => {
		db.close();
	});

	async function createTask(taskCode: string) {
		await handleTaskWrite(
			{
				repo: REPO,
				owner: "test",
				task_code: taskCode,
				phase: "test",
				title: `Task ${taskCode}`,
				description: `Description for ${taskCode}`,
				status: "pending",
				agent: "test-agent",
				role: "test-role"
			},
			db,
			vectors
		);
		return db.tasks.getTaskByCode("test", REPO, taskCode)!;
	}

	async function completeTask(taskCode: string) {
		const task = await createTask(taskCode);
		await handleTaskWrite(
			{ owner: "test", repo: REPO, id: task.id, status: "in_progress", comment: "starting" },
			db,
			vectors
		);
		await handleTaskWrite(
			{ owner: "test", repo: REPO, id: task.id, status: "completed", comment: "done", est_tokens: 100 },
			db,
			vectors
		);
		return task;
	}

	it("(a) sets a non-null expires_at ~180 days out on the archived task memory", async () => {
		const before = Date.now();
		await completeTask("AR-001");

		const archives = db.memories.getRecentMemories("test", REPO, 50).filter((m) => m.type === "task_archive");
		expect(archives.length).toBe(1);

		const archive = archives[0];
		expect(archive.expires_at).not.toBeNull();
		expect(archive.expires_at).toBeTruthy();

		const expiresMs = new Date(archive.expires_at!).getTime();
		const expectedMs = before + TASK_ARCHIVE_TTL_DAYS * MS_PER_DAY;
		// Allow a small slack for the wall clock advancing during the write.
		expect(Math.abs(expiresMs - expectedMs)).toBeLessThan(60_000);
		expect(expiresMs).toBeGreaterThan(Date.now());
	});

	it("(b) TASK_ARCHIVE_TTL_DAYS defaults to 180 and is env-overridable", async () => {
		expect(TASK_ARCHIVE_TTL_DAYS).toBe(180);

		const prev = process.env.TASK_ARCHIVE_TTL_DAYS;
		process.env.TASK_ARCHIVE_TTL_DAYS = "30";
		try {
			// The constant is bound at module-load time (envInt), so drop the
			// cached module and re-import so envInt re-reads process.env.
			vi.resetModules();
			const mod = await import("../utils/constants");
			expect(mod.TASK_ARCHIVE_TTL_DAYS).toBe(30);
		} finally {
			if (prev === undefined) delete process.env.TASK_ARCHIVE_TTL_DAYS;
			else process.env.TASK_ARCHIVE_TTL_DAYS = prev;
			vi.resetModules();
		}
	});

	it("(c) coalesces a multi-task archive into ONE memory with task_ids metadata", async () => {
		// Create 3 tasks and move each to in_progress individually (no archive),
		// then complete all three in ONE bulk-by-ids call → one aggregated archive.
		const tasks = [await createTask("AGG-001"), await createTask("AGG-002"), await createTask("AGG-003")];
		for (const task of tasks) {
			await handleTaskWrite(
				{ owner: "test", repo: REPO, id: task.id, status: "in_progress", comment: "starting" },
				db,
				vectors
			);
		}

		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				ids: tasks.map((t) => t.id),
				status: "completed",
				comment: "batch complete",
				est_tokens: 100
			},
			db,
			vectors
		);

		const archives = db.memories.getRecentMemories("test", REPO, 50).filter((m) => m.type === "task_archive");

		// Exactly ONE aggregated row — not three per-task rows.
		expect(archives.length).toBe(1);
		const aggregated = archives[0];
		expect((aggregated.metadata as { aggregated?: boolean }).aggregated).toBe(true);

		const meta = aggregated.metadata as {
			aggregated?: boolean;
			count?: number;
			task_ids?: string[];
			task_codes?: string[];
		};
		expect(meta.count).toBe(3);
		expect(meta.task_ids).toEqual(expect.arrayContaining(tasks.map((t) => t.id)));
		expect(meta.task_ids?.length).toBe(3);
		expect(meta.task_codes).toEqual(expect.arrayContaining(["AGG-001", "AGG-002", "AGG-003"]));
		expect(aggregated.expires_at).not.toBeNull();
	});

	it("(d) keeps a non-empty body when the FIRST block alone exceeds the cap", async () => {
		// Edge case: the first task's body is larger than the aggregate cap, so
		// the coalescing loop breaks with included === 0. Without the fallback
		// the body would be header + elision notice only (no task text at all).
		const huge = await createTask("BIG-001");
		// Rewrite the description with a body far larger than the cap.
		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				id: huge.id,
				description: "BEGIN-BIG-BODY " + "x".repeat(TASK_ARCHIVE_AGGREGATE_MAX_CHARS * 3) + " END-BIG-BODY"
			},
			db,
			vectors
		);
		const small = await createTask("BIG-002");

		for (const task of [huge, small]) {
			await handleTaskWrite(
				{ owner: "test", repo: REPO, id: task.id, status: "in_progress", comment: "starting" },
				db,
				vectors
			);
		}

		await handleTaskWrite(
			{
				owner: "test",
				repo: REPO,
				ids: [huge.id, small.id],
				status: "completed",
				comment: "batch complete",
				est_tokens: 100
			},
			db,
			vectors
		);

		const archives = db.memories.getRecentMemories("test", REPO, 50).filter((m) => m.type === "task_archive");
		expect(archives.length).toBe(1);
		const content = archives[0].content;

		// Body must not be empty: it retains a truncated prefix of the first task.
		expect(content.length).toBeGreaterThan(0);
		expect(content).toContain("Task: [BIG-001]");
		expect(content).toContain("BEGIN-BIG-BODY");
		expect(content).toContain("…[truncated]");
		expect(content.length).toBeLessThanOrEqual(TASK_ARCHIVE_AGGREGATE_MAX_CHARS);
	});
});
