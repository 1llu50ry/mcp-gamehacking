import { BaseEntity } from "../storage/base";
import {
	MemoryEntry,
	MemoryRow,
	VectorStore,
	MemoryIdVector,
	VectorWriteMeta,
	MEMORY_STATUS_ACTIVE,
	MEMORY_STATUS_ARCHIVED
} from "../types";
import { TABLE_MEMORIES } from "../utils/constants";
import { computeVector, cosineSimilarity, createTfVectorCache, encodeVector } from "../utils/vector";
import {
	VECTOR_CANDIDATE_CAP,
	MIN_CANDIDATES,
	SIMILARITY_ZERO_FALLBACK,
	REPO_MATCH_BOOST,
	MEMORY_CHECK_CONFLICTS_THRESHOLD
} from "../utils/constants";

export class MemoryVectorEntity extends BaseEntity {
	// In-memory TF vector cache keyed by memory id and validated against
	// memories.updated_at — self-invalidates on writes without write-path hooks.
	private readonly tfCache = createTfVectorCache();
	/**
	 * Candidate (memory_id, vector) rows for the vector-search fallback,
	 * optionally scoped by owner and/or repo.
	 *
	 * **Empty `owner` means ANY owner (audit F7).** The previous shape treated a
	 * truthy `repo` as "filter on both columns" and interpolated `owner!` —
	 * which meant the sole production caller, `RealVectorStore.search`, always
	 * emitted `WHERE m.owner = '' AND m.repo = ?` because it passes a hardcoded
	 * empty-string owner. Memories are stored with a REAL owner (the GitHub
	 * org/username), so on a real database only 380 of 710 vectorized memories
	 * (54%) had `owner = ''` and the other **330 (46%) could never match the
	 * query at all** — for one repo the candidate set went from 44 rows with the
	 * correct owner to 0 rows with the empty one.
	 *
	 * The bug was masked because `memory.read` only reaches the vector stage
	 * when the TF-similarity + FTS pipeline produced zero candidates, so the
	 * failure looked like "vector search didn't add anything" rather than an
	 * error. Treating an empty owner as "unscoped" both fixes it and matches the
	 * sibling stores: `standards.getVectorCandidates(repo)` and
	 * `tasks.getTaskVectorCandidates(repo)` take no owner at all.
	 */
	getVectorCandidates(
		owner?: string,
		repo?: string,
		limit = VECTOR_CANDIDATE_CAP
	): {
		memory_id: string;
		vector: string | Uint8Array;
	}[] {
		let sql = `SELECT mv.memory_id, mv.vector FROM derived.memory_vectors mv JOIN ${TABLE_MEMORIES} m ON mv.memory_id = m.id`;
		const params: (string | number)[] = [];
		const predicates: string[] = [];
		if (owner) predicates.push("m.owner = ?");
		if (repo) predicates.push("m.repo = ?");
		if (owner) params.push(owner);
		if (repo) params.push(repo);
		if (predicates.length > 0) sql += ` WHERE ${predicates.join(" AND ")}`;
		sql += " LIMIT ?";
		params.push(limit);
		return this.all<MemoryIdVector>(sql, params);
	}

	upsertVectorEmbedding(memoryId: string, vector: unknown, meta?: VectorWriteMeta): void {
		// Dense embeddings are stored as a float32 BLOB, sparse TF maps as JSON
		// TEXT — see encodeVector (TASK-038).
		//
		// PERF-003: persist the embed/KG `content_hash` + `model_version` when
		// supplied so the startup backfill can skip re-embedding unchanged
		// content. COALESCE keeps a previously-stored value when a caller (e.g.
		// the TF stub) does not provide one — a NULL write never erases it.
		this.run(
			`INSERT INTO derived.memory_vectors (memory_id, vector, updated_at, content_hash, model_version) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(memory_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at,
				content_hash = COALESCE(excluded.content_hash, content_hash),
				model_version = COALESCE(excluded.model_version, model_version)`,
			[memoryId, encodeVector(vector), new Date().toISOString(), meta?.contentHash ?? null, meta?.modelVersion ?? null]
		);
	}

