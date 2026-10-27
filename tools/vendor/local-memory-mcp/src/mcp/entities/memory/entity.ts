import { BaseEntity } from "../../storage/base";
import { MemoryEntry, MemoryRow, MemoryScope, MemoryType, MEMORY_STATUS_ACTIVE } from "../../types";
import { VALID_COLUMNS, mergeStructuredData } from "./validation";
import { BULK_UPDATE_CHUNK_SIZE, TABLE_MEMORIES } from "../../utils/constants";
import { buildUpdateClause } from "../../utils/sql-builder";
import { chunksOf } from "../../utils/chunk";
import * as queries from "./queries";
import * as search from "./search";
import type { MemoryQueryRunner } from "./queries";

// JSON-serialized / int-coerced columns for the shared update-clause builder
// (TASK-109). Tags and metadata are stored as JSON text; is_global as 0/1.
const MEMORY_JSON_KEYS = new Set(["tags", "metadata"]);
const MEMORY_INT_KEYS = new Set(["is_global"]);

/**
 * Single encapsulation point for ALL raw SQL against the memories tables.
 * Read/query SQL lives in `./queries` (same seam as knowledge-graph,
 * TASK-176); writes and bulk mutations stay here.
 */
export class MemoryEntity extends BaseEntity {
	/** Read accessor exposing protected BaseEntity helpers to `./queries`. */
	private get runner(): MemoryQueryRunner {
		return {
			all: <T>(sql: string, params: unknown[] = []) => this.all<T>(sql, params),
			get: <T>(sql: string, params: unknown[] = []) => this.get<T>(sql, params),
			toEntry: (row: MemoryRow) => this.rowToMemoryEntry(row)
		};
	}

	// -----------------------------------------------------------------------
	// Writes
	// -----------------------------------------------------------------------

