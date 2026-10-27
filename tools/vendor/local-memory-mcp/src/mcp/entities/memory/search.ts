import { buildFtsMatchQuery } from "../../utils/fts";
import { TABLE_MEMORIES } from "../../utils/constants";
import { MEMORY_STATUS_ACTIVE, MemoryEntry, MemoryRow, MemoryType, CountResult } from "../../types";
import type { MemoryQueryRunner } from "./queries";

// ---------------------------------------------------------------------------
// Search (FTS5-first, LIKE fallback)
// ---------------------------------------------------------------------------

/**
 * Build the repo-scope SQL predicate shared by every search path in this
 * module. The rule is the repo-wide canonical one for scoped reads
 * (`queries.ts` getByCode/getMemoriesByCodes, `memoryVectors`
 * searchBySimilarity): when BOTH owner and repo are given the scope is
 * `((owner = ? AND repo = ?) OR is_global = 1)` — global memories from other
 * repos ARE included so a repo-scoped agent search still surfaces the
 * project's global standards/memories. When owner is falsy the scope
 * degenerates to the bare `repo = ?` equality (owner-unscoped listing /
 * dashboard-style reads keep strict repo-only semantics).
 *
 * Returns the predicate fragment (without the leading "AND") plus the bound
 * params. Pass `alias` when the predicates must qualify the memories column
 * (e.g. `m.` inside an FTS5 JOIN); the `memories` table is otherwise
 * unqualified so callers may join under any alias.
 */
function buildScopePredicate(owner: string, repo: string, alias = ""): { clause: string; params: (string | number)[] } {
	if (owner) {
		return {
			clause: `((${alias}owner = ? AND ${alias}repo = ?) OR ${alias}is_global = 1)`,
			params: [owner, repo]
		};
	}
	return {
		clause: `${alias}repo = ?`,
		params: [repo]
	};
}

/**
 * FTS5-first keyword search over title/content/tags (MEM-367 / TASK-014).
 * Filters mirror the LIKE path in {@link searchByRepo} exactly (owner/repo
 * scope, status='active', not expired, optional type); ordering is bm25
 * relevance first with the historical importance/created_at tie-break
 * preserved. Repo scope includes global memories when owner is given —
 * same `(owner AND repo) OR is_global` rule as {@link searchByFtsScored}
 * (FIX-GLOBAL-PRECEDENCE). Returns [] on any FTS error or unbuildable
 * query — callers must fall back to the LIKE path.
 */
export function searchByFts(
	runner: MemoryQueryRunner,
	query: string,
	owner: string,
	repo: string,
	type?: string,
	limit = 5
): MemoryEntry[] {
	try {
		const safeQuery = buildFtsMatchQuery(query);
		if (!safeQuery) return [];

		const conditions = ["memories_fts MATCH ?"];
		const params: (string | number)[] = [safeQuery];
		// Scope mirrors the LIKE path in searchByRepo AND searchByFtsScored:
		// `((owner = ? AND repo = ?) OR is_global = 1)` when owner is given
		// (FIX-GLOBAL-PRECEDENCE unifies the global-inclusion policy) so the
		// strict/non-strict split between the two FTS paths is gone.
		const scope = buildScopePredicate(owner, repo, "m.");
		conditions.push(scope.clause);
		params.push(...scope.params);
		conditions.push(`m.status = '${MEMORY_STATUS_ACTIVE}'`, "(m.expires_at IS NULL OR m.expires_at > ?)");
		params.push(new Date().toISOString());
		if (type) {
			conditions.push("m.type = ?");
			params.push(type);
		}
		params.push(limit);

		const rows = runner.all<MemoryRow>(
			`SELECT m.*
			 FROM memories_fts fts
			 JOIN ${TABLE_MEMORIES} m ON m.rowid = fts.rowid
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY bm25(memories_fts), m.importance DESC, m.created_at DESC
			 LIMIT ?`,
			params
		);
		return rows.map((row) => runner.toEntry(row));
	} catch {
		return [];
	}
}

/**
 * bm25-scored FTS search (MEM-367 §6.1): matching memories with their raw
 * `bm25(memories_fts)` scores, ordered most-relevant first. Scope mirrors
 * `memoryVectors.searchBySimilarity` — `(owner AND repo) OR is_global`,
 * active unless includeArchived, not expired. Shares the scope builder with
 * {@link searchByFts} so both FTS paths implement the identical
 * global-inclusion rule (FIX-GLOBAL-PRECEDENCE). Used by memory.read.ts to
 * feed a min-max-normalized bm25 into the 0.30 keyword hybrid weight.
 */
