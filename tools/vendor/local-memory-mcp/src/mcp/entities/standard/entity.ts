import { BaseEntity } from "../../storage/base";
import { CodingStandardEntry, CodingStandardRow, VectorWriteMeta } from "../../types";
import { computeVector, cosineSimilarity, createTfVectorCache, encodeVector } from "../../utils/vector";
import { buildUpdateClause } from "../../utils/sql-builder";
import { chunksOf } from "../../utils/chunk";
import {
	STANDARD_CONFLICT_THRESHOLD,
	STANDARD_CONFLICT_CANDIDATES,
	STANDARD_CANDIDATE_CAP,
	VECTOR_CANDIDATE_CAP,
	BULK_UPDATE_CHUNK_SIZE
} from "../../utils/constants";
import { buildStandardInsert, buildStandardUpdateMap } from "./serializers";
import { buildNonFtsFilters, buildFtsFilters } from "./filters";

// Int-coerced / immutable columns for the shared update-clause builder
// (TASK-109). is_global is stored as 0/1; id/created_at are never writable.
const STANDARD_INT_KEYS = new Set(["is_global"]);
const STANDARD_EXCLUDE_KEYS = new Set(["id", "created_at"]);

export class StandardEntity extends BaseEntity {
	// In-memory TF vector cache keyed by standard id and validated against
	// coding_standards.updated_at — self-invalidates on writes.
	private readonly tfCache = createTfVectorCache();

	insert(entry: CodingStandardEntry): void {
		const { sql, params } = buildStandardInsert(entry);
		this.run(sql, params);
	}

	bulkInsertStandards(entries: CodingStandardEntry[]): number {
		return this.transaction(() => {
			let count = 0;
			for (const entry of entries) {
				const { sql, params } = buildStandardInsert(entry);
				this.run(sql, params);
				count++;
			}
			return count;
		});
	}

	/**
	 * Bulk updates standards by IDs within a single transaction.
	 *
	 * @param ids - Array of standard IDs to update
	 * @param updates - Partial standard fields to update
	 * @returns Number of standards actually updated
	 */
	bulkUpdateStandards(ids: string[], updates: Partial<CodingStandardEntry>): number {
		if (ids.length === 0) return 0;

		const { fields, values } = buildUpdateClause(updates as Record<string, unknown>, {
			jsonKeys: new Set(["tags", "metadata", "stack"]),
			intKeys: STANDARD_INT_KEYS,
			excludeKeys: STANDARD_EXCLUDE_KEYS
		});

		if (fields.length === 0) return 0;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());

