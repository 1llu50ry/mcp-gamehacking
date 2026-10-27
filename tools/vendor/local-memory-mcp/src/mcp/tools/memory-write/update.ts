import { MemoryTypeSchema } from "../schemas/index";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore } from "../../types";
import { logger } from "../../utils/logger";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { enqueueMemory } from "../../embedding-queue";
import { resolveEntityRef } from "../../utils/entity-ref";
import { hasMetadataLikeTitle, resolveMemorySupersedes } from "../../utils/memory-utils";

// ── Single UPDATE ────────────────────────────────────────────────────────

export async function handleUpdate(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore,
	json: boolean
): Promise<McpResponse> {
	const idOrCode = (params.id ?? params.code) as string | undefined;
	if (!idOrCode) {
		throw new Error("Either id or code must be provided for update");
	}

	// Resolve code/id to a memory UUID
	const scope = (params.scope as Record<string, unknown>) ?? {};
	const owner = (params.owner as string) ?? (scope.owner as string);
	const repo = (params.repo as string) ?? (scope.repo as string);
	const resolvedId = resolveEntityRef(db, "memory", idOrCode, owner, repo) ?? "";

	// Check memory exists
	const existing = db.memories.getById(resolvedId);
	if (!existing) {
		throw new Error(`Memory not found: ${resolvedId}`);
	}

	// Repo mismatch check
	const repoFilter = (params.repo as string) ?? ((params.scope as Record<string, unknown>)?.repo as string);
	if (repoFilter && repoFilter !== existing.scope.repo) {
		throw new Error(
			`Repository mismatch: provided repo "${repoFilter}" does not match memory repo "${existing.scope.repo}"`
		);
	}

	// Title metadata check
	const title = params.title as string | undefined;
	if (title !== undefined && hasMetadataLikeTitle(title)) {
		throw new Error(
			"Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields."
		);
	}

	// Build updates
	const updates: Record<string, unknown> = {};
	const updatableFields = [
		"type",
		"title",
		"content",
		"importance",
		"agent",
		"role",
		"status",
		"supersedes",
		"tags",
		"metadata",
		"is_global",
		"completed_at"
	] as const;

	for (const field of updatableFields) {
		if (params[field] !== undefined) {
			if (field === "type") {
				updates[field] = MemoryTypeSchema.parse(params[field]);
			} else if (field === "supersedes") {
				updates[field] = resolveMemorySupersedes(
					params[field] as string | null | undefined,
					db,
					existing.scope.owner,
					existing.scope.repo
				);
			} else {
				updates[field] = params[field] as string | number | boolean | Record<string, unknown> | string[] | undefined;
			}
		}
	}

	// Update row + outbox job atomically when content changed. Embedding/KG
	// enrichment is deferred to the outbox worker (TASK-013) — the enqueue is
	// a single sync upsert, keeping lock-held time at ~µs.
	db.db
		.transaction(() => {
			db.memories.update(resolvedId, updates);
			if (params.content !== undefined) {
				const fresh = db.memories.getById(resolvedId);
				if (fresh) enqueueMemory(db, fresh);
			}
		})
		.immediate();

	// Action logging happens once per tool call at the executor level
	// (extractActionLog + logAction in tools/index.ts / router.ts) — do NOT
	// log here to guarantee exactly one action_log row per tool call.
	logger.info("[Tool] memory.write — update", {
		repo: existing.scope.repo,
		id: resolvedId,
		fields: Object.keys(updates)
	});

	return createMcpResponse(
		{
			success: true,
			id: resolvedId,
			code: existing.code,
			repo: existing.scope.repo,
			updatedFields: Object.keys(updates)
		},
		`Updated [${existing.code}] "${existing.title}" in "${existing.scope.repo}" — ${Object.keys(updates).join(", ") || "none"}.`,
		{
			structuredContentPathHint: "updatedFields",
			includeJson: json
		}
	);
}

// ── Single ACKNOWLEDGE ───────────────────────────────────────────────────

export async function handleAcknowledge(
	params: Record<string, unknown>,
	db: SQLiteStore,
	json: boolean
): Promise<McpResponse> {
	const idOrCode = (params.id ?? params.code) as string | undefined;
	if (!idOrCode) {
		throw new Error("Either id or code must be provided for acknowledge");
	}

	// Resolve code/id to a memory UUID
	const scope = (params.scope as Record<string, unknown>) ?? {};
	const owner = (params.owner as string) ?? (scope.owner as string);
	const repo = (params.repo as string) ?? (scope.repo as string);
	const memoryId = resolveEntityRef(db, "memory", idOrCode, owner, repo) ?? "";

	// Check memory exists
	const memory = db.memories.getById(memoryId);
	if (!memory) {
		throw new Error(`Memory with ID ${memoryId} not found.`);
	}

	const status = params.acknowledge as string;
	const applicationContext = params.application_context as string | undefined;

	// Validate acknowledge status value
	const VALID_ACK_STATUSES = ["used", "irrelevant", "contradictory"] as const;
	if (!VALID_ACK_STATUSES.includes(status as (typeof VALID_ACK_STATUSES)[number])) {
		throw new Error(`Invalid acknowledge status "${status}". Must be one of: ${VALID_ACK_STATUSES.join(", ")}`);
	}

	// Update stats based on status
	if (status === "used") {
		db.memories.incrementRecallCount(memory.id);
		logger.info("[Tool] memory.write — acknowledge used", { id: memory.id, context: applicationContext });
	} else if (status === "contradictory") {
		logger.warn("[Tool] memory.write — acknowledge contradiction reported", {
			id: memory.id,
			context: applicationContext
		});
	} else {
		logger.info("[Tool] memory.write — acknowledge irrelevant", { id: memory.id, context: applicationContext });
	}

	return createMcpResponse(
		{
			success: true,
			id: memory.id,
			code: memory.code,
			status
		},
		`Acknowledged [${memory.code}] as "${status}" in "${memory.scope.repo}".`,
		{
			structuredContentPathHint: "status",
			includeJson: json
		}
	);
}
