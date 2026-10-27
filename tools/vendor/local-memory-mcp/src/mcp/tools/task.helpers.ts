import { SQLiteStore } from "../storage/sqlite";
import { type Task, type TaskComment, type TaskStatus, type VectorStore } from "../types";
import { logger } from "../utils/logger";
import { resolveEntityRef } from "../utils/entity-ref";
import { TASK_ARCHIVE_AGGREGATE_MAX_CHARS, TASK_ARCHIVE_TTL_DAYS } from "../utils/constants";
import { handleMemoryWrite } from "./memory-write";

/**
 * Builds the caller-actionable VALIDATION_ERROR for a task reference
 * (parent_id / depends_on) that names a task which does not exist.
 * `classifyExpectedError` (utils/mcp-error.ts) maps this message to
 * VALIDATION_ERROR via the `references '<x>' which does not exist` pattern.
 */
function missingReferenceError(field: "parent_id" | "depends_on", value: string, owner: string, repo: string): Error {
	return new Error(
		`${field} references '${value}' which does not exist in ${owner}/${repo}. Create the referenced task first or remove the reference.`
	);
}

/**
 * Resolves a task reference (UUID or code) to a UUID and verifies the target
 * task actually exists in scope (FIX-024).
 *
 * `resolveEntityRef` returns a well-formed UUID as-is WITHOUT a DB lookup, so a
 * reference to a task that does not exist previously reached SQLite and
 * surfaced as a raw `FOREIGN KEY constraint failed`. This pre-check turns that
 * into a caller-actionable VALIDATION_ERROR naming the missing reference. The
 * FK remains in place as a last-resort integrity net — this is a pre-check,
 * not a constraint removal.
 *
 * The optional `localCodeMap` is checked first for cross-references within the
 * same batch (bulk create); a sibling whose row has not been inserted yet is
 * still reported as missing because the FK would reject it too.
 */
function resolveTaskReference(
	field: "parent_id" | "depends_on",
	value: string | null | undefined,
	owner: string,
	repo: string,
	storage: SQLiteStore,
	localCodeMap?: Map<string, string>
): string | null {
	if (!value) return null;

	let id: string | null;
	try {
		id = resolveEntityRef(storage, "task", value, owner, repo, { localMap: localCodeMap });
	} catch (err) {
		// FIX-021: keep the actionable orchestrator-placeholder error as-is
		// (an unsubstituted template token, not a genuinely missing reference).
		if (err instanceof Error && /unsubstituted orchestrator template placeholder/i.test(err.message)) {
			throw err;
		}
		// A code that does not resolve to any task in scope.
		throw missingReferenceError(field, value, owner, repo);
	}

	if (!id) return null;

	// The UUID branch of resolveEntityRef does not hit the DB — verify existence
	// (also covers a localMap id whose sibling row is not inserted yet).
	if (!storage.tasks.getTaskById(id)) {
		throw missingReferenceError(field, value, owner, repo);
	}

	return id;
}

/**
 * Resolves a parent_id value that is either a UUID or a task_code string.
 * Returns the resolved UUID, or throws if the task cannot be found.
 * An optional localCodeMap is checked first for cross-references within the same batch.
 */
export function resolveParentId(
	value: string | null | undefined,
	owner: string,
	repo: string,
	storage: SQLiteStore,
	localCodeMap?: Map<string, string>
): string | null {
	return resolveTaskReference("parent_id", value, owner, repo, storage, localCodeMap);
}

export function resolveDependsOn(
	value: string | null | undefined,
	owner: string,
	repo: string,
	storage: SQLiteStore,
	localCodeMap?: Map<string, string>
): string | null {
	return resolveTaskReference("depends_on", value, owner, repo, storage, localCodeMap);
}

export function deriveTaskStatusTimestamps(status: TaskStatus, now: string, existingTask?: { status: TaskStatus }) {
	const timestamps = {
		in_progress_at: null as string | null,
		finished_at: null as string | null,
		canceled_at: null as string | null
	};

	if (status === "in_progress" && existingTask?.status !== "in_progress") {
		timestamps.in_progress_at = now;
	}

	if (status === "completed") {
		timestamps.finished_at = now;
	}

	if (status === "canceled") {
		timestamps.canceled_at = now;
	}

	return timestamps;
}

export async function archiveTaskToMemory(taskId: string, repo: string, storage: SQLiteStore, vectors: VectorStore) {
	const task = storage.tasks.getTaskById(taskId);
	if (!task) return;

	const comments = storage.taskComments.getTaskCommentsByTaskId(taskId);
	const content = buildTaskArchiveContent(task, comments);

	const metadata = {
		task_id: taskId,
		task_code: task.task_code,
		original_metadata: task.metadata
	};

	const title = `Completed Task: ${task.title}`;
	const truncatedTitle = title.length > 100 ? title.substring(0, 97) + "..." : title;

	try {
		await handleMemoryWrite(
			{
				type: "task_archive",
				title: truncatedTitle,
				content: content,
				importance: Math.min(5, task.priority + 1),
				agent: task.agent || "system",
				role: task.role || "unknown",
				model: "system",
				scope: { repo, owner: task.owner || "" },
				tags: ["task-archive", ...task.tags],
				// TASK-039: task_archive memories were the largest, unbounded
				// memory class (65% of all rows). A TTL feeds them into the
				// existing archiveExpiredMemories sweep (runStartupMaintenance
				// with force=true) so they are archived once stale instead of
				// accumulating forever. See TASK_ARCHIVE_TTL_DAYS.
				ttlDays: TASK_ARCHIVE_TTL_DAYS,
				metadata: metadata
			},
			storage,
			vectors
		);
	} catch (error) {
		logger.error("Failed to archive task to memory", { error: String(error) });
	}
}