export function searchByFtsScored(
	runner: MemoryQueryRunner,
	query: string,
	owner: string,
	repo: string,
	options: { type?: string; limit?: number; includeArchived?: boolean } = {}
): Array<{ memory: MemoryEntry; bm25: number }> {
	const { type, limit = 100, includeArchived = false } = options;
	try {
		const safeQuery = buildFtsMatchQuery(query);
		if (!safeQuery) return [];

		const conditions = ["memories_fts MATCH ?"];
		const params: (string | number)[] = [safeQuery];
		// Scope only when a repo (or owner+repo) is given; with BOTH absent the
		// search is intentionally unscoped (historical searchByFtsScored
		// contract) — buildScopePredicate would otherwise bind `repo = ''`.
		if (owner || repo) {
			const scope = buildScopePredicate(owner, repo, "m.");
			conditions.push(scope.clause);
			params.push(...scope.params);
		}
		if (!includeArchived) conditions.push(`m.status = '${MEMORY_STATUS_ACTIVE}'`);
		conditions.push("(m.expires_at IS NULL OR m.expires_at > ?)");
		params.push(new Date().toISOString());
		if (type) {
			conditions.push("m.type = ?");
			params.push(type);
		}
		params.push(limit);

		const rows = runner.all<MemoryRow & { bm25_score: number }>(
			`SELECT m.*, bm25(memories_fts) AS bm25_score
			 FROM memories_fts fts
			 JOIN ${TABLE_MEMORIES} m ON m.rowid = fts.rowid
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY bm25_score
			 LIMIT ?`,
			params
		);
		return rows.map((row) => ({ memory: runner.toEntry(row), bm25: row.bm25_score ?? 0 }));
	} catch {
		return [];
	}
}

/**
 * Dashboard FTS fast path (MEM-367 §5.3): search clause replaced by the
 * FTS5 join while every other filter stays as an `m.*` predicate. The tag
 * filter uses the indexed memory_tags child table (OPT-PERF-07) instead of
 * an unindexable `m.tags LIKE` scan. Returns null when FTS produced no
 * matches or errored so the caller falls back to the LIKE path (permanent
 * fallback pattern).
 */
function tryDashboardFtsSearch(
	runner: MemoryQueryRunner,
	options: {
		ftsMatch: string;
		owner?: string;
		repo?: string;
		type?: MemoryType;
		tag?: string;
		isGlobal?: boolean;
		minImportance?: number;
		maxImportance?: number;
		includeArchived?: boolean;
		sortBy: string;
		sortOrder: "ASC" | "DESC";
		limit: number;
		offset: number;
	}
): {
	items: (MemoryEntry & { recall_rate: number })[];
	total: number;
	limit: number;
	offset: number;
} | null {
	try {
		const {
			ftsMatch,
			owner,
			repo,
			type,
			tag,
			isGlobal,
			minImportance,
			maxImportance,
			includeArchived,
			sortBy,
			sortOrder,
			limit,
			offset
		} = options;
		const conditions = ["memories_fts MATCH ?"];
		const params: (string | number)[] = [ftsMatch];

		if (owner) {
			conditions.push("m.owner = ?");
			params.push(owner);
		}
		if (repo) {
			conditions.push("m.repo = ?");
			params.push(repo);
		}
		if (type) {
			conditions.push("m.type = ?");
			params.push(type);
		}
		if (tag) {
			// Indexed tag filter via the normalized memory_tags table
			// (OPT-PERF-07) instead of an unindexable LIKE on tags JSON.
			conditions.push("EXISTS (SELECT 1 FROM memory_tags t WHERE t.memory_id = m.id AND t.tag = ?)");
			params.push(tag);
		}
		if (isGlobal !== undefined) {
			conditions.push("m.is_global = ?");
			params.push(isGlobal ? 1 : 0);
		}
		if (!includeArchived) {
			conditions.push(`m.status = '${MEMORY_STATUS_ACTIVE}'`);
		}
		if (minImportance !== undefined) {
			conditions.push("m.importance >= ?");
			params.push(minImportance);
		}
		if (maxImportance !== undefined) {
			conditions.push("m.importance <= ?");
			params.push(maxImportance);
		}

		const whereClause = conditions.join(" AND ");
		const totalRow = runner.get<CountResult>(
			`SELECT COUNT(*) as count FROM memories_fts fts JOIN ${TABLE_MEMORIES} m ON m.rowid = fts.rowid WHERE ${whereClause}`,
			params
		);
		const total = totalRow?.count ?? 0;
		if (total === 0) return null; // no FTS match → LIKE fallback (mid-word recall)

		const rows = runner.all<MemoryRow & { recall_rate: number }>(
			`SELECT m.*, CASE WHEN m.hit_count > 0 THEN CAST(m.recall_count AS REAL) / m.hit_count ELSE 0 END AS recall_rate
			 FROM memories_fts fts JOIN ${TABLE_MEMORIES} m ON m.rowid = fts.rowid
			 WHERE ${whereClause}
			 ORDER BY m.${sortBy} ${sortOrder} LIMIT ? OFFSET ?`,
			[...params, limit, offset]
		);
		return {
			items: rows.map((row) => ({
				...runner.toEntry(row),
				recall_rate: row.recall_rate || 0
			})),
			total,
			limit,
			offset
		};
	} catch {
		return null;
	}
}

