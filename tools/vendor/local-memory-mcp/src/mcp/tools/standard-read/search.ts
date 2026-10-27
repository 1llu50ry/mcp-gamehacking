/**
 * standard-read/search — hybrid search (vector + keyword + recency + domain).
 *
 * Implements hybrid scoring per SPEC-001:
 *   0.40 similarity + 0.30 keyword + 0.15 recency + 0.15 domain
 */

import { CodingStandardEntry, VectorStore } from "../../types";
import { SQLiteStore } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { buildTableResult, createMcpResponse, McpResponse } from "../../utils/mcp-response";
import { expandQuery } from "../../utils/query-expander";
import { fetchAggregatedKgContext } from "../kg-archivist/query";
import { StandardReadInput } from "../schemas/index";
import type { HybridScores } from "../../utils/scoring";
import { STANDARD_SCORING } from "../../utils/scoring";
import { HybridSearchEngine } from "../../utils/hybrid-search";
import { SEARCH_THRESHOLDS } from "../../utils/constants";
import { renderGroupedSummary } from "../../utils/summary";
import { parseTaggedQuery, unionStrings, STANDARD_READ_TAG_KEYS } from "../../utils/query-tags";

// ── SPEC-001 Hybrid weights ──────────────────────────────────────────────
// All scoring paths now blend through the shared HybridSearchEngine
// (utils/hybrid-search): 0.40 similarity + 0.30 keyword + 0.15 recency +
// 0.15 domain (HYBRID_WEIGHTS from utils/scoring).
// Recency/domain/confidence live in STANDARD_SCORING (utils/scoring.ts,
// OPT-DRY-04) — see its docblock for the standard-specific semantics
// (e^(-age/180d) recency on last_used_at ?? updated_at, filter-driven
// domain, 0.72/0.42 final-score + keyword-OR confidence buckets).

// ── Search Result columns ────────────────────────────────────────────────

const SEARCH_COLUMNS = [
	"code",
	"id",
	"title",
	"context",
	"language",
	"scope",
	"tags",
	"confidence",
	"score",
	"matched_terms",
	"updated_at"
] as const;

// ── Scoring helpers ──────────────────────────────────────────────────────

function tokenizeSearchText(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2);
}

function scoreKeywordRelevance(query: string, standard: CodingStandardEntry): number {
	const queryTokens = Array.from(new Set(tokenizeSearchText(query)));
	if (queryTokens.length === 0) return 0;

	const titleText = standard.title.toLowerCase();
	const contextText = standard.context.toLowerCase();
	const tagText = standard.tags.join(" ").toLowerCase();
	const stackText = standard.stack.join(" ").toLowerCase();
	const contentText = standard.content.toLowerCase();
	const queryPhrase = query.trim().toLowerCase();

	let titleMatches = 0;
	let contextMatches = 0;
	let tagMatches = 0;
	let stackMatches = 0;
	let contentMatches = 0;

	for (const token of queryTokens) {
		if (titleText.includes(token)) titleMatches += 1;
		if (contextText.includes(token)) contextMatches += 1;
		if (tagText.includes(token)) tagMatches += 1;
		if (stackText.includes(token)) stackMatches += 1;
		if (contentText.includes(token)) contentMatches += 1;
	}

	const titleCoverage = titleMatches / queryTokens.length;
	const contextCoverage = contextMatches / queryTokens.length;
	const tagCoverage = tagMatches / queryTokens.length;
	const stackCoverage = stackMatches / queryTokens.length;
	const contentCoverage = contentMatches / queryTokens.length;
	const exactPhraseBonus =
		queryPhrase.length >= 6 &&
		(titleText.includes(queryPhrase) || contentText.includes(queryPhrase) || tagText.includes(queryPhrase))
			? 0.2
			: 0;

	return Math.min(
		1,
		titleCoverage * 0.45 +
			contextCoverage * 0.15 +
			tagCoverage * 0.15 +
			stackCoverage * 0.05 +
			contentCoverage * 0.2 +
			exactPhraseBonus
	);
}

