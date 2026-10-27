import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { createMcpErrorResponse } from "../utils/mcp-error";
import { collectEntityIds } from "../utils/auto-infer";
import { purgeEntityAndCleanup } from "../utils/purge-entity-cleanup";
import { logger } from "../utils/logger";
import { MemoryDeleteSchema } from "./schemas/index";

export async function handleMemoryDelete(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore,
	onProgress?: (progress: number, total?: number) => void
): Promise<McpResponse> {
	const validated = MemoryDeleteSchema.parse(params);
	const { id, ids, owner, repo, json } = validated;

	// Resolve all identifiers (id/code/ids/codes — UUID or code, auto-inferred
	// per item) to UUIDs via the shared helper (OPT-DRY-06). Replaces the
	// hand-rolled resolveIdentifier closure and its `?? ""` sentinel.
	const resolvedIds = collectEntityIds(validated, "memory", db, { owner, repo });

	if (resolvedIds.length === 0) {
		throw new Error("At least one of 'id', 'code', 'ids', or 'codes' must be provided for deletion");
	}

	// Fetch memories to verify existence and collect metadata for response
	const existingMemories = db.memories.getByIds(resolvedIds);
	const memoryMap = new Map(existingMemories.map((m) => [m.id, m]));
	const deletedCodes: string[] = [];
	const validIdsToDelete: string[] = [];
	const skippedErrors: { identifier: string; error: string }[] = [];

	// Code-resolution failures already throw from collectEntityIds (TASK-123);
	// this existence check covers raw-UUID targets that resolve but no longer
	// exist. Unified not-found policy (OPT-CODE-04): single → throw, bulk →
	// skip + report (documented bulk-partial-execution convention).
	const isBulk = resolvedIds.length > 1;

	let lastRepo = repo || "unknown";

	for (const targetId of resolvedIds) {
		const existing = memoryMap.get(targetId);
		if (existing) {
			lastRepo = existing.scope.repo;
			deletedCodes.push(existing.code || existing.id);
			validIdsToDelete.push(targetId);
		} else if (isBulk) {
			const msg = `Memory not found: ${targetId}`;
			// Bulk partial execution — warn and skip instead of throw
			logger.warn("[Tool] memory.delete — skipping not found", { targetId });
			skippedErrors.push({ identifier: targetId, error: msg });
		} else {
			// Single target not found — fail loud (OPT-CODE-04)
			throw new Error(`Memory not found: ${targetId}`);
		}
	}

	let deletedCount = 0;

	if (validIdsToDelete.length > 0) {
		// Shared purge + cleanup contract (OPT-DRY-03): archive + queue_jobs
		// purge + vector removal + repo-scoped KG cleanup, identical to the
		// standard/task delete tools. Progress is reported per item.
		await purgeEntityAndCleanup(
			db,
			"memory",
			validIdsToDelete.map((id) => {
				const memory = memoryMap.get(id);
				return memory ? { id, title: memory.title, repo: memory.scope.repo } : { id };
			}),
			{ onProgress }
		);
		deletedCount = validIdsToDelete.length;
	}

	logger.info("[Tool] memory.delete", { repo: lastRepo, count: deletedCount });

	const skippedCount = skippedErrors.length;
	// success is false only when nothing was deleted and there were errors
	const overallSuccess = deletedCount > 0 || skippedCount === 0;

	const codeSample =
		deletedCodes.length <= 5
			? deletedCodes.join(", ")
			: `${deletedCodes.slice(0, 3).join(", ")}, ... (${deletedCodes.length} total)`;

	const data = {
		success: overallSuccess,
		id: id || undefined,
		ids: ids || undefined,
		repo: lastRepo,
		deletedCount,
		deletedCodes: deletedCount > 10 ? [...deletedCodes.slice(0, 10), "..."] : deletedCodes,
		...(skippedCount > 0 ? { skippedCount, errors: skippedErrors, totalAttempted: resolvedIds.length } : {})
	};
	const summary = `Deleted ${deletedCount} ${deletedCount === 1 ? "memory" : "memories"} from "${lastRepo}"${deletedCount > 0 ? `: ${codeSample}` : ""}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}.`;
	if (skippedCount > 0) {
		return createMcpErrorResponse({
			code: deletedCount > 0 ? "PARTIAL_FAILURE" : "BULK_OPERATION_FAILED",
			message: summary,
			retryable: false,
			data
		});
	}
	return createMcpResponse(data, summary, {
		structuredContentPathHint: "deletedCount",
		includeJson: json
	});
}
