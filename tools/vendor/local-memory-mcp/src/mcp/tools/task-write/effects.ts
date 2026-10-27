import { VectorStore } from "../../types";
import { logger } from "../../utils/logger";

// ---------------------------------------------------------------------------
// Side effects and helpers for task write operations
// ---------------------------------------------------------------------------

/**
 * Merges decision_refs into metadata if provided.
 */
export function applyDecisionRefs(
	decisionRefs: string[] | undefined,
	existingMetadata: Record<string, unknown> | undefined
): Record<string, unknown> {
	const meta = { ...(existingMetadata ?? {}) };
	if (decisionRefs !== undefined && decisionRefs.length > 0) {
		meta.decision_refs = decisionRefs;
	}
	return meta;
}

/**
 * Best-effort vector embedding for a task.
 */
export async function tryVectorEmbedding(
	taskId: string,
	title: string,
	description: string | null,
	vectors: VectorStore
) {
	try {
		await vectors.upsert(taskId, `${title}\n${description ?? ""}`, "task");
	} catch (error) {
		logger.warn("Failed to generate vector embedding for task", { taskId, error: String(error) });
	}
}
