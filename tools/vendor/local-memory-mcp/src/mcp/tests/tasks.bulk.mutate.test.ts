import { describe, it, expect, beforeEach } from "vitest";
import { createRouter } from "../router";
import { createTestStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import type { VectorStore } from "../types";
import { getPrimaryTextContent, McpResponse } from "../utils/mcp-response";

function getTextContent(result: McpResponse) {
	return getPrimaryTextContent(result) || (result.structuredContent as { text?: string })?.text || "";
}

// ─── Bulk update / soft-delete / not-found policy ─────────────────────────
// Split out from tasks.bulk.test.ts (the "mutate + delete" half of the bulk
// suite) to keep that file within the 500-line maintainability limit.
// Setup mirrors the original describe: createTestStore + error-to-isError
// router wrapper + getTextContent helper.

describe("MCP Local Memory - Consolidated Task Tools Bulk (update / soft-delete / not-found)", () => {
	let db: Awaited<ReturnType<typeof createTestStore>>;
	let vectors: VectorStore;
	let router: (
		method: string,
		params: Record<string, unknown> | undefined,
		signal?: AbortSignal,
		onProgress?: (progress: number, total?: number) => void
	) => Promise<McpResponse>;

	const REPO = "bulk-test-repo";

	beforeEach(async () => {
		db = await createTestStore();
		vectors = new StubVectorStore(db);
		const originalRouter = createRouter(db, vectors);
		router = async (method, params) => {
			try {
				return (await originalRouter(method, params)) as any;
			} catch (err: any) {
				return {
					isError: true,
					content: [{ type: "text", text: err?.message || String(err) }]
				} as McpResponse;
			}
		};
	});

	it("should bulk soft-delete tasks", async () => {
		// Create 3 tasks
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{ task_code: "DEL-1", title: "Task 1", description: "Desc 1", phase: "p", status: "pending", est_tokens: 15 },
					{ task_code: "DEL-2", title: "Task 2", description: "Desc 2", phase: "p", status: "pending", est_tokens: 16 },
					{ task_code: "DEL-3", title: "Task 3", description: "Desc 3", phase: "p", status: "pending", est_tokens: 17 }
				]
			}
		});

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		const idsToDelete = [tasks[0].id, tasks[1].id];

		const delRes = await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: idsToDelete
			}
		});

		expect(getTextContent(delRes)).toContain(`Deleted 2 tasks from "${REPO}`);
		const remainingTasks = db.tasks.getTasksByRepo("test", REPO);
		expect(remainingTasks.length).toBe(3); // soft-delete keeps records
		expect(remainingTasks.filter((t) => t.status !== "canceled").length).toBe(1);
	});

	it("auto-populates timestamps from status so agents do not need to send them manually", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{ task_code: "TS-1", title: "To Start", description: "Desc", phase: "p", status: "backlog", est_tokens: 40 },
					{ task_code: "TS-2", title: "To Finish", description: "Desc", phase: "p", status: "backlog", est_tokens: 60 }
				]
			}
		});

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		const ts1 = tasks.find((t) => t.task_code === "TS-1");
		const ts2 = tasks.find((t) => t.task_code === "TS-2");

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: ts1!.id,
				status: "in_progress",
				comment: "Starting TS-1",
				agent: "Agent-1",
				role: "tester"
			}
		});

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: ts2!.id,
				status: "in_progress",
				comment: "Starting TS-2",
				agent: "Agent-1",
				role: "tester"
			}
		});

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				id: ts2!.id,
				status: "completed",
				comment: "Finishing TS-2",
				agent: "Agent-1",
				role: "tester",
				est_tokens: 100
			}
		});

		const started = db.tasks.getTaskById(ts1!.id);
		const done = db.tasks.getTaskById(ts2!.id);

		expect(started?.in_progress_at).toBeTruthy();
		expect(started?.finished_at).toBeNull();
		expect(done?.finished_at).toBeTruthy();
	});

	it("should bulk update tasks from pending to completed", async () => {
		// Create 3 pending tasks
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{ task_code: "UP-1", title: "Task 1", description: "D", phase: "p", status: "pending", est_tokens: 10 },
					{ task_code: "UP-2", title: "Task 2", description: "D", phase: "p", status: "pending", est_tokens: 10 },
					{ task_code: "UP-3", title: "Task 3", description: "D", phase: "p", status: "pending", est_tokens: 10 }
				]
			}
		});

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		const ids = tasks.map((t) => t.id);

		// TASK-061: pending → completed is not a valid direct transition and
		// `force` no longer bypasses the state machine — move the batch to
		// in_progress first (with a comment), then complete it.
		const startRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: ids,
				status: "in_progress",
				comment: "starting batch"
			}
		});
		expect(startRes.isError).toBe(false);

		// Bulk update to completed
		const upRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: ids,
				status: "completed",
				comment: "Bulk completion test",
				est_tokens: 500
			}
		});

		expect(upRes.isError).toBe(false);
		expect(getTextContent(upRes)).toContain(`Updated 3 tasks in repo "${REPO}`);

		const updatedTasks = db.tasks.getTasksByRepo("test", REPO);
		updatedTasks.forEach((t) => {
			expect(t.status).toBe("completed");
			expect(t.finished_at).toBeTruthy();
			expect(t.est_tokens).toBe(500);
		});

		// Verify task archive memory created — TASK-039: the multi-id batch is
		// coalesced into ONE aggregated task_archive memory (not 3 per-task rows).
		const memories = db.memories.searchByRepo("test", REPO);
		const archMemories = memories.filter((m) => m.type === "task_archive");
		expect(archMemories.length).toBe(1);

		const aggregated = archMemories[0];
		const aggMeta = aggregated.metadata as { aggregated?: boolean; count?: number; task_ids?: string[] };
		expect(aggMeta.aggregated).toBe(true);
		expect(aggMeta.count).toBe(3);
		expect(aggMeta.task_ids).toEqual(expect.arrayContaining(ids));
		expect(aggMeta.task_ids?.length).toBe(3);
		// TASK-039: aggregated archives carry a retention TTL.
		expect(aggregated.expires_at).not.toBeNull();

		// Verify comments created — one per transition (in_progress, then completed).
		const comments = db.taskComments.getTaskCommentsByTaskId(ids[0]);
		expect(comments.length).toBe(2);
		expect(comments[0].comment).toBe("Bulk completion test");
		expect(comments[0].next_status).toBe("completed");
		expect(comments[1].comment).toBe("starting batch");
		expect(comments[1].next_status).toBe("in_progress");
	});

	it("TASK-044: aggregates a tasks[] bulk completion of N tasks into ONE task_archive memory", async () => {
		// Create 3 tasks in one bulk call.
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{ task_code: "T44-1", title: "Task 1", description: "D", phase: "p", status: "pending" },
					{ task_code: "T44-2", title: "Task 2", description: "D", phase: "p", status: "pending" },
					{ task_code: "T44-3", title: "Task 3", description: "D", phase: "p", status: "pending" }
				]
			}
		});

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		const ids = tasks.map((t) => t.id);

		// Move all three to in_progress in one bulk `tasks[]` call (no archive yet).
		const startRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				tasks: ids.map((id) => ({ id, status: "in_progress", comment: "starting" }))
			}
		});
		expect(startRes.isError).toBe(false);

		// Complete all three in ONE bulk `tasks[]` call → one aggregated archive.
		const doneRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				tasks: ids.map((id) => ({ id, status: "completed", comment: "done" }))
			}
		});
		expect(doneRes.isError).toBe(false);

		const updatedTasks = db.tasks.getTasksByRepo("test", REPO);
		updatedTasks.forEach((t) => expect(t.status).toBe("completed"));

		// Exactly ONE aggregated task_archive memory — not three per-task rows.
		const archMemories = db.memories.searchByRepo("test", REPO).filter((m) => m.type === "task_archive");
		expect(archMemories.length).toBe(1);

		const aggMeta = archMemories[0].metadata as { aggregated?: boolean; count?: number; task_ids?: string[] };
		expect(aggMeta.aggregated).toBe(true);
		expect(aggMeta.count).toBe(3);
		expect(aggMeta.task_ids).toEqual(expect.arrayContaining(ids));
		expect(aggMeta.task_ids?.length).toBe(3);
		// Retention TTL is applied by archiveTasksToMemory.
		expect(archMemories[0].expires_at).not.toBeNull();
	});

	it("TASK-044: a single-task tasks[] bulk completion keeps the exact per-task archive shape", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [{ task_code: "T44S-1", title: "Solo Task", description: "D", phase: "p", status: "pending" }]
			}
		});

		const task = db.tasks.getTasksByRepo("test", REPO).find((t) => t.task_code === "T44S-1")!;

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				tasks: [{ id: task.id, status: "in_progress", comment: "starting" }]
			}
		});

		const doneRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				tasks: [{ id: task.id, status: "completed", comment: "done" }]
			}
		});
		expect(doneRes.isError).toBe(false);

		const archMemories = db.memories.searchByRepo("test", REPO).filter((m) => m.type === "task_archive");
		expect(archMemories.length).toBe(1);

		const archive = archMemories[0];
		// Per-task shape: title names the task, metadata carries task_id (no aggregate).
		expect(archive.title).toBe("Completed Task: Solo Task");
		const meta = archive.metadata as { task_id?: string; aggregated?: boolean };
		expect(meta.task_id).toBe(task.id);
		expect(meta.aggregated).toBeUndefined();
		expect(archive.expires_at).not.toBeNull();
	});

	it("should bulk update statuses and record in-progress timestamps", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [{ task_code: "IP-1", title: "Task 1", description: "D", phase: "p", status: "pending" }]
			}
		});

		const taskId = db.tasks.getTasksByRepo("test", REPO)[0].id;

		await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: [taskId],
				status: "in_progress",
				comment: "Moving to in progress"
			}
		});

		const task = db.tasks.getTaskById(taskId);
		expect(task?.status).toBe("in_progress");
		expect(task?.in_progress_at).toBeTruthy();
	});

	it("should soft-delete a single task via task-delete (by task_code)", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "SDEL-001",
				phase: "testing",
				title: "Soft Delete Single",
				description: "Testing single task soft delete by task_code",
				status: "pending",
				priority: 2,
				est_tokens: 30
			}
		});

		const beforeDelete = db.tasks.getTaskByCode("test", REPO, "SDEL-001");
		expect(beforeDelete).toBeDefined();
		expect(beforeDelete!.status).toBe("pending");

		const res = await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				task_code: "SDEL-001"
			}
		});

		expect(getTextContent(res)).toContain(`Deleted 1 task from "${REPO}"`);

		// Verify soft-delete: task still exists but is canceled
		const afterDelete = db.tasks.getTaskByCode("test", REPO, "SDEL-001");
		expect(afterDelete).toBeDefined();
		expect(afterDelete!.status).toBe("canceled");
		expect(afterDelete!.canceled_at).toBeTruthy();
	});

	it("should soft-delete multiple tasks by task_codes array via task-delete", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [
					{
						task_code: "BDEL-001",
						title: "Bulk Delete 1",
						description: "Desc",
						phase: "p",
						status: "pending",
						est_tokens: 10
					},
					{
						task_code: "BDEL-002",
						title: "Bulk Delete 2",
						description: "Desc",
						phase: "p",
						status: "pending",
						est_tokens: 10
					},
					{
						task_code: "BDEL-003",
						title: "Bulk Delete 3",
						description: "Desc",
						phase: "p",
						status: "pending",
						est_tokens: 10
					}
				]
			}
		});

		const res = await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				task_codes: ["BDEL-001", "BDEL-003"]
			}
		});

		expect(getTextContent(res)).toContain(`Deleted 2 tasks from "${REPO}"`);

		// Verify soft-delete: tasks exist but are canceled
		const task1 = db.tasks.getTaskByCode("test", REPO, "BDEL-001");
		expect(task1).toBeDefined();
		expect(task1!.status).toBe("canceled");

		const task2 = db.tasks.getTaskByCode("test", REPO, "BDEL-002");
		expect(task2).toBeDefined();
		expect(task2!.status).toBe("pending"); // not deleted

		const task3 = db.tasks.getTaskByCode("test", REPO, "BDEL-003");
		expect(task3).toBeDefined();
		expect(task3!.status).toBe("canceled");
	});

	// Unified not-found policy (OPT-CODE-04): single target → throw (fail
	// loud); bulk → skip + report partial execution.
	it("should fail loudly when deleting a non-existent single task (raw UUID)", async () => {
		const fakeId = "00000000-0000-0000-0000-000000000000";
		// The bulk-test router converts a thrown handler error into an isError
		// result — the fail-loud contract surfaces as isError:true here.
		const res = (await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				id: fakeId
			}
		})) as McpResponse;

		expect(res.isError).toBe(true);
		expect(getTextContent(res)).toContain("Task not found");
	});

	it("should skip + report a missing task in a bulk delete (partial execution)", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "PARTIAL-DEL-001",
				phase: "p",
				title: "Partial Delete Surviving",
				description: "This task survives the partial bulk delete.",
				status: "pending",
				priority: 2,
				est_tokens: 10
			}
		});

		const tasks = db.tasks.getTasksByRepo("test", REPO);
		const realId = tasks.find((t) => t.task_code === "PARTIAL-DEL-001")!.id;
		const fakeId = "00000000-0000-0000-0000-000000000000";

		const delRes = (await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: [realId, fakeId],
				json: true
			}
		})) as McpResponse;

		const data = delRes.structuredContent as any;
		expect(delRes.isError).toBe(true);
		expect(data).toMatchObject({ schema: "tool-error", code: "PARTIAL_FAILURE" });
		expect(data.success).toBe(true);
		expect(data.canceledCount).toBe(1);
		expect(data.skippedCount).toBe(1);
		expect(data.totalAttempted).toBe(2);
		expect(data.errors[0].error).toContain("Task not found");

		// The real task was canceled; the phantom id changed nothing.
		const stored = db.tasks.getTaskById(realId);
		expect(stored!.status).toBe("canceled");
	});

	// ─── Schema-drift regression: bulk tasks[] item must expose EVERY field ──
	// The item schema is now built from the canonical TaskWriteFieldDefs. These
	// tests pin the fields that the old hand-rolled copy silently stripped
	// (comment/force/model/commit_id/changed_files) plus the tightened phase min.

	it("schema-drift: a bulk tasks[] status update with no comment records an auto-comment (FIX-022; force:true is inert)", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [{ task_code: "FORCE-1", title: "Force Task", description: "D", phase: "p", status: "pending" }]
			}
		});

		const task = db.tasks.getTasksByRepo("test", REPO).find((t) => t.task_code === "FORCE-1")!;

		// backlog/pending → completed must pass through in_progress first.
		const startRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				tasks: [{ id: task.id, status: "in_progress", comment: "starting" }]
			}
		});
		expect(startRes.isError).toBe(false);

		// FIX-022: a status change with NO comment no longer bounces — it
		// succeeds and records a deterministic auto-comment. `force:true` stays
		// inert (it neither bypasses nor alters anything).
		const forcedRes = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				tasks: [{ id: task.id, status: "completed", force: true }]
			}
		});
		expect(forcedRes.isError).toBe(false);
		expect(db.tasks.getTaskById(task.id)?.status).toBe("completed");

		// The auto-comment is persisted (non-empty) so the audit trail survives.
		const comments = db.taskComments.getTaskCommentsByTaskId(task.id);
		const autoComment = comments.find((c) => c.next_status === "completed");
		expect(autoComment).toBeDefined();
		expect(autoComment!.comment).toMatch(/^Status: in_progress -> completed \(.+\)$/);
		expect(autoComment!.comment.trim()).not.toBe("");
	});

	it("schema-drift: a bulk tasks[] update persists commit_id + changed_files", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [{ task_code: "CF-1", title: "Commit Files", description: "D", phase: "p", status: "pending" }]
			}
		});

		const task = db.tasks.getTasksByRepo("test", REPO).find((t) => t.task_code === "CF-1")!;

		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				tasks: [
					{
						id: task.id,
						commit_id: "abc1234",
						changed_files: ["src/a.ts", "src/b.ts"]
					}
				]
			}
		});
		expect(res.isError).toBe(false);

		// Read back — commit_id/changed_files MUST persist (they were stripped
		// from the old item schema, so the update silently no-op'd).
		const stored = db.tasks.getTaskById(task.id);
		expect(stored?.commit_id).toBe("abc1234");
		expect(stored?.changed_files).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("schema-drift: a bulk tasks[] item with phase:'' is rejected at the schema layer (min 1)", async () => {
		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [{ task_code: "EMPTY-1", title: "Empty Phase", description: "D", phase: "", status: "pending" }]
			}
		});

		expect(res.isError).toBe(true);
		expect(getTextContent(res)).toMatch(/phase/i);
		// Nothing was created — the request failed before execution.
		expect(db.tasks.getTasksByRepo("test", REPO).length).toBe(0);
	});

	it("schema-drift: a bulk tasks[] status update records the provided model on the comment", async () => {
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				tasks: [{ task_code: "MODEL-1", title: "Model Task", description: "D", phase: "p", status: "pending" }]
			}
		});

		const task = db.tasks.getTasksByRepo("test", REPO).find((t) => t.task_code === "MODEL-1")!;

		const res = await router("tools/call", {
			name: "task-write",
			arguments: {
				owner: "test",
				repo: REPO,
				tasks: [{ id: task.id, status: "in_progress", comment: "starting", model: "claude-test-model" }]
			}
		});
		expect(res.isError).toBe(false);

		const comments = db.taskComments.getTaskCommentsByTaskId(task.id);
		expect(comments.length).toBe(1);
		// `model` is read off the raw item to author the status comment; if the
		// item schema stripped it, this would fall back to "unknown".
		expect(comments[0].model).toBe("claude-test-model");
	});

	it("should report success:false when every target of a bulk delete is missing (all-negative)", async () => {
		// Seed a real task so a phantom "canceled" would be observable.
		await router("tools/call", {
			name: "task-write",
			arguments: {
				repo: REPO,
				owner: "test",
				task_code: "ALL-NEG-DEL-001",
				phase: "p",
				title: "All-Negative Guard",
				description: "This task must survive an all-phantom bulk delete.",
				status: "pending",
				priority: 2,
				est_tokens: 10
			}
		});

		const before = db.tasks.getTasksByRepo("test", REPO);
		expect(before.length).toBe(1);

		const fakeId1 = "00000000-0000-0000-0000-000000000001";
		const fakeId2 = "00000000-0000-0000-0000-000000000002";

		const delRes = (await router("tools/call", {
			name: "task-delete",
			arguments: {
				owner: "test",
				repo: REPO,
				ids: [fakeId1, fakeId2],
				json: true
			}
		})) as McpResponse;

		// The shared success formula `deletedCount > 0 || skippedCount === 0`
		// flips to false here — nothing was deleted and everything was skipped.
		const data = delRes.structuredContent as any;
		expect(delRes.isError).toBe(true);
		expect(data).toMatchObject({ schema: "tool-error", code: "BULK_OPERATION_FAILED" });
		expect(data.success).toBe(false);
		expect(data.canceledCount).toBe(0);
		expect(data.skippedCount).toBe(2);
		expect(data.totalAttempted).toBe(2);
		expect(data.errors.length).toBe(2);
		expect(data.errors[0].error).toContain("Task not found");
		expect(data.errors[1].error).toContain("Task not found");

		// Task count/status unchanged — no phantom cancellation.
		const after = db.tasks.getTasksByRepo("test", REPO);
		expect(after).toHaveLength(before.length);
		expect(after.every((task) => task.status !== "canceled")).toBe(true);
	});
});