/** Renders the full per-task archive body (title, phase, comments history, …). */
function buildTaskArchiveContent(task: Task, comments: TaskComment[]): string {
	let content = `Task: [${task.task_code}] ${task.title}\n`;
	content += `Phase: ${task.phase}\n`;
	content += `Description: ${task.description || "No description"}\n`;
	content += `Commit: ${task.commit_id || "N/A"}\n`;
	if (task.changed_files && task.changed_files.length > 0) {
		content += `Files changed:\n`;
		for (const f of task.changed_files) {
			content += `  - ${f}\n`;
		}
	}

	if (comments && comments.length > 0) {
		content += `\nComments & History:\n`;
		const chronComments = [...comments].reverse();
		for (const c of chronComments) {
			const statusInfo = c.next_status ? ` (Status: ${c.previous_status} -> ${c.next_status})` : "";
			content += `- [${c.created_at}] ${c.agent}${statusInfo}: ${c.comment}\n`;
		}
	}

	return content;
}

/**
 * Archives ONE completed task to a single task_archive memory. Delegates to
 * {@link archiveTasksToMemory} so single- and multi-task callers share one
 * code path.
 */
export async function archiveTasksToMemory(
	taskIds: string[],
	repo: string,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<void> {
	if (taskIds.length === 0) return;
	if (taskIds.length === 1) {
		await archiveTaskToMemory(taskIds[0], repo, storage, vectors);
		return;
	}

	// TASK-039 aggregation: a single archiveCompletedTasks call that completes
	// MULTIPLE task ids for the same repo coalesces them into ONE task_archive
	// memory instead of N. This bounds the row growth on the batch-completion
	// path (each per-task archive was a full row with the complete body). The
	// content is capped at TASK_ARCHIVE_AGGREGATE_MAX_CHARS and the ids are
	// listed in metadata.task_ids so the individual tasks remain discoverable.
	const tasks: { task: Task; comments: TaskComment[] }[] = [];
	for (const taskId of taskIds) {
		const task = storage.tasks.getTaskById(taskId);
		if (!task) continue;
		tasks.push({ task, comments: storage.taskComments.getTaskCommentsByTaskId(taskId) });
	}
	if (tasks.length === 0) return;

	const blocks = tasks.map(({ task, comments }) => buildTaskArchiveContent(task, comments));
	let content = `Aggregated task archive — ${tasks.length} tasks completed in one batch.\n\n`;
	let included = 0;
	for (const block of blocks) {
		if (content.length + block.length > TASK_ARCHIVE_AGGREGATE_MAX_CHARS) break;
		content += block + "\n---\n";
		included++;
	}
	// Edge case: the FIRST block alone already exceeds the cap, so the loop
	// broke with included === 0 and the body would be header + notice only.
	// Retain a truncated prefix of the first task's body (marker reserved
	// inside the budget so the hard cap below does not clip it off) so the
	// archive is never body-empty. Task ids/codes live in metadata regardless.
	if (included === 0 && blocks.length > 0) {
		const ELISION = "…[truncated]";
		const budget = TASK_ARCHIVE_AGGREGATE_MAX_CHARS - content.length - ELISION.length;
		if (budget > 0) {
			content += blocks[0].slice(0, budget) + ELISION;
			included = 1;
		}
	}
	if (included < blocks.length) {
		content += `\n... (+${blocks.length - included} more task(s) not shown; see metadata.task_ids)\n`;
	}
	// Hard cap: a single oversized block could still push past the limit.
	if (content.length > TASK_ARCHIVE_AGGREGATE_MAX_CHARS) {
		content = content.slice(0, TASK_ARCHIVE_AGGREGATE_MAX_CHARS);
	}

	const first = tasks[0].task;
	const taskCodes = tasks.map((t) => t.task.task_code);
	const tags = new Set<string>(["task-archive", "aggregated"]);
	for (const { task } of tasks) {
		for (const tag of task.tags) tags.add(tag);
	}

	const title = `Completed Tasks: ${tasks.length} tasks`;
	const truncatedTitle = title.length > 100 ? title.substring(0, 97) + "..." : title;

	try {
		await handleMemoryWrite(
			{
				type: "task_archive",
				title: truncatedTitle,
				content: content,
				importance: Math.min(5, Math.max(...tasks.map((t) => t.task.priority)) + 1),
				agent: first.agent || "system",
				role: first.role || "unknown",
				model: "system",
				scope: { repo, owner: first.owner || "" },
				tags: [...tags],
				ttlDays: TASK_ARCHIVE_TTL_DAYS,
				metadata: {
					aggregated: true,
					count: tasks.length,
					task_ids: tasks.map((t) => t.task.id),
					task_codes: taskCodes
				}
			},
			storage,
			vectors
		);
	} catch (error) {
		logger.error("Failed to archive tasks to memory", { error: String(error) });
	}
}
