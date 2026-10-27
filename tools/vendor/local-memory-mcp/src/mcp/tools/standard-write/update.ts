/**
 * standard-write/update — single standard update with conflict detection.
 */

import { CodingStandardEntry, VectorStore } from "../../types";
import { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import { resolveEntityRef } from "../../utils/entity-ref";
import { enqueueStandard } from "../../embedding-queue";
import { StandardWriteParams, resolveStandardParentId } from "./shared";

// ── Core update logic — returns plain data, does NOT wrap in McpResponse ──

export async function coreUpdate(
	params: StandardWriteParams,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<{ id: string; code: string; title: string; repo: string; updatedFields: string[] }> {
	// Resolve code to id if needed
	let resolvedId = params.id
		? (resolveEntityRef(db, "standard", params.id, params.owner, params.repo) ?? "")
		: undefined;
	if (!resolvedId && params.code) {
		resolvedId = resolveEntityRef(db, "standard", params.code, params.owner, params.repo) ?? "";
	} else if (!resolvedId) {
		throw new Error("Either id or code must be provided");
	}

	const existing = db.standards.getById(resolvedId);
	if (!existing) {
		throw new Error(`Coding standard not found: ${resolvedId}`);
	}

	// Conflict detection on content change (also in update mode, per ADR-003)
	if (params.content !== undefined && params.content !== existing.content) {
		const conflict = db.standards.checkConflicts(
			params.content,
			params.version || existing.version,
			params.owner || existing.owner,
			(params.repo || existing.repo) ?? undefined,
			params.language ?? existing.language,
			params.stack ?? existing.stack,
			0.82
		);
		if (conflict && conflict.id !== existing.id) {
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
				message: `This updated standard content conflicts with an existing standard (ID: ${conflict.id}, similarity: ${(conflict.similarity * 100).toFixed(1)}%).`,
				conflicting_standard: {
					id: conflict.id,
					title: conflict.title,
					version: conflict.version,
					language: conflict.language,
					stack: conflict.stack,
					content: conflict.content
				},
				instruction: "Differentiate by 'version', 'language', or non-overlapping 'stack' to avoid conflict."
			};
			err.name = "StandardConflictError";
			throw err;
		}
	}

	const updates: Partial<CodingStandardEntry> = {};
	if (params.name !== undefined) updates.title = params.name;
	if (params.content !== undefined) updates.content = params.content;
	if (params.parent_id !== undefined)
		updates.parent_id = resolveStandardParentId(params.parent_id, db, existing.owner, existing.repo ?? undefined);
	if (params.context !== undefined) updates.context = params.context;
	if (params.version !== undefined) updates.version = params.version;
	if (params.language !== undefined) updates.language = params.language;
	if (params.stack !== undefined) updates.stack = params.stack;
	if (params.repo !== undefined) updates.repo = params.repo;
	if (params.is_global !== undefined) updates.is_global = params.is_global;
	if (params.tags !== undefined) updates.tags = params.tags;
	if (params.metadata !== undefined) updates.metadata = params.metadata;
	if (params.agent !== undefined) updates.agent = params.agent;
	if (params.model !== undefined) updates.model = params.model;

	const merged: CodingStandardEntry = {
		...existing,
		...updates,
		updated_at: new Date().toISOString()
	};

	// Re-enqueue embedding/KG on content or semantic field change — atomic
	// with the row update, enrichment deferred to the outbox worker (TASK-013).
	const contentRelatedFields = [
		params.name,
		params.content,
		params.context,
		params.version,
		params.language,
		params.stack,
		params.tags,
		params.metadata
	];
	if (contentRelatedFields.some((f) => f !== undefined)) {
		db.db
			.transaction(() => {
				db.standards.update(resolvedId, updates);
				enqueueStandard(db, merged);
			})
			.immediate();
	} else {
		db.standards.update(resolvedId, updates);
	}

	logger.info("[Tool] standard.write — update", {
		standardId: resolvedId,
		fields: Object.keys(updates)
	});

	return {
		id: resolvedId,
		code: existing.code ?? "",
		title: existing.title,
		repo: existing.repo || "global",
		updatedFields: Object.keys(updates)
	};
}

// ── Single update handler (returns McpResponse) ─────────────────────────

export async function handleUpdateSingle(
	params: StandardWriteParams,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	try {
		const data = await coreUpdate(params, db, vectors);
		return createMcpResponse(
			{
				success: true,
				id: data.id,
				code: data.code,
				updatedFields: data.updatedFields
			},
			`Updated [${data.code}] "${data.title}" in "${data.repo}" — ${data.updatedFields.join(", ") || "none"}.`,
			{
				structuredContentPathHint: "updatedFields",
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