/**
 * Keyword search over a repo's memories: FTS5-first (MEM-367 / TASK-014),
 * with the LIKE path as a permanent fallback for empty/unbuildable queries,
 * FTS errors, and queries with no FTS match (mirrors codebase-symbol.ts).
 * Repo scope includes global memories when owner is given, shared with
 * {@link searchByFts}/{@link searchByFtsScored} (FIX-GLOBAL-PRECEDENCE).
 */
export function searchByRepo(
	runner: MemoryQueryRunner,
	owner: string,
	repo: string,
	query: string = "",
	type?: string,
	limit = 5
): MemoryEntry[] {
	const now = new Date().toISOString();

	// FTS5-first keyword search (MEM-367 / TASK-014); the LIKE path stays
	// as a permanent fallback for empty/unbuildable queries, FTS errors,
	// and queries with no FTS match (mirrors codebase-symbol.ts).
	if (query && query.trim()) {
		const ftsHits = searchByFts(runner, query, owner, repo, type, limit);
		if (ftsHits.length > 0) return ftsHits;
	}

	// LIKE fallback mirrors the FTS path's scope: global memories from other
	// repos are included when owner is given (FIX-GLOBAL-PRECEDENCE) — the
	// FTS and LIKE branches of searchByRepo must agree or recall would differ
	// based on FTS availability.
	const scope = buildScopePredicate(owner, repo);
	let sql = `SELECT * FROM ${TABLE_MEMORIES} WHERE ${scope.clause} AND (content LIKE ? OR title LIKE ? OR tags LIKE ?) AND status = '${MEMORY_STATUS_ACTIVE}' AND (expires_at IS NULL OR expires_at > ?)`;
	const params: (string | number)[] = [...scope.params, `%${query}%`, `%${query}%`, `%${query}%`, now];

	if (type) {
		sql += " AND type = ?";
		params.push(type);
	}

	sql += " ORDER BY importance DESC, created_at DESC LIMIT ?";
	params.push(limit);

	const rows = runner.all<MemoryRow>(sql, params);
	return rows.map((row) => runner.toEntry(row));
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * Recent memories scoped to a repo, ordered by importance then created_at
 * (default DESC), with optional archive/type exclusions and pagination.
 */
export function getRecentMemories(
	runner: MemoryQueryRunner,
	owner: string,
	repo: string,
	limit: number,
	offset: number = 0,
	includeArchived: boolean = false,
	excludeTypes: string[] = [],
	sortOrder: "ASC" | "DESC" = "DESC"
): MemoryEntry[] {
	const ownerClause = owner ? "owner = ? AND " : "";
	let query = `SELECT * FROM ${TABLE_MEMORIES} WHERE ${ownerClause}repo = ?`;
	const params: (string | number)[] = owner ? [owner, repo] : [repo];

	if (!includeArchived) {
		query += ` AND status = '${MEMORY_STATUS_ACTIVE}'`;
	}

	if (excludeTypes.length > 0) {
		query += ` AND type NOT IN (${excludeTypes.map(() => "?").join(",")})`;
		params.push(...excludeTypes);
	}

	query += ` ORDER BY importance DESC, created_at ${sortOrder} LIMIT ? OFFSET ?`;
	params.push(limit, offset);

	const rows = runner.all<MemoryRow>(query, params);
	return rows.map((row) => runner.toEntry(row));
}

/**
 * Count memories scoped to a repo, with optional archive/type exclusions.
 */
export function getTotalCount(
	runner: MemoryQueryRunner,
	owner: string,
	repo: string,
	includeArchived = false,
	excludeTypes: string[] = []
): number {
	const ownerClause = owner ? "owner = ? AND " : "";
	let sql = `SELECT COUNT(*) as count FROM ${TABLE_MEMORIES} WHERE ${ownerClause}repo = ?`;
	const params: (string | number)[] = owner ? [owner, repo] : [repo];

	if (!includeArchived) sql += ` AND status = '${MEMORY_STATUS_ACTIVE}'`;

	if (excludeTypes.length > 0) {
		sql += ` AND type NOT IN (${excludeTypes.map(() => "?").join(",")})`;
		params.push(...excludeTypes);
	}

	const row = runner.get<CountResult>(sql, params);
	return row?.count ?? 0;
}

/**
 * Dashboard listing: combined filter/pagination with the computed
 * `recall_rate`. Uses the FTS fast path when a non-empty search term is
 * present (MEM-367 §5.3); empty/error falls through to the LIKE path.
 */
export function listMemoriesForDashboard(
	runner: MemoryQueryRunner,
	options: {
		owner?: string;
		repo?: string;
		type?: MemoryType;
		tag?: string;
		isGlobal?: boolean;
		minImportance?: number;
		maxImportance?: number;
		search?: string;
		offset?: number;
		limit?: number;
		sortBy?: string;
		sortOrder?: "ASC" | "DESC";
		includeArchived?: boolean;
	}
): {
	items: (MemoryEntry & { recall_rate: number })[];
	total: number;
	limit: number;
	offset: number;
} {
	const {
		owner,
		repo,
		type,
		tag,
		isGlobal,
		minImportance,
		maxImportance,
		search,
		offset = 0,
		limit = 50,
		includeArchived = false,
		sortOrder = "DESC"
	} = options;
	let sortBy = options.sortBy ?? "created_at";

	const ALLOWED_SORT_COLUMNS = new Set(["created_at", "updated_at", "importance", "hit_count", "title", "recall_rate"]);
	if (!ALLOWED_SORT_COLUMNS.has(sortBy)) {
		sortBy = "created_at";
	}

	// FTS fast path when a non-empty search term is present (MEM-367
	// §5.3): the search clause becomes the FTS5 join while all other
	// filters stay as m.* predicates. Used only when it returned
	// matches; empty/error falls through to the LIKE path below.
	if (search) {
		const ftsMatch = buildFtsMatchQuery(search);
		if (ftsMatch) {
			const ftsResult = tryDashboardFtsSearch(runner, {
				ftsMatch,
				owner,
				repo,
				type,
				tag,
				isGlobal,
				minImportance,
				maxImportance,
				includeArchived,
				sortBy,
				sortOrder,
				limit,
				offset
			});
			if (ftsResult !== null) return ftsResult;
		}
	}

	const where = ["1=1"];
	const params: (string | number)[] = [];
	// Soft-delete status scoping (TASK-209): archived memories are hidden from
	// the dashboard list unless includeArchived=true — mirrors
	// getRecentMemories/getTotalCount's status handling.
	if (!includeArchived) {
		where.push(`status = '${MEMORY_STATUS_ACTIVE}'`);
	}
	if (owner) {
		where.push("owner = ?");
		params.push(owner);
	}
	if (repo) {
		where.push("repo = ?");
		params.push(repo);
	}
	if (type) {
		where.push("type = ?");
		params.push(type);
	}
	if (tag) {
		// Indexed child-table equality (OPT-PERF-07) — replaces the
		// `tags LIKE '%tag%'` scan on the tags JSON text column.
		where.push("EXISTS (SELECT 1 FROM memory_tags t WHERE t.memory_id = memories.id AND t.tag = ?)");
		params.push(tag);
	}
	if (isGlobal !== undefined) {
		where.push("is_global = ?");
		params.push(isGlobal ? 1 : 0);
	}
	if (minImportance !== undefined) {
		where.push("importance >= ?");
		params.push(minImportance);
	}
	if (maxImportance !== undefined) {
		where.push("importance <= ?");
		params.push(maxImportance);
	}
	if (search) {
		where.push("(title LIKE ? OR content LIKE ?)");
		params.push(`%${search}%`, `%${search}%`);
	}

	const countSql = `SELECT COUNT(*) as count FROM ${TABLE_MEMORIES} WHERE ${where.join(" AND ")}`;
	const totalRow = runner.get<CountResult>(countSql, params);
	const total = totalRow?.count ?? 0;

	const dataSql = `SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate FROM ${TABLE_MEMORIES} WHERE ${where.join(" AND ")} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
	const rows = runner.all<MemoryRow & { recall_rate: number }>(dataSql, [...params, limit, offset]);
	const items = rows.map((row) => ({
		...runner.toEntry(row),
		recall_rate: row.recall_rate || 0
	}));

	return { items, total, limit, offset };
}
