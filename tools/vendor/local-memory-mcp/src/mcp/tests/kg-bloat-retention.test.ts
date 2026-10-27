/**
 * Unit tests for the KG bloat + retention audit fixes.
 *
 * Covered:
 *   F0  — bounded `co_mentioned` clique in `saveExtractions`
 *   F1  — `deleteStaleObservations` (parent-aware) + `deleteUnreachableRelations`
 *   F2  — `getRelationsFor` bounded UNION with confidence ranking
 *   F6  — `getEntitiesFor` resolves repository-scoped entity identities
 *   F8  — markdown-heading / ordinal entity names rejected
 *   F12 — relation writers emit contract-format observation text
 *   F13 — bounded task/standard relation cross-products
 *
 * Strategy: real in-memory SQLiteStore (createTestStore) throughout — every
 * assertion here is about SQL semantics or row counts, so a mock would prove
 * nothing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { extractEntities, saveExtractions, saveTaskRelations, observationText } from "../tools/kg-archivist";
import { pruneObservations, pruneRelations } from "../services/soul-maintenance";
import {
	KG_MAX_COOCCURRENCE_ENTITIES,
	KG_MAX_TASK_RELATION_ENTITIES,
	KG_RELATION_PRUNE_MAX_ROWS,
	KG_RELATION_PRUNE_REMAINING_UNKNOWN
} from "../utils/constants";
import type { MemoryEntry, Task } from "../types";

const REPO = "kg-audit-test";
const OWNER = "test";
const OLD = "2024-01-01T00:00:00.000Z";
const NOW = new Date().toISOString();

function countRelations(db: SQLiteStore, type?: string): number {
	const sql = type
		? "SELECT COUNT(*) AS c FROM relations WHERE relation_type = ?"
		: "SELECT COUNT(*) AS c FROM relations";
	return (db.db.prepare(sql).get(...(type ? [type] : [])) as { c: number }).c;
}

function countObservations(db: SQLiteStore): number {
	return (db.db.prepare("SELECT COUNT(*) AS c FROM observations").get() as { c: number }).c;
}

function seedEntity(db: SQLiteStore, name: string, repo = REPO, created_at = NOW): void {
	db.knowledgeGraph.upsertEntity({
		name,
		type: "concept",
		description: null,
		repo,
		owner: OWNER,
		created_at,
		updated_at: created_at
	});
}

function seedRelation(
	db: SQLiteStore,
	from: string,
	to: string,
	opts: { type?: string; repo?: string; confidence?: number; created_at?: string } = {}
): void {
	db.knowledgeGraph.upsertRelation({
		from_entity: from,
		to_entity: to,
		relation_type: opts.type ?? "co_mentioned",
		repo: opts.repo ?? REPO,
		owner: OWNER,
		created_at: opts.created_at ?? NOW,
		confidence: opts.confidence
	});
}

function seedObservation(db: SQLiteStore, entity: string, text: string, repo = REPO, created_at = NOW): void {
	db.knowledgeGraph.insertObservation({
		id: `${entity}-${text}-${repo}`.slice(0, 60) + Math.random().toString(36).slice(2, 8),
		entity_name: entity,
		observation: text,
		repo,
		owner: OWNER,
		created_at
	});
}

// ---------------------------------------------------------------------------
// F8 — entity-name filter
// ---------------------------------------------------------------------------

describe("KG audit F8 — markdown structure is not an entity name", () => {
	it("rejects ATX headings and ordinal list markers", async () => {
		const content = [
			"## Acceptance Criteria",
			"### 1. Context and Analysis",
			"1. Cross-tenant integration test",
			"2) Tenant scoped Redis prefix",
			"#534AB7"
		].join("\n");

		const names = (await extractEntities(content)).map((e) => e.name);

		expect(names.some((n) => n.startsWith("#"))).toBe(false);
		expect(names.some((n) => /^\d+[.)]\s/.test(n))).toBe(false);
	});

	it("still accepts prose that merely begins with a digit (no list separator)", async () => {
		const names = (await extractEntities("The 3D renderer handles the viewport.")).map((e) => e.name);

		// Nothing was rejected for starting with a digit — at least one entity
		// survived from a sentence whose only noun phrase starts with "3D".
		expect(names.length).toBeGreaterThan(0);
		expect(names.some((n) => n.startsWith("#"))).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// F0 — bounded co-occurrence clique
// ---------------------------------------------------------------------------

describe("KG audit F0 — bounded co_mentioned clique", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});
	afterEach(() => {
		db.close();
		vi.restoreAllMocks();
	});

	it("caps pair generation at KG_MAX_COOCCURRENCE_ENTITIES while keeping EVERY entity + observation", async () => {
		// 40 distinct proper nouns → compromise yields well above the cap.
		const nouns = Array.from({ length: 40 }, (_, i) => `Alphaterm${i}`);
		await saveExtractions(nouns.join(" and "), "Wide Memory", OWNER, REPO, db);

		const entities = (db.db.prepare("SELECT COUNT(*) AS c FROM entities").get() as { c: number }).c;
		const cap = KG_MAX_COOCCURRENCE_ENTITIES;
		const maxPairs = (cap * (cap - 1)) / 2;

		// Entities are NOT capped — the graph still knows about every one.
		expect(entities).toBeGreaterThan(cap);
		// Every entity got its observation row (the document↔graph link).
		expect(countObservations(db)).toBe(entities);
		// Edges ARE capped.
		expect(countRelations(db, "co_mentioned")).toBeLessThanOrEqual(maxPairs);
		// And the uncapped clique would have been far larger.
		expect((entities * (entities - 1)) / 2).toBeGreaterThan(maxPairs);
	});

	it("leaves documents below the cap byte-identical (full clique)", async () => {
		await saveExtractions("Alice and Bob deployed Redis in Seattle", "Small Memory", OWNER, REPO, db);

		const entities = (db.db.prepare("SELECT COUNT(*) AS c FROM entities").get() as { c: number }).c;
		expect(entities).toBeLessThanOrEqual(KG_MAX_COOCCURRENCE_ENTITIES);
		expect(countRelations(db, "co_mentioned")).toBe((entities * (entities - 1)) / 2);
	});
});

// ---------------------------------------------------------------------------
// F2 — bounded, confidence-ranked relation lookup
// ---------------------------------------------------------------------------

describe("KG audit F2 — getRelationsFor is bounded and confidence-ranked", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
		seedEntity(db, "hub");
		for (let i = 0; i < 30; i++) {
			seedEntity(db, `leaf${i}`);
			// Half the edges point AT the hub so both UNION branches contribute.
			if (i % 2 === 0) seedRelation(db, "hub", `leaf${i}`, { confidence: 0.55 });
			else seedRelation(db, `leaf${i}`, "hub", { type: "call", confidence: 0.9 });
		}
	});
	afterEach(() => db.close());

	it("returns both directions of the adjacency list (UNION of from- and to-branches)", () => {
		const rows = db.knowledgeGraph.getRelationsFor(["hub"], REPO, 0);

		expect(rows).toHaveLength(30);
		expect(rows.some((r) => r.from === "hub")).toBe(true);
		expect(rows.some((r) => r.to === "hub")).toBe(true);
	});

	it("truncates to the limit and keeps the HIGHEST-confidence edges", () => {
		const rows = db.knowledgeGraph.getRelationsFor(["hub"], REPO, 10);

		expect(rows).toHaveLength(10);
		// confidence 0.9 edges are the `call` ones; all 15 exist, so a
		// confidence-ranked window of 10 must be entirely `call`.
		expect(rows.every((r) => r.type === "call")).toBe(true);
	});

	it("limit = 0 means unbounded", () => {
		expect(db.knowledgeGraph.getRelationsFor(["hub"], REPO, 0)).toHaveLength(30);
	});

	it("stays scoped to the repo", () => {
		seedEntity(db, "other-hub", "other-repo");
		seedEntity(db, "other-leaf", "other-repo");
		seedRelation(db, "other-hub", "other-leaf", { repo: "other-repo" });

		expect(db.knowledgeGraph.getRelationsFor(["other-hub"], REPO, 0)).toHaveLength(0);
		expect(db.knowledgeGraph.getRelationsFor(["other-hub"], "other-repo", 0)).toHaveLength(1);
	});

	it("returns [] for an empty name set", () => {
		expect(db.knowledgeGraph.getRelationsFor([], REPO)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// F6 — entities lookup must not be repo-filtered
// ---------------------------------------------------------------------------

describe("KG repository-scoped entity identity", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});
	afterEach(() => db.close());

	it("returns the repository-local row when names collide", () => {
		seedEntity(db, "priority", "repo-a");
		seedEntity(db, "priority", "repo-b");

		const rows = db.knowledgeGraph.getEntitiesFor(["priority"], "repo-b");

		expect(rows).toHaveLength(1);
		expect(rows[0].name).toBe("priority");
	});

	it("returns every endpoint from the relation's repository", () => {
		seedEntity(db, "priority", "repo-a");
		seedEntity(db, "priority", "repo-b");
		seedEntity(db, "section", "repo-b");
		seedRelation(db, "priority", "section", { repo: "repo-b" });

		const entities = db.knowledgeGraph.getEntitiesFor(["priority", "section"], "repo-b");
		const relations = db.knowledgeGraph.getRelationsFor(["priority", "section"], "repo-b", 0);

		// Every endpoint of every shipped edge is present in the entity payload.
		const known = new Set(entities.map((e) => e.name));
		for (const rel of relations) {
			expect(known.has(rel.from)).toBe(true);
			expect(known.has(rel.to)).toBe(true);
		}
	});

	it("returns [] for an empty name set", () => {
		expect(db.knowledgeGraph.getEntitiesFor([], "repo-a")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// F1 — parent-aware observation prune
// ---------------------------------------------------------------------------

describe("KG audit F1 — deleteStaleObservations keeps live document links", () => {
	let db: SQLiteStore;

	const memory: MemoryEntry = {
		id: "123e4567-e89b-42d3-a456-426614174000",
		type: "code_fact",
		title: "Live Memory",
		content: "Still exists.",
		importance: 3,
		agent: "test",
		role: "backend",
		model: "test",
		scope: { owner: OWNER, repo: REPO },
		created_at: OLD,
		updated_at: OLD,
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

	beforeEach(async () => {
		db = await createTestStore();
		db.memories.insert(memory);
	});
	afterEach(() => db.close());

	it("KEEPS an old observation whose parent memory still exists", async () => {
		seedEntity(db, "LiveEntity", REPO, OLD);
		seedObservation(db, "LiveEntity", observationText("memory", memory.title), REPO, OLD);

		const deleted = await db.knowledgeGraph.deleteStaleObservations(NOW);

		expect(deleted).toBe(0);
		expect(countObservations(db)).toBe(1);
	});

	it("DELETES an old observation whose parent memory is gone", async () => {
		seedEntity(db, "GhostEntity", REPO, OLD);
		seedObservation(db, "GhostEntity", observationText("memory", "Deleted Memory"), REPO, OLD);

		expect(await db.knowledgeGraph.deleteStaleObservations(NOW)).toBe(1);
		expect(countObservations(db)).toBe(0);
	});

	it("DELETES an inline-format observation when the entity has no contract anchor", async () => {
		seedEntity(db, "InlineOnly", REPO, OLD);
		seedObservation(db, "InlineOnly", "call relation: InlineOnly → Other", REPO, OLD);

		expect(await db.knowledgeGraph.deleteStaleObservations(NOW)).toBe(1);
	});

	it("KEEPS an inline-format observation when the entity IS contract-anchored", async () => {
		seedEntity(db, "Anchored", REPO, OLD);
		seedObservation(db, "Anchored", observationText("memory", memory.title), REPO, OLD);
		seedObservation(db, "Anchored", "call relation: Anchored → Other", REPO, OLD);

		expect(await db.knowledgeGraph.deleteStaleObservations(NOW)).toBe(0);
		expect(countObservations(db)).toBe(2);
	});

	it("never touches rows newer than the cutoff", async () => {
		seedEntity(db, "FreshGhost", REPO, NOW);
		seedObservation(db, "FreshGhost", observationText("memory", "Deleted Memory"), REPO, NOW);

		expect(await db.knowledgeGraph.deleteStaleObservations(OLD)).toBe(0);
	});

	it("pruneObservations reports the delegated count", async () => {
		seedEntity(db, "GhostEntity", REPO, OLD);
		seedObservation(db, "GhostEntity", observationText("memory", "Deleted Memory"), REPO, OLD);

		expect(await pruneObservations(db.knowledgeGraph, 7)).toEqual({ deleted: 1 });
	});
});

// ---------------------------------------------------------------------------
// F1 — relation retention sweep
// ---------------------------------------------------------------------------

describe("KG audit F1 — deleteUnreachableRelations", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});
	afterEach(() => db.close());

	it("deletes only OLD edges whose BOTH endpoints are unobserved", async () => {
		seedEntity(db, "orphanA", REPO, OLD);
		seedEntity(db, "orphanB", REPO, OLD);
		seedRelation(db, "orphanA", "orphanB", { created_at: OLD });

		seedEntity(db, "observedA", REPO, OLD);
		seedEntity(db, "observedB", REPO, OLD);
		seedObservation(db, "observedA", observationText("memory", "Some Memory"), REPO, OLD);
		seedRelation(db, "observedA", "observedB", { created_at: OLD });

		const deleted = await db.knowledgeGraph.deleteUnreachableRelations(NOW, 1000, 100);

		expect(deleted).toBe(1);
		expect(countRelations(db)).toBe(1);
		const survivor = db.db.prepare("SELECT from_entity FROM relations").get() as { from_entity: string };
		expect(survivor.from_entity).toBe("observedA");
	});

	it("prunes an edge when its endpoint is observed only in another repository", async () => {
		seedEntity(db, "sharedA", "repo-a", OLD);
		seedEntity(db, "sharedA", "repo-b", OLD);
		seedEntity(db, "sharedB", "repo-b", OLD);
		seedObservation(db, "sharedA", observationText("memory", "Cross Memory"), "repo-a", OLD);
		seedRelation(db, "sharedA", "sharedB", { repo: "repo-b", created_at: OLD });

		expect(await db.knowledgeGraph.deleteUnreachableRelations(NOW, 1000, 100)).toBe(1);
		expect(countRelations(db)).toBe(0);
	});

	it("respects the age guard — fresh edges are never swept", async () => {
		seedEntity(db, "freshA", REPO, NOW);
		seedEntity(db, "freshB", REPO, NOW);
		seedRelation(db, "freshA", "freshB", { created_at: NOW });

		expect(await db.knowledgeGraph.deleteUnreachableRelations(OLD, 1000, 100)).toBe(0);
	});

	it("honours maxRows and converges across successive runs", async () => {
		for (let i = 0; i < 10; i++) {
			seedEntity(db, `a${i}`, REPO, OLD);
			seedEntity(db, `b${i}`, REPO, OLD);
			seedRelation(db, `a${i}`, `b${i}`, { created_at: OLD });
		}

		expect(await db.knowledgeGraph.deleteUnreachableRelations(NOW, 4, 2)).toBe(4);
		expect(countRelations(db)).toBe(6);
		expect(await db.knowledgeGraph.deleteUnreachableRelations(NOW, 100, 2)).toBe(6);
		expect(countRelations(db)).toBe(0);
	});

	it("maxRows <= 0 is a no-op", async () => {
		seedEntity(db, "x", REPO, OLD);
		seedEntity(db, "y", REPO, OLD);
		seedRelation(db, "x", "y", { created_at: OLD });

		expect(await db.knowledgeGraph.deleteUnreachableRelations(NOW, 0, 100)).toBe(0);
		expect(countRelations(db)).toBe(1);
	});

	it("countPrunableRelations reports the backlog without deleting", () => {
		seedEntity(db, "p", REPO, OLD);
		seedEntity(db, "q", REPO, OLD);
		seedRelation(db, "p", "q", { created_at: OLD });

		expect(db.knowledgeGraph.countPrunableRelations(NOW)).toBe(1);
		expect(countRelations(db)).toBe(1);
	});

	it("yields to the event loop between chunks so the sweep never blocks the main thread", async () => {
		// 10 prunable edges; cap 4 / chunk 2 → two chunks, so the sweep must
		// yield at least once between them.
		for (let i = 0; i < 10; i++) {
			seedEntity(db, `a${i}`, REPO, OLD);
			seedEntity(db, `b${i}`, REPO, OLD);
			seedRelation(db, `a${i}`, `b${i}`, { created_at: OLD });
		}

		const order: string[] = [];

		// Scheduled BEFORE the sweep starts: if the loop never yielded, the
		// sweep would run to completion in the same tick, so the microtask
		// continuation would push "sweep" BEFORE this macrotask ever fires.
		setImmediate(() => order.push("external"));

		const sweep = db.knowledgeGraph.deleteUnreachableRelations(NOW, 4, 2);
		await sweep.then(() => order.push("sweep"));

		expect(order).toEqual(["external", "sweep"]);
	});

	it("pruneRelations sweeps the now-orphaned entities and reports the exact remainder at the tail", async () => {
		for (let i = 0; i < 6; i++) {
			seedEntity(db, `o${i}`, REPO, OLD);
			seedEntity(db, `t${i}`, REPO, OLD);
			seedRelation(db, `o${i}`, `t${i}`, { created_at: OLD });
		}

		// maxRows 4 with chunk 2: deletes 4 (< cap is impossible here since it
		// hits the cap)... so drive the TAIL explicitly: first a capped run,
		// then a tail run.
		const capped = await pruneRelations(db.knowledgeGraph, 0, 4, 2);

		expect(capped.deleted).toBe(4);
		// 8 endpoints lost their only reference.
		expect(capped.orphanEntitiesDeleted).toBe(8);
		// Hit the cap → remaining is the sentinel (expensive count skipped).
		expect(capped.remaining).toBe(KG_RELATION_PRUNE_REMAINING_UNKNOWN);

		// Second run: only 2 eligible rows remain, cap is 4 → tail reached, so
		// the exact remaining count IS computed (and is 0).
		const tail = await pruneRelations(db.knowledgeGraph, 0, 4, 2);

		expect(tail.deleted).toBe(2);
		expect(tail.remaining).toBe(0);
	});

	it("pruneRelations reports an EXACT remaining count when the run does not hit the cap", async () => {
		for (let i = 0; i < 6; i++) {
			seedEntity(db, `o${i}`, REPO, OLD);
			seedEntity(db, `t${i}`, REPO, OLD);
			seedRelation(db, `o${i}`, `t${i}`, { created_at: OLD });
		}

		// Cap of 100 > 6 eligible: the sweep drains the tail, so the correlated
		// count runs once and returns the (exact) zero.
		const result = await pruneRelations(db.knowledgeGraph, 0, 100, 2);

		expect(result.deleted).toBe(6);
		expect(result.remaining).toBe(0);
	});

	it("pruneRelations SKIPS the expensive remaining count when the run hits the cap (TASK-041)", async () => {
		for (let i = 0; i < 10; i++) {
			seedEntity(db, `o${i}`, REPO, OLD);
			seedEntity(db, `t${i}`, REPO, OLD);
			seedRelation(db, `o${i}`, `t${i}`, { created_at: OLD });
		}

		// Spy on the exact count and assert it is never invoked on a capped run.
		const countSpy = vi.spyOn(db.knowledgeGraph, "countPrunableRelations");

		const result = await pruneRelations(db.knowledgeGraph, 0, 4, 2);

		expect(result.deleted).toBe(4);
		expect(result.remaining).toBe(KG_RELATION_PRUNE_REMAINING_UNKNOWN);
		// A backlog provably remains, so the ~105s correlated scan is skipped.
		expect(countSpy).not.toHaveBeenCalled();
	});

	it("pruneRelations short-circuits with zeros when nothing is eligible", async () => {
		expect(await pruneRelations(db.knowledgeGraph, 0, 1000, 100)).toEqual({
			deleted: 0,
			orphanEntitiesDeleted: 0,
			remaining: 0
		});
	});
});

// ---------------------------------------------------------------------------
// Sparse-predicate windowed deletes yield to the event loop (heartbeat fix)
// ---------------------------------------------------------------------------

describe("windowed deletes yield so the exclusive lock heartbeat can refresh", () => {
	let db: SQLiteStore;

	beforeEach(async () => {
		db = await createTestStore();
	});
	afterEach(() => db.close());

	it("deleteStaleObservations yields between rowid windows", async () => {
		// 6 prunable observations spread across rowids; window of 2 → ≥3 windows,
		// so the sweep MUST yield at least once.
		for (let i = 0; i < 6; i++) {
			seedEntity(db, `ghost${i}`, REPO, OLD);
			seedObservation(db, `ghost${i}`, observationText("memory", `Deleted ${i}`), REPO, OLD);
		}

		const order: string[] = [];
		setImmediate(() => order.push("external"));

		const sweep = db.knowledgeGraph.deleteStaleObservations(NOW, 2);
		await sweep.then(() => order.push("sweep"));

		// If the delete never yielded, "sweep" would precede "external".
		expect(order).toEqual(["external", "sweep"]);
		expect(await sweep).toBe(6);
		expect(countObservations(db)).toBe(0);
	});

	it("deleteOrphanEntities yields between rowid windows", async () => {
		for (let i = 0; i < 6; i++) seedEntity(db, `orphan${i}`, REPO, OLD);

		const order: string[] = [];
		setImmediate(() => order.push("external"));

		const sweep = db.knowledgeGraph.deleteOrphanEntities(2);
		await sweep.then(() => order.push("sweep"));

		expect(order).toEqual(["external", "sweep"]);
		expect(await sweep).toBe(6);
	});

	it("deleteOrphanEntities keeps entities still referenced by an observation", async () => {
		seedEntity(db, "keepMe", REPO, OLD);
		seedObservation(db, "keepMe", observationText("memory", "Some Memory"), REPO, OLD);
		seedEntity(db, "dropMe", REPO, OLD);

		expect(await db.knowledgeGraph.deleteOrphanEntities(1)).toBe(1);
		const remaining = db.db.prepare("SELECT name FROM entities").all() as Array<{ name: string }>;
		expect(remaining.map((r) => r.name)).toEqual(["keepMe"]);
	});

	it("deleteOrphanEntities is a no-op on an empty table", async () => {
		expect(await db.knowledgeGraph.deleteOrphanEntities(100)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// TASK-041 — prune cap default + env override
// ---------------------------------------------------------------------------

describe("KG_RELATION_PRUNE_MAX_ROWS (TASK-041 backlog drain)", () => {
	afterEach(() => {
		delete process.env.KG_RELATION_PRUNE_MAX_ROWS;
	});

	it("defaults to 500,000 so the accumulated backlog drains in days", () => {
		expect(KG_RELATION_PRUNE_MAX_ROWS).toBe(500_000);
	});

	it("is env-overridable (envInt reads the var at module load)", async () => {
		process.env.KG_RELATION_PRUNE_MAX_ROWS = "1234";

		// The constant is bound at module-load time, so drop the cached module
		// and re-import so `envInt` re-reads process.env.
		vi.resetModules();
		const mod = await import("../utils/constants");

		expect(mod.KG_RELATION_PRUNE_MAX_ROWS).toBe(1234);
	});

	it("exposes the sentinel as an unambiguous negative value", () => {
		expect(KG_RELATION_PRUNE_REMAINING_UNKNOWN).toBe(-1);
	});
});

// ---------------------------------------------------------------------------
// F12 + F13 — task relation writer
// ---------------------------------------------------------------------------

describe("KG audit F12/F13 — saveTaskRelations", () => {
	let db: SQLiteStore;

	function makeTask(overrides: Partial<Task>): Task {
		return {
			id: overrides.id ?? "task-id",
			owner: OWNER,
			repo: REPO,
			task_code: "T-1",
			phase: "build",
			title: "Task Title",
			description: "Task description.",
			status: "backlog",
			priority: 3,
			agent: "test",
			role: "backend",
			doc_path: null,
			created_at: NOW,
			updated_at: NOW,
			in_progress_at: null,
			finished_at: null,
			canceled_at: null,
			est_tokens: 0,
			tags: [],
			suggested_skills: [],
			commit_id: null,
			changed_files: [],
			metadata: {},
			parent_id: null,
			depends_on: null,
			...overrides
		};
	}

	beforeEach(async () => {
		db = await createTestStore();
	});
	afterEach(() => db.close());

	it("writes contract-format observation text, not the old inline format", async () => {
		const parent = makeTask({ id: "parent-id", title: "Parent Task", description: "Redis and Postgres." });
		db.tasks.insertTask(parent);

		await saveTaskRelations("Alice deployed Redis", "Child Task", OWNER, REPO, db, { parentId: parent.id });

		const texts = (
			db.db.prepare("SELECT DISTINCT observation FROM observations").all() as Array<{
				observation: string;
			}>
		).map((r) => r.observation);

		expect(texts.length).toBeGreaterThan(0);
		// Every row is matchable by deleteObservationsAndOrphans.
		for (const text of texts) {
			expect(text).toBe(observationText("task", "Child Task"));
		}
		expect(texts.some((t) => t.includes("depends_on relation:"))).toBe(false);
	});

	it("bounds the depends_on cross-product on BOTH sides", async () => {
		const many = Array.from({ length: 30 }, (_, i) => `Betaterm${i}`).join(" and ");
		const parent = makeTask({ id: "parent-id", title: "Parent Task", description: many });
		db.tasks.insertTask(parent);

		await saveTaskRelations(many, "Child Task", OWNER, REPO, db, { parentId: parent.id });

		const cap = KG_MAX_TASK_RELATION_ENTITIES;
		expect(countRelations(db, "depends_on")).toBeLessThanOrEqual(cap * cap);
	});

	it("bounds the inspired_by fan-out to the capped entity slice", async () => {
		const many = Array.from({ length: 30 }, (_, i) => `Gammaterm${i}`).join(" and ");

		await saveTaskRelations(many, "Child Task", OWNER, REPO, db, { decisionRefs: ["ADR-001", "ADR-002"] });

		expect(countRelations(db, "inspired_by")).toBeLessThanOrEqual(KG_MAX_TASK_RELATION_ENTITIES * 2);
	});
});
