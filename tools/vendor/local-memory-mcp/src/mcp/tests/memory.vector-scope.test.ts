/**
 * Unit tests for `MemoryVectorEntity.getVectorCandidates` scoping (audit F7).
 *
 * The vector-search fallback used to pass a hardcoded empty-string owner, which
 * the old implementation turned into `WHERE m.owner = '' AND m.repo = ?` — so
 * every memory stored with a real owner was excluded from the candidate pool.
 * An empty/omitted owner must therefore mean "any owner".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import type { MemoryEntry } from "../types";

const REPO = "vector-scope-test";
const NOW = new Date().toISOString();

function makeMemory(owner: string, repo = REPO): MemoryEntry {
	return {
		id: randomUUID(),
		type: "code_fact",
		title: `Memory for ${owner || "(empty owner)"}`,
		content: "Vector candidate scoping fixture.",
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
		is_global: false
	};
}

describe("audit F7 — getVectorCandidates owner scoping", () => {
	let db: SQLiteStore;
	let ownedId: string;
	let unownedId: string;

	beforeEach(async () => {
		db = await createTestStore();

		const owned = makeMemory("acme-org");
		const unowned = makeMemory("");
		ownedId = owned.id;
		unownedId = unowned.id;

		db.memories.insert(owned);
		db.memories.insert(unowned);
		db.memoryVectors.upsertVectorEmbedding(owned.id, [0.1, 0.2, 0.3]);
		db.memoryVectors.upsertVectorEmbedding(unowned.id, [0.4, 0.5, 0.6]);
	});

	afterEach(() => db.close());

	it("an omitted owner returns candidates from EVERY owner in the repo", () => {
		const ids = db.memoryVectors.getVectorCandidates(undefined, REPO, 100).map((r) => r.memory_id);

		expect(ids).toHaveLength(2);
		expect(ids).toContain(ownedId);
		expect(ids).toContain(unownedId);
	});

	it("an empty-string owner is treated as unscoped, not as owner = ''", () => {
		const ids = db.memoryVectors.getVectorCandidates("", REPO, 100).map((r) => r.memory_id);

		// Pre-fix this returned only the empty-owner row (the bug: 46% of a real
		// corpus was unreachable).
		expect(ids).toHaveLength(2);
		expect(ids).toContain(ownedId);
	});

	it("an explicit owner still narrows the pool", () => {
		const ids = db.memoryVectors.getVectorCandidates("acme-org", REPO, 100).map((r) => r.memory_id);

		expect(ids).toEqual([ownedId]);
	});

	it("the repo filter still applies", () => {
		const other = makeMemory("acme-org", "other-repo");
		db.memories.insert(other);
		db.memoryVectors.upsertVectorEmbedding(other.id, [0.7, 0.8, 0.9]);

		const ids = db.memoryVectors.getVectorCandidates(undefined, REPO, 100).map((r) => r.memory_id);

		expect(ids).not.toContain(other.id);
		expect(ids).toHaveLength(2);
	});

	it("omitting both owner and repo returns every vectorized memory", () => {
		expect(db.memoryVectors.getVectorCandidates(undefined, undefined, 100)).toHaveLength(2);
	});

	it("the limit is honoured", () => {
		expect(db.memoryVectors.getVectorCandidates(undefined, REPO, 1)).toHaveLength(1);
	});
});