	/**
	 * Single source of truth for the memories INSERT statement (TASK-108) —
	 * shared by insert() and bulkInsertMemories() so a column change is made
	 * in exactly one place. Includes the TASK-121 branch column.
	 *
	 * `last_used_at` is deliberately hardcoded to NULL on INSERT (MEM-586 /
	 * TASK-129 — INTENTIONAL, not a bug): creation does NOT count as "used".
	 * A memory is timestamped only by the explicit usage paths —
	 * acknowledge("used")/recall via incrementRecallCount(), incrementHitCount(s)(),
	 * or a direct update() — and reads/searches deliberately never touch it
	 * (memory.read.ts: "No hit_count increments on read"), keeping reads
	 * side-effect-free and write-lock-free. Consumers must treat NULL as
	 * "never explicitly used": soul-maintenance decay (`last_used_at IS NULL
	 * OR last_used_at < cutoff`) and archive expiry
	 * (COALESCE(last_used_at, created_at)) already handle NULL correctly.
	 */
	private buildInsert(entry: MemoryEntry): { sql: string; params: unknown[] } {
		const mergedMeta = mergeStructuredData(entry.metadata, entry.structuredData);
		return {
			sql: `INSERT INTO ${TABLE_MEMORIES} (
				id, code, repo, owner, type, title, content, importance, folder, language, branch,
				created_at, updated_at, hit_count, recall_count, last_used_at, expires_at,
				supersedes, status, is_global, tags, metadata, agent, role, model, completed_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			params: [
				entry.id,
				entry.code || null,
				entry.scope.repo,
				entry.scope.owner,
				entry.type,
				entry.title || null,
				entry.content,
				entry.importance,
				entry.scope.folder || null,
				entry.scope.language || null,
				entry.scope.branch || null,
				entry.created_at,
				entry.updated_at,
				entry.expires_at ?? null,
				entry.supersedes ?? null,
				entry.status || MEMORY_STATUS_ACTIVE,
				entry.is_global ? 1 : 0,
				entry.tags ? JSON.stringify(entry.tags) : null,
				mergedMeta ? JSON.stringify(mergedMeta) : null,
				entry.agent || "unknown",
				entry.role || "unknown",
				entry.model || "unknown",
				entry.completed_at || null
			]
		};
	}

	insert(entry: MemoryEntry): void {
		const { sql, params } = this.buildInsert(entry);
		this.run(sql, params);
	}

	update(id: string, updates: Partial<MemoryEntry>): void {
		const { fields, values } = buildUpdateClause(this.buildUpdateMap(updates, true, id), {
			jsonKeys: MEMORY_JSON_KEYS,
			intKeys: MEMORY_INT_KEYS
		});

		if (fields.length === 0) return;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());
		values.push(id);

		this.run(`UPDATE ${TABLE_MEMORIES} SET ${fields.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
	}

	/**
	 * Normalize a Partial<MemoryEntry> into a flat column→value map for the
	 * shared update-clause builder (TASK-109), preserving the exact
	 * pre-refactor whitelist and serialization semantics:
	 *
	 * - `scope` expands into its scalar columns (owner/repo/folder/language/branch)
	 *   with the same per-key guards (owner/folder/language/branch when
	 *   `!== undefined`, repo when truthy).
	 * - `structuredData` is merged into the existing metadata JSON blob — in
	 *   the single-id update path (`mergeStructuredData=true, id` set) and, per
	 *   row within {@link bulkUpdateMemories}, where each row's stored metadata
	 *   is read and merged the same way so bulk matches single-update
	 *   semantics. Passed `false` with no id when the caller handled merging
	 *   (or omits structuredData entirely).
	 * - Every other key is kept only when it is tags/metadata/is_global or a
	 *   whitelisted VALID_COLUMNS member; unknown keys are ignored.
	 */
	private buildUpdateMap(
		updates: Partial<MemoryEntry>,
		mergeStructuredData: boolean,
		id?: string
	): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value === undefined) continue;
			if (key === "scope") {
				const scope = value as MemoryScope;
				if (scope.owner !== undefined) result.owner = scope.owner;
				if (scope.repo) result.repo = scope.repo;
				if (scope.folder !== undefined) result.folder = scope.folder;
				if (scope.language !== undefined) result.language = scope.language;
				if (scope.branch !== undefined) result.branch = scope.branch;
			} else if (key === "structuredData") {
				if (!mergeStructuredData || id === undefined) continue;
				const existingRow = this.get<{ metadata: string }>(`SELECT metadata FROM ${TABLE_MEMORIES} WHERE id = ?`, [id]);
				const existingMeta = existingRow ? this.safeJSONParse<Record<string, unknown>>(existingRow.metadata, {}) : {};
				result.metadata = { ...existingMeta, structuredData: value };
			} else if (key === "tags" || key === "metadata" || key === "is_global" || VALID_COLUMNS.has(key)) {
				result[key] = value;
			}
		}
		return result;
	}

	delete(id: string): void {
		this.run(`DELETE FROM ${TABLE_MEMORIES} WHERE id = ?`, [id]);
	}

	bulkInsertMemories(entries: MemoryEntry[]): number {
		return this.transaction(() => {
			let count = 0;
			for (const entry of entries) {
				const { sql, params } = this.buildInsert(entry);
				this.run(sql, params);
				count++;
			}
			return count;
		});
	}

	bulkUpdateMemories(ids: string[], updates: Partial<MemoryEntry>): number {
		if (ids.length === 0) return 0;

		// structuredData is row-specific: the merge target is each row's own
		// stored metadata blob, so it cannot ride the shared batched SET clause
		// below. When present we fall through to the per-row path (mirrors
		// update()); otherwise keep the single-clause batched UPDATE exactly as
		// before (TASK-122 alignment, TASK-129 semantics untouched).
		if (updates.structuredData !== undefined) {
			const now = new Date().toISOString();
			return this.transaction(() => {
				let count = 0;
				for (const id of ids) {
					// Same merge as update(): read the row's stored metadata
					// and set the `structuredData` key inside it, preserving
					// every other metadata entry.
					const { fields, values } = buildUpdateClause(this.buildUpdateMap(updates, true, id), {
						jsonKeys: MEMORY_JSON_KEYS,
						intKeys: MEMORY_INT_KEYS
					});
					if (fields.length === 0) continue;
					fields.push("updated_at = ?");
					values.push(now);
					values.push(id);
					const result = this.run(
						`UPDATE ${TABLE_MEMORIES} SET ${fields.join(", ")} WHERE id = ?`,
						values as (string | number)[]
					);
					count += result.changes;
				}
				return count;
			});
		}

		const { fields, values } = buildUpdateClause(this.buildUpdateMap(updates, false), {
			jsonKeys: MEMORY_JSON_KEYS,
			intKeys: MEMORY_INT_KEYS
		});

		if (fields.length === 0) return 0;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());

		return this.transaction(() => {
			let count = 0;
			for (const chunk of chunksOf(ids, BULK_UPDATE_CHUNK_SIZE)) {
				const result = this.run(
					`UPDATE ${TABLE_MEMORIES} SET ${fields.join(", ")} WHERE id IN (${chunk.map(() => "?").join(",")})`,
					[...values, ...chunk] as (string | number)[]
				);
				count += result.changes;
			}
			return count;
		});
	}

	incrementHitCount(id: string): void {
		this.run(`UPDATE ${TABLE_MEMORIES} SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?`, [
			new Date().toISOString(),
			id
		]);
	}

	incrementHitCounts(ids: string[]): void {
		if (!ids || ids.length === 0) return;
		const now = new Date().toISOString();
		// Chunk at BULK_UPDATE_CHUNK_SIZE (500) — same rationale as getByIds.
		for (const chunk of chunksOf(ids, BULK_UPDATE_CHUNK_SIZE)) {
			const placeholders = chunk.map(() => "?").join(",");
			this.run(
				`UPDATE ${TABLE_MEMORIES} SET hit_count = hit_count + 1, last_used_at = ? WHERE id IN (${placeholders})`,
				[now, ...chunk]
			);
		}
	}

	incrementRecallCount(id: string): void {
		this.run(`UPDATE ${TABLE_MEMORIES} SET recall_count = recall_count + 1, last_used_at = ? WHERE id = ?`, [
			new Date().toISOString(),
			id
		]);
	}

	// -----------------------------------------------------------------------
	// Reads (delegated to ./queries and ./search)
	// -----------------------------------------------------------------------

	getById(id: string): MemoryEntry | null {
		return queries.getById(this.runner, id);
	}

	getByCode(code: string, owner?: string, repo?: string): MemoryEntry | null {
		return queries.getByCode(this.runner, code, owner, repo);
	}

	getByIdWithStats(id: string, includeArchived: boolean = false): (MemoryEntry & { recall_rate: number }) | null {
		return queries.getByIdWithStats(this.runner, id, includeArchived);
	}

	getByIds(ids: string[], options: { type?: string; status?: string } = {}): MemoryEntry[] {
		return queries.getByIds(this.runner, ids, options);
	}

	getMemoriesByCodes(codes: string[], owner?: string, repo?: string): MemoryEntry[] {
		return queries.getMemoriesByCodes(this.runner, codes, owner, repo);
	}

	getStats(owner?: string, repo?: string): { total: number; byType: Record<string, number> } {
		return queries.getStats(this.runner, owner, repo);
	}

	searchByFts(query: string, owner: string, repo: string, type?: string, limit = 5): MemoryEntry[] {
		return search.searchByFts(this.runner, query, owner, repo, type, limit);
	}

	searchByFtsScored(
		query: string,
		owner: string,
		repo: string,
		options: { type?: string; limit?: number; includeArchived?: boolean } = {}
	): Array<{ memory: MemoryEntry; bm25: number }> {
		return search.searchByFtsScored(this.runner, query, owner, repo, options);
	}

	searchByRepo(owner: string, repo: string, query: string = "", type?: string, limit = 5): MemoryEntry[] {
		return search.searchByRepo(this.runner, owner, repo, query, type, limit);
	}

	getRecentMemories(
		owner: string,
		repo: string,
		limit: number,
		offset: number = 0,
		includeArchived: boolean = false,
		excludeTypes: string[] = [],
		sortOrder: "ASC" | "DESC" = "DESC"
	): MemoryEntry[] {
		return search.getRecentMemories(this.runner, owner, repo, limit, offset, includeArchived, excludeTypes, sortOrder);
	}

	getTotalCount(owner: string, repo: string, includeArchived = false, excludeTypes: string[] = []): number {
		return search.getTotalCount(this.runner, owner, repo, includeArchived, excludeTypes);
	}

	getAllMemoriesWithStats(
		owner: string,
		repo: string,
		limit?: number,
		offset?: number
	): (MemoryEntry & { recall_rate: number })[] {
		return queries.getAllMemoriesWithStats(this.runner, owner, repo, limit, offset);
	}

	listMemoriesForDashboard(options: {
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
	}): {
		items: (MemoryEntry & { recall_rate: number })[];
		total: number;
		limit: number;
		offset: number;
	} {
		return search.listMemoriesForDashboard(this.runner, options);
	}
}