	/**
	 * Build the broadened search predicate list (FIX-13 / MEM-426): the repo
	 * scope is OR'ed with the tag conditions — `(scope) OR (tags)` — so
	 * tag-matched memories from OTHER repos re-enter the candidate pool for the
	 * memory.read tag-affinity boost (tech-stack affinity), while non-tag
	 * out-of-scope rows stay excluded. When no tags are supplied this
	 * degenerates to the plain scope predicate, preserving the strict-AND join
	 * (TASK-009).
	 */
	private buildFallbackPredicates(
		owner: string,
		repo: string,
		currentTags: string[]
	): { predicates: string[]; params: (string | number)[] } {
		// Scope rule shared with every scoped read (queries.ts getByCode /
		// memory/search.ts): when owner is given the repo scope is
		// `(owner = ? AND repo = ?) OR is_global = 1` so GLOBAL memories from
		// other repos re-enter the candidate pool (FIX-GLOBAL-PRECEDENCE).
		// The parens are load-bearing: without them SQLite parses
		// `owner = ? AND (repo = ? OR is_global = 1)` and leaks any same-owner
		// row regardless of repo. A falsy owner falls back to the bare repo
		// equality so owner-unscoped calls (e.g. empty-owner tests / audit F7
		// vector fallbacks) keep their strict semantics.
		const hasOwnerScope = Boolean(owner);
		const scopePredicate = hasOwnerScope ? "((owner = ? AND repo = ?) OR is_global = 1)" : "(repo = ?)";
		const params: (string | number)[] = hasOwnerScope ? [owner, repo] : [repo];
		const predicates: string[] = [];

		if (currentTags.length > 0) {
			// Indexed child-table equality (OPT-PERF-07): the normalized
			// memory_tags table (tag COLLATE NOCASE, idx_memory_tags_tag) turns
			// the old `tags LIKE '%tag%'` per-row text scan into a per-candidate
			// index lookup. LIKE remains the permanent fallback for queries
			// that cannot go through the child table.
			const tagConditions = currentTags
				.map(() => "EXISTS (SELECT 1 FROM memory_tags t WHERE t.memory_id = memories.id AND t.tag = ?)")
				.join(" OR ");
			predicates.push(`(${scopePredicate} OR (${tagConditions}))`);
			currentTags.forEach((tag) => params.push(tag));
		} else {
			predicates.push(scopePredicate);
		}

		return { predicates, params };
	}

	searchBySimilarity(
		query: string,
		owner: string,
		repo: string,
		limit: number = 10,
		includeArchived: boolean = false,
		currentTags: string[] = []
	): (MemoryEntry & { similarity: number })[] {
		const queryVector = computeVector(query);
		const now = new Date();

		// Single broadened query (OPT-PERF-10): the repo scope is OR'ed with
		// the tag conditions — `(scope) OR (tags)` — so tag-matched memories
		// from OTHER repos re-enter the candidate pool for the memory.read
		// tag-affinity boost (MEM-426), while non-tag out-of-scope rows stay
		// excluded. Previously the strict primary query ran first and a second
		// full fallback query was issued whenever fewer than MIN_CANDIDATES
		// candidates matched (doubling small-corpus search cost); folding the
		// broadened predicate into this one query keeps identical recall with a
		// single round-trip per search.
		const { predicates, params } = this.buildFallbackPredicates(owner, repo, currentTags);
		predicates.push("(expires_at IS NULL OR expires_at > ?)");
		params.push(now.toISOString());
		if (!includeArchived) predicates.push(`status = '${MEMORY_STATUS_ACTIVE}'`);

		// Honor the caller's fetch limit (was a hardcoded LIMIT 100) while
		// keeping a floor so small fetches/conflict checks stay responsive.
		const candidateLimit = Math.max(limit, MIN_CANDIDATES);

		const sql = `SELECT * FROM ${TABLE_MEMORIES} WHERE ${predicates.join(" AND ")}
			ORDER BY CASE WHEN owner = ? AND repo = ? THEN 0 ELSE 1 END, importance DESC, created_at DESC LIMIT ?`;
		const candidates = this.all<MemoryRow>(sql, [...params, owner, repo, candidateLimit]);

		return candidates
			.map((row) => {
				const memory = this.rowToMemoryEntry(row);

				const isExpired = row.expires_at && new Date(row.expires_at) <= now;
				const isArchived = row.status === MEMORY_STATUS_ARCHIVED && !includeArchived;

				if (isExpired || isArchived) {
					return { ...memory, similarity: 0 };
				}

				const similarity = cosineSimilarity(queryVector, this.tfCache.get(row.id, row.content, row.updated_at)) || 0;
				let score = similarity;
				if (!score) {
					score = SIMILARITY_ZERO_FALLBACK;
				}

				if (row.repo === repo) score += REPO_MATCH_BOOST;

				return { ...memory, similarity: score };
			})
			.filter((r) => r.similarity > 0)
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, limit);
	}

	async checkConflicts(
		content: string,
		owner: string,
		repo: string,
		_type: string,
		_vectors: VectorStore,
		threshold: number = MEMORY_CHECK_CONFLICTS_THRESHOLD
	): Promise<(MemoryEntry & { similarity: number }) | null> {
		const results = await this.searchBySimilarity(content, owner, repo, 1, false);
		if (results.length > 0 && results[0].similarity >= threshold) {
			return results[0];
		}
		return null;
	}
}
