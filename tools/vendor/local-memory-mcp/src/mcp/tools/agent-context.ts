import { AgentContextSchema } from "./schemas/index";
import { SQLiteStore } from "../storage/sqlite";
import type { CodebaseReferenceKind, MemoryEntry, VectorStore } from "../types";
import { TASK_STATUS_IN_PROGRESS, TASK_STATUS_PENDING, TASK_STATUS_BACKLOG, TASK_STATUS_BLOCKED } from "../types";
import {
	AGENT_CONTEXT_SOURCE_ORDER,
	codeCandidate,
	estimateTokens,
	handoffCandidate,
	memoryCandidate,
	observationCandidate,
	rankAndPackContext,
	standardCandidate,
	taskCandidate,
	type AgentContextSource,
	type ContextCandidate
} from "./agent-context-compiler";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { logger } from "../utils/logger";
import { reuseTelemetry } from "../utils/reuse-telemetry";

const ACTIVE_TASK_STATUSES = [TASK_STATUS_IN_PROGRESS, TASK_STATUS_PENDING, TASK_STATUS_BACKLOG, TASK_STATUS_BLOCKED];

/**
 * Deliberate divergence from SPEC-001 hybrid weights (see utils/scoring.ts).
 *
 * agent-context ranks context memories by RELEVANCE (vector score) + IMPORTANCE,
 * not by the search-oriented keyword/recency/domain blend used by the three
 * search engines. Kept as an explicit named constant so the divergence is
 * visible and cannot silently drift; do NOT fold into HYBRID_WEIGHTS.
 *
 * TASK-027: relevance (vector) is weighted ABOVE raw importance (0.6 vs 0.4).
 * The previous 0.3/0.7 split let importance dominate, so an important-but-
 * irrelevant memory outranked a relevant one — backwards for an objective-driven
 * context compiler whose whole job is surfacing what matches the current goal.
 */
export const AGENT_CONTEXT_BLEND = {
	vector: 0.6,
	importance: 0.4
} as const;

/**
 * Candidate pool size for the compiler, derived primarily from the requested
 * item budget (TASK-031). `limit` only bounds the legacy "Relevant Memories"
 * projection, so it must not shrink the compiler's pool — it is kept only as a
 * floor for callers that ask for more rows than the budget implies. Clamped to
 * the vector store's hard search ceiling of 100.
 */
export const AGENT_CONTEXT_CANDIDATE_POOL_MULTIPLIER = 3;
export const AGENT_CONTEXT_CANDIDATE_POOL_MAX = 100;

/**
 * Reference `kind`s the agent-context code-graph BFS is allowed to traverse
 * (TASK-028). The literals mirror the `CodebaseReferenceKind` union in
 * `src/mcp/types/codebase-reference.ts` (also `ReferenceKind` in
 * `codebase-index/parser/language-visitor.ts`) minus the barrel-only edge.
 *
 * Why an allowlist rather than a denylist: `reexport` edges are emitted by
 * barrels / re-export hubs (`export { X } from "./mod"`, `export * from "./mod"`)
 * and carry NO real dependency between the file the agent is editing and the
 * re-exported symbol — a depth-2 walk over them dragged in dozens of unrelated
 * global symbols (e.g. HandoffEntity / ActionEntity / SummaryEntity for
 * `src/mcp/tools/codebase-read/search.ts`). Note `wildcard` is an `import_kind`
 * (a form of the `reexport` edge), NOT a `kind`, so excluding `reexport`
 * already excludes `export *`. The remaining kinds are genuine dependency
 * edges (runtime calls / instantiation, module imports, heritage, type usage).
 */
export const AGENT_CONTEXT_CODE_BFS_KINDS: ReadonlySet<CodebaseReferenceKind> = new Set([
	"call",
	"instantiation",
	"import",
	"extends",
	"implements",
	"type"
]);

/**
 * Derives the compiler candidate pool size from the item budget, using the
 * legacy `limit` only as a floor (TASK-031). Pure so the derivation is unit
 * testable without a database.
 */
export function deriveCandidateLimit(maxItems: number, limit: number): number {
	return Math.min(
		AGENT_CONTEXT_CANDIDATE_POOL_MAX,
		Math.max(maxItems * AGENT_CONTEXT_CANDIDATE_POOL_MULTIPLIER, limit)
	);
}