function collectMatchedTerms(query: string, standard: CodingStandardEntry): string[] {
	const queryTokens = Array.from(new Set(tokenizeSearchText(query)));
	if (queryTokens.length === 0) return [];

	const searchableFields = [
		standard.title.toLowerCase(),
		standard.context.toLowerCase(),
		standard.tags.join(" ").toLowerCase(),
		standard.stack.join(" ").toLowerCase(),
		standard.content.toLowerCase()
	];

	return queryTokens.filter((token) => searchableFields.some((field) => field.includes(token)));
}

// ── Search handler ──────────────────────────────────────────────────────

export async function handleSearchMode(
	validated: StandardReadInput,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	// Defensive inline tag extraction (TASK-443): pull `key:value` filters out of
	// the free-text query so non-compliant callers still get correct filtering,
	// and strip them from the residual text so FTS won't see "language:php".
	const tagged = parseTaggedQuery(validated.query || "", STANDARD_READ_TAG_KEYS);
	const tf = tagged.filters as {
		language?: string;
		context?: string;
		version?: string;
		is_global?: boolean;
		stack?: string[];
		tags?: string[];
		scope?: { owner?: string; repo?: string };
	};
	const cleanQuery = tagged.query;

	// Merge rule (union/B): arrays union+dedupe; scalar inline (tag) wins if
	// present else fill gap; owner/repo scope is protected (structured wins).
	const stack = unionStrings(validated.stack, tf.stack);
	const tags = unionStrings(validated.tags, tf.tags);
	const language = tf.language ?? validated.language;
	const context = tf.context ?? validated.context;
	const version = tf.version ?? validated.version;
	const is_global = "is_global" in tf ? tf.is_global : validated.is_global;

	const searchQuery = expandQuery(cleanQuery, undefined);

	const fetchLimit = (validated.offset + validated.limit) * 3;
	const similarityResults = searchQuery
		? db.standards.searchBySimilarity(searchQuery, {
				context,
				version,
				language,
				stack,
				tags,
				repo: validated.repo,
				is_global,
				limit: fetchLimit
			})
		: db.standards
				.search({
					context,
					version,
					language,
					stack: stack[0],
					tag: tags[0],
					repo: validated.repo,
					is_global,
					limit: fetchLimit,
					offset: 0
				})
				.map((standard) => ({ ...standard, similarity: 0.5 }));

	const domainFilters = {
		stack,
		tags,
		language,
		context
	};

	// Per-entity signal computation (OPT-DRY-01): the engine owns vector+keyword
	// merge, sort, threshold, guarantee-at-least-1, and pagination; this file
	// keeps ONLY the candidate fetch + keyword/recency/domain signal scoring.
	// All three paths (main, vector-only, error fallback) share the canonical
	// SPEC-001 blend — the engine's scoreHybrid — with each signal in its own
	// slot (the old bit-exact remainingWeight expression was exactly this).
	const standardSignals = (standard: CodingStandardEntry, similarity: number): HybridScores => ({
		similarity,
		keyword: scoreKeywordRelevance(cleanQuery, standard),
		recency: STANDARD_SCORING.recency(standard),
		domain: STANDARD_SCORING.domain(standard, domainFilters)
	});

	// ONNX vector search only powers the vector-only fallback (when TF
	// similarity produced no candidates). Skip it on the main path where
	// its result would be discarded — saves one full inference per search.
	const needsVectorFallback = Boolean(searchQuery) && similarityResults.length === 0;
	const vectorResults = needsVectorFallback
		? await vectors.search(searchQuery, validated.limit, validated.repo, "standard").catch((error) => {
				logger.warn("Standard vector search failed, using similarity only", { error: String(error) });
				return null;
			})
		: [];

	let vectorEntities: ReadonlyMap<string, CodingStandardEntry> = new Map();
	if (vectorResults && vectorResults.length > 0) {
		// A DB failure fetching the entities (SQLITE_BUSY/corruption) must NOT
		// reject the whole search — degrade to an empty map, dropping only the
		// vector-only fallback (mirrors memory.read / task-read guards).
		try {
			const fetched = db.standards.getByIds(vectorResults.map((row) => row.id));
			vectorEntities = new Map(fetched.map((standard) => [standard.id, standard]));
		} catch (error) {
			logger.warn("Standard vector-entity fetch failed, dropping vector-only fallback", { error: String(error) });
		}
	}

	const { items, total } = HybridSearchEngine.run<CodingStandardEntry>({
		candidates: similarityResults.map((candidate) => ({ entity: candidate, similarity: candidate.similarity })),
		queryTerms: cleanQuery.split(/\s+/).filter(Boolean),
		vectorResults,
		vectorEntities,
		scorer: {
			idOf: (standard) => standard.id,
			scoreCandidate: (standard, similarity) => standardSignals(standard, similarity),
			scoreVectorOnly: (standard, hit) => standardSignals(standard, hit.score),
			scoreFallback: (standard, similarity) => standardSignals(standard, similarity)
		},
		thresholds: SEARCH_THRESHOLDS.standard,
		merge: "fallback",
		offset: validated.offset,
		limit: validated.limit
	});

	// Rebuild the scored shape expected downstream — matchedTerms + confidence
	// are per-entity domain/confidence scoring computed after the engine blend
	// (confidence depends on the final score).
	const paginatedResults = items.map((scored) => ({
		standard: scored.entity,
		similarityScore: scored.similarityScore,
		keywordScore: scored.keywordScore,
		recencyScore: scored.recencyScore,
		domainScore: scored.domainScore,
		matchedTerms: collectMatchedTerms(cleanQuery, scored.entity),
		finalScore: scored.finalScore,
		confidence: STANDARD_SCORING.confidence({ finalScore: scored.finalScore, keywordScore: scored.keywordScore })
	}));
	// NOTE: hit_count intentionally NOT incremented on read/search

	logger.info("[Tool] standard-read - searched coding standards", {
		resultCount: paginatedResults.length,
		stack: validated.stack,
		language: validated.language,
		context: validated.context,
		version: validated.version,
		topConfidence: paginatedResults[0]?.confidence
	});

	const rows = paginatedResults.map(({ standard, confidence, finalScore, matchedTerms }) => [
		standard.code ?? "-",
		standard.id,
		standard.title,
		standard.context,
		standard.language || "-",
		standard.is_global ? "global" : standard.repo || "-",
		standard.tags.join(", "),
		confidence,
		Number(finalScore.toFixed(3)),
		matchedTerms.join(", "),
		standard.updated_at
	]);

	let contentSummary: string;
	if (paginatedResults.length > 0) {
		const displayCount = paginatedResults.length;
		const parts = [`### Results: ${total} standards for "${validated.query || ""}" (showing ${displayCount})`, ""];

		// Fused grouped by scope (global first, then repo names, then "-" for null)
		// Sort keys: global first, then repo names alphabetically, then "-" last
		const scopeSort = (a: string, b: string): number => {
			if (a === "global" && b !== "global") return -1;
			if (b === "global" && a !== "global") return 1;
			if (a === "-" && b !== "-") return 1;
			if (b === "-" && a !== "-") return -1;
			return a.localeCompare(b);
		};

		parts.push(
			renderGroupedSummary({
				items: paginatedResults,
				getGroup: (scored) => (scored.standard.is_global ? "global" : scored.standard.repo || "-"),
				groupOrder: scopeSort,
				formatLine: (scored, rank) =>
					`#${rank} ${scored.standard.code ?? "-"} [${scored.finalScore.toFixed(2)}] ${scored.standard.title}`,
				footer: "Use standard-read with code for full content."
			})
		);
		contentSummary = parts.join("\n");
	} else {
		contentSummary = "No matching coding standards found.";
	}

	const responseData = buildTableResult(SEARCH_COLUMNS, rows, {
		schema: "standard-read",
		mode: "search",
		key: "results",
		count: paginatedResults.length,
		total,
		offset: validated.offset,
		limit: validated.limit,
		extra: { query: validated.query || "" }
	});

	// Best-effort KG context (REFACTOR-KG-005) — gated on the json flag
	// (audit F3/F4): `kg` only ships inside `structuredContent`.
	if (validated.json && paginatedResults.length > 0) {
		const kgData = fetchAggregatedKgContext(
			db,
			validated.repo ?? "",
			paginatedResults.map((r) => r.standard.title),
			"standard"
		);
		if (kgData) responseData.kg = kgData;
	}

	return createMcpResponse(responseData, `Found ${total} coding standards matching your query`, {
		contentSummary,
		structuredContentPathHint: "results",
		// Audit F4: was hardcoded `true` — the `json` flag was silently ignored
		// in search mode while detail mode honored it.
		includeJson: validated.json
	});
}
