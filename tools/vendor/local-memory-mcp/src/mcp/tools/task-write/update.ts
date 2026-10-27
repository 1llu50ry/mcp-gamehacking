import { SQLiteStore } from "../../storage/sqlite";
import { TaskStatus, VectorStore } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { UUID_REGEX } from "../../utils/uuid";
import { assertNotOrchestratorPlaceholder } from "../../utils/placeholder-code";
import { resolveEntityRef } from "../../utils/entity-ref";
import { resolveParentId, resolveDependsOn } from "../task.helpers";
import { TASK_UPDATE_COLUMNS } from "../../entities/task/serializers";
import { validateStatusTransition } from "./state-machine";
import { invalidIdFormatMessage, ownerMoveCollisionMessage } from "./errors";
import { TaskWriteParams } from "./types";
import {
	buildUpdatesFromParams,
	applyPhaseTagSync,
	applyDecisionRefsToUpdates,
	enrichUpdatedTasks,
	validateNewOwner
} from "./update-field";
import {
	applyStatusTimestamps,
	insertStatusComment,
	handleCoordinationCleanup,
	archiveCompletedTasks
} from "./update-status";

// ---------------------------------------------------------------------------
// updatedFields — report only fields that actually reach the DB
// ---------------------------------------------------------------------------

/**
 * Derives the list of `updatedFields` from the keys of `updates` that survive
 * the writable-column allowlist (`TASK_UPDATE_COLUMNS`, the same allowlist
 * `updateTask` enforces). `buildUpdatesFromParams` spreads `...restUpdates`, so
 * request plumbing keys (`task_code`, `json`, `code`, `agent`, `interactive`,
 * `tasks`, …) leak into `updates` even though they are never persisted — this
 * keeps the response summary honest about what was written (issue #108).
 */
function deriveUpdatedFields(updates: Record<string, unknown>): string[] {
	return Object.keys(updates).filter((key) => TASK_UPDATE_COLUMNS.has(key));
}

/**
 * Builds the optional `(completed with commit …)` summary clause for a
 * completion transition. Omitted entirely when the task did not transition to
 * `completed`; the commit segment is omitted when no `commit_id` was provided,
 * so the summary never renders a literal `undefined` (issue #108).
 */
function buildCompletionClause(params: TaskWriteParams): string {
	if (params.status !== "completed") return "";
	const fileCount = (params.changed_files || []).length;
	const commitPart = params.commit_id ? `completed with commit ${params.commit_id}, ` : "completed, ";
	return ` (${commitPart}${fileCount} ${fileCount === 1 ? "file" : "files"} changed)`;
}

// ---------------------------------------------------------------------------
// Single UPDATE — shared core logic
// ---------------------------------------------------------------------------

