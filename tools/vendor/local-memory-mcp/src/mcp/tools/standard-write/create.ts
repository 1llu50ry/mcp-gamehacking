/**
 * standard-write/create — single standard creation with conflict detection.
 */

import { randomUUID } from "crypto";
import { CodingStandardEntry, VectorStore } from "../../types";
import { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import { enqueueStandard } from "../../embedding-queue";
import { StandardWriteParams, resolveStandardParentId, toContextSlug, generateNextCode } from "./shared";

// ── Core create logic — returns plain data, does NOT wrap in McpResponse ──

export async function coreCreate(
	params: StandardWriteParams,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<{ id: string; code: string; title: string; repo: string }> {
	if (!params.name || !params.content || !params.tags || !params.metadata) {
		throw new Error("CREATE requires: name, content, tags, metadata");
	}

	const incomingVersion = params.version || "1.0.0";
	const incomingLanguage = params.language ?? null;
	const incomingStack = params.stack ?? [];

	const conflict = db.standards.checkConflicts(
		params.content,
		incomingVersion,
		params.owner!,
		params.repo,
		incomingLanguage,
		incomingStack,
		0.82
	);

	if (conflict) {
		const err = new Error("STANDARD_CONFLICT") as Error & {
			structured: {
				success: false;
				error: string;
				message: string;
				conflicting_standard: Record<string, unknown>;
				instruction: string;
			};
		};
		err.structured = {
			success: false,
			error: "STANDARD_CONFLICT",
			message: `This standard's content is highly similar to an existing standard (ID: ${conflict.id}, similarity: ${(conflict.similarity * 100).toFixed(1)}%).`,
			conflicting_standard: {
				id: conflict.id,
				title: conflict.title,
				version: conflict.version,
				language: conflict.language,
				stack: conflict.stack,
				content: conflict.content
			},
			instruction:
				"Use 'standard-write' with 'id' or 'code' to update the existing standard. To store a distinct variant, supply a different 'version', 'language', or non-overlapping 'stack'."
		};
		err.name = "StandardConflictError";
		throw err;
	}

	const now = new Date().toISOString();
	const standardRepo = params.repo || "__global__";

	const entry: CodingStandardEntry = {
		id: randomUUID(),
		code: generateNextCode(params.owner!, standardRepo, "standard", db),
		title: params.name,
		content: params.content,
		parent_id: resolveStandardParentId(params.parent_id, db, params.owner, params.repo),
		context: toContextSlug(params.context || "general"),
		version: params.version || "1.0.0",
		language: params.language || null,
		stack: params.stack || [],
		is_global: params.is_global === true,
		owner: params.owner!,
		repo: params.repo || null,
		tags: params.tags,
		metadata: params.metadata,
		created_at: now,
		updated_at: now,
		hit_count: 0,
		last_used_at: null,
		agent: params.agent || "unknown",
		model: params.model || "unknown"
	};

	db.db
		.transaction(() => {
			db.standards.insert(entry);

			// Enqueue embedding + KG enrichment (vector text, content extraction,
			// parent/stack relations) to the outbox worker — off the write-lock
			// critical path (TASK-013).
			enqueueStandard(db, entry);
		})
		.immediate();

	return { id: entry.id, code: entry.code!, title: entry.title, repo: entry.repo || "global" };
}

// ── Single create handler (returns McpResponse) ──────────────────────────

export async function handleCreateSingle(
	params: StandardWriteParams,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	try {
		const data = await coreCreate(params, db, vectors);
		return createMcpResponse(
			{
				success: true,
				standard: data,
				message: `Coding standard [${data.code}] "${data.title}" saved successfully.`
			},
			`Stored [${data.code}] "${data.title}" in "${data.repo}".`,
			{
				structuredContentPathHint: "standard",
				includeJson: params.json
			}
		);
	} catch (err: unknown) {
		const conflictErr = err as Error & { structured?: Record<string, unknown> };
		if (conflictErr.structured) {
			const { error, message, success: _success, ...details } = conflictErr.structured;
			return createMcpErrorResponse({
				code: String(error),
				message: String(message),
				retryable: false,
				details
			});
		}
		throw err;
	}
}
