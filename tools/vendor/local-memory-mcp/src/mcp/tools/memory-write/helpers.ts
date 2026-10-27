import { randomUUID } from "crypto";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore, MemoryEntry, MEMORY_STATUS_ACTIVE } from "../../types";
import type { McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import { resolveEntityCode } from "../../utils/code-generator";
import { resolveMemorySupersedes } from "../../utils/memory-utils";
import { MEMORY_CONFLICT_THRESHOLD, TTL_MS_PER_DAY } from "../../utils/constants";
import type { MemoryWriteItemInput } from "../schemas/index";

// ── Mode inference ───────────────────────────────────────────────────────

export type WriteMode = "create" | "update" | "acknowledge" | "bulk";

export function inferWriteMode(params: Record<string, unknown>): WriteMode {
	if (params.memories !== undefined && Array.isArray(params.memories)) {
		return "bulk";
	}
	if (params.acknowledge !== undefined && (params.id !== undefined || params.code !== undefined)) {
		return "acknowledge";
	}
	if (params.id !== undefined || params.code !== undefined) {
		return "update";
	}
	return "create";
}

// ── Decision fields convenience ──────────────────────────────────────────

/**
 * If flat decision fields (`context`, `rationale`, `alternatives`) are
 * provided alongside type="decision", auto-generates the `content`,
 * sets `importance=4`, and strips the convenience fields so the memory
 * entry is clean.
 */
export function applyDecisionFields(params: Record<string, unknown>): void {
	const context = params.context as string | undefined;
	const rationale = params.rationale as string | undefined;
	const alternatives = params.alternatives as string[] | undefined;

	if (!context && !rationale && !alternatives) return;

	// Validate type must be "decision"
	if (params.type !== "decision") {
		throw new Error(
			`context/rationale/alternatives require type="decision", got ${params.type ? `"${params.type}"` : "undefined"}.`
		);
	}

	const lines: string[] = [];

	if (context) {
		lines.push(`## Context\n\n${context}`);
	}
	if (rationale) {
		lines.push(`## Rationale\n\n${rationale}`);
	}
	if (Array.isArray(alternatives) && alternatives.length > 0) {
		lines.push(`## Alternatives\n\n${(alternatives as string[]).map((a) => `- ${a}`).join("\n")}`);
	}

	params.content = lines.join("\n\n");
	params.importance = 4;

	// Inject the "decision" tag if not already present
	const tags = (params.tags as string[]) ?? [];
	if (!tags.includes("decision")) {
		tags.push("decision");
		params.tags = tags;
	}

	// Strip the flat fields so the memory entry is clean
	delete params.context;
	delete params.rationale;
	delete params.alternatives;
}

// ── Session fields convenience ───────────────────────────────────────────

/**
 * If flat session fields (`key_decisions`, `next_steps`) are provided
 * alongside type="task_archive", auto-generates the `content`, sets
 * `importance=3`, and strips the convenience fields so the memory entry
 * is clean.
 */
export function applySessionFields(params: Record<string, unknown>): void {
	const keyDecisions = params.key_decisions as string[] | undefined;
	const nextSteps = params.next_steps as string[] | undefined;

	if (!keyDecisions && !nextSteps) return;

	// Validate type must be "task_archive"
	if (params.type !== "task_archive") {
		throw new Error(
			`key_decisions/next_steps require type="task_archive", got ${params.type ? `"${params.type}"` : "undefined"}.`
		);
	}

	const lines: string[] = [];

	if (Array.isArray(keyDecisions) && keyDecisions.length > 0) {
		lines.push(`## Key Decisions\n\n${keyDecisions.map((d) => `- ${d}`).join("\n")}`);
	}
	if (Array.isArray(nextSteps) && nextSteps.length > 0) {
		lines.push(`## Next Steps\n\n${nextSteps.map((n) => `- ${n}`).join("\n")}`);
	}

	params.content = lines.join("\n\n");
	params.importance = 3;

	// Always tag with "session-summary"
	const tags = (params.tags as string[]) ?? [];
	if (!tags.includes("session-summary")) {
		tags.push("session-summary");
		params.tags = tags;
	}

	// Strip the flat fields so the memory entry is clean
	delete params.key_decisions;
	delete params.next_steps;
}

// ── Scope resolution ─────────────────────────────────────────────────────

/**
 * Resolves the effective `(owner, repo)` for a memory-write item.
 *
 * Precedence is nested `scope` FIRST, then the top-level fields, then
 * `"unknown"`. This is the single source of truth shared by
 * {@link buildMemoryEntry} and {@link checkCreateConflict} so the stored scope
 * and the conflict-gate scope can never disagree.
 *
 * Why scope-first: `normalizeToolArguments` mirrors the resolved repo/owner
 * INTO `scope` when `scope` exists but lacks them, and it fills the TOP-LEVEL
 * `owner`/`repo` from the session (roots/CWD) even when the caller scoped the
 * write ONLY via `scope:{owner,repo}`. Preferring the top-level would therefore
 * silently re-target a scope-only write to the session repo (e.g. "agents")
 * instead of the requested one (FIX-020). Because normalization keeps
 * `scope.owner`/`scope.repo` equal to the top-level pair whenever they were NOT
 * caller-supplied, scope-first is byte-identical for every `owner`/`repo`-only
 * call — `"unknown"` applies only when BOTH are absent.
 */
export function resolveScopeOwnerRepo(params: MemoryWriteItemInput): { owner: string; repo: string } {
	return {
		owner: params.scope?.owner ?? params.owner ?? "unknown",
		repo: params.scope?.repo ?? params.repo ?? "unknown"
	};
}

// ── Memory entry builder ─────────────────────────────────────────────────

/**
 * Builds a `MemoryEntry` from a schema-validated write item (OPT-CODE-03).
 *
 * The param is typed as {@link MemoryWriteItemInput} (z.infer of
 * `MemoryWriteItemSchema`) instead of `Record<string, unknown>`, so field
 * reads are statically typed — no `as` casts per field.
 *
 * Fields keep a narrow compile-time cast because the schema marks them
 * optional (the schema is shared with the update/acknowledge modes) while the
 * entity type and the memories table expect non-null:
 * - `type`     → `type TEXT NOT NULL`.
 * - `content`  → `content TEXT NOT NULL`: an absent value flows through and the
 *   insert fails with SQLITE_CONSTRAINT — the exact pre-refactor outcome for a
 *   create missing a required column (surfaced as a structured error, FIX-020).
 * - `importance` → `importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5)`.
 *   The schema now supplies `.default(3)`, and the `?? 3` here is an
 *   independent safety net so NO create path can ever bind `undefined`
 *   (FIX-020) — the constraint can never be violated by an omitted importance.
 * - `title`    → `title TEXT` (nullable): an absent value flows through and is
 *   stored as NULL (insert binds `entry.title || null`).
 *
 * The casts are type-level only; the runtime values pass through verbatim, so
 * behavior is byte-identical to the pre-refactor `Record<string, unknown>` code.
 */
export function buildMemoryEntry(
	params: MemoryWriteItemInput,
	db: SQLiteStore,
	vectors: VectorStore,
	now: string,
	batchCodes?: Set<string>
): MemoryEntry {
	const scope = params.scope;
	// Scope-first resolution (FIX-020) — see resolveScopeOwnerRepo.
	const { owner, repo } = resolveScopeOwnerRepo(params);
	const fullScope = {
		owner,
		repo,
		branch: scope?.branch,
		folder: scope?.folder,
		language: scope?.language
	};

	const createdAtTime = new Date(now).getTime();
	const expires_at =
		params.ttlDays != null ? new Date(createdAtTime + params.ttlDays * TTL_MS_PER_DAY).toISOString() : null;

	const resolvedSupersedes = resolveMemorySupersedes(params.supersedes, db, owner, repo);

	const tags = [...(params.tags ?? [])];
	if (fullScope.language && !tags.includes(fullScope.language.toLowerCase())) {
		tags.push(fullScope.language.toLowerCase());
	}

	const code = resolveEntityCode(params.code || null, owner, repo, "memory", db, { batchCodes });

	return {
		id: randomUUID(),
		code,
		// Narrow field casts — see the JSDoc above for the schema-vs-table contract.
		type: params.type as MemoryEntry["type"],
		title: params.title as string,
		content: params.content as string,
		// Safety net (FIX-020): the schema now defaults importance to 3, but this
		// `?? 3` guarantees NO create path can ever bind `undefined` into the
		// NOT NULL CHECK(1..5) column, independent of the schema.
		importance: (params.importance ?? 3) as number,
		agent: params.agent ?? "unknown",
		role: params.role ?? "unknown",
		model: params.model ?? "unknown",
		scope: fullScope,
		created_at: now,
		updated_at: now,
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at,
		supersedes: resolvedSupersedes,
		status: MEMORY_STATUS_ACTIVE,
		tags,
		metadata: params.metadata ?? {},
		is_global: params.is_global ?? false
	};
}

// ── Conflict check for create items ──────────────────────────────────────

export async function checkCreateConflict(
	params: MemoryWriteItemInput,
	db: SQLiteStore,
	vectors: VectorStore,
	isTaskArchive: boolean,
	resolvedSupersedes: string | null
): Promise<{ conflict: boolean; response?: McpResponse }> {
	if (resolvedSupersedes || isTaskArchive) {
		return { conflict: false };
	}

	// Same scope-first resolution as buildMemoryEntry (FIX-020) so the
	// conflict gate and the stored row agree on the scope.
	const { owner, repo } = resolveScopeOwnerRepo(params);

	// `content` is schema-optional but checkConflicts requires a string. The cast
	// is type-level only — it passes `params.content` (possibly undefined) through
	// unchanged, exactly as the pre-refactor code did. An empty/absent content
	// yields no similarity match (no false conflict), and a create without content
	// still fails later at the `content TEXT NOT NULL` insert.
	const conflict = await db.memoryVectors.checkConflicts(
		params.content as string,
		owner,
		repo,
		params.type ?? "unknown",
		vectors,
		MEMORY_CONFLICT_THRESHOLD
	);

	if (conflict) {
		return {
			conflict: true,
			response: createMcpErrorResponse({
				code: "MEMORY_CONFLICT",
				message: `Rejected due to conflict: "${conflict.title}" (${conflict.id.slice(0, 8)}...). Hint: Use 'id' for update, 'id'+'acknowledge' for acknowledge, or 'supersedes' if replacing.`,
				retryable: false,
				details: {
					conflicting_memory: { id: conflict.id, title: conflict.title, content: conflict.content },
					instruction:
						"Provide 'id' for update, 'id'+'acknowledge' for acknowledge, or 'supersedes' if this new memory replaces it."
				}
			})
		};
	}

	return { conflict: false };
}
