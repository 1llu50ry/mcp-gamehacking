import type { CodebaseReadInput } from "../schemas/codebase-read";
import { SQLiteStore } from "../../storage/sqlite";
import { VectorStore, type CodebaseSymbol } from "../../types";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import { rankSymbols, filterSymbols, RankTier, type RankedSymbol } from "../../codebase-index/services/symbol-ranking";
import { blendVectorRanking } from "../../codebase-index/services/vector-ranking";
import { CODEBASE_SEARCH_DEFAULT_LIMIT } from "../../utils/constants";
import { docSuffix } from "../../utils/doc-comment-format";
import { parseTaggedQuery, unionStrings, CODEBASE_READ_TAG_KEYS } from "../../utils/query-tags";

// ── MATCH KIND (issue #81) ───────────────────────────────────────────────

/** Whether a search result came from source code or from indexed documentation (Markdown). */
export type MatchKind = "source" | "documentation";

/**
 * Kinds produced only by the MarkdownVisitor — any row with one of these, or
 * with a `.md`/`.mdx` file path, is a documentation (doc-only) match.
 */
const DOCUMENTATION_KINDS: ReadonlySet<string> = new Set(["heading1", "heading2", "heading", "code_block"]);

/** File extensions treated as documentation regardless of symbol kind. */
const DOCUMENTATION_EXTENSIONS: ReadonlySet<string> = new Set([".md", ".mdx"]);

/** Max path-like tokens extracted from a single doc heading for the secondary lookup. */
const SECONDARY_LOOKUP_TOKEN_CAP = 3;

/** Total cap on secondary (related) source results attached to a SEARCH response. */
const SECONDARY_RELATED_CAP = 10;

/**
 * Derive the match kind for a search result. Markdown rows (heading/code_block
 * kinds from MarkdownVisitor, or `.md`/`.mdx` file paths) are classified as
 * "documentation"; everything else is source code.
 */
export function getMatchKind(symbol: Pick<CodebaseSymbol, "kind" | "file_path">): MatchKind {
	if (DOCUMENTATION_KINDS.has(symbol.kind)) return "documentation";
	const lower = symbol.file_path.toLowerCase();
	for (const ext of DOCUMENTATION_EXTENSIONS) {
		if (lower.endsWith(ext)) return "documentation";
	}
	return "source";
}

/**
 * Extract a bounded set of path-like tokens from a Markdown heading. Strips
 * Markdown formatting and backticks, then pulls out namespace-qualified /
 * path-like tokens such as `modules/Common` or `Vheins\Common\Models`. Returns
 * at most {@link SECONDARY_LOOKUP_TOKEN_CAP} tokens.
 */
