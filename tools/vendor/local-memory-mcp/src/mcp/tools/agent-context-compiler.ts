import type { CodebaseSymbol, CodingStandardEntry, ExplorationObservation, Handoff, MemoryEntry, Task } from "../types";
import { TASK_STATUS_IN_PROGRESS } from "../types";

export const AGENT_CONTEXT_SOURCE_ORDER = [
	"tasks",
	"decisions",
	"handoffs",
	"standards",
	"observations",
	"code",
	"memories"
] as const;
export type AgentContextSource = (typeof AGENT_CONTEXT_SOURCE_ORDER)[number];

export interface ContextCandidate {
	source: AgentContextSource;
	id: string;
	/**
	 * Compact, human-facing reference rendered in the compiled context block
	 * (TASK-431), e.g. `MEM-189`. Defaults to `id`; entity types that expose a
	 * stable short `code` (memories/decisions) set it to that code so every
	 * pack does not repeat a 36-char UUID. Kept SEPARATE from `id` on purpose:
	 * `id` stays the canonical UUID because it drives dedup, telemetry, and
	 * tie-break ordering, which must not change.
	 */
	reference: string;
	title: string;
	text: string;
	provenance: Record<string, unknown>;
	priority: number;
	critical: boolean;
	estimated_tokens: number;
}

export interface ContextExclusion {
	source: AgentContextSource;
	id: string;
	reason: "token_budget" | "item_budget" | "below_relevance";
	estimated_tokens: number;
}

/**
 * Minimum lexical relevance a `decisions` candidate must reach before it is
 * treated as critical (TASK-026). Previously every decision was unconditionally
 * critical, so a repo with many decisions flooded the pack ahead of actually
 * relevant context. Decisions are now promoted to critical only when the
 * objective overlaps their text at or above this score.
 *
 * When the caller sets `budget.min_relevance > 0` that explicit threshold is
 * used instead (the two knobs are intentionally coupled so a caller that
 * demands relevance cannot still get an irrelevant decision marked critical).
 */
export const DECISION_CRITICAL_MIN_SCORE = 0.34;

/**
 * Token-estimation constants (TASK-030).
 *
 * `estimateTokens` is a cheap character-count heuristic, not a real tokenizer.
 * A single chars-per-token divisor is too coarse: prose averages ~4 chars per
 * token, but code/symbol text (identifiers, punctuation, short tokens) is
 * denser and tokenizes into MORE tokens per character. Using the prose divisor
 * for code UNDER-estimates its cost, so a code-heavy pack can overflow
 * `budget.tokens`. We therefore estimate code with a SMALLER divisor so code
 * items are estimated HIGHER (the safe direction: over-estimate, never
 * overflow).
 */
export const ESTIMATE_CHARS_PER_TOKEN_DEFAULT = 4;
export const ESTIMATE_CHARS_PER_TOKEN_CODE = 3;
export const ESTIMATE_TOKEN_FLOOR = 12;
export const ESTIMATE_TOKEN_OVERHEAD = 8;

/**
 * Per-source chars-per-token divisors. Sources absent from the map fall back to
 * `ESTIMATE_CHARS_PER_TOKEN_DEFAULT` (prose-like text). `code` is the only
 * denser source today; add entries here if another source needs a different
 * divisor.
 */
export const ESTIMATE_CHARS_PER_TOKEN_BY_SOURCE: Partial<Record<AgentContextSource, number>> = {
	code: ESTIMATE_CHARS_PER_TOKEN_CODE
};

/**
 * Estimates the token cost of `text`, optionally source-aware (TASK-030).
 * `source` selects the chars-per-token divisor (see
 * `ESTIMATE_CHARS_PER_TOKEN_BY_SOURCE`); omitting it uses the prose default.
 * Always returns at least `ESTIMATE_TOKEN_FLOOR` and always adds
 * `ESTIMATE_TOKEN_OVERHEAD` for framing.
 */
export function estimateTokens(text: string, source?: AgentContextSource): number {
	const divisor = (source && ESTIMATE_CHARS_PER_TOKEN_BY_SOURCE[source]) ?? ESTIMATE_CHARS_PER_TOKEN_DEFAULT;
	return Math.max(ESTIMATE_TOKEN_FLOOR, Math.ceil(text.length / divisor) + ESTIMATE_TOKEN_OVERHEAD);
}

function lexicalScore(text: string, objective: string): number {
	const terms = [
		...new Set(
			objective
				.toLocaleLowerCase("en-US")
				.split(/[^a-z0-9_/-]+/)
				.filter((term) => term.length > 1)
		)
	];
	if (terms.length === 0) return 0;
	const normalized = text.toLocaleLowerCase("en-US");
	return terms.filter((term) => normalized.includes(term)).length / terms.length;
}

function candidate(
	source: AgentContextSource,
	id: string,
	title: string,
	text: string,
	priority: number,
	critical: boolean,
	provenance: Record<string, unknown>,
	reference?: string
): ContextCandidate {
	return {
		source,
		id,
		reference: reference ?? id,
		title,
		text,
		priority,
		critical,
		provenance,
		estimated_tokens: estimateTokens(`${title}: ${text}`, source)
	};
}

