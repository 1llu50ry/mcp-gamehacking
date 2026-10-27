/**
 * Regression tests for FIX-GLOBAL-PRECEDENCE: global memories must be
 * included by every repo-scoped search path under the canonical
 * `((owner = ? AND repo = ?) OR is_global = 1)` rule, and — because the old
 * un-parenthesized `owner = ? AND repo = ? OR is_global = 1` parsed as
 * `owner = ? AND (repo = ? OR is_global = 1)` — non-global memories of the
 * same owner in OTHER repos must NOT leak into a repo-scoped search.
 *
 * The four search paths under test:
 *   - db.memoryVectors.searchBySimilarity  (TF-similarity candidate pool)
 *   - db.memories.searchByFtsScored        (bm25-scored FTS, memory-read)
 *   - db.memories.searchByFts              (FTS-first inside searchByRepo)
 *   - db.memories.searchByRepo             (LIKE fallback path)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import type { MemoryEntry } from "../types";

const OWNER = "acme-org";
const REPO = "global-scope-repo";
const NOW = new Date().toISOString();

function makeMemory(
	overrides: { owner?: string; repo?: string; is_global?: boolean; content?: string; title?: string } = {}
): MemoryEntry {
	const owner = overrides.owner ?? OWNER;
	const repo = overrides.repo ?? REPO;
	return {
		id: randomUUID(),
		type: "code_fact",
		title: overrides.title ?? "Global scope fixture",
		content: overrides.content ?? "precedence regression fixture content",
		importance: 3,
		agent: "test",
		role: "backend",
		model: "test",
		scope: { owner, repo },
		created_at: NOW,
		updated_at: NOW,
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: null,
		supersedes: null,
		status: "active",
		tags: [],
		metadata: {},
		is_global: overrides.is_global ?? false
	};
}

describe("FIX-GLOBAL-PRECEDENCE — global memories in repo-scoped search paths", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});

	afterEach(() => db.close());

	/**
	 * Shared fixture: a repo-scoped memory that matches the query term, a
	 * GLOBAL memory (stored under a different repo/owner, as a real global
	 * write would carry the writer's own scope) that also matches, and a
	 * NON-global same-owner memory in ANOTHER repo that matches — the row
	 * the missing-parens bug used to leak.
	 */
	function seed(term: string): { localId: string; globalId: string; foreignRepoId: string } {
		const local = makeMemory({ content: `local ${term} content` });
		const global = makeMemory({
			owner: "other-org",
			repo: "other-repo",
			is_global: true,
			content: `global ${term} content`
		});
		const foreignRepo = makeMemory({
			owner: OWNER,
			repo: "other-repo",
			content: `foreign ${term} content`
		});
		db.memories.insert(local);
		db.memories.insert(global);
		db.memories.insert(foreignRepo);
		return { localId: local.id, globalId: global.id, foreignRepoId: foreignRepo.id };
	}

	function ids(memories: MemoryEntry[] | Array<{ memory: MemoryEntry; bm25: number }>): Set<string> {
		return new Set(memories.map((entry) => ("memory" in entry ? entry.memory.id : entry.id)));
	}

	it("searchBySimilarity includes the global memory and excludes the foreign-repo non-global one", () => {
		const { localId, globalId, foreignRepoId } = seed("precedence");

		const results = db.memoryVectors.searchBySimilarity("precedence", OWNER, REPO, 10);
		const resultIds = ids(results);

		expect(resultIds).toContain(localId);
		expect(resultIds).toContain(globalId);
		expect(resultIds).not.toContain(foreignRepoId);
	});

	it("searchBySimilarity with a tag-affinity scope keeps the same global semantics", () => {
		// The buildFallbackPredicates tag path wraps the scope predicate as
		// `(scope) OR (tags)` — the parens regression must be fixed there too.
		const local = makeMemory({ content: "tagged scoped memory" });
		const global = makeMemory({
			owner: "other-org",
			repo: "other-repo",
			is_global: true,
			content: "tagged global memory"
		});
		const foreignRepo = makeMemory({ owner: OWNER, repo: "other-repo", content: "tagged foreign memory" });
		db.memories.insert(local);
		db.memories.insert(global);
		db.memories.insert(foreignRepo);

		const results = db.memoryVectors.searchBySimilarity("tagged", OWNER, REPO, 10, false, ["typescript"]);
		const resultIds = ids(results);

		expect(resultIds).toContain(global.id);
		expect(resultIds).not.toContain(foreignRepo.id);
	});

	it("searchByFtsScored includes the global memory and excludes the foreign-repo non-global one", () => {
		const { localId, globalId, foreignRepoId } = seed("ftsglobal");

		const results = db.memories.searchByFtsScored("ftsglobal", OWNER, REPO, { limit: 10 });
		const resultIds = ids(results);

		expect(resultIds).toContain(localId);
		expect(resultIds).toContain(globalId);
		expect(resultIds).not.toContain(foreignRepoId);
	});

	it("searchByFts includes the global memory and excludes the foreign-repo non-global one", () => {
		const { localId, globalId, foreignRepoId } = seed("ftskeyword");

		const results = db.memories.searchByFts("ftskeyword", OWNER, REPO, undefined, 10);
		const resultIds = ids(results);

		expect(resultIds).toContain(localId);
		expect(resultIds).toContain(globalId);
		expect(resultIds).not.toContain(foreignRepoId);
	});

	it("searchByRepo FTS branch includes the global memory and excludes the foreign-repo one", () => {
		const { localId, globalId, foreignRepoId } = seed("repokeyword");

		const results = db.memories.searchByRepo(OWNER, REPO, "repokeyword", undefined, 10);
		const resultIds = ids(results);

		expect(resultIds).toContain(localId);
		expect(resultIds).toContain(globalId);
		expect(resultIds).not.toContain(foreignRepoId);
	});

	it("searchByRepo LIKE fallback includes the global memory and excludes the foreign-repo one", () => {
		// A query with no FTS match forces the LIKE fallback branch, which
		// must apply the SAME scope rule or recall would differ by FTS
		// availability. `zzle` is a mid-word substring of `sizzle`: FTS5
		// prefix matching (`zzle*`) cannot hit it, but the LIKE `%zzle%`
		// fallback does — guaranteeing the branch under test.
		const local = makeMemory({ content: "sizzle like target" });
		const global = makeMemory({
			owner: "other-org",
			repo: "other-repo",
			is_global: true,
			content: "sizzle like global"
		});
		const foreignRepo = makeMemory({ owner: OWNER, repo: "other-repo", content: "sizzle like foreign" });
		db.memories.insert(local);
		db.memories.insert(global);
		db.memories.insert(foreignRepo);

		// searchByRepo only falls to LIKE when the FTS branch yields no hits.
		const ftsProbe = db.memories.searchByFts("zzle", OWNER, REPO, undefined, 10);
		expect(ftsProbe).toHaveLength(0);

		const results = db.memories.searchByRepo(OWNER, REPO, "zzle", undefined, 10);
		const resultIds = ids(results);

		expect(resultIds).toContain(local.id);
		expect(resultIds).toContain(global.id);
		expect(resultIds).not.toContain(foreignRepo.id);
	});

	it("an unscoped (owner-less) search keeps strict repo-only semantics", () => {
		// Empty-owner callers (audit F7 / dashboard-style flows) bind only the
		// repo equality — the owner-less path must NOT widen to every global
		// memory in the database.
		const local = makeMemory({ content: "ownerless scope target" });
		const global = makeMemory({
			owner: "other-org",
			repo: "other-repo",
			is_global: true,
			content: "ownerless scope global"
		});
		db.memories.insert(local);
		db.memories.insert(global);

		const ftsResults = db.memories.searchByFts("ownerless", "", REPO, undefined, 10);
		expect(ids(ftsResults)).toContain(local.id);
		expect(ids(ftsResults)).not.toContain(global.id);

		const simResults = db.memoryVectors.searchBySimilarity("ownerless", "", REPO, 10);
		expect(ids(simResults)).toContain(local.id);
		expect(ids(simResults)).not.toContain(global.id);

		const repoResults = db.memories.searchByRepo("", REPO, "ownerless", undefined, 10);
		expect(ids(repoResults)).toContain(local.id);
		expect(ids(repoResults)).not.toContain(global.id);
	});
});
