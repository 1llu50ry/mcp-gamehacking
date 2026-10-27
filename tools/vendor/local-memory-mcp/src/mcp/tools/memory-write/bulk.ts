import { MemoryTypeSchema, MemoryWriteItemSchema } from "../schemas/index";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore, MemoryEntry, MEMORY_STATUS_ARCHIVED } from "../../types";
import { logger } from "../../utils/logger";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import { enqueueMemory } from "../../embedding-queue";
import { resolveEntityRef } from "../../utils/entity-ref";
import { hasMetadataLikeTitle, resolveMemorySupersedes } from "../../utils/memory-utils";
import {
	applyDecisionFields,
	applySessionFields,
	buildMemoryEntry,
	checkCreateConflict,
	inferWriteMode
} from "./helpers";

// ── BULK ─────────────────────────────────────────────────────────────────

export async function handleBulk(
	items: Record<string, unknown>[],
	db: SQLiteStore,
	vectors: VectorStore,
	json: boolean,
	parentParams?: Record<string, unknown>
): Promise<McpResponse> {
	const results: Record<string, unknown>[] = [];
	const errors: { index: number; error: string }[] = [];
	const createdEntries: MemoryEntry[] = [];
	const now = new Date().toISOString();
	const batchCodes = new Set<string>();

	// Session defaults carried from top-level — inherit from parent if not set per-item
	const parentOwner = (parentParams?.owner as string) ?? "";
	const parentRepo = (parentParams?.repo as string) ?? "";
	const defaultOwner = parentOwner;
	const defaultRepo = parentRepo;

	for (let i = 0; i < items.length; i++) {
		try {
			const raw = { ...items[i] };

			// Infer per-item operation
			const itemMode = inferWriteMode(raw);

			switch (itemMode) {
				case "acknowledge": {
					// Acknowledge inline within bulk — run against the DB directly
					const idOrCode = (raw.id ?? raw.code) as string | undefined;
					if (!idOrCode) throw new Error("Either id or code must be provided for acknowledge");

					const scope = (raw.scope as Record<string, unknown>) ?? {};
					const owner = (raw.owner as string) ?? (scope.owner as string);
					const repo = (raw.repo as string) ?? (scope.repo as string);
					const memId = resolveEntityRef(db, "memory", idOrCode, owner, repo) ?? "";

					const mem = db.memories.getById(memId);
					if (!mem) throw new Error(`Memory with ID ${memId} not found.`);

					const ackStatus = raw.acknowledge as string;
					if (ackStatus === "used") {
						db.memories.incrementRecallCount(mem.id);
					}

					results.push({
						operation: "acknowledge",
						success: true,
						id: mem.id,
						code: mem.code,
						status: ackStatus
					});
					break;
				}

				case "update": {
					// Update inline within bulk
					const idOrCode = (raw.id ?? raw.code) as string | undefined;
					if (!idOrCode) throw new Error("Either id or code must be provided for update");

					const scope = (raw.scope as Record<string, unknown>) ?? {};
					const owner = (raw.owner as string) ?? (scope.owner as string);
					const repo = (raw.repo as string) ?? (scope.repo as string);
					const memId = resolveEntityRef(db, "memory", idOrCode, owner, repo) ?? "";

					const existing = db.memories.getById(memId);
					if (!existing) throw new Error(`Memory with ID ${memId} not found.`);

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
						if (raw[field] !== undefined) {
							if (field === "type") {
								updates[field] = MemoryTypeSchema.parse(raw[field]);
							} else {
								updates[field] = raw[field] as
									| string
									| number
									| boolean
									| Record<string, unknown>
									| string[]
									| undefined;
							}
						}
					}

					db.memories.update(memId, updates);

					if (raw.content !== undefined) {
						const fresh = db.memories.getById(memId);
						if (fresh) enqueueMemory(db, fresh);
					}

					results.push({
						operation: "update",
						success: true,
						id: memId,
						code: existing.code,
						updatedFields: Object.keys(updates)
					});
					break;
				}

				case "create":
				default: {
					// Apply convenience helpers
					applyDecisionFields(raw);
					applySessionFields(raw);

					// Title metadata check
					const rawTitle = raw.title as string | undefined;
					if (rawTitle && hasMetadataLikeTitle(rawTitle)) {
						throw new Error(
							"Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields."
						);
					}

					const isTaskArchive = raw.type === "task_archive";

					// Fill scope defaults from item or parent params
					const itemScope = (raw.scope as Record<string, unknown>) ?? {};
					const itemOwner = (raw.owner as string) ?? (itemScope.owner as string) ?? defaultOwner;
					const itemRepo = (raw.repo as string) ?? (itemScope.repo as string) ?? defaultRepo;

					// Propagate the RESOLVED owner/repo to the item so
					// buildMemoryEntry (scope-first, FIX-020) and the conflict gate
					// agree on the item's own scope. Synthesizing the scope from the
					// item's resolved values — not the raw parent defaults — keeps an
					// item that set ONLY a top-level owner/repo from being overridden
					// by a parent-derived scope under the scope-first precedence.
					//
					// Scope is only synthesized when BOTH halves resolve —
					// MemoryScopeSchema requires owner+repo min(1), so an asymmetric
					// pair (exactly one non-empty) would emit a PARTIAL scope that
					// fails the item parse below and flips the whole valid bulk create
					// into per-item errors (TASK-147). When a half is missing, leave
					// scope undefined; buildMemoryEntry falls back to "unknown" for
					// that half, keeping stored owner/repo byte-identical to the
					// pre-refactor behavior.
					if (!raw.owner && itemOwner) raw.owner = itemOwner;
					if (!raw.repo && itemRepo) raw.repo = itemRepo;
					if (!raw.scope) {
						raw.scope = itemOwner && itemRepo ? { owner: itemOwner, repo: itemRepo } : undefined;
					} else {
						const scope = raw.scope as Record<string, unknown>;
						if (!scope.owner && itemOwner) scope.owner = itemOwner;
						if (!scope.repo && itemRepo) scope.repo = itemRepo;
					}

					// Parse the item through the item schema (OPT-CODE-03). Bulk items
					// were previously NOT validated (only the single-create path ran
					// MemoryWriteSchema.parse), letting junk values (invalid type
					// enums, out-of-range importance, over-long titles) reach the DB.
					// Validating here aligns bulk with the single path and hands the
					// helpers a z.infer'd typed input instead of Record<string, unknown>.
					// Failures surface per-item in the errors[] list (bulk partial
					// execution contract) — the same fail-loud direction as single create.
					const item = MemoryWriteItemSchema.parse(raw);

					// Conflict check — resolve supersedes from the validated item, not
					// the untyped raw object (NIT fix, OPT-CODE-03 review).
					const resolvedS = resolveMemorySupersedes(item.supersedes, db, itemOwner, itemRepo);
					const { conflict, response: conflictResponse } = await checkCreateConflict(
						item,
						db,
						vectors,
						isTaskArchive,
						resolvedS
					);
					if (conflict) {
						throw new Error((conflictResponse!.content?.[0] as { text?: string })?.text ?? "Conflict detected");
					}

					// Archive superseded
					if (resolvedS) {
						const oldMemory = db.memories.getById(resolvedS);
						if (oldMemory) {
							db.memories.update(oldMemory.id, { status: MEMORY_STATUS_ARCHIVED });
						}
					}

					const entry = buildMemoryEntry(item, db, vectors, now, batchCodes);
					createdEntries.push(entry);

					results.push({
						operation: "create",
						success: true,
						id: entry.id,
						code: entry.code,
						title: entry.title,
						type: entry.type
					});
					break;
				}
			}
		} catch (error) {
			errors.push({ index: i, error: (error as Error).message });
			logger.warn("[Tool] memory.write — bulk item failed", { index: i, error: String(error) });
		}
	}

	// Batch insert all created entries in a single transaction
	if (createdEntries.length > 0) {
		db.memories.bulkInsertMemories(createdEntries);

		// Enqueue embedding/KG jobs for every created entry — one atomic batch
		// (TASK-013). Enrichment runs later via the outbox worker, off the
		// write-lock critical path.
		db.db
			.transaction(() => {
				for (const entry of createdEntries) {
					enqueueMemory(db, entry);
				}
			})
			.immediate();
	}

	const successCount = results.length;
	const errorCount = errors.length;

	const byOp: Record<string, string[]> = { create: [], update: [], acknowledge: [] };
	for (const r of results) {
		const op = r.operation as string;
		const code = r.code as string;
		if (byOp[op]) {
			byOp[op].push(code);
		}
	}

	const opParts: string[] = [];
	for (const [op, codes] of Object.entries(byOp)) {
		if (codes.length === 0) continue;
		const opLabel = op === "acknowledge" ? "ack" : op;
		const sample = codes.length <= 3 ? codes.join(", ") : `${codes.slice(0, 3).join(", ")}, ... (${codes.length})`;
		opParts.push(`${opLabel}: ${sample}`);
	}

	const data = {
		success: errorCount === 0,
		total: items.length,
		processed: successCount,
		results,
		...(errorCount > 0 ? { errors } : {})
	};
	const summary = `Processed ${successCount}/${items.length} — ${opParts.join("; ")}${errorCount > 0 ? `; ${errorCount} failed` : ""}.`;
	if (errorCount > 0) {
		return createMcpErrorResponse({
			code: successCount > 0 ? "PARTIAL_FAILURE" : "BULK_OPERATION_FAILED",
			message: summary,
			retryable: false,
			data
		});
	}
	return createMcpResponse(data, summary, {
		structuredContentPathHint: "results",
		includeJson: json
	});
}