export function rankAndPackContext(
	candidates: ContextCandidate[],
	objective: string,
	budget: { tokens: number; max_items: number; min_relevance?: number }
): { included: ContextCandidate[]; exclusions: ContextExclusion[]; estimatedTokens: number } {
	const sourceRank = new Map(AGENT_CONTEXT_SOURCE_ORDER.map((source, index) => [source, index]));
	const cleanObjective = objective.trim();
	const hasObjective = cleanObjective.length > 0;
	const minRelevance = budget.min_relevance ?? 0;
	// TASK-026: decisions are promoted to critical only when the objective
	// overlaps them enough. A caller-set min_relevance wins; otherwise fall back
	// to the internal constant. An empty objective yields no basis for
	// relevance, so decisions are never critical in that case.
	const decisionThreshold = minRelevance > 0 ? minRelevance : DECISION_CRITICAL_MIN_SCORE;
	const scored = candidates.map((item) => {
		const score = lexicalScore(`${item.title} ${item.text}`, cleanObjective);
		const critical = item.source === "decisions" ? hasObjective && score >= decisionThreshold : item.critical;
		return { item, score, critical };
	});
	const exclusions: ContextExclusion[] = [];
	// TASK-025: when the caller opts into a minimum relevance (and an objective
	// exists to measure against), drop irrelevant candidates before packing.
	// Critical candidates (e.g. an explicitly pinned task) are exempt so the
	// pin guarantee holds even when their text does not lexically match.
	const eligible =
		hasObjective && minRelevance > 0
			? scored.filter(({ item, score, critical }) => {
					if (!critical && score < minRelevance) {
						exclusions.push({
							source: item.source,
							id: item.id,
							reason: "below_relevance",
							estimated_tokens: item.estimated_tokens
						});
						return false;
					}
					return true;
				})
			: scored;
	const ranked = [...eligible].sort((a, b) => {
		if (a.critical !== b.critical) return a.critical ? -1 : 1;
		const valueA = (a.item.priority + a.score * 5) / a.item.estimated_tokens;
		const valueB = (b.item.priority + b.score * 5) / b.item.estimated_tokens;
		return (
			valueB - valueA ||
			(sourceRank.get(a.item.source) ?? 99) - (sourceRank.get(b.item.source) ?? 99) ||
			a.item.id.localeCompare(b.item.id)
		);
	});
	const included: ContextCandidate[] = [];
	let estimatedTokens = 0;
	for (const { item, critical } of ranked) {
		const reason =
			included.length >= budget.max_items
				? "item_budget"
				: estimatedTokens + item.estimated_tokens > budget.tokens
					? "token_budget"
					: null;
		if (reason) {
			exclusions.push({ source: item.source, id: item.id, reason, estimated_tokens: item.estimated_tokens });
			continue;
		}
		included.push({ ...item, critical });
		estimatedTokens += item.estimated_tokens;
	}
	return { included, exclusions, estimatedTokens };
}

export function memoryCandidate(memory: MemoryEntry, source: "memories" | "decisions"): ContextCandidate {
	// TASK-026: decisions are NOT unconditionally critical. Criticality is
	// decided in rankAndPackContext from lexical relevance to the objective
	// (see DECISION_CRITICAL_MIN_SCORE), so the builder stays neutral here.
	// TASK-431: render the stable short `code` in the pack label, falling back
	// to the UUID when the row has none (empty string counts as none).
	return candidate(
		source,
		memory.id,
		memory.title,
		memory.content.slice(0, 600),
		memory.importance,
		false,
		{
			code: memory.code ?? null,
			type: memory.type,
			updated_at: memory.updated_at
		},
		memory.code || undefined
	);
}

export function taskCandidate(task: Task, requestedTaskCode?: string): ContextCandidate {
	return candidate(
		"tasks",
		task.task_code,
		task.title,
		task.description?.slice(0, 500) ?? `${task.phase} · ${task.status}`,
		task.priority + (task.status === TASK_STATUS_IN_PROGRESS ? 2 : 0),
		task.task_code === requestedTaskCode,
		{ task_id: task.id, status: task.status, priority: task.priority, updated_at: task.updated_at }
	);
}

export function handoffCandidate(handoff: Handoff): ContextCandidate {
	return candidate(
		"handoffs",
		handoff.id,
		`Handoff from ${handoff.from_agent}`,
		handoff.summary.slice(0, 500),
		4,
		false,
		{
			task_code: handoff.task_code ?? null,
			to_agent: handoff.to_agent,
			created_at: handoff.created_at
		}
	);
}

export function standardCandidate(standard: CodingStandardEntry): ContextCandidate {
	return candidate(
		"standards",
		standard.code ?? standard.id,
		standard.title,
		standard.content.slice(0, 500),
		3,
		false,
		{
			code: standard.code ?? null,
			language: standard.language,
			version: standard.version
		}
	);
}

export function observationCandidate(observation: ExplorationObservation): ContextCandidate {
	return candidate(
		"observations",
		observation.id,
		observation.subject,
		observation.fact.slice(0, 500),
		observation.confidence * 5,
		false,
		{
			confidence: observation.confidence,
			freshness: observation.freshness,
			task_id: observation.task_id,
			evidence_count: observation.evidence_count
		}
	);
}

export function codeCandidate(symbol: CodebaseSymbol): ContextCandidate {
	return candidate("code", symbol.id, symbol.name, symbol.signature ?? symbol.kind, symbol.exported ? 4 : 2, false, {
		file_path: symbol.file_path,
		kind: symbol.kind,
		start_line: symbol.start_line,
		end_line: symbol.end_line
	});
}
