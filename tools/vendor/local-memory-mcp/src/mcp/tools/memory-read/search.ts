/**
 * memory-read/search — SEARCH mode handler (hybrid vector + keyword + recency
 * + domain scoring).
 *
 * Split from memory.read.ts (TASK-555) — this was the ~294-line dominant
 * handler in the old single-file orchestrator. Public behavior is unchanged:
 *
 *   query present → SEARCH via db.memoryVectors.searchBySimilarity +
 *   FTS bm25 keyword feed + HybridSearchEngine blend (SPEC-001: 0.40
 *   similarity + 0.30 keyword + 0.15 recency + 0.15 domain), time-tunnel
 *   window post-filter, then grouped text output + pointer-table structured
 *   content + best-effort KG enrichment (json-only).
 *
 * No hit_count increments on read.
 */

import type { MemoryEntry, VectorResult, VectorStore } from "../../types";
import type { SQLiteStore } from "../../storage/sqlite";
import { buildTableResult, createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import { logger } from "../../utils/logger";
import { expandQuery } from "../../utils/query-expander";
import { parseRelativeDate, type TimeTunnelResult } from "../time-tunnel";
import { MEMORY_SCORING } from "../../utils/scoring";
import { HybridSearchEngine } from "../../utils/hybrid-search";
import {
	SEARCH_THRESHOLDS,
	MEMORY_UNACKNOWLEDGED_DOMAIN_BOOST,
	MEMORY_TASK_ARCHIVE_DOMAIN_PENALTY
} from "../../utils/constants";
import { isMemoryAcknowledged } from "../../utils/memory-utils";
import { renderGroupedSummary, enumOrderComparator, formatOutputLegend } from "../../utils/summary";
import { FTS_CANDIDATE_CAP } from "../../utils/fts";
import { parseTaggedQuery, unionStrings, MEMORY_READ_TAG_KEYS } from "../../utils/query-tags";
import type { MemoryReadInput } from "../schemas/index";
import { fetchGatedMemoryKgContext } from "./kg";
import { ackMarker, MEMORY_COLUMNS, memoryPointerRow } from "./shared";

// ── Constants ───────────────────────────────────────────────────────────────

// Group order for the fused by-type summary renderer (enum order).
const TYPE_ORDER = ["code_fact", "decision", "mistake", "pattern", "task_archive"];

// ── Scoring helpers ─────────────────────────────────────────────────────────

/**
 * Memory domain signal with TASK-423 knowledge-debt adjustments, riding the
 * shared 0.15 domain slot WITHOUT touching the hybrid engine:
 *   - unacknowledged memories (+MEMORY_UNACKNOWLEDGED_DOMAIN_BOOST) surface
 *     above equal-relevance acknowledged ones for work queries,
 *   - task_archive completion records (−MEMORY_TASK_ARCHIVE_DOMAIN_PENALTY)
 *     no longer dominate work queries via "Task"-in-title keyword collision.
 */
function memoryDomainSignal(memory: MemoryEntry, queryTerms: string[]): number {
	let domain = MEMORY_SCORING.domain(memory, { queryTerms });
	if (!isMemoryAcknowledged(memory)) domain += MEMORY_UNACKNOWLEDGED_DOMAIN_BOOST;
	if (memory.type === "task_archive") domain -= MEMORY_TASK_ARCHIVE_DOMAIN_PENALTY;
	return Math.max(0, Math.min(1, domain));
}

/**
 * Time Tunnel created_at window filter, applied by the hybrid engine's
 * postFilter hook AFTER threshold/guarantee and BEFORE pagination.
 */
function applyTimeFilter(memories: MemoryEntry[], tunnel: TimeTunnelResult): MemoryEntry[] {
	const sinceMs = tunnel.since ? new Date(tunnel.since).getTime() : 0;
	const untilMs = tunnel.until ? new Date(tunnel.until).getTime() : Infinity;
	return memories.filter((m: MemoryEntry) => {
		const createdAtMs = new Date(m.created_at).getTime();
		if (sinceMs > 0 && createdAtMs < sinceMs) return false;
		if (untilMs < Infinity && createdAtMs >= untilMs) return false;
		return true;
	});
}

// ── Search handler ──────────────────────────────────────────────────────────

export async function handleSearchMode(
	params: MemoryReadInput,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	// Defensive inline tag extraction (TASK-443): pull `key:value` filters out of
	// the free-text query so non-compliant callers still get correct filtering,
	// and strip them from the residual text so FTS won't see "language:php".
	const tagged = parseTaggedQuery(params.query!, MEMORY_READ_TAG_KEYS);
	const tf = tagged.filters as {
		current_tags?: string[];
		current_file_path?: string;
		scope?: { language?: string; branch?: string; folder?: string; owner?: string; repo?: string };
	};
	const cleanQuery = tagged.query;

	// Merge rule (union/B): current_tags union+dedupe; scope branch inline wins
	// if present else fill gap; owner/repo scope is protected (structured wins).
	const currentTags = unionStrings(params.current_tags, tf.current_tags);
	const currentFilePath = tf.current_file_path ?? params.current_file_path;
	const scopeBranch = tf.scope?.branch ?? params.scope?.branch;
	// Inline `lang:`/`language:`/`folder:` tags (TASK-443) populate
	// `tf.scope.language`/`tf.scope.folder`; the structured `scope.language`/
	// `scope.folder` params fall back here. Both must feed the affinity boost
	// (TASK-444) so inline tags rank identically to the structured params.
	const queryLang = tf.scope?.language ?? params.scope?.language;
	const queryFolder = tf.scope?.folder ?? params.scope?.folder;

	// Time Tunnel: extract relative date phrases
	const timeTunnel = parseRelativeDate(cleanQuery);
	const effectiveQuery = timeTunnel ? timeTunnel.cleanedQuery : cleanQuery;
	const searchQuery = expandQuery(effectiveQuery);

	// 1. Get candidates from SQLite similarity
	const fetchLimit = (params.offset + params.limit) * 3;
	const similarityResults = db.memoryVectors.searchBySimilarity(
		searchQuery,
		params.owner,
		params.repo,
		fetchLimit,
		params.include_archived,
		currentTags
	);

	interface Candidate {
		memory: MemoryEntry;
		similarityScore: number;
	}

	let candidates: Candidate[] = similarityResults.map((r: MemoryEntry & { similarity: number }) => ({
		memory: r as MemoryEntry,
		similarityScore: r.similarity
	}));

	// 1a. FTS bm25 keyword signal (MEM-367 §6) — feeds the 0.30 keyword
	// hybrid weight with real lexical relevance instead of the ONNX rerank.
	// Uses the post-time-tunnel query (NOT the expanded one — injected
	// synonyms would wrongly restrict lexical matches). Raw bm25() is unitless
	// and non-positive (most negative = best); min-max normalization over the
	// top-k set maps best → 1.0, worst → ≈0 (self-contained per query, no
	// calibration drift). FTS-only hits are merged in as extra candidates
	// (similarity 0) so token-initial lexical recall surfaces even when vector
	// similarity misses. Any FTS failure only disables the bm25 feed — the
	// vector/similarity pipeline below is unaffected.
	const ftsScoreMap = new Map<string, number>();
	try {
		const ftsScored = db.memories.searchByFtsScored(effectiveQuery, params.owner, params.repo, {
			limit: FTS_CANDIDATE_CAP,
			includeArchived: params.include_archived
		});
		if (ftsScored.length > 0) {
			let minB = Number.POSITIVE_INFINITY;
			let maxB = Number.NEGATIVE_INFINITY;
			for (const r of ftsScored) {
				if (r.bm25 < minB) minB = r.bm25;
				if (r.bm25 > maxB) maxB = r.bm25;
			}
			const range = maxB - minB;
			for (const r of ftsScored) {
				const normalized = range === 0 ? 1.0 : 1 - (r.bm25 - minB) / range;
				ftsScoreMap.set(r.memory.id, normalized);
			}
			const knownIds = new Set(candidates.map((c) => c.memory.id));
			for (const r of ftsScored) {
				if (!knownIds.has(r.memory.id)) {
					knownIds.add(r.memory.id);
					candidates.push({ memory: r.memory, similarityScore: 0 });
				}
			}
		}
	} catch (error) {
		logger.warn("FTS keyword search failed, using vector keyword only", { error: String(error) });
	}

	// 2. Workspace & Tag Affinity Boost
	if (candidates.length > 0) {
		const currentPath = currentFilePath?.toLowerCase();
		const currentTagsLc = currentTags.map((tag: string) => tag.toLowerCase());
		const currentBranch = scopeBranch;
		// Structured `scope.language`/`scope.folder` and the inline `lang:`/
		// `folder:` tags resolve into these (see merge rule above). They feed the
		// same affinity-boost shape as `scopeBranch`/`currentPath` (TASK-444) so
		// inline `lang:php` / `folder:src/foo` rank like the structured params.
		const queryLangLc = queryLang?.toLowerCase();
		const queryFolderLc = queryFolder?.toLowerCase();

		candidates = candidates.map((c: Candidate) => {
			let boost = 0;
			if (currentBranch && c.memory.scope.branch === currentBranch) boost += 0.1;
			if (currentPath && c.memory.scope.folder && currentPath.includes(c.memory.scope.folder.toLowerCase()))
				boost += 0.15;
			if (currentPath && c.memory.scope.language) {
				const ext = currentPath.split(".").pop();
				if (ext && ext.includes(c.memory.scope.language.toLowerCase())) boost += 0.1;
			}
			// Structured `scope.folder` / inline `folder:` affinity.
			if (queryFolderLc && c.memory.scope.folder && queryFolderLc.includes(c.memory.scope.folder.toLowerCase()))
				boost += 0.15;
			// Structured `scope.language` / inline `lang:` affinity.
			if (queryLangLc && c.memory.scope.language && queryLangLc.includes(c.memory.scope.language.toLowerCase()))
				boost += 0.1;
			if (currentTagsLc.length > 0 && c.memory.tags.some((tag: string) => currentTagsLc.includes(tag.toLowerCase())))
				boost += 0.2;
			return { ...c, similarityScore: Math.min(1.0, c.similarityScore + boost) };
		});
	}

	// 3. Hybrid scoring through the shared engine (OPT-DRY-01). The engine
	// owns vector+keyword merge, sort by composite score, threshold,
	// guarantee-at-least-1, the time-tunnel post-filter, and pagination.
	// This file keeps ONLY the candidate fetch + domain/recency signal
	// computation (EntityScorer below).
	const queryTerms = searchQuery.split(/\s+/).filter(Boolean);

	// Vector re-rank only matters when the candidate pool is empty (vector-only
	// fallback). Skip the inference when similarity/FTS produced candidates —
	// its result would be discarded anyway, so this saves one full inference
	// per search (mirrors standard-read's needsVectorFallback).
	let vectorResults: VectorResult[] | null;
	let vectorEntities: ReadonlyMap<string, MemoryEntry> = new Map();
	if (candidates.length === 0) {
		try {
			vectorResults = await vectors.search(searchQuery, 10, params.repo);
			if (vectorResults.length > 0) {
				const fetched = db.memories.getByIds(vectorResults.map((vr) => vr.id));
				vectorEntities = new Map(fetched.map((m: MemoryEntry) => [m.id, m]));
			}
		} catch (error) {
			logger.warn("Vector search failed, using similarity only", { error: String(error) });
			vectorResults = null;
		}
	} else {
		vectorResults = [];
	}

	const { items: scoredResult, total } = HybridSearchEngine.run<MemoryEntry>({
		candidates: candidates.map((c: Candidate) => ({ entity: c.memory, similarity: c.similarityScore })),
		queryTerms,
		vectorResults,
		vectorEntities,
		scorer: {
			idOf: (memory) => memory.id,
			scoreCandidate: (memory, similarity, terms) => ({
				// bm25 (min-max normalized) feeds the 0.30 keyword weight
				// (MEM-367 §6.2): lexical relevance, not vector rerank, powers
				// the keyword signal.
				similarity,
				keyword: ftsScoreMap.get(memory.id) ?? 0,
				recency: MEMORY_SCORING.recency(memory),
				// TASK-423: unacknowledged boost + task_archive penalty ride the
				// domain slot (engine untouched).
				domain: memoryDomainSignal(memory, terms)
			}),
			scoreVectorOnly: (memory, hit, terms) => ({
				similarity: hit.score,
				keyword: 0,
				recency: MEMORY_SCORING.recency(memory),
				domain: memoryDomainSignal(memory, terms)
			}),
			scoreFallback: (memory, similarity, terms) => ({
				similarity,
				keyword: ftsScoreMap.get(memory.id) ?? 0,
				recency: MEMORY_SCORING.recency(memory),
				domain: memoryDomainSignal(memory, terms)
			})
		},
		thresholds: SEARCH_THRESHOLDS.memory,
		merge: "fallback",
		offset: params.offset,
		limit: params.limit,
		// 4a. Time Tunnel post-filter (window check on created_at), applied
		// after threshold/guarantee and before pagination.
		postFilter: (eligible) => {
			if (!timeTunnel) return eligible;
			const kept = applyTimeFilter(
				eligible.map((s) => s.entity),
				timeTunnel
			);
			const keptIds = new Set(kept.map((m: MemoryEntry) => m.id));
			return eligible.filter((s) => keptIds.has(s.entity.id));
		}
	});

	const paginatedResults = scoredResult.map((s) => s.entity);

	// CRITICAL: No hit_count increment on search

	logger.info("[Tool] memory.read (search)", {
		repo: params.repo,
		query: params.query,
		total,
		offset: params.offset,
		returned: paginatedResults.length
	});

	// 5. Prepare Output
	const rows = paginatedResults.map(memoryPointerRow);

	let contentSummary: string;
	if (paginatedResults.length > 0) {
		const parts: string[] = [];

		// Header: query + pagination. (showing N) = paginated result rows fed
		// to the grouped renderer; unackedCount is the work-queue signal.
		const unackedCount = paginatedResults.filter((m: MemoryEntry) => !isMemoryAcknowledged(m)).length;
		parts.push(
			`### Results: ${total} memories for "${params.query}" (showing ${paginatedResults.length} · ${unackedCount} unacknowledged)`
		);
		// Shared metadata legend (TASK-424): documents [N] = importance (1–5)
		// and the per-group cap (+N more). task_archive is capped at 2 (see
		// `cap` below) — noted in the legend string for transparency.
		parts.push(
			formatOutputLegend({
				scoreLabel: "importance",
				scoreRange: "1–5",
				groupBy: "type",
				perGroupCap: "5 (task_archive 2)"
			})
		);
		parts.push("");

		// Fused grouped by type (enum order), with global rank #N
		parts.push(
			renderGroupedSummary<MemoryEntry>({
				items: paginatedResults,
				getGroup: (m) => m.type || "unknown",
				groupOrder: enumOrderComparator(TYPE_ORDER),
				cap: (key) => (key === "task_archive" ? 2 : 5),
				formatLine: (m, rank) => `#${rank} ${m.code || "-"} [${m.importance}] ${m.title}${ackMarker(m)}`,
				footer: "Use memory-read with id (or code) for full content."
			})
		);
		contentSummary = parts.join("\n");
	} else {
		contentSummary = `No memories found for "${params.query}" in repo "${params.repo}".`;
	}

	const structuredData = buildTableResult(MEMORY_COLUMNS, rows, {
		schema: "memory-read",
		mode: "search",
		count: paginatedResults.length,
		total,
		offset: params.offset,
		limit: params.limit
	});

	// Best-effort KG context (REFACTOR-KG-003) — gated on `params.json`
	// (audit F3): `kg` only ships inside `structuredContent`, so text-mode
	// reads skip the dominant-cost KG lookup entirely.
	const kgData = fetchGatedMemoryKgContext(db, params.repo, paginatedResults, params.json);
	if (kgData) structuredData.kg = kgData;

	return createMcpResponse(structuredData, contentSummary, {
		contentSummary,
		structuredContentPathHint: "rows",
		includeJson: params.json
	});
}
