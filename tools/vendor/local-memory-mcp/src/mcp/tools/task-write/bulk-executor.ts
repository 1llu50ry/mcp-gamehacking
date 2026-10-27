import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { Task, TaskStatus, TaskPriority, VectorStore, TASK_STATUS_BACKLOG } from "../../types";
import { UUID_REGEX } from "../../utils/uuid";
import { resolveEntityRef } from "../../utils/entity-ref";
import { resolveEntityCode } from "../../utils/code-generator";
import { enqueueTask } from "../../embedding-queue";
import { resolveParentId, resolveDependsOn, deriveTaskStatusTimestamps } from "../task.helpers";
import { applyDecisionRefs } from "./effects";
import { validateStatusTransition, validateBulkStatus, resolveTransitionComment } from "./state-machine";
import { archiveCompletedTasks } from "./update-status";
import { inferItemMode, describeBulkItem } from "./bulk-infer";
import {
	duplicateCodeMessage,
	missingCreateFields,
	missingCreateFieldsMessage,
	noUpdatableFieldsMessage,
	scopeBulkItemError
} from "./errors";

// ---------------------------------------------------------------------------
// Bulk execution — processes each item (create or update)
// ---------------------------------------------------------------------------

/**
 * Processes all bulk items, returning results, counts, and error info.
 * Does NOT build the MCP response — that is the orchestrator's job.
 */
