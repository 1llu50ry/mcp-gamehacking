/**
 * standard-write/bulk — bulk standard creation with partial execution.
 */

import { randomUUID } from "crypto";
import { CodingStandardEntry, VectorStore } from "../../types";
import { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import { enqueueStandard } from "../../embedding-queue";
import { StandardWriteParams, BulkResult, resolveStandardParentId, toContextSlug, generateNextCode } from "./shared";

// ── Bulk handler ─────────────────────────────────────────────────────────

export async function handleBulk(
	params: StandardWriteParams,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const items = params.standards ?? [];
	const results: BulkResult[] = [];
	const batchCodes = new Set<string>();
	const standardRepo = params.repo || "__global__";

	for (let i = 0; i < items.length; i++) {
		const raw = items[i] as Record<string, unknown>;

		const std = {
			...raw,
			owner: (raw.owner as string) ?? params.owner,
			repo: (raw.repo as string) ?? params.repo,
			json: params.json
		} as unknown as StandardWriteParams;

		try {
			const incomingVersion = (std.version as string) || "1.0.0";
			const incomingLanguage = (std.language as string) ?? null;
			const incomingStack = (std.stack as string[]) ?? [];

			const conflict = db.standards.checkConflicts(
				std.content!,
				incomingVersion,
				params.owner!,
				params.repo,
				incomingLanguage,
				incomingStack,
				0.82
			);

			if (conflict) {
				results.push({
					index: i,
					operation: "create",
					success: false,
					error: `Conflicts with standard "${conflict.title}" (v${conflict.version}, similarity: ${(conflict.similarity * 100).toFixed(1)}%)`
				});
				continue;
			}

			const now = new Date().toISOString();
			const code = generateNextCode(params.owner!, standardRepo, "standard", db, batchCodes);
			batchCodes.add(code);

			const entry: CodingStandardEntry = {
				id: randomUUID(),
				code,
				title: std.name!,
				content: std.content!,
				parent_id: resolveStandardParentId(std.parent_id as string | undefined, db, params.owner, params.repo),
				context: toContextSlug((std.context as string) || "general"),
				version: (std.version as string) || "1.0.0",
				language: (std.language as string) || null,
				stack: (std.stack as string[]) || [],
				is_global: (std.is_global as boolean) === true,
				owner: params.owner!,
				repo: params.repo || null,
				tags: (std.tags as string[]) || [],
				metadata: (std.metadata as Record<string, unknown>) || {},
				created_at: now,
				updated_at: now,
				hit_count: 0,
				last_used_at: null,
				agent: (std.agent as string) || "unknown",
				model: (std.model as string) || "unknown"
			};

			// Insert + enqueue embedding/KG atomically; enrichment deferred to
			// the outbox worker (TASK-013).
			db.db
				.transaction(() => {
					db.standards.insert(entry);
					enqueueStandard(db, entry);
				})
				.immediate();

			results.push({ index: i, operation: "create", success: true, id: entry.id, code, title: std.name });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			results.push({ index: i, operation: "create", success: false, error: msg });
		}
	}

	const succeeded = results.filter((r) => r.success);
	const failed = results.filter((r) => !r.success);
	const allOk = failed.length === 0;

	const data = {
		success: allOk,
		total: items.length,
		processed: succeeded.length,
		...(failed.length > 0 ? { errors: failed.map((r) => ({ index: r.index, error: r.error })) } : {}),
		results: results.map((r) => ({
			index: r.index,
			operation: r.operation,
			success: r.success,
			...(r.id ? { id: r.id } : {}),
			...(r.code ? { code: r.code } : {}),
			...(r.title ? { title: r.title } : {}),
			...(r.error ? { error: r.error } : {})
		}))
	};
	const summary = `Processed ${succeeded.length}/${items.length} items${failed.length > 0 ? ` (${failed.length} failed)` : ""}.`;
	if (!allOk) {
		return createMcpErrorResponse({
			code: succeeded.length > 0 ? "PARTIAL_FAILURE" : "BULK_OPERATION_FAILED",
			message: summary,
			retryable: false,
			data
		});
	}
	return createMcpResponse(data, summary, { includeJson: params.json });
}