export function extractReferencedTokens(heading: string): string[] {
	const plain = heading
		.replace(/`/g, " ")
		.replace(/[*_~[\]]/g, " ")
		.trim();
	const candidates = plain.match(/[\w\\/]+(?:[\\/][\w\\/]+)*/g) ?? [];
	const tokens: string[] = [];
	for (const candidate of candidates) {
		const trimmed = candidate.trim();
		if (trimmed.length < 3) continue;
		// Path-like: at least one separator (module path, namespace, or file path).
		if (!/[\\/]/.test(trimmed)) continue;
		if (!tokens.includes(trimmed)) tokens.push(trimmed);
		if (tokens.length >= SECONDARY_LOOKUP_TOKEN_CAP) break;
	}
	return tokens;
}

// ── BARREL-CANONICAL PREFERENCE (issue #87, TASK-013) ───────────────────

/**
 * A barrel file is an `index.*` module that re-exports from sibling/canonical
 * modules (e.g. `src/domain/index.ts`). Search results landing in a barrel file
 * are usually duplicates of the canonical declaration elsewhere — SEARCH
 * prefers the canonical declaration (issue #87).
 */
export function isBarrelFile(filePath: string): boolean {
	const base = filePath.split("/").pop() ?? filePath;
	return /^index\.(ts|tsx|js|jsx|mjs|cjs|d\.ts)$/.test(base);
}

/**
 * De-duplicate ranked search results so a canonical declaration wins over its
 * barrel-file duplicate (issue #87).
 *
 * For any symbol name that appears in BOTH a barrel file and a non-barrel
 * file, every barrel-file copy is dropped (the canonical copy keeps its rank).
 * When a name appears only in barrel files (no canonical sibling), all copies
 * are kept — never drop a result outright, only prefer canonical when one
 * exists. Other names (single occurrence, or collisions across two non-barrel
 * files) are passed through untouched.
 */
export function preferCanonicalSymbols(ranked: RankedSymbol[]): RankedSymbol[] {
	const byName = new Map<string, RankedSymbol[]>();
	for (const r of ranked) {
		const arr = byName.get(r.symbol.name) ?? [];
		arr.push(r);
		byName.set(r.symbol.name, arr);
	}

	const out: RankedSymbol[] = [];
	for (const group of byName.values()) {
		if (group.length === 1) {
			out.push(group[0]);
			continue;
		}
		const barrel = group.filter((r) => isBarrelFile(r.symbol.file_path));
		const canonical = group.filter((r) => !isBarrelFile(r.symbol.file_path));
		if (barrel.length > 0 && canonical.length > 0) {
			out.push(...canonical);
		} else {
			out.push(...group);
		}
	}
	return out;
}

// ── UNIFIED SEARCH ───────────────────────────────────────────────────────

/**
 * Build a grouped-by-file list of search results in token-efficient format.
 *
 * Format:
 *   ### Results: N symbols for "query" (showing M)
 *
 *   **file/path.ts**
 *   - `kind` name Lstart-Lend (score: 0.XX)
 */
function formatSearchResultsGrouped(
	results: Array<CodebaseSymbol & { rankTier: RankTier; score: number }>,
	total: number,
	query: string
): string {
	if (results.length === 0) return `### Results: 0 symbols for "${query}"`;

	let out = `### Results: ${total} symbols for "${query}" (showing ${results.length})\n`;

	// Group by file_path, preserving result order within each file
	const groups = new Map<string, Array<CodebaseSymbol & { rankTier: RankTier; score: number }>>();
	const groupOrder: string[] = [];
	for (const s of results) {
		if (!groups.has(s.file_path)) {
			groups.set(s.file_path, []);
			groupOrder.push(s.file_path);
		}
		groups.get(s.file_path)!.push(s);
	}

	for (const filePath of groupOrder) {
		const symbols = groups.get(filePath)!;
		out += `\n**${filePath}**\n`;
		for (const s of symbols) {
			const lineRange =
				s.start_line != null
					? s.end_line != null && s.end_line !== s.start_line
						? `L${s.start_line}-L${s.end_line}`
						: `L${s.start_line}`
					: "-";
			const scorePart = s.score != null ? ` (score: ${s.score.toFixed(2)})` : "";
			out += `- \`${s.kind}\` ${s.name} ${lineRange}${scorePart}${docSuffix(s.doc_comment)}\n`;
		}
	}

	return out;
}

/**
 * Unified search handler combining code-like 5-tier ranking with NL semantic search.
 *
 * Strategy:
 * 1. DB-level name search via getSymbolByName / LIKE
 * 2. If name search returns 0 AND query has spaces, try word-split content search
 * 3. Text ranking via SymbolRankingService (5 tiers: Exact → CamelCase → Prefix → Substring → FTS5)
 * 4. Vector similarity tiebreaker within each rank tier (semantic blending)
 * 5. Apply filters (kind, exportedOnly) + pagination
 */
async function handleSearchMode(
	validated: CodebaseReadInput,
	db: SQLiteStore,
	vectors: VectorStore
): Promise<McpResponse> {
	const rawQuery = (validated.query ?? "").trim();
	if (rawQuery.length < 2) {
		return createMcpResponse(
			{ schema: "codebase-read", symbols: [], total: 0, hasMore: false, mode: "search" },
			"Search query too short (minimum 2 characters)",
			{ includeJson: validated.json }
		);
	}
	// Defensive inline tag extraction (TASK-443): pull `key:value` filters out of
	// the free-text query so non-compliant callers still get correct filtering,
	// and strip them from the residual text so FTS won't see "language:php".
	// Symbol mode applies `kind`/`file`/`path`; `language` is CODE-mode only and
	// is ignored here.
	const tagged = parseTaggedQuery(validated.query ?? "", CODEBASE_READ_TAG_KEYS);
	const tf = tagged.filters as { kind?: string[]; filePath?: string; language?: string };
	const query = tagged.query;

	// Merge rule (union/B): kind union+dedupe with structured `validated.kind`.
	const kindMerged = unionStrings(
		Array.isArray(validated.kind) ? validated.kind : validated.kind ? [validated.kind] : [],
		tf.kind
	);
	const filePath = tf.filePath ?? validated.filePath;

	// Single kind stays a scalar (unchanged DB path `cs.kind = ?`); a multi-kind
	// OR (`kind:function,class`) is passed as an array so searchSymbols builds
	// `cs.kind IN (?, ?, ...)` at the DB level (TASK-445).
	const kindQuery: string | string[] | undefined =
		kindMerged.length === 1 ? kindMerged[0] : kindMerged.length > 1 ? kindMerged : undefined;

	// Cross-repo scope wins over single-repo scope. When `repos` is provided
	// (even alongside a session-injected `repo`), results are restricted to the
	// requested set and the single `repo` value is ignored.
	const repos = validated.repos && validated.repos.length > 0 ? validated.repos : undefined;
	const repo = repos && repos.length > 0 ? undefined : validated.repo;

	// Per-mode default limit (TASK-316): the schema no longer defaults `limit`
	// (was 50 for every mode), so SEARCH applies its historical default here —
	// behavior is unchanged for callers that omit it.
	const limit = validated.limit ?? CODEBASE_SEARCH_DEFAULT_LIMIT;

	// Phase 1: DB-level name search (LIKE on symbol name + kind/filePath filtering)
	const dbResult = db.codebaseSymbols.searchSymbols({
		query,
		repo,
		repos,
		kind: kindQuery,
		filePath,
		exportedOnly: validated.exportedOnly,
		limit: 200,
		offset: 0
	});

	let symbols: CodebaseSymbol[] = dbResult.symbols;

	// Apply in-memory filters as complement — filterSymbols accepts string[]
	symbols = filterSymbols(symbols, {
		kind: kindMerged,
		repo,
		repos,
		filePath,
		exportedOnly: validated.exportedOnly
	});

	// Phase 2: If name search returned 0 results AND query has spaces, try word-split search
	if (symbols.length === 0 && query.includes(" ")) {
		const words = query.split(/\s+/).filter((w) => w.length >= 2);
		for (const word of words) {
			const wordResult = db.codebaseSymbols.searchSymbols({
				query: word,
				repo,
				repos,
				kind: kindQuery,
				filePath,
				exportedOnly: validated.exportedOnly,
				limit: 200,
				offset: 0
			});
			if (wordResult.symbols.length > 0) {
				symbols = filterSymbols(wordResult.symbols, {
					kind: kindMerged,
					repo,
					repos,
					filePath,
					exportedOnly: validated.exportedOnly
				});
				break;
			}
		}
	}

	// Phase 3: Text ranking via SymbolRankingService (5 tiers)
	let ranked: RankedSymbol[] = rankSymbols(symbols, query);

	// Phase 4: Vector similarity tiebreaker within each rank tier. For a
	// cross-repo search the vector stage is unscoped (`repo` empty) so vector
	// candidates aren't wrongly limited to the single repo; blendVectorRanking
	// degrades to text-only ranking when vector search is unavailable.
	ranked = await blendVectorRanking(ranked, query, repo ?? "", vectors);

	// Phase 4b: prefer canonical declarations over barrel-file duplicates
	// (issue #87) — a `User` declared in `src/domain/user.ts` should win over
	// the `export { User }` barrel copy in `src/domain/index.ts`.
	ranked = preferCanonicalSymbols(ranked);

	// Apply pagination
	const paginated = ranked.slice(validated.offset, validated.offset + limit);

	const results = paginated.map((r) => ({
		...r.symbol,
		rankTier: r.rankTier,
		score: r.score,
		matchKind: getMatchKind(r.symbol)
	}));

	const total = ranked.length;

	// Bounded secondary lookup (issue #81): when a result is documentation
	// (Markdown heading / code_block), extract the path-like tokens it
	// references and surface the matching source symbols so an agent can tell
	// a doc-only match from a real source match. Capped at 10 related results
	// to avoid any perf regression on doc-heavy corpora.
	const related: Array<
		CodebaseSymbol & { rankTier: RankTier; score: number; matchKind: MatchKind; relatedTo: string }
	> = [];
	for (const r of paginated) {
		if (getMatchKind(r.symbol) !== "documentation") continue;
		for (const token of extractReferencedTokens(r.symbol.name)) {
			if (related.length >= SECONDARY_RELATED_CAP) break;
			const secondary = db.codebaseSymbols.searchSymbols({
				query: token,
				repo,
				repos,
				kind: kindQuery,
				limit: SECONDARY_RELATED_CAP - related.length
			});
			for (const sym of secondary.symbols) {
				if (related.length >= SECONDARY_RELATED_CAP) break;
				related.push({
					...sym,
					rankTier: RankTier.FTS5,
					score: 0,
					matchKind: getMatchKind(sym),
					relatedTo: r.symbol.name
				});
			}
		}
	}

	// Scope counts for the envelope (issue #81): file + symbol counts per
	// resolved repo, plus the repo root when the caller supplied it.
	const scopeRepos = repos && repos.length > 0 ? repos : repo ? [repo] : [];
	const scope = Object.fromEntries(
		scopeRepos.map((r) => [
			r,
			{ files: db.codebaseFiles.getFileCountByRepo(r), symbols: db.codebaseSymbols.getSymbolCountByRepo(r) }
		])
	);

	const contentSummary = formatSearchResultsGrouped(results, total, query);

	return createMcpResponse(
		{
			schema: "codebase-read",
			symbols: results,
			related,
			total,
			hasMore: validated.offset + limit < total,
			offset: validated.offset,
			limit,
			query,
			mode: "search",
			repoRoot: validated.repoPath ?? null,
			scope
		},
		`Found ${total} matching symbols for "${query}" (showing ${results.length}).`,
		{ includeJson: validated.json, contentSummary }
	);
}

export { handleSearchMode };
