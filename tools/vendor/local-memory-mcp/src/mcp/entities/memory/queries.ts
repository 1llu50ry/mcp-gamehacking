import { chunksOf } from "../../utils/chunk";
import { BULK_UPDATE_CHUNK_SIZE, TABLE_MEMORIES } from "../../utils/constants";
import { MEMORY_STATUS_ACTIVE, MemoryEntry, MemoryRow, TypeCountResult } from "../../types";

// ---------------------------------------------------------------------------
// Query runner (TASK-176-style seam)
// ---------------------------------------------------------------------------

/**
 * Minimal read-only SQL accessor implemented by MemoryEntity so the standalone
 * query functions in this module can execute through the shared
 * prepared-statement cache without widening BaseEntity's protected surface.
 * `toEntry` performs the shared row→entity conversion (BaseEntity
 * rowToMemoryEntry) so the read paths stay in one place.
 */
export interface MemoryQueryRunner {
	all<T = unknown>(sql: string, params?: unknown[]): T[];
	get<T = unknown>(sql: string, params?: unknown[]): T | undefined;
	toEntry(row: MemoryRow): MemoryEntry;
}

// ---------------------------------------------------------------------------
// Reads (single row)
// ---------------------------------------------------------------------------

/**
 * Fetch a single memory by id, or null when absent.
 */
export function getById(runner: MemoryQueryRunner, id: string): MemoryEntry | null {
	const row = runner.get<MemoryRow>(`SELECT * FROM ${TABLE_MEMORIES} WHERE id = ?`, [id]);
	return row ? runner.toEntry(row) : null;
}

/**
 * Fetch a memory by code. When owner/repo are given the lookup is scoped with
 * the same `(owner AND repo) OR is_global = 1` rule as every other scoped read.
 */
export function getByCode(runner: MemoryQueryRunner, code: string, owner?: string, repo?: string): MemoryEntry | null {
	let sql = `SELECT * FROM ${TABLE_MEMORIES} WHERE code = ?`;
	const params: (string | null)[] = [code];
	if (owner && repo) {
		sql += " AND ((owner = ? AND repo = ?) OR is_global = 1)";
		params.push(owner, repo);
	}
	const row = runner.get<MemoryRow>(sql, params);
	return row ? runner.toEntry(row) : null;
}

/**
 * Fetch a single memory by id including the computed `recall_rate`
 * (recall_count / hit_count, 0 when hit_count is 0).
 *
 * Soft-delete status scoping (TASK-209): archived memories are hidden by
 * default (the dashboard GET /:id layer 404s) but remain restorable via
 * `includeArchived = true`. Mutation/existence callers that must keep seeing
 * archived rows (exists/update/delete + the `memory://{id}` MCP resource) opt
 * in explicitly.
 */
export function getByIdWithStats(
	runner: MemoryQueryRunner,
	id: string,
	includeArchived: boolean = false
): (MemoryEntry & { recall_rate: number }) | null {
	let sql = `SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate FROM ${TABLE_MEMORIES} WHERE id = ?`;
	if (!includeArchived) sql += ` AND status = '${MEMORY_STATUS_ACTIVE}'`;
	const row = runner.get<MemoryRow & { recall_rate: number }>(sql, [id]);
	if (!row) return null;
	return {
		...runner.toEntry(row),
		recall_rate: row.recall_rate ?? 0
	};
}

// ---------------------------------------------------------------------------
// Reads (bulk)
// ---------------------------------------------------------------------------

/**
 * Bulk-load memories by id, optionally filtered by type/status.
 */
export function getByIds(
	runner: MemoryQueryRunner,
	ids: string[],
	options: { type?: string; status?: string } = {}
): MemoryEntry[] {
	if (ids.length === 0) return [];
	// Chunk at BULK_UPDATE_CHUNK_SIZE (500) to bound the IN()-list width —
	// very large id sets produce long SQL strings that miss better-sqlite3's
	// prepare cache and can stall the parser. Results are fused per-chunk;
	// callers consume by-id (Set/Map lookup), so concatenation is safe.
	const results: MemoryEntry[] = [];
	for (const chunk of chunksOf(ids, BULK_UPDATE_CHUNK_SIZE)) {
		let sql = `SELECT * FROM ${TABLE_MEMORIES} WHERE id IN (${chunk.map(() => "?").join(",")})`;
		const params: (string | number)[] = [...chunk];
		if (options.type) {
			sql += " AND type = ?";
			params.push(options.type);
		}
		if (options.status) {
			sql += " AND status = ?";
			params.push(options.status);
		}
		const rows = runner.all<MemoryRow>(sql, params);
		results.push(...rows.map((row) => runner.toEntry(row)));
	}
	return results;
}