export async function handleAgentContext(
	args: Record<string, unknown>,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const validated = AgentContextSchema.parse(args);
	const { owner, repo, type_filter, limit, json: isJsonRequest } = validated;
	const objective = validated.objective ?? validated.query ?? "";
	const packCorrelation = [
		validated.context_pack_id ?? validated.session_id ?? "anonymous",
		objective,
		validated.task_code ?? "",
		validated.current_file_path ?? "",
		validated.sources.join(","),
		JSON.stringify(validated.budget),
		String(validated.include_stale),
		String(isJsonRequest)
	].join("\u001f");
	const contextPackId = reuseTelemetry.createContextPackId(owner, repo, packCorrelation);
	type CachedContextPack = {
		response: McpResponse;
		allocation: Record<AgentContextSource, { included: number; excluded: number; estimated_tokens: number }>;
		observationIds: string[];
		memoryIds: string[];
		evidencePointers: number;
	};
	const cached = validated.context_pack_id ? reuseTelemetry.getCachedPack<CachedContextPack>(contextPackId) : undefined;
	if (cached) {
		reuseTelemetry.recordContextPack({
			owner,
			repo,
			session: validated.session_id,
			packId: contextPackId,
			cacheLookup: true,
			cacheHit: true,
			allocation: cached.allocation,
			observationIds: cached.observationIds,
			memoryIds: cached.memoryIds,
			evidencePointers: cached.evidencePointers,
			staleRejected: 0
		});
		reuseTelemetry.flushIfNeeded(db);
		return cached.response;
	}
	const enabled = new Set<AgentContextSource>(validated.sources);
	// TASK-031: derive the compiler candidate pool from the item budget (×3),
	// keeping the legacy `limit` only as a floor. Previously `limit` (default 5,
	// meant solely for the legacy memories projection) capped the pool at
	// max(5, max_items × 2), starving the compiler of candidates.
	const candidateLimit = deriveCandidateLimit(validated.budget.max_items, limit);
	let memories: MemoryEntry[] = [];
	let decisionMemories: MemoryEntry[] = [];

	if (enabled.has("memories")) {
		if (objective) {
			try {
				const vectorResults = await vectors.search(objective, candidateLimit, repo);
				const vectorScores = new Map(vectorResults.map((result) => [result.id, result.score]));
				const byId = new Map(
					db.memories.getByIds(vectorResults.map((result) => result.id)).map((memory) => [memory.id, memory])
				);
				memories = vectorResults
					.map((result) => byId.get(result.id))
					.filter((item): item is MemoryEntry => Boolean(item));
				if (type_filter) memories = memories.filter((memory) => memory.type === type_filter);
				memories.sort((a, b) => {
					const score = (memory: MemoryEntry) =>
						(vectorScores.get(memory.id) ?? 0) * AGENT_CONTEXT_BLEND.vector +
						((memory.importance ?? 3) / 5) * AGENT_CONTEXT_BLEND.importance;
					return score(b) - score(a) || a.id.localeCompare(b.id);
				});
				if (memories.length === 0)
					memories = db.memories.searchByRepo(owner, repo, objective, type_filter, candidateLimit);
			} catch {
				logger.warn("[Tool] agent-context vector search failed, falling back to keyword", { repo });
				memories = db.memories.searchByRepo(owner, repo, objective, type_filter, candidateLimit);
			}
		} else {
			const excludeTypes: string[] = type_filter ? [] : ["decision"];
			memories = db.memories.getRecentMemories(owner, repo, candidateLimit, 0, false, excludeTypes);
			if (type_filter) memories = memories.filter((memory) => memory.type === type_filter);
		}
	}
	if (enabled.has("decisions") && (!type_filter || type_filter === "decision")) {
		decisionMemories = db.memories.searchByRepo(owner, repo, objective, "decision", candidateLimit);
	}

	const activeTasks = enabled.has("tasks")
		? db.tasks.getTasksByMultipleStatuses(owner, repo, ACTIVE_TASK_STATUSES, candidateLimit, 0, objective || undefined)
		: [];
	if (
		enabled.has("tasks") &&
		validated.task_code &&
		!activeTasks.some((task) => task.task_code === validated.task_code)
	) {
		const requested = db.tasks.getTaskByCode(owner, repo, validated.task_code);
		if (requested) activeTasks.unshift(requested);
	}
	const handoffs = enabled.has("handoffs")
		? db.handoffs.listHandoffs({ owner, repo, status: "pending", limit: candidateLimit, offset: 0 })
		: [];
	const standards = enabled.has("standards")
		? db.standards.search({ query: objective || undefined, owner, repo, limit: candidateLimit, offset: 0 })
		: [];
	const observations = enabled.has("observations")
		? db.explorationObservations.list({
				owner,
				repo,
				include_stale: validated.include_stale,
				limit: candidateLimit,
				offset: 0
			})
		: [];
	const codeSymbols =
		enabled.has("code") && validated.current_file_path
			? db.codebaseSymbols.getSymbolsByFile(repo, validated.current_file_path).slice(0, candidateLimit)
			: [];
	if (enabled.has("code") && validated.current_file_path && validated.budget.code_depth > 0) {
		const symbolIds = new Set(codeSymbols.map((symbol) => symbol.id));
		let frontier = [validated.current_file_path];
		for (let depth = 0; depth < validated.budget.code_depth && frontier.length > 0; depth++) {
			const nextFiles = new Set<string>();
			for (const filePath of frontier.sort()) {
				// TASK-028: only traverse REAL dependency edges. Barrel-only
				// `reexport` edges (incl. wildcard `export *`) are filtered out
				// BEFORE the fan-out cap so the cap is spent on meaningful
				// neighbours instead of unrelated re-exported globals.
				const references = db.codebaseReferences
					.getReferencesByFile(repo, filePath)
					.filter((reference) => AGENT_CONTEXT_CODE_BFS_KINDS.has(reference.kind as CodebaseReferenceKind));
				for (const reference of references.slice(0, candidateLimit)) {
					const targetSymbols = reference.target_file
						? db.codebaseSymbols.getSymbolsByFile(repo, reference.target_file)
						: db.codebaseSymbols.getSymbolByName(repo, reference.symbol_name);
					const referenced = reference.target_symbol_id
						? targetSymbols.find((symbol) => symbol.id === reference.target_symbol_id)
						: targetSymbols.find((symbol) => symbol.name === reference.symbol_name);
					if (referenced && !symbolIds.has(referenced.id)) {
						codeSymbols.push(referenced);
						symbolIds.add(referenced.id);
					}
					if (reference.target_file) nextFiles.add(reference.target_file);
					if (codeSymbols.length >= candidateLimit) break;
				}
				if (codeSymbols.length >= candidateLimit) break;
			}
			frontier = [...nextFiles];
		}
	}

	const memoryIds = new Set(memories.map((memory) => memory.id));
	const uniqueDecisions = decisionMemories.filter((decision) => !memoryIds.has(decision.id));
	const candidates: ContextCandidate[] = [];
	memories.forEach((memory) => candidates.push(memoryCandidate(memory, "memories")));
	uniqueDecisions.forEach((decision) => candidates.push(memoryCandidate(decision, "decisions")));
	activeTasks.forEach((task) => candidates.push(taskCandidate(task, validated.task_code)));
	handoffs.forEach((handoff) => candidates.push(handoffCandidate(handoff)));
	standards.forEach((standard) => candidates.push(standardCandidate(standard)));
	observations.forEach((observation) => candidates.push(observationCandidate(observation)));
	codeSymbols.forEach((symbol) => candidates.push(codeCandidate(symbol)));
	const packed = rankAndPackContext(candidates, objective, validated.budget);
	// Keep the legacy projections independent from compiler packing so existing
	// consumers do not lose rows merely because another source won the budget.
	// The structured `memories[]`/`decisions[]`/`tasks[]` projections therefore
	// keep their full rows (unchanged contract).
	const selectedMemories = memories.slice(0, limit);
	const selectedDecisions = uniqueDecisions.slice(0, limit);
	const selectedTasks = activeTasks.slice(0, 10);
	// TASK-029: the legacy `== Relevant Memories ==` TEXT block is rendered
	// separately from packing, so a memory that already won a slot in
	// `packed.included` would otherwise be printed twice. Dedup the block against
	// the packed memory/decision ids (the structured projections above stay
	// intact). If every legacy row was packed, the block still renders its header
	// with the existing "(No relevant memories selected)" placeholder.
	const packedMemoryIds = new Set(
		packed.included.filter((item) => item.source === "memories" || item.source === "decisions").map((item) => item.id)
	);
	const legacyMemories = selectedMemories.filter((memory) => !packedMemoryIds.has(memory.id));
	const legacyMemoryBullets = legacyMemories.map(
		(memory) => `- [${memory.code || "-"}] ${memory.title}: ${memory.content.slice(0, 120)}`
	);
	// TASK-029: the legacy block is rendered OUTSIDE packing, so its cost is not
	// part of packed.estimatedTokens. Report it explicitly so the effective
	// payload size is visible rather than silently exceeding the budget.
	const legacyMemoryTokens = legacyMemoryBullets.reduce((sum, bullet) => sum + estimateTokens(bullet), 0);

	const sections = [`--- Active Context for "${repo}" ---`, "", "== Relevant Memories =="];
	sections.push(...(legacyMemoryBullets.length ? legacyMemoryBullets : ["(No relevant memories selected)"]));
	sections.push("", "== Compiled Context ==");
	sections.push(
		...(packed.included.length
			? packed.included.map((item) => `- [${item.source}/${item.reference}] ${item.title}: ${item.text.slice(0, 180)}`)
			: ["(No candidates fit the requested budget)"])
	);
	sections.push(
		"",
		`Estimated ${packed.estimatedTokens}/${validated.budget.tokens} tokens across ${packed.included.length} items.`,
		`Legacy memory block: ~${legacyMemoryTokens} tokens (${legacyMemories.length} items).`
	);
	const contentSummary = sections.join("\n").trim();
	const sourceAllocation = Object.fromEntries(
		AGENT_CONTEXT_SOURCE_ORDER.map((source) => [
			source,
			{
				included: packed.included.filter((item) => item.source === source).length,
				excluded: packed.exclusions.filter((item) => item.source === source).length,
				estimated_tokens: packed.included
					.filter((item) => item.source === source)
					.reduce((sum, item) => sum + item.estimated_tokens, 0)
			}
		])
	) as Record<AgentContextSource, { included: number; excluded: number; estimated_tokens: number }>;
	const observationIds = packed.included.filter((item) => item.source === "observations").map((item) => item.id);
	const evidencePointers = packed.included
		.filter((item) => item.source === "observations")
		.reduce((sum, item) => sum + Number(item.provenance.evidence_count ?? 0), 0);
	const staleRejected =
		reuseTelemetry.isEnabled() && !validated.include_stale && enabled.has("observations")
			? db.explorationObservations
					.list({ owner, repo, include_stale: true, limit: candidateLimit, offset: 0 })
					.filter((observation) => observation.freshness !== "valid" || observation.superseded_by).length
			: 0;
	const structuredData = {
		schema: "agent-context" as const,
		mode: "compiled" as const,
		context_pack_id: contextPackId,
		repo,
		query: objective || null,
		objective: objective || null,
		memories: selectedMemories.map((memory) => ({
			id: memory.id,
			code: memory.code || null,
			title: memory.title,
			type: memory.type,
			importance: memory.importance
		})),
		decisions: selectedDecisions.map((decision) => ({
			id: decision.id,
			code: decision.code || null,
			title: decision.title,
			importance: decision.importance
		})),
		tasks: selectedTasks.map((task) => ({
			task_code: task.task_code,
			title: task.title,
			status: task.status,
			priority: task.priority
		})),
		context: packed.included.map(
			({ priority: _priority, critical: _critical, reference: _reference, ...item }) => item
		),
		estimated_tokens: packed.estimatedTokens,
		budget: validated.budget,
		allocation: {
			included_items: packed.included.length,
			excluded_items: packed.exclusions.length,
			sources: sourceAllocation
		},
		exclusions: packed.exclusions
	};

	reuseTelemetry.recordContextPack({
		owner,
		repo,
		session: validated.session_id,
		packId: contextPackId,
		cacheLookup: Boolean(validated.context_pack_id),
		cacheHit: false,
		allocation: sourceAllocation,
		observationIds,
		memoryIds: packed.included
			.filter((item) => item.source === "memories" || item.source === "decisions")
			.map((item) => item.id),
		evidencePointers,
		staleRejected
	});
	const response = createMcpResponse(structuredData, contentSummary, { contentSummary, includeJson: isJsonRequest });
	if (validated.context_pack_id) {
		reuseTelemetry.cachePack(contextPackId, {
			response,
			allocation: sourceAllocation,
			observationIds,
			memoryIds: packed.included
				.filter((item) => item.source === "memories" || item.source === "decisions")
				.map((item) => item.id),
			evidencePointers
		});
	}
	reuseTelemetry.flushIfNeeded(db);
	logger.info("[Tool] agent-context", {
		repo,
		contextPackId,
		included: packed.included.length,
		excluded: packed.exclusions.length,
		estimatedTokens: packed.estimatedTokens
	});
	return response;
}
