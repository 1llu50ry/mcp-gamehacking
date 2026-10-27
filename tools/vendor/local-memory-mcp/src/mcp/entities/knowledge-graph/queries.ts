import { logger } from "../../utils/logger";
import { KG_MAX_CONTEXT_ENTITIES, KG_CONTEXT_TEXT_TOKENS, KG_MAX_CONTEXT_RELATIONS } from "../../utils/constants";

// ---------------------------------------------------------------------------
// Query runner (TASK-176)
// ---------------------------------------------------------------------------

export type { KgQueryRunner, KgEntityRow, KgRelationRow, KgObservationRow } from "./query-types";
import type { KgQueryRunner } from "./query-types";

/**
 * Split arbitrary text into lowercase alphanumeric tokens, mirroring FTS5's
 * unicode61 tokenizer for ASCII input.
 */
function tokenizeKgText(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 0);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Fetch entity name/type rows for names within one repository identity scope. */
export function getEntitiesFor(
	runner: KgQueryRunner,
	entityNames: string[],
	repo: string
): Array<{ name: string; type: string }> {
	if (entityNames.length === 0) return [];
	const placeholders = entityNames.map(() => "?").join(",");
	return runner.all<{ name: string; type: string }>(
		`SELECT name, type FROM entities WHERE repo = ? AND name IN (${placeholders})`,
		[repo, ...entityNames]
	);
}

/**
 * Fetch relations touching any of the given entity names, scoped to a repo.
 *
 * **Audit F2 — why this is a bounded UNION and not one `OR` predicate.**
 *
 * The original shape was a single scan-forcing predicate:
 *
 * ```sql
 * WHERE (from_entity IN (...) OR to_entity IN (...)) AND repo = ?
 * ```
 *
 * SQLite cannot serve one `OR` branch from `(repo, from_entity)` and the other
 * from a `to_entity` index in the same scan, so the planner fell back to
 * `SEARCH relations USING INDEX idx_relations_repo (repo=?)` — i.e. it walked
 * EVERY edge in the repo and filtered in memory. Cost was O(edges in repo),
 * not O(names): on a 490k-edge repo one 50-name enrichment took ~1.2s and
 * returned 37,815 rows (~184k tokens of JSON) for a payload the caller only
 * samples.
 *
 * Three changes, each necessary:
 *
 *  1. **UNION of two index-served branches** — `(repo, from_entity)` is served
 *     by `idx_relations_repo_from_to` (v12), `(repo, to_entity)` by
 *     `idx_relations_repo_to` (v29). Both become index seeks per name instead
 *     of one full-repo scan. An index alone does NOT help: adding
 *     `(repo, to_entity)` without the UNION rewrite leaves the plan unchanged
 *     (measured — still `idx_relations_repo`), because the limitation is the
 *     `OR`, not the available indexes.
 *  2. **Per-branch `LIMIT`** — each branch is bounded BEFORE the merge, so a
 *     hub entity with 100k edges cannot materialize its whole adjacency list
 *     into a temp b-tree just to have the outer LIMIT throw it away.
 *  3. **`ORDER BY confidence DESC`** — when the cap truncates, the retained
 *     window is the most trustworthy slice (migration v24): explicit/manual
 *     1.0 and parser-deterministic codebase 0.9 outrank NLP co-occurrence
 *     guesses at 0.55. Ties break on `(from, to)` so output is deterministic.
 *
 * Measured A/B on a real 1.29M-edge database across six repository scopes of
 * differing size (median of 5, warm, interleaved, `limit = 500`):
 *
 * ```
 * repo edges     OLD ms   NEW ms   speedup   OLD rows   NEW rows
 *   490,255     1218.3     38.0     32.0x      37,815        500
 *   207,338       88.1     26.2      3.4x      25,604        500
 *   168,379       68.7     20.1      3.4x      20,169        500
 *   120,439       47.1      6.2      7.6x       6,000        500
 *    83,218       47.1     26.5      1.8x      30,877        500
 *    20,857        8.1      4.0      2.0x       3,894        500
 * ```
 *
 * No scope regressed. Aggregate KG-relation payload across the six fell
 * 2,483,541 → 62,412 JSON chars (39.8x).
 *
 * @param limit - Max rows returned; `0` disables the cap (unbounded, the
 *   pre-fix behavior) for callers that genuinely need the full adjacency set.
 */