/**
 * Bulk-load memories by code with the same owner/repo/global scoping as
 * getByCode, but in a single query. Results preserve the input code order
 * (first match per code, mirroring per-code getByCode lookups).
 */
export function getMemoriesByCodes(
	runner: MemoryQueryRunner,
	codes: string[],
	owner?: string,
	repo?: string
): MemoryEntry[] {
	if (codes.length === 0) return [];
	const byCode = new Map<string, MemoryEntry>();
	// Chunk at BULK_UPDATE_CHUNK_SIZE (500) — same rationale as getByIds.
	for (const chunk of chunksOf(codes, BULK_UPDATE_CHUNK_SIZE)) {
		const placeholders = chunk.map(() => "?").join(",");
		let sql = `SELECT * FROM ${TABLE_MEMORIES} WHERE code IN (${placeholders})`;
		const params: (string | null)[] = [...chunk];
		if (owner && repo) {
			sql += " AND ((owner = ? AND repo = ?) OR is_global = 1)";
			params.push(owner, repo);
		}
		const rows = runner.all<MemoryRow>(sql, params);
		for (const row of rows) {
			const entry = runner.toEntry(row);
			if (entry.code && !byCode.has(entry.code)) byCode.set(entry.code, entry);
		}
	}

	const seen = new Set<string>();
	const result: MemoryEntry[] = [];
	for (const code of codes) {
		const entry = byCode.get(code);
		if (entry && !seen.has(code)) {
			seen.add(code);
			result.push(entry);
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Total memory count (optionally scoped to owner/repo) plus per-type counts.
 */
export function getStats(
	runner: MemoryQueryRunner,
	owner?: string,
	repo?: string
): { total: number; byType: Record<string, number> } {
	let sql = `SELECT type, COUNT(*) as count FROM ${TABLE_MEMORIES}`;
	const params: unknown[] = [];
	if (owner) {
		sql += " WHERE owner = ?";
		params.push(owner);
		if (repo) {
			sql += " AND repo = ?";
			params.push(repo);
		}
	} else if (repo) {
		sql += " WHERE repo = ?";
		params.push(repo);
	}
	sql += " GROUP BY type";

	const rows = runner.all<TypeCountResult>(sql, params);
	const byType: Record<string, number> = {};
	let total = 0;
	rows.forEach((row) => {
		byType[row.type] = row.count;
		total += row.count;
	});

	return { total, byType };
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * All memories scoped to a repo with the computed `recall_rate`, ordered by
 * created_at DESC, with optional limit/offset pagination.
 */
export function getAllMemoriesWithStats(
	runner: MemoryQueryRunner,
	owner: string,
	repo: string,
	limit?: number,
	offset?: number
): (MemoryEntry & { recall_rate: number })[] {
	const ownerClause = owner ? "owner = ? AND " : "";
	let sql = `SELECT *, CASE WHEN hit_count > 0 THEN CAST(recall_count AS REAL) / hit_count ELSE 0 END AS recall_rate FROM ${TABLE_MEMORIES} WHERE ${ownerClause}repo = ? ORDER BY created_at DESC`;
	const params: unknown[] = owner ? [owner, repo] : [repo];
	if (limit !== undefined) {
		sql += " LIMIT ?";
		params.push(limit);
		if (offset !== undefined) {
			sql += " OFFSET ?";
			params.push(offset);
		}
	}
	const rows = runner.all<MemoryRow & { recall_rate: number }>(sql, params);
	return rows.map((row) => ({
		...runner.toEntry(row),
		recall_rate: row.recall_rate || 0
	}));
}