async function coreUpdate(
	params: TaskWriteParams,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<{
	updatedCount: number;
	updatedTasks: { id: string; code: string }[];
	completedTaskIds: string[];
	releasedClaims: number;
	expiredHandoffs: number;
	updatedFields: string[];
	taskTitle: string;
	oldStatus: string;
	newStatus: string | undefined;
}> {
	const { owner, repo, id, comment, force, new_owner: newOwner } = params;

	// Build the set of updates (exclude identification/control fields)
	const updates = buildUpdatesFromParams(params);

	// FEAT-007: validate the explicit owner-move target BEFORE any DB work so an
	// invalid owner (empty/dotfile/reserved OS segment) fails fast with a
	// caller-actionable VALIDATION_ERROR and never enters the transaction.
	if (newOwner !== undefined) {
		validateNewOwner(newOwner);
	}

	// Resolve task identifier to UUID: prefer id, fall back to code
	let resolvedId: string | undefined;
	if (id) {
		// FIX-021: reject reserved orchestrator placeholders (T01/R01/Q01/…) in
		// the `id` slot too — a placeholder there is an unsubstituted template
		// token, not an invalid UUID, so surface the actionable error.
		assertNotOrchestratorPlaceholder(id);
		if (UUID_REGEX.test(id)) {
			resolvedId = id;
		} else {
			// FIX-027: when the value looks like a task code, say so explicitly
			// (`use 'code' instead of 'id'`) instead of a bare invalid-UUID error.
			throw new Error(invalidIdFormatMessage(id));
		}
	}
	if (!resolvedId && params.code) {
		resolvedId = resolveEntityRef(storage, "task", params.code, owner, repo) ?? "";
	}

	if (!resolvedId) {
		throw new Error("Either 'id' (UUID) or 'code' must be provided for update");
	}

	const targetIds = [resolvedId];
	let updatedCount = 0;
	const updatedTasks: { id: string; code: string }[] = [];
	const completedTaskIds: string[] = [];
	let releasedClaims = 0;
	let expiredHandoffs = 0;
	let movedOwner = false;
	const now = new Date().toISOString();
	const isStatusChangingGlobal = updates.status !== undefined;

	const existingTasks = storage.tasks.getTasksByIds(targetIds);
	const taskMap = new Map(existingTasks.map((t) => [t.id, t]));

	// All task mutations for this update run in ONE transaction — a mid-loop
	// failure (validation, FK, etc.) rolls back the entire batch (no partial state).
	storage.db
		.transaction(() => {
			for (const targetId of targetIds) {
				const existingTask = taskMap.get(targetId);
				if (!existingTask) {
					throw new Error(`Task not found: ${targetId} (owner="${owner}", repo="${repo}")`);
				}

				const isStatusChanging = isStatusChangingGlobal && updates.status !== existingTask.status;

				// Status transition validation — ALWAYS run (TASK-061): a comment is
				// required on any status change and `force` no longer bypasses it.
				if (isStatusChanging) {
					const validationError = validateStatusTransition(
						existingTask.status,
						updates.status as TaskStatus,
						comment,
						force,
						updates.est_tokens as number | undefined,
						existingTask.task_code
					);
					if (validationError) {
						throw new Error(validationError);
					}

					// Children gate: cannot complete if children are incomplete
					if (updates.status === "completed") {
						const children = storage.tasks.getChildrenByParentId(targetId);
						const incompleteChildren = children.filter((c) => c.status !== "completed");
						if (incompleteChildren.length > 0) {
							const childList = incompleteChildren.map((c) => `[${c.task_code}] ${c.title} (${c.status})`).join("; ");
							throw new Error(
								`Cannot complete task [${existingTask.task_code}] "${existingTask.title}" — it has ${incompleteChildren.length} incomplete child task(s). Complete the following child task(s) first: ${childList}`
							);
						}
					}
				}

				// FEAT-007: explicit opt-in owner move. `owner` is the scope
				// selector for the CURRENT row; `new_owner` re-scopes the row.
				// A move is an IDENTITY change (owner is part of the identity key
				// `idx_tasks_code_owner_repo`), so it is routed here — never
				// through the generic update set. The collision check below uses
				// the TARGET owner so a move (with or without a rename) cannot
				// violate the UNIQUE identity key.
				const isMovingOwner = newOwner !== undefined && newOwner !== existingTask.owner;
				// Treat an empty-string task_code as "not provided" (it is stripped
				// at dispatch anyway) to preserve the pre-FEAT-007 truthy semantics.
				const renameRequested = typeof updates.task_code === "string" && updates.task_code.length > 0;
				const effectiveTaskCode = renameRequested ? (updates.task_code as string) : existingTask.task_code;
				const collisionScopeOwner = isMovingOwner ? (newOwner as string) : owner;

				// Check for duplicate task_code if renaming, or if moving the owner
				// (a move alone collides when the target identity is already taken).
				if (
					(renameRequested || isMovingOwner) &&
					storage.tasks.isTaskCodeDuplicate(collisionScopeOwner, repo, effectiveTaskCode, targetId)
				) {
					if (isMovingOwner) {
						// Actionable: name the existing task + the rename-and-move retry.
						const clash = storage.tasks.getTaskByCode(newOwner as string, repo, effectiveTaskCode);
						throw new Error(ownerMoveCollisionMessage(effectiveTaskCode, newOwner as string, repo, clash));
					}
					// FIX-027: name the EXISTING task (id + status) so the caller
					// can pick a free code or target the right task.
					const clash = storage.tasks.getTaskByCode(owner, repo, updates.task_code as string);
					const detail = clash ? ` (existing task id "${clash.id}", status "${clash.status}")` : "";
					throw new Error(
						`Duplicate task_code: '${updates.task_code}' already exists${detail}. Choose a different code or update the existing task directly.`
					);
				}

				const finalUpdates: Record<string, unknown> = { ...updates };

				// Apply the explicit owner move to the row (same transaction).
				if (isMovingOwner) {
					finalUpdates.owner = newOwner;
					movedOwner = true;
				}

				// Resolve parent_id if provided (UUID or code)
				if (updates.parent_id !== undefined) {
					finalUpdates.parent_id = resolveParentId(
						updates.parent_id as string | null | undefined,
						owner,
						repo,
						storage
					);
				}

				// Resolve depends_on if provided (UUID or code)
				if (updates.depends_on !== undefined) {
					finalUpdates.depends_on = resolveDependsOn(
						updates.depends_on as string | null | undefined,
						owner,
						repo,
						storage
					);
				}

				// Phase tag sync
				applyPhaseTagSync(updates, existingTask, finalUpdates);

				// decision_refs → metadata injection
				applyDecisionRefsToUpdates(params, existingTask, finalUpdates);

				// Status timestamp management
				applyStatusTimestamps(updates, existingTask, now, finalUpdates);

				storage.tasks.updateTask(targetId, finalUpdates);

				// Insert comment if status changed or comment provided
				insertStatusComment(storage, targetId, owner, repo, updates, existingTask, isStatusChanging, comment, now);

				// FEAT-007: re-scope every comment row for the moved task in the
				// SAME transaction (after the status comment insert, so a new
				// comment is included). A partial move would strand comments
				// under the old scope, making them invisible to owner-scoped
				// reads; the shared transaction guarantees row + comments agree.
				if (isMovingOwner) {
					storage.taskComments.updateTaskCommentsOwnerByTaskId(targetId, newOwner as string);
				}

				// Track completed tasks for later archival
				if (updates.status === "completed" && existingTask.status !== "completed") {
					completedTaskIds.push(targetId);
				}

				// Auto-release claims and expire handoffs on completion/cancellation
				const cleanup = handleCoordinationCleanup(
					storage,
					targetId,
					isStatusChanging,
					updates.status as TaskStatus | undefined
				);
				releasedClaims += cleanup.releasedClaims;
				expiredHandoffs += cleanup.expiredHandoffs;

				updatedTasks.push({
					id: targetId,
					code: (updates.task_code as string) || existingTask.task_code
				});
				updatedCount++;
			}
		})
		.immediate();

	// Best-effort vector embedding + KG extraction for updated tasks (if title/description changed)
	if ((params.title !== undefined || params.description !== undefined) && updatedCount > 0) {
		await enrichUpdatedTasks(updatedTasks, storage, vectors);
	}

	const existingTask = taskMap.get(targetIds[0])!;
	// FEAT-007: report `owner` as an updated field when an explicit move
	// happened. It is intentionally NOT in `updates` (the generic update set
	// never carries owner), so it is appended here only on an actual move —
	// an ordinary update still never reports owner.
	const updatedFields = deriveUpdatedFields(updates);
	if (movedOwner && !updatedFields.includes("owner")) {
		updatedFields.push("owner");
	}
	return {
		updatedCount,
		updatedTasks,
		completedTaskIds,
		releasedClaims,
		expiredHandoffs,
		updatedFields,
		taskTitle: (updates.title as string) || existingTask.title,
		oldStatus: existingTask.status,
		newStatus: updates.status as string | undefined
	};
}

export async function handleUpdate(
	params: TaskWriteParams,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const {
		updatedCount,
		updatedTasks,
		completedTaskIds,
		releasedClaims,
		expiredHandoffs,
		updatedFields,
		taskTitle,
		oldStatus,
		newStatus
	} = await coreUpdate(params, storage, vectors);

	const fieldsStr = updatedFields.length > 0 ? updatedFields.join(", ") : "none";
	let summaryText: string;
	if (updatedCount === 1 && updatedTasks.length === 1) {
		const extra = buildCompletionClause(params);
		const transition = oldStatus && newStatus && oldStatus !== newStatus ? ` ${oldStatus} → ${newStatus}` : "";
		summaryText = `Updated [${updatedTasks[0].code}] "${taskTitle}"${transition} in "${params.repo}" — ${fieldsStr}.${extra}`;
	} else {
		const tasksStr = updatedTasks.map((t) => `[${t.code}]`).join(", ");
		summaryText = `Updated ${updatedCount} tasks in "${params.repo}" — ${tasksStr}.`;
	}
	if (releasedClaims || expiredHandoffs) {
		summaryText += ` Auto-closed coordination: released ${releasedClaims} ${releasedClaims === 1 ? "claim" : "claims"}, expired ${expiredHandoffs} ${expiredHandoffs === 1 ? "handoff" : "handoffs"}.`;
	}

	const response = createMcpResponse(
		{
			success: true,
			id: params.id || undefined,
			repo: params.repo,
			status: params.status,
			updatedCount,
			updatedFields,
			coordinationCleanup: {
				releasedClaims,
				expiredHandoffs
			}
		},
		summaryText,
		{ includeJson: params.json }
	);

	// Archive completed tasks BEFORE the response resolves so task_archive
	// memory rows exist once the caller observes the write (deterministic —
	// no setImmediate race). Awaited under the (reentrant) write lock.
	await archiveCompletedTasks(completedTaskIds, params.repo, storage, vectors);

	return response;
}

// ---------------------------------------------------------------------------
// BULK UPDATE by IDs (array of UUIDs)
// ---------------------------------------------------------------------------

/**
 * Handles bulk update of tasks by array of UUID `ids`. All tasks receive the same updates.
 * Supports status transitions (with validation, timestamps, claims/handoffs cleanup, archival),
 * field updates, comments, coordination cleanup, and KG enrichment.
 */
export async function handleBulkUpdateByIds(
	params: TaskWriteParams,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const { owner, repo, ids, comment, force } = params;
	if (!ids || ids.length === 0) {
		throw new Error("No task IDs provided for bulk update");
	}

	// FEAT-007: the explicit owner move is single-task only. Re-scoping many
	// rows at once is an ambiguous identity change (each id may collide
	// differently under the target owner), so it is rejected here instead of
	// being silently dropped by buildUpdatesFromParams (which excludes
	// new_owner). Direct the caller to the single-update path.
	if (params.new_owner !== undefined) {
		throw new Error(
			"Invalid new_owner for bulk update: an owner move is single-task only. " +
				'Retry with task-write(id: "<uuid>" or code: "<CODE>", new_owner: "<owner>") for one task at a time.'
		);
	}

	// Build the set of updates (exclude identification/control fields)
	const updates = buildUpdatesFromParams(params);

	// Validate all IDs exist before mutating
	const existingTasks = storage.tasks.getTasksByIds(ids);
	const taskMap = new Map(existingTasks.map((t) => [t.id, t]));

	const notFound = ids.filter((id) => !taskMap.has(id));
	if (notFound.length > 0) {
		throw new Error(`Tasks not found: ${notFound.join(", ")}`);
	}

	const now = new Date().toISOString();
	const isStatusChangingGlobal = updates.status !== undefined;

	const updatedTasks: { id: string; code: string }[] = [];
	const completedTaskIds: string[] = [];
	let releasedClaims = 0;
	let expiredHandoffs = 0;

	// All task mutations for this bulk update run in ONE transaction — a
	// mid-loop failure rolls back the entire batch (no partial state).
	storage.db
		.transaction(() => {
			for (const targetId of ids) {
				const existingTask = taskMap.get(targetId)!;
				const isStatusChanging = isStatusChangingGlobal && updates.status !== existingTask.status;

				// Status transition validation — ALWAYS run (TASK-061): a comment is
				// required on any status change and `force` no longer bypasses it.
				if (isStatusChanging) {
					const validationError = validateStatusTransition(
						existingTask.status,
						updates.status as TaskStatus,
						comment,
						force,
						updates.est_tokens as number | undefined,
						existingTask.task_code
					);
					if (validationError) {
						throw new Error(validationError);
					}

					// Children gate: cannot complete if children are incomplete
					if (updates.status === "completed") {
						const children = storage.tasks.getChildrenByParentId(targetId);
						const incompleteChildren = children.filter((c) => c.status !== "completed");
						if (incompleteChildren.length > 0) {
							throw new Error(
								`Cannot complete task [${existingTask.task_code}] "${existingTask.title}" — it has ${incompleteChildren.length} incomplete child task(s)`
							);
						}
					}
				}

				const finalUpdates: Record<string, unknown> = { ...updates };

				// Phase tag sync
				applyPhaseTagSync(updates, existingTask, finalUpdates);

				// decision_refs → metadata injection
				applyDecisionRefsToUpdates(params, existingTask, finalUpdates);

				// Remove identification fields that should not be persisted
				delete finalUpdates.ids;
				delete finalUpdates.id;
				delete finalUpdates.code;
				delete finalUpdates.json;
				delete finalUpdates.owner;
				delete finalUpdates.repo;
				delete finalUpdates.interactive;
				delete finalUpdates.tasks;
				delete finalUpdates.comment;
				delete finalUpdates.force;

				// Status timestamp management
				applyStatusTimestamps(updates, existingTask, now, finalUpdates);

				storage.tasks.updateTask(targetId, finalUpdates);

				// Insert comment if status changed or comment provided
				insertStatusComment(storage, targetId, owner, repo, updates, existingTask, isStatusChanging, comment, now);

				// Track completed tasks for later archival
				if (updates.status === "completed" && existingTask.status !== "completed") {
					completedTaskIds.push(targetId);
				}

				// Auto-release claims and expire handoffs on completion/cancellation
				const cleanup = handleCoordinationCleanup(
					storage,
					targetId,
					isStatusChanging,
					updates.status as TaskStatus | undefined
				);
				releasedClaims += cleanup.releasedClaims;
				expiredHandoffs += cleanup.expiredHandoffs;

				updatedTasks.push({
					id: targetId,
					code: existingTask.task_code
				});
			}
		})
		.immediate();

	// Best-effort vector embedding + KG extraction for updated tasks (if title/description changed)
	if ((params.title !== undefined || params.description !== undefined) && updatedTasks.length > 0) {
		await enrichUpdatedTasks(updatedTasks, storage, vectors);
	}

	// Build response
	const updatedCount = updatedTasks.length;
	const persistedFields = deriveUpdatedFields(updates);
	const fieldsStr = persistedFields.length > 0 ? persistedFields.join(", ") : "none";
	let summaryText: string;
	if (updatedCount === 1 && updatedTasks.length === 1) {
		const extra = buildCompletionClause(params);
		summaryText = `Updated [${updatedTasks[0].code}] in repo "${params.repo}": fields ${fieldsStr}.${extra}`;
	} else {
		const tasksStr = updatedTasks.map((t) => `[${t.code}]`).join(", ");
		summaryText = `Updated ${updatedCount} tasks in repo "${params.repo}": ${tasksStr}.`;
	}
	if (releasedClaims || expiredHandoffs) {
		summaryText += ` Auto-closed coordination: released ${releasedClaims} ${releasedClaims === 1 ? "claim" : "claims"}, expired ${expiredHandoffs} ${expiredHandoffs === 1 ? "handoff" : "handoffs"}.`;
	}

	const response = createMcpResponse(
		{
			success: true,
			repo: params.repo,
			status: params.status,
			updatedCount,
			updatedFields: persistedFields,
			coordinationCleanup: {
				releasedClaims,
				expiredHandoffs
			}
		},
		summaryText,
		{ includeJson: params.json }
	);

	// Archive completed tasks BEFORE the response resolves so task_archive
	// memory rows exist once the caller observes the write (deterministic —
	// no setImmediate race). Awaited under the (reentrant) write lock.
	await archiveCompletedTasks(completedTaskIds, params.repo, storage, vectors);

	return response;
}