		return this.transaction(() => {
			let count = 0;
			for (const chunk of chunksOf(ids, BULK_UPDATE_CHUNK_SIZE)) {
				const placeholders = chunk.map(() => "?").join(",");
				const result = this.run(`UPDATE coding_standards SET ${fields.join(", ")} WHERE id IN (${placeholders})`, [
					...values,
					...chunk
				] as (string | number)[]);
				count += result.changes;
			}
			return count;
		});
	}

	getById(id: string): CodingStandardEntry | null {
		const row = this.get<CodingStandardRow>("SELECT * FROM coding_standards WHERE id = ?", [id]);
		return row ? this.rowToEntry(row) : null;
	}

	getByCode(code: string, owner?: string, repo?: string): CodingStandardEntry | null {
		let sql = "SELECT * FROM coding_standards WHERE code = ?";
		const params: (string | null)[] = [code];
		if (owner && repo) {
			sql += " AND ((owner = ? AND repo = ?) OR is_global = 1)";
			params.push(owner, repo);
		}
		const row = this.get<CodingStandardRow>(sql, params);
		return row ? this.rowToEntry(row) : null;
	}

	/**
	 * Every standard carrying `code`, regardless of scope (FIX-026).
	 *
	 * Powers the standard-read not-found scope hint: when a scoped lookup misses,
	 * this finds the same code under a different owner/repo so the caller can
	 * retry with the right scope. Uses the `idx_coding_standards_code` index and
	 * is only invoked on the not-found path, so there is no hot-path cost.
	 */
	getByCodeAnyScope(code: string): CodingStandardEntry[] {
		const rows = this.all<CodingStandardRow>("SELECT * FROM coding_standards WHERE code = ?", [code]);
		return rows.map((row) => this.rowToEntry(row));
	}

	search(options: {
		query?: string;
		context?: string;
		version?: string;
		language?: string;
		stack?: string;
		tag?: string;
		owner?: string;
		repo?: string;
		is_global?: boolean;
		limit?: number;
		offset?: number;
	}): CodingStandardEntry[] {
		const { query, context, version, language, stack, tag, owner, repo, is_global, limit = 20, offset = 0 } = options;

		if (query) {
			try {
				return this.ftsSearch({ ...options, query });
			} catch {
				// Fall through to LIKE search
			}
		}

		const { clauses, params } = buildNonFtsFilters({
			query,
			context,
			version,
			language,
			stack,
			tag,
			owner,
			repo,
			is_global
		});
		const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
		const sql = `SELECT * FROM coding_standards ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
		params.push(limit, offset);

		const rows = this.all<CodingStandardRow>(sql, params);
		return rows.map((r) => this.rowToEntry(r));
	}

	/**
	 * Count coding standards matching the same filters as search(), without
	 * materializing any rows. The dashboard list path previously re-ran
	 * search() with a 100k limit and counted `.length`, which fetched every
	 * matching row (full column payloads) and JSON-parsed stack/tags/metadata
	 * per row just to produce a total (TASK-406). Mirrors the memory entity's
	 * COUNT(*) pattern (memory/search.ts) so the total is O(matches) on the
	 * index instead of O(matches) row materialization.
	 */
	count(options: {
		query?: string;
		context?: string;
		version?: string;
		language?: string;
		stack?: string;
		tag?: string;
		owner?: string;
		repo?: string;
		is_global?: boolean;
	}): number {
		const { query, context, version, language, stack, tag, owner, repo, is_global } = options;

		if (query) {
			try {
				return this.ftsCount({ query, context, version, language, stack, tag, owner, repo, is_global });
			} catch {
				// Fall through to LIKE count (matches search()'s fallback)
			}
		}

		const { clauses, params } = buildNonFtsFilters({
			query,
			context,
			version,
			language,
			stack,
			tag,
			owner,
			repo,
			is_global
		});
		const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
		const row = this.get<{ count: number }>(`SELECT COUNT(*) as count FROM coding_standards ${whereClause}`, params);
		return row?.count ?? 0;
	}

	private ftsSearch(options: {
		query: string;
		context?: string;
		version?: string;
		language?: string;
		stack?: string;
		tag?: string;
		owner?: string;
		repo?: string;
		is_global?: boolean;
		limit?: number;
		offset?: number;
	}): CodingStandardEntry[] {
		const { limit = 20, offset = 0 } = options;

		const { conditions, params } = buildFtsFilters(options);

		params.push(limit, offset);

		const sql = `
			SELECT cs.*
			FROM coding_standards_fts fts
			JOIN coding_standards cs ON cs.rowid = fts.rowid
			WHERE ${conditions.join(" AND ")}
			ORDER BY rank
			LIMIT ? OFFSET ?
		`;

		const rows = this.all<CodingStandardRow>(sql, params);
		return rows.map((r) => this.rowToEntry(r));
	}

	/**
	 * COUNT(*) counterpart of ftsSearch — same FTS join + filters, no row
	 * materialization (TASK-406). Shared conditions via buildFtsFilters.
	 */
	private ftsCount(options: {
		query: string;
		context?: string;
		version?: string;
		language?: string;
		stack?: string;
		tag?: string;
		owner?: string;
		repo?: string;
		is_global?: boolean;
	}): number {
		const { conditions, params } = buildFtsFilters(options);

		const row = this.get<{ count: number }>(
			`
			SELECT COUNT(*) as count
			FROM coding_standards_fts fts
			JOIN coding_standards cs ON cs.rowid = fts.rowid
			WHERE ${conditions.join(" AND ")}
			`,
			params
		);
		return row?.count ?? 0;
	}

	searchBySimilarity(
		query: string,
		options: {
			context?: string;
			version?: string;
			language?: string;
			stack?: string[];
			tags?: string[];
			owner?: string;
			repo?: string;
			is_global?: boolean;
			limit?: number;
			offset?: number;
			minScore?: number;
		}
	): Array<CodingStandardEntry & { similarity: number }> {
		const candidates = this.search({
			context: options.context,
			version: options.version,
			language: options.language,
			stack: options.stack?.[0],
			tag: options.tags?.[0],
			owner: options.owner,
			repo: options.repo,
			is_global: options.is_global,
			limit: options.limit ?? STANDARD_CANDIDATE_CAP,
			offset: options.offset ?? 0
		});

		const queryVector = computeVector(query);
		const scored = candidates
			.map((standard) => {
				const haystack = [
					standard.title,
					standard.content,
					standard.context,
					standard.language ?? "",
					standard.version,
					...standard.stack,
					...standard.tags,
					JSON.stringify(standard.metadata)
				]
					.filter(Boolean)
					.join(" ");
				const similarity = cosineSimilarity(queryVector, this.tfCache.get(standard.id, haystack, standard.updated_at));
				return { ...standard, similarity };
			})
			.sort((a, b) => b.similarity - a.similarity);

		const { minScore } = options;
		if (minScore !== undefined) {
			return scored.filter((s) => s.similarity >= minScore);
		}
		return scored;
	}

	/**
	 * Check if a new coding standard's content conflicts with an existing one.
	 *
	 * Returns the first conflicting entry whose cosine similarity exceeds `threshold`.
	 * A conflict is SKIPPED (returns null) when the incoming version differs from
	 * the conflicting entry's version — this allows intentional version bumps.
	 *
	 * @param content   Raw content of the new standard to check.
	 * @param incomingVersion  Version of the new standard (e.g. "2.0.0").
	 * @param owner     Owner filter; pass undefined for global standards.
	 * @param repo      Repo filter; pass undefined for global standards.
	 * @param threshold Cosine-similarity cutoff (default 0.82 — stricter than memory).
	 */
	checkConflicts(
		content: string,
		incomingVersion: string,
		owner: string | undefined,
		repo: string | undefined,
		incomingLanguage: string | null | undefined,
		incomingStack: string[],
		threshold = STANDARD_CONFLICT_THRESHOLD
	): (CodingStandardEntry & { similarity: number }) | null {
		// Delegate vector scoring to searchBySimilarity — push threshold
		// filtering into the search so we never iterate below-threshold rows.
		const candidates = this.searchBySimilarity(content, {
			owner,
			repo,
			limit: STANDARD_CONFLICT_CANDIDATES,
			offset: 0,
			minScore: threshold
		});

		for (const standard of candidates) {
			// ---- Guard: exempt if ANY identifying dimension differs ----

			// 1. Version guard
			if (incomingVersion && standard.version && incomingVersion !== standard.version) {
				continue;
			}

			// 2. Language guard (only when BOTH sides have a language value)
			if (incomingLanguage && standard.language && incomingLanguage !== standard.language) {
				continue;
			}

			// 3. Stack guard: if incoming stack is non-empty and has NO overlap with
			//    the existing stack, treat them as targeting different ecosystems.
			if (
				incomingStack.length > 0 &&
				standard.stack.length > 0 &&
				!incomingStack.some((s) => standard.stack.includes(s))
			) {
				continue;
			}

			// All guards passed — this is a genuine duplicate
			return standard;
		}

		return null;
	}

	getByIds(ids: string[]): CodingStandardEntry[] {
		if (ids.length === 0) return [];
		// Chunk at BULK_UPDATE_CHUNK_SIZE (500) to bound the IN()-list width —
		// same rationale as memory.entity.ts.getByIds.
		const results: CodingStandardEntry[] = [];
		for (const chunk of chunksOf(ids, BULK_UPDATE_CHUNK_SIZE)) {
			const placeholders = chunk.map(() => "?").join(",");
			const rows = this.all<CodingStandardRow>(`SELECT * FROM coding_standards WHERE id IN (${placeholders})`, chunk);
			results.push(...rows.map((row) => this.rowToEntry(row)));
		}
		return results;
	}

	update(id: string, updates: Partial<CodingStandardEntry>): void {
		const { fields, values } = buildUpdateClause(buildStandardUpdateMap(updates), {
			intKeys: STANDARD_INT_KEYS,
			excludeKeys: STANDARD_EXCLUDE_KEYS
		});

		if (fields.length === 0) return;

		fields.push("updated_at = ?");
		values.push(new Date().toISOString());
		values.push(id);

		this.run(`UPDATE coding_standards SET ${fields.join(", ")} WHERE id = ?`, values as (string | number | null)[]);
	}

	delete(id: string): void {
		// coding_standards lives in memory.db; its vector lives in the derived
		// database with NO cross-database FK, so the previously implicit
		// ON DELETE CASCADE is now an explicit delete (TASK-037).
		this.run("DELETE FROM coding_standards WHERE id = ?", [id]);
		this.run("DELETE FROM derived.standard_vectors WHERE standard_id = ?", [id]);
	}

	incrementHitCounts(ids: string[]): void {
		if (ids.length === 0) return;
		const now = new Date().toISOString();
		// Chunk at BULK_UPDATE_CHUNK_SIZE (500) — same rationale as getByIds.
		for (const chunk of chunksOf(ids, BULK_UPDATE_CHUNK_SIZE)) {
			const placeholders = chunk.map(() => "?").join(",");
			this.run(
				`UPDATE coding_standards
				 SET hit_count = hit_count + 1,
				     last_used_at = ?
				 WHERE id IN (${placeholders})`,
				[now, ...chunk]
			);
		}
	}

	getVectorCandidates(
		repo?: string,
		limit = VECTOR_CANDIDATE_CAP
	): { standard_id: string; vector: string | Uint8Array }[] {
		let sql = `SELECT sv.standard_id, sv.vector
			FROM derived.standard_vectors sv
			JOIN coding_standards cs ON cs.id = sv.standard_id`;
		const params: (string | number)[] = [];

		if (repo) {
			sql += " WHERE (cs.repo = ? OR cs.is_global = 1)";
			params.push(repo);
		}

		sql += " ORDER BY cs.updated_at DESC LIMIT ?";
		params.push(limit);
		return this.all<{ standard_id: string; vector: string | Uint8Array }>(sql, params);
	}

	upsertVectorEmbedding(standardId: string, vector: unknown, meta?: VectorWriteMeta): void {
		// Dense embeddings are stored as a float32 BLOB, sparse TF maps as JSON
		// TEXT — see encodeVector (TASK-038).
		//
		// PERF-003: persist content_hash + model_version when supplied (COALESCE
		// keeps an existing value on a NULL write) — see memory.vector.ts.
		this.run(
			`INSERT INTO derived.standard_vectors (standard_id, vector, updated_at, content_hash, model_version)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(standard_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at,
				content_hash = COALESCE(excluded.content_hash, content_hash),
				model_version = COALESCE(excluded.model_version, model_version)`,
			[
				standardId,
				encodeVector(vector),
				new Date().toISOString(),
				meta?.contentHash ?? null,
				meta?.modelVersion ?? null
			]
		);
	}
}
