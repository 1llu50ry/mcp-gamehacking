import { MemoryWriteSchema } from "../schemas/index";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore, MEMORY_STATUS_ARCHIVED } from "../../types";
import { createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { enqueueMemory } from "../../embedding-queue";
import { hasMetadataLikeTitle, resolveMemorySupersedes } from "../../utils/memory-utils";
import {
	applyDecisionFields,
	applySessionFields,
	buildMemoryEntry,
	checkCreateConflict,
	resolveScopeOwnerRepo
} from "./helpers";

// ── Single CREATE ────────────────────────────────────────────────────────

export async function handleCreate(
	params: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore,
	json: boolean
): Promise<McpResponse> {
	// Apply convenience helpers before validation
	applyDecisionFields(params);
	applySessionFields(params);

	// Parse once — `parsed` carries the z.infer'd MemoryWriteInput type
	// (OPT-CODE-03), so no `as Record<string, unknown>` re-cast is needed
	// and downstream reads (owner/scope/type/supersedes) are statically typed.
	const parsed = MemoryWriteSchema.parse(params);

	// Title metadata check
	const title = parsed.title ?? "";
	if (hasMetadataLikeTitle(title)) {
		throw new Error(
			"Title appears to contain metadata. Keep title concise and move agent/role/date details into metadata or dedicated fields."
		);
	}

	const isTaskArchive = parsed.type === "task_archive";
	// Scope-first resolution (FIX-020) — shared with buildMemoryEntry so the
	// supersede/conflict lookups and the stored row use the same scope.
	const { owner, repo } = resolveScopeOwnerRepo(parsed);

	// Check for resolved supersedes to decide
	const resolvedSupersedes = resolveMemorySupersedes(parsed.supersedes, db, owner, repo);

	// Conflict check
	const { conflict, response: conflictResponse } = await checkCreateConflict(
		parsed,
		db,
		vectors,
		isTaskArchive,
		resolvedSupersedes
	);
	if (conflict) {
		return conflictResponse!;
	}

	// Archive the superseded memory
	if (resolvedSupersedes) {
		const oldMemory = db.memories.getById(resolvedSupersedes);
		if (oldMemory) {
			db.memories.update(oldMemory.id, { status: MEMORY_STATUS_ARCHIVED });
		}
	}

	const now = new Date().toISOString();
	const entry = buildMemoryEntry(parsed, db, vectors, now);

	// Row + outbox job commit atomically inside the write transaction: ONNX
	// embedding + KG extraction run later via the outbox worker (TASK-013).
	db.db
		.transaction(() => {
			db.memories.insert(entry);
			enqueueMemory(db, entry);
		})
		.immediate();

	return createMcpResponse(
		{
			success: true,
			id: entry.id,
			code: entry.code,
			repo: entry.scope.repo,
			type: entry.type,
			title: entry.title,
			importance: entry.importance
		},
		`Stored [${entry.code}] "${entry.title}" (${entry.type}, imp:${entry.importance}) in "${entry.scope.repo}".`,
		{
			contentSummary: `Stored [${entry.code}] "${entry.title}" (${entry.type}, imp:${entry.importance}) in "${entry.scope.repo}".`,
			structuredContentPathHint: "code",
			includeJson: json
		}
	);
}