export function getRelationsFor(
	runner: KgQueryRunner,
	entityNames: string[],
	repo: string,
	limit = KG_MAX_CONTEXT_RELATIONS
): Array<{ from: string; to: string; type: string }> {
	if (entityNames.length === 0) return [];
	const placeholders = entityNames.map(() => "?").join(",");
	const columns = `from_entity AS "from", to_entity AS "to", relation_type AS type`;

	if (limit <= 0) {
		// Unbounded: still the UNION rewrite (both branches index-served), just
		// without the ranking/truncation window.
		return runner.all<{ from: string; to: string; type: string }>(
			`SELECT ${columns} FROM relations WHERE repo = ? AND from_entity IN (${placeholders})
			 UNION
			 SELECT ${columns} FROM relations WHERE repo = ? AND to_entity IN (${placeholders})`,
			[repo, ...entityNames, repo, ...entityNames]
		);
	}

	// `confidence` is selected so the merge can rank on it, then dropped from
	// the projection by the caller's row type — the KG-context payload shape
	// ({ from, to, type }) is unchanged.
	return runner.all<{ from: string; to: string; type: string }>(
		`SELECT "from", "to", type FROM (
		   SELECT * FROM (
		     SELECT ${columns}, confidence FROM relations
		     WHERE repo = ? AND from_entity IN (${placeholders})
		     ORDER BY confidence DESC LIMIT ?
		   )
		   UNION
		   SELECT * FROM (
		     SELECT ${columns}, confidence FROM relations
		     WHERE repo = ? AND to_entity IN (${placeholders})
		     ORDER BY confidence DESC LIMIT ?
		   )
		 )
		 ORDER BY confidence DESC, "from", "to"
		 LIMIT ?`,
		[repo, ...entityNames, limit, repo, ...entityNames, limit, limit]
	);
}

/**
 * Entity names referenced by a single exact observation text.
 */
export function getEntityNamesByObservation(runner: KgQueryRunner, observation: string, repo: string): string[] {
	const rows = runner.all<{ entity_name: string }>(
		"SELECT DISTINCT entity_name FROM observations WHERE observation = ? AND repo = ?",
		[observation, repo]
	);
	return rows.map((r) => r.entity_name);
}

/**
 * Entity names referenced by any of the given exact observation texts.
 */
export function getEntityNamesByObservations(runner: KgQueryRunner, observations: string[], repo: string): string[] {
	if (observations.length === 0) return [];
	const placeholders = observations.map(() => "?").join(",");
	const rows = runner.all<{ entity_name: string }>(
		`SELECT DISTINCT entity_name FROM observations WHERE observation IN (${placeholders}) AND repo = ?`,
		[...observations, repo]
	);
	return rows.map((r) => r.entity_name);
}

/**
 * Entity names related to the given search text.
 *
 * OPT-PERF-04: the old `INSTR(?, name) > 0` scan walked EVERY entity row
 * with no LIMIT on every task-read (the hottest read path). This now
 * resolves names through the `entity_names_fts` token index (migration
 * v15): the search text is split into unicode61-style tokens, OR'd into a
 * single MATCH query, and looked up index-scoped with a LIMIT.
 *
 * Matching semantics: FTS5 token-boundary, case-insensitive matching (any
 * name token present in the search text) replaces the old case-sensitive
 * contiguous-substring (INSTR) rule. A single-token entity name matches
 * when the name appears as a standalone token in the search text; mid-word
 * (~substring) and case-variant behavior differs from the old INSTR rule.
 * Multi-token names are matched by ANY token overlap (more permissive).
 * Rows are ORDER BY rank (FTS5 bm25 + repo filter), so the LIMIT keeps the
 * highest-relevance names; both are bounded by `limit`
 * (KG_MAX_CONTEXT_ENTITIES), so enrichment cost is capped regardless of
 * match breadth.
 *
 * Degraded fallback (index absent, e.g. pre-v15 DB or rollback): the
 * INSTR scan still runs, but LIMIT-bounded — bounded output, scan cost
 * bounded by the entities table only in that fallback path.
 */
export function getEntityNamesByText(
	runner: KgQueryRunner,
	repo: string,
	text: string,
	limit = KG_MAX_CONTEXT_ENTITIES
): string[] {
	const tokens = [...new Set(tokenizeKgText(text))];
	if (tokens.length === 0) return [];

	const queryTokens = tokens.slice(0, KG_CONTEXT_TEXT_TOKENS);
	const matchQuery = queryTokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");

	try {
		const rows = runner.all<{ name: string }>(
			"SELECT name, rank FROM entity_names_fts WHERE repo = ? AND entity_names_fts MATCH ? ORDER BY rank LIMIT ?",
			[repo, matchQuery, limit]
		);
		return rows.map((r) => r.name);
	} catch (error) {
		logger.warn("[KG] FTS entity-name lookup failed, falling back to bounded INSTR", {
			error: String(error)
		});
		const rows = runner.all<{ name: string }>(
			"SELECT name FROM entities WHERE repo = ? AND INSTR(?, name) > 0 LIMIT ?",
			[repo, text, limit]
		);
		return rows.map((r) => r.name);
	}
}

export {
	entityExists,
	getEntityByName,
	getRelationsByName,
	getObservationsByName,
	listEntities,
	countEntities,
	listRelations,
	countRelations,
	listGraphNodes,
	countGraphNodes,
	listGraphEdges,
	listGraphEdgesForSubset,
	listEntitiesForGraph,
	listRelationsForGraph
} from "./dashboard-queries";