export async function executeBulkOperation(
	items: Record<string, unknown>[],
	owner: string,
	repo: string,
	storage: SQLiteStore,
	vectors: VectorStore
): Promise<{
	results: Record<string, unknown>[];
	allOk: boolean;
}> {
	const results: Record<string, unknown>[] = [];

	const initialStats = storage.taskStats.getTaskStats(owner, repo);
	let pendingInRequestCount = 0;
	const codesInRequest = new Set<string>();
	const batchCodes = new Set<string>();

	// Pre-generate UUIDs and build local code→UUID map for cross-reference resolution
	const localCodeMap = new Map<string, string>();
	for (const taskData of items) {
		const tc = (taskData.code as string) || (taskData.id as string) || "";
		if (tc) localCodeMap.set(tc, randomUUID());
		if (!tc) localCodeMap.set("__create_" + Math.random().toString(36).slice(2, 8), randomUUID());
	}

	// Completed task ids collected during the per-item loop, grouped by repo.
	// TASK-044: instead of archiving each completed item inline (one memory per
	// task), collect them here and archive ONCE per repo after the loop so a
	// bulk `tasks[]` completion that finishes N tasks in the same repo coalesces
	// into ONE aggregated task_archive memory (archiveTasksToMemory), matching
	// the `ids[]` bulk path (handleBulkUpdateByIds). A single completion keeps
	// the exact per-task archive shape.
	const completedByRepo = new Map<string, string[]>();

	for (let i = 0; i < items.length; i++) {
		const raw = items[i];
		const mode = inferItemMode(raw);

		try {
			if (mode === "update") {
				// ── Update item ──
				const itemCode = raw.code as string | undefined;
				const itemId = raw.id as string | undefined;

				// Resolve to UUID
				let resolvedId: string | undefined;
				if (itemId && UUID_REGEX.test(itemId)) {
					resolvedId = itemId;
				} else if (itemCode) {
					resolvedId = resolveEntityRef(storage, "task", itemCode, owner, repo) ?? "";
				} else if (itemId) {
					resolvedId = resolveEntityRef(storage, "task", itemId, owner, repo) ?? "";
				}

				if (!resolvedId) throw new Error("Cannot update: neither 'id' nor 'code' resolved to an existing task");

				const existing = storage.tasks.getTaskById(resolvedId);
				if (!existing) throw new Error(`Task not found: ${resolvedId} (owner="${owner}", repo="${repo}")`);

				// Build updates
				const updatableFields = [
					"phase",
					"title",
					"description",
					"status",
					"priority",
					"agent",
					"role",
					"tags",
					"metadata",
					"parent_id",
					"depends_on",
					"est_tokens",
					"commit_id",
					"changed_files",
					"decision_refs"
				] as const;

				const itemUpdates: Record<string, unknown> = {};
				for (const field of updatableFields) {
					if (raw[field] !== undefined) {
						itemUpdates[field] = raw[field];
					}
				}

				if (Object.keys(itemUpdates).length === 0) {
					// FIX-027: name the fields an update item MAY carry so the
					// caller can see what the inferred-update item was missing.
					throw new Error(noUpdatableFieldsMessage(updatableFields));
				}

				// FIX-024: resolve + pre-validate parent_id/depends_on references
				// (UUID or code) before the DB transaction. Without this a
				// non-existent reference reached SQLite as a raw FOREIGN KEY
				// error; a valid CODE reference was also never resolved, so it
				// failed the FK too. resolveParentId/resolveDependsOn throw a
				// caller-actionable VALIDATION_ERROR naming the missing task.
				if (itemUpdates.parent_id !== undefined) {
					itemUpdates.parent_id = resolveParentId(
						itemUpdates.parent_id as string | null | undefined,
						owner,
						repo,
						storage,
						localCodeMap
					);
				}
				if (itemUpdates.depends_on !== undefined) {
					itemUpdates.depends_on = resolveDependsOn(
						itemUpdates.depends_on as string | null | undefined,
						owner,
						repo,
						storage,
						localCodeMap
					);
				}

				// Handle status transition
				if (itemUpdates.status !== undefined && itemUpdates.status !== existing.status) {
					const err = validateStatusTransition(
						existing.status,
						itemUpdates.status as TaskStatus,
						raw.comment as string | undefined,
						raw.force as boolean | undefined,
						itemUpdates.est_tokens as number | undefined,
						existing.task_code
					);
					if (err) throw new Error(err);

					// Children gate for completed
					if (itemUpdates.status === "completed") {
						const children = storage.tasks.getChildrenByParentId(resolvedId);
						const incomplete = children.filter((c) => c.status !== "completed");
						if (incomplete.length > 0) {
							throw new Error(
								`Cannot complete task [${existing.task_code}] — ${incomplete.length} incomplete child task(s)`
							);
						}
					}
				}

				// Phase tag sync
				if (itemUpdates.phase !== undefined || itemUpdates.tags !== undefined) {
					let currentTags = (itemUpdates.tags as string[]) || (existing.tags as string[]) || [];
					currentTags = currentTags.filter((t: string) => !t.startsWith("phase:"));
					const finalPhase = itemUpdates.phase !== undefined ? (itemUpdates.phase as string) : existing.phase;
					if (finalPhase) {
						const phaseTag = `phase:${finalPhase}`;
						if (!currentTags.includes(phaseTag)) currentTags.push(phaseTag);
					}
					itemUpdates.tags = currentTags;
				}

				// decision_refs
				if (raw.decision_refs !== undefined) {
					const meta = { ...(existing.metadata ?? {}) };
					meta.decision_refs = raw.decision_refs;
					itemUpdates.metadata = meta;
					// decision_refs is not a task column — it is folded into
					// metadata above, so drop it from the reported
					// updatedFields (issue #108: report only written columns).
					delete itemUpdates.decision_refs;
				}

				const now = new Date().toISOString();
				if (itemUpdates.status === "completed") {
					itemUpdates.finished_at = now;
				} else if (itemUpdates.status === "canceled") {
					itemUpdates.canceled_at = now;
				} else if (itemUpdates.status === "in_progress" && existing.status !== "in_progress") {
					itemUpdates.in_progress_at = now;
				}

				// ── Synchronous DB mutations, atomic (single transaction) ──
				// updateTask + comment + claims/handoffs cleanup either all commit
				// or all roll back — no partial state on mid-way failure.
				storage.db
					.transaction(() => {
						storage.tasks.updateTask(resolvedId, itemUpdates);

						// Comment insertion (FIX-022: a status change with no
						// caller comment records a deterministic auto-comment
						// instead of bouncing; explicit comments are verbatim).
						if (itemUpdates.status !== undefined && itemUpdates.status !== existing.status) {
							const commentAgent = (raw.agent as string) || existing.agent || "unknown";
							storage.taskComments.insertTaskComment({
								id: randomUUID(),
								task_id: resolvedId,
								owner,
								repo,
								comment: resolveTransitionComment(
									raw.comment as string | undefined,
									existing.status,
									itemUpdates.status as TaskStatus,
									commentAgent,
									now
								),
								agent: commentAgent,
								role: (raw.role as string) || existing.role || "unknown",
								model: (raw.model as string) || "unknown",
								previous_status: existing.status as TaskStatus,
								next_status: itemUpdates.status as TaskStatus,
								created_at: now
							});
						}

						// Claims/handoffs cleanup
						if (itemUpdates.status === "completed" || itemUpdates.status === "canceled") {
							storage.handoffs.releaseClaimsForTask(resolvedId);
							storage.handoffs.updatePendingHandoffsForTask(resolvedId, "expired");
						}
					})
					.immediate();

				// Best-effort embedding/KG — enqueue to the outbox worker if
				// title/description changed (TASK-013). Synchronous LWW upsert.
				if (itemUpdates.title !== undefined || itemUpdates.description !== undefined) {
					const updatedTask = storage.tasks.getTaskById(resolvedId);
					if (updatedTask) {
						enqueueTask(storage, updatedTask);
					}
				}

				// Archive for completed — collected here and flushed ONCE per
				// repo after the loop (TASK-044). Deferring lets a bulk batch
				// that completes N tasks in one repo coalesce into ONE
				// aggregated task_archive memory (via archiveCompletedTasks →
				// archiveTasksToMemory) instead of N per-task rows. The flush
				// runs under the exclusive file lock (withExclusiveWrite,
				// OPT-PERF-09) before the response resolves, so the archive
				// rows exist the moment the caller observes the write.
				// Best-effort: a batch archival failure is logged and does not
				// fail the item or the batch.
				if (itemUpdates.status === "completed" && existing.status !== "completed") {
					const taskRepo = existing.repo || repo;
					const bucket = completedByRepo.get(taskRepo);
					if (bucket) {
						bucket.push(resolvedId);
					} else {
						completedByRepo.set(taskRepo, [resolvedId]);
					}
				}
				results.push({
					index: i,
					operation: "update",
					success: true,
					id: resolvedId,
					code: existing.task_code,
					updatedFields: Object.keys(itemUpdates)
				});
			} else {
				// ── Create item ──
				const preferredCode = (raw.code as string) || "";
				if (preferredCode && codesInRequest.has(preferredCode)) {
					throw new Error(`Duplicate task_code in request: '${preferredCode}'`);
				}

				const assignedCode = resolveEntityCode(preferredCode || null, owner ?? "", repo, "task", storage, {
					batchCodes
				});

				if (preferredCode && assignedCode !== preferredCode) {
					// FIX-027: name the EXISTING task (id + status) so the caller
					// can switch to an update instead of retrying the create.
					throw new Error(duplicateCodeMessage(preferredCode, storage.tasks.getTaskByCode(owner, repo, preferredCode)));
				}

				codesInRequest.add(assignedCode);
				batchCodes.add(assignedCode);

				const phase = raw.phase as string;
				const title = raw.title as string;
				const description = raw.description as string;

				if (!phase || !title || !description) {
					// FIX-027: list EXACTLY which of phase/title/description are absent.
					throw new Error(missingCreateFieldsMessage(missingCreateFields(raw), "bulk"));
				}

				let normalizedStatus = (raw.status as TaskStatus) || "backlog";
				const statusErr = validateBulkStatus(raw.status as string | undefined);
				if (statusErr) throw new Error(statusErr);

				if (normalizedStatus === "pending") {
					if (initialStats.todo + pendingInRequestCount > 10) {
						normalizedStatus = TASK_STATUS_BACKLOG;
					}
				}

				const now = new Date().toISOString();
				const statusTimestamps = deriveTaskStatusTimestamps(normalizedStatus, now);
				const tags = [...((raw.tags as string[]) || [])];
				const phaseTag = `phase:${phase}`;
				if (!tags.includes(phaseTag)) {
					tags.push(phaseTag);
				}

				const taskId = localCodeMap.get(assignedCode) ?? randomUUID();
				localCodeMap.set(assignedCode, taskId);

				const finalMetadata = applyDecisionRefs(
					raw.decision_refs as string[] | undefined,
					raw.metadata as Record<string, unknown> | undefined
				);

				const task: Task = {
					id: taskId,
					owner,
					repo,
					task_code: assignedCode,
					phase,
					title,
					description,
					status: normalizedStatus,
					priority: (raw.priority as TaskPriority) || 3,
					agent: (raw.agent as string) || "unknown",
					role: (raw.role as string) || "unknown",
					doc_path: (raw.doc_path as string) || null,
					created_at: now,
					updated_at: now,
					in_progress_at: statusTimestamps.in_progress_at,
					finished_at: statusTimestamps.finished_at,
					canceled_at: statusTimestamps.canceled_at,
					est_tokens: (raw.est_tokens as number) ?? 0,
					tags,
					suggested_skills: (raw.suggested_skills as string[]) || [],
					commit_id: null,
					changed_files: [],
					metadata: finalMetadata,
					parent_id: resolveParentId(raw.parent_id as string | null | undefined, owner, repo, storage, localCodeMap),
					depends_on: resolveDependsOn(raw.depends_on as string | null | undefined, owner, repo, storage, localCodeMap)
				};

				// Insert + enqueue embedding/KG atomically; enrichment (ONNX +
				// compromise KG) runs via the outbox worker (TASK-013).
				storage.db
					.transaction(() => {
						storage.tasks.insertTask(task);
						enqueueTask(storage, task);
					})
					.immediate();

				results.push({
					index: i,
					operation: "create",
					success: true,
					id: task.id,
					code: assignedCode,
					title,
					repo
				});

				if (normalizedStatus === "pending") {
					pendingInRequestCount++;
				}
			}
		} catch (err) {
			const raw = err instanceof Error ? err.message : String(err);
			// FIX-027: every rejection names the failing item (index + code).
			// The orchestrator already carries `index` in the structured
			// envelope, but the all-items-failed path throws `failed[0].error`
			// bare — scoping here keeps the item identity on that path too.
			const msg = scopeBulkItemError(raw, describeBulkItem(items[i], i));
			results.push({
				index: i,
				operation: mode,
				success: false,
				error: msg
			});
		}
	}

	// Flush collected completions ONCE per repo (TASK-044). A repo with N
	// completed tasks produces ONE aggregated task_archive memory; a repo with
	// a single completion keeps the exact per-task archive shape. Best-effort:
	// archiveCompletedTasks logs and swallows failures so the batch result is
	// unaffected.
	for (const [taskRepo, ids] of completedByRepo) {
		await archiveCompletedTasks(ids, taskRepo, storage, vectors);
	}

	const failed = results.filter((r) => !r.success);
	const allOk = failed.length === 0;

	return { results, allOk };
}
