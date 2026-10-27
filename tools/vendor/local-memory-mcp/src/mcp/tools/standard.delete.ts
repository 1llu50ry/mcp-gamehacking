import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { createMcpErrorResponse } from "../utils/mcp-error";
import { collectEntityIds } from "../utils/auto-infer";
import { purgeEntityAndCleanup } from "../utils/purge-entity-cleanup";
import { logger } from "../utils/logger";
import { StandardDeleteSchema } from "./schemas/index";

export async function handleStandardDelete(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = StandardDeleteSchema.parse(params);
	const { id, ids, owner, repo, json } = validated;

	// Resolve all identifiers (id/code/ids/codes — UUID or code, auto-inferred
	// per item) to UUIDs via the shared helper (OPT-DRY-06). Replaces the
	// hand-rolled resolveIdentifier closure and its `?? ""` sentinel.
	const resolvedIds = collectEntityIds(validated, "standard", db, { owner, repo });

	// Fetch standards to verify existence and collect metadata for response
	const existingStandards = db.standards.getByIds(resolvedIds);
	const standardMap = new Map(existingStandards.map((s) => [s.id, s]));
	const deletedTitles: string[] = [];
	const deletedCodes: string[] = [];
	const validIdsToDelete: string[] = [];

	// Code-resolution failures already throw from collectEntityIds (TASK-123);
	// this existence check covers raw-UUID targets that resolve but no longer
	// exist. Unified not-found policy (OPT-CODE-04): single → throw, bulk →
	// skip + report (documented bulk-partial-execution convention).
	const isBulk = resolvedIds.length > 1;

	let lastRepo = repo || "unknown";
	const skippedErrors: { identifier: string; error: string }[] = [];

	for (const targetId of resolvedIds) {
		const existing = standardMap.get(targetId);
		if (existing) {
			lastRepo = existing.repo || (existing.is_global ? "global" : lastRepo);
			deletedTitles.push(existing.title);
			if (existing.code) deletedCodes.push(existing.code);
			validIdsToDelete.push(targetId);
		} else if (isBulk) {
			// Bulk partial execution — skip and report instead of throw
			logger.warn("[Tool] standard.delete — skipping not found", { targetId });
			skippedErrors.push({ identifier: targetId, error: `Coding standard not found: ${targetId}` });
		} else {
			// Single target not found — fail loud (OPT-CODE-04)
			throw new Error(`Coding standard not found: ${targetId}`);
		}
	}

	let deletedCount = 0;

	if (validIdsToDelete.length > 0) {
		// Shared purge + cleanup contract (OPT-DRY-03): hard delete + queue_jobs
		// purge + vector removal + repo-scoped KG cleanup, identical to the
		// memory/task delete tools.
		await purgeEntityAndCleanup(
			db,
			"standard",
			validIdsToDelete.map((id) => {
				const standard = standardMap.get(id);
				return standard ? { id, title: standard.title, repo: standard.repo ?? "" } : { id };
			})
		);
		deletedCount = validIdsToDelete.length;
	}

	const skippedCount = skippedErrors.length;
	// success is false only when nothing was deleted and there were errors
	const overallSuccess = deletedCount > 0 || skippedCount === 0;

	logger.info("[Tool] standard.delete", {
		repo: lastRepo,
		count: deletedCount,
		...(skippedCount > 0 ? { errors: skippedCount } : {})
	});

	const codeSample =
		deletedCodes.length <= 3
			? deletedCodes.join(", ")
			: `${deletedCodes.slice(0, 3).join(", ")}, ... (${deletedCodes.length} total)`;

	const responseData: Record<string, unknown> = {
		success: overallSuccess,
		id: id || undefined,
		ids: ids || undefined,
		repo: lastRepo,
		deletedCount,
		deletedCodes: deletedCodes.length > 10 ? [...deletedCodes.slice(0, 10), "..."] : deletedCodes,
		deletedTitles: deletedTitles.length > 10 ? [...deletedTitles.slice(0, 10), "..."] : deletedTitles
	};

	if (skippedErrors.length > 0) {
		responseData.errors = skippedErrors;
		responseData.skippedCount = skippedErrors.length;
		responseData.totalAttempted = resolvedIds.length;
	}

	const summary = `Deleted ${deletedCount} ${deletedCount === 1 ? "standard" : "standards"} from "${lastRepo}"${deletedCodes.length > 0 ? `: ${codeSample}` : ""}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}.`;
	if (skippedCount > 0) {
		return createMcpErrorResponse({
			code: deletedCount > 0 ? "PARTIAL_FAILURE" : "BULK_OPERATION_FAILED",
			message: summary,
			retryable: false,
			data: responseData
		});
	}
	return createMcpResponse(responseData, summary, { includeJson: json });
}
