import { SQLiteStore } from "../storage/sqlite";
import { createMcpResponse } from "../utils/mcp-response";
import { createMcpErrorResponse } from "../utils/mcp-error";
import { collectEntityIds } from "../utils/auto-infer";
import { purgeEntityAndCleanup } from "../utils/purge-entity-cleanup";
import { logger } from "../utils/logger";
import { TaskDeleteSchema } from "./schemas/index";

export async function handleTaskDelete(args: unknown, storage: SQLiteStore) {
	const validated = TaskDeleteSchema.parse(args);
	const { owner, repo, id, code, task_code, ids, codes, task_codes } = validated;

	// Resolve all identifiers (id/code/task_code/ids/codes/task_codes — UUID or
	// code, auto-inferred per item) to UUIDs via the shared helper (OPT-DRY-06).
	// Unresolvable non-empty identifiers still throw from resolveEntityRef —
	// the TASK-123 fail-loud behavior (no `?? ""` sentinel, no phantom success).
	const resolvedIds = collectEntityIds(validated, "task", storage, { owner, repo });

	if (resolvedIds.length === 0) {
		throw new Error(
			"At least one of 'id', 'code', 'task_code', 'ids', 'codes', or 'task_codes' must be provided for deletion"
		);
	}

	// Fetch tasks to verify existence and collect codes for response. Code
	// resolution failures already throw from collectEntityIds (TASK-123); this
	// existence check covers raw-UUID targets that resolve but no longer exist.
	// Unified not-found policy (OPT-CODE-04): single → throw, bulk → skip +
	// report (documented bulk-partial-execution convention).
	const tasksToDelete = storage.tasks.getTasksByIds(resolvedIds);
	const taskMap = new Map(tasksToDelete.map((t) => [t.id, t]));
	const deletedCodes: string[] = [];
	const validIdsToDelete: string[] = [];
	const skippedErrors: { identifier: string; error: string }[] = [];

	const isBulk = resolvedIds.length > 1;

	for (const targetId of resolvedIds) {
		const existing = taskMap.get(targetId);
		if (existing) {
			deletedCodes.push(existing.task_code);
			validIdsToDelete.push(targetId);
		} else if (isBulk) {
			// Bulk partial execution — warn and skip instead of throw
			logger.warn("[Tool] task.delete — skipping not found", { targetId });
			skippedErrors.push({
				identifier: targetId,
				error: `Task not found: ${targetId} (owner="${owner}", repo="${repo}")`
			});
		} else {
			// Single target not found — fail loud (OPT-CODE-04)
			throw new Error(`Task not found: ${targetId} (owner="${owner}", repo="${repo}")`);
		}
	}

	// Shared purge + cleanup contract (OPT-DRY-03): soft cancel + child detach +
	// vector removal + claim release + handoff expiry + queue_jobs purge +
	// repo-scoped KG cleanup — identical to the memory/standard delete tools.
	// All DB mutations run in ONE transaction; KG cleanup stays best-effort.
	// Only resolved-and-existing targets are purged; phantom ids never reach it.
	if (validIdsToDelete.length > 0) {
		purgeEntityAndCleanup(
			storage,
			"task",
			validIdsToDelete.map((id) => {
				const task = taskMap.get(id);
				return task ? { id, title: task.title, repo } : { id };
			})
		);
	}

	const deletedCount = validIdsToDelete.length;
	const skippedCount = skippedErrors.length;
	// success is false only when nothing was deleted and there were errors
	const overallSuccess = deletedCount > 0 || skippedCount === 0;

	logger.info("[Tool] task.delete", { repo, count: deletedCount });

	const codeSample =
		deletedCodes.length <= 5
			? deletedCodes.join(", ")
			: `${deletedCodes.slice(0, 3).join(", ")}, ... (${deletedCodes.length} total)`;

	const data = {
		success: overallSuccess,
		id: id || undefined,
		code: code || undefined,
		ids: ids || undefined,
		codes: codes || undefined,
		task_code: task_code || undefined,
		task_codes: task_codes || undefined,
		repo,
		canceledCount: deletedCount,
		canceledCodes: deletedCodes,
		...(skippedCount > 0 ? { skippedCount, errors: skippedErrors, totalAttempted: resolvedIds.length } : {})
	};
	const summary = `Deleted ${deletedCount} ${deletedCount === 1 ? "task" : "tasks"} from "${repo}"${deletedCodes.length > 0 ? `: ${codeSample}` : ""}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}.`;
	if (skippedCount > 0) {
		return createMcpErrorResponse({
			code: deletedCount > 0 ? "PARTIAL_FAILURE" : "BULK_OPERATION_FAILED",
			message: summary,
			retryable: false,
			data
		});
	}
	return createMcpResponse(data, summary, { includeJson: validated.json });
}
