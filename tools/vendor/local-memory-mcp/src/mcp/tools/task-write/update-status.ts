import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { Task, TaskStatus, VectorStore } from "../../types";
import { logger } from "../../utils/logger";
import { archiveTasksToMemory } from "../task.helpers";
import { resolveTransitionComment } from "./state-machine";

// ---------------------------------------------------------------------------
// Status transition logic
// ---------------------------------------------------------------------------

/**
 * Applies status timestamp fields (finished_at, canceled_at, in_progress_at)
 * based on the target status and current task state.
 * Modifies finalUpdates in place.
 */
export function applyStatusTimestamps(
	updates: Record<string, unknown>,
	existingTask: Task,
	now: string,
	finalUpdates: Record<string, unknown>
): void {
	const status = updates.status as TaskStatus | undefined;
	if (status === "completed") {
		finalUpdates.finished_at = now;
	} else if (status === "canceled") {
		finalUpdates.canceled_at = now;
	} else if (status === "in_progress" && existingTask.status !== "in_progress") {
		finalUpdates.in_progress_at = now;
	}
}

/**
 * Inserts a task comment when status changes or a comment is provided.
 *
 * FIX-022: a status change with no caller comment no longer bounces — the
 * comment is derived deterministically via {@link resolveTransitionComment}
 * (`Status: <from> -> <to> (<agent>, <timestamp>)`) so the audit trail stays
 * inspectable. An explicit comment is still honored verbatim. A status change
 * NEVER persists an empty-string comment.
 */
export function insertStatusComment(
	storage: SQLiteStore,
	targetId: string,
	owner: string,
	repo: string,
	updates: Record<string, unknown>,
	existingTask: Task,
	isStatusChanging: boolean,
	comment: string | undefined,
	now: string
): void {
	const hasExplicitComment = comment !== undefined && comment.trim() !== "";
	if (hasExplicitComment || isStatusChanging) {
		const agent = (updates.agent as string) || existingTask.agent || "unknown";
		const persistedComment = isStatusChanging
			? resolveTransitionComment(comment, existingTask.status, updates.status as TaskStatus, agent, now)
			: (comment as string);
		storage.taskComments.insertTaskComment({
			id: randomUUID(),
			task_id: targetId,
			owner,
			repo,
			comment: persistedComment,
			agent,
			role: (updates.role as string) || existingTask.role || "unknown",
			model: (updates.model as string) || "unknown",
			previous_status: isStatusChanging ? (existingTask.status as TaskStatus) : null,
			next_status: isStatusChanging ? (updates.status as TaskStatus) : null,
			created_at: now
		});
	}
}

/**
 * Releases claims and expires handoffs for completed/canceled tasks.
 */
export function handleCoordinationCleanup(
	storage: SQLiteStore,
	targetId: string,
	isStatusChanging: boolean,
	status: TaskStatus | undefined
): { releasedClaims: number; expiredHandoffs: number } {
	if (isStatusChanging && (status === "completed" || status === "canceled")) {
		const releasedClaims = storage.handoffs.releaseClaimsForTask(targetId);
		const expiredHandoffs = storage.handoffs.updatePendingHandoffsForTask(targetId, "expired");
		return { releasedClaims, expiredHandoffs };
	}
	return { releasedClaims: 0, expiredHandoffs: 0 };
}

/**
 * Archives completed tasks to memory (awaited, not fire-and-forget).
 *
 * Callers await this BEFORE returning the tool response so the task_archive
 * memory rows exist the moment the caller observes the write (deterministic
 * for tests and agents alike — no race window, no deferred work leaking into
 * later requests). The archive is a compound mutation (task update + memory
 * INSERT + outbox enqueue via handleMemoryWrite), so it runs under the
 * exclusive file lock (withExclusiveWrite, OPT-PERF-09) to never interleave
 * with another process's same-class sequence.
 *
 * TASK-039: a multi-id batch (bulk update by ids) is coalesced into ONE
 * task_archive memory by archiveTasksToMemory — capped content +
 * metadata.task_ids — instead of N per-task rows. A single id keeps the
 * per-task archive shape.
 *
 * The archival is intentionally cheap: task_archive skips the conflict check
 * (memory-write/helpers.ts) and ONNX embedding + KG extraction run later via
 * the outbox worker (TASK-013), so awaiting it adds negligible latency to the
 * write path.
 */
export async function archiveCompletedTasks(
	completedTaskIds: string[],
	repo: string,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<void> {
	if (completedTaskIds.length === 0) return;
	try {
		// TASK-039: archiveTasksToMemory coalesces a multi-task batch into ONE
		// task_archive memory (capped content, metadata.task_ids) and delegates
		// to the per-task archiveTaskToMemory for a single id. The whole batch
		// runs under one exclusive write so the task_archive row(s) exist the
		// moment the caller observes the completion.
		await storage.withExclusiveWrite(() => archiveTasksToMemory(completedTaskIds, repo, storage, vectors));
	} catch (err) {
		logger.error("Failed to archive tasks to memory", { taskIds: completedTaskIds, error: String(err) });
	}
}
