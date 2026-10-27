/**
 * Unit tests for src/mcp/services/soul-maintenance.ts (applyDecay,
 * pruneActionLog, pruneObservations) and src/mcp/services/maintenance-job.ts
 * (runStartupMaintenance — the startup decay/archive sweep).
 *
 * TASK-104 coverage: decay/archive logic — ttlDays expiry, tag immunization,
 * archive marking, and the TASK-124 `MaintenanceResult.totalArchived`
 * contract (expired + low-score + decay-archived).
 *
 * Strategy: real in-memory SQLiteStore (createTestStore) for SQL-bound logic;
 * vi.spyOn passthrough for the file-lock boundary (db.withExclusiveWrite) and for
 * entity sweeps whose internals are covered by their own suites. No real
 * proper-lockfile acquisition.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { applyDecay, pruneActionLog, pruneObservations, pruneRelations } from "../services/soul-maintenance";
import { runStartupMaintenance } from "../services/maintenance-job";
import { addLogSink } from "../utils/logger";
import type { MemoryEntry } from "../types";
import type { KnowledgeGraphEntity } from "../entities/knowledge-graph";

const VALID_UUID = "123e4567-e89b-42d3-a456-426614174000";

const OLD_DATE = "2024-01-01T00:00:00.000Z"; // ~2 years before test run
const RECENT_DATE = new Date().toISOString();

function makeMemory(overrides: Partial<MemoryEntry>): MemoryEntry {
	return {
		id: VALID_UUID,
		type: "code_fact",
		title: "Decay Target",
		content: "Memory subject to decay/archive logic.",
		importance: 4,
		agent: "test",
		role: "backend",
		model: "test",
		scope: { owner: "test", repo: "soul-test" },
		created_at: OLD_DATE,
		updated_at: OLD_DATE,
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: OLD_DATE,
		expires_at: null,
		supersedes: null,
		status: "active",
		tags: [],
		metadata: {},
		is_global: false,
		...overrides
	};
}

describe("applyDecay", () => {
	it("reduces importance by decayRate (floored, min 1) for stale active memories", async () => {
		const db = await createTestStore();
		db.memories.insert(makeMemory({ id: VALID_UUID, importance: 4 }));

		const result = applyDecay(db.db);

		expect(result.decayed).toBe(1);
		expect(result.archived).toBe(0);
		expect(result.immunizedSkipped).toBe(0);
		expect(db.memories.getById(VALID_UUID)!.importance).toBe(3); // floor(4 - 0.5)
		db.close();
	});

	it("treats memories with NULL last_used_at as stale and decays them", async () => {
		const db = await createTestStore();
		db.memories.insert(makeMemory({ id: VALID_UUID, last_used_at: null, importance: 3 }));

		const result = applyDecay(db.db);

		expect(result.decayed).toBe(1);
		expect(db.memories.getById(VALID_UUID)!.importance).toBe(2);
		db.close();
	});

	it("skips memories whose tags match immunizedTags — importance unchanged", async () => {
		const db = await createTestStore();
		db.memories.insert(makeMemory({ id: VALID_UUID, importance: 4, tags: ["immortal", "reference"] }));

		const result = applyDecay(db.db, { immunizedTags: ["immortal"] });

		expect(result.immunizedSkipped).toBe(1);
		expect(result.decayed).toBe(0);
		expect(db.memories.getById(VALID_UUID)!.importance).toBe(4);
		db.close();
	});

	it("does not skip when immunizedTags is empty", async () => {
		const db = await createTestStore();
		db.memories.insert(makeMemory({ id: VALID_UUID, importance: 4, tags: ["immortal"] }));

		const result = applyDecay(db.db, { immunizedTags: [] });

		expect(result.immunizedSkipped).toBe(0);
		expect(result.decayed).toBe(1);
		db.close();
	});

	it("archives memories whose post-decay importance drops below archiveThreshold", async () => {
		const db = await createTestStore();
		db.memories.insert(makeMemory({ id: VALID_UUID, importance: 1 }));

		const result = applyDecay(db.db, { archiveThreshold: 2 });

		expect(result.decayed).toBe(1);
		expect(result.archived).toBe(1);
		expect(db.memories.getById(VALID_UUID)!.status).toBe("archived");
		db.close();
	});

	it("does NOT archive at the boundary: newImportance === archiveThreshold", async () => {
		const db = await createTestStore();
		db.memories.insert(makeMemory({ id: VALID_UUID, importance: 2 }));

		const result = applyDecay(db.db, { archiveThreshold: 2 }); // floor(2-0.5)=1 < 2 → archived
		// importance 3 with default threshold: floor(3-0.5)=2 === 2 → NOT archived
		const db2 = await createTestStore();
		db2.memories.insert(makeMemory({ id: VALID_UUID, importance: 3 }));

		const result2 = applyDecay(db2.db, { archiveThreshold: 2 });

		expect(result.archived).toBe(1);
		expect(result2.decayed).toBe(1);
		expect(result2.archived).toBe(0);
		expect(db2.memories.getById(VALID_UUID)!.status).toBe("active");
		db.close();
		db2.close();
	});

	it("leaves recently used active memories untouched", async () => {
		const db = await createTestStore();
		// NOTE: MemoryEntity.insert hardcodes last_used_at = NULL (memories are
		// only timestamped by usage paths such as acknowledge/recall), so a
		// "recently used" row is seeded through the public update() API.
		db.memories.insert(makeMemory({ id: VALID_UUID, importance: 4 }));
		db.memories.update(VALID_UUID, { last_used_at: RECENT_DATE });

		const result = applyDecay(db.db);

		expect(result.decayed).toBe(0);
		expect(result.archived).toBe(0);
		expect(db.memories.getById(VALID_UUID)!.importance).toBe(4);
		db.close();
	});

	it("ignores archived memories (status filter)", async () => {
		const db = await createTestStore();
		db.memories.insert(makeMemory({ id: VALID_UUID, status: "archived", importance: 4 }));

		const result = applyDecay(db.db);

		expect(result.decayed).toBe(0);
		db.close();
	});

	it("returns zero counts when no memories are eligible", async () => {
		const db = await createTestStore();

		const result = applyDecay(db.db);

		expect(result).toEqual({ decayed: 0, archived: 0, immunizedSkipped: 0 });
		db.close();
	});

	it("honors custom decayAfterDays (memory unused for 2 days decays with decayAfterDays: 1)", async () => {
		const db = await createTestStore();
		const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
		db.memories.insert(makeMemory({ id: VALID_UUID, last_used_at: twoDaysAgo, importance: 4 }));

		const result = applyDecay(db.db, { decayAfterDays: 1 });

		expect(result.decayed).toBe(1);
		expect(db.memories.getById(VALID_UUID)!.importance).toBe(3);
		db.close();
	});
});

describe("pruneActionLog", () => {
	it("deletes only entries older than retentionDays", async () => {
		const db = await createTestStore();
		const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
		const insert = db.db.prepare("INSERT INTO action_log (action, repo, owner, created_at) VALUES (?, ?, ?, ?)");
		insert.run("memory-read", "r", "o", old);
		insert.run("memory-read", "r", "o", old);
		insert.run("memory-read", "r", "o", new Date().toISOString());

		const result = pruneActionLog(db.db, 30);

		expect(result.deleted).toBe(2);
		expect(result.deletedByCap).toBe(0);
		const remaining = db.db.prepare("SELECT COUNT(*) AS c FROM action_log WHERE repo = ?").get("r") as {
			c: number;
		};
		expect(remaining.c).toBe(1);
		db.close();
	});

	it("maps the SQL changes count into the result shape", () => {
		const fakeDb = {
			prepare: vi.fn().mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 5 }) })
		} as unknown as Parameters<typeof pruneActionLog>[0];

		const result = pruneActionLog(fakeDb, 30);

		expect(result).toEqual({ deletedByAge: 5, deletedByCap: 5, deleted: 10 });
		expect(fakeDb.prepare).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM action_log"));
	});

	it("keeps only the newest maxRows entries when the table exceeds the cap (OPT-PERF-05)", async () => {
		const db = await createTestStore();
		const insert = db.db.prepare("INSERT INTO action_log (action, repo, owner, created_at) VALUES (?, ?, ?, ?)");
		const now = new Date().toISOString();
		for (let i = 0; i < 25; i++) {
			insert.run("memory-read", "r", "o", now);
		}

		const result = pruneActionLog(db.db, 30, 10);

		expect(result.deletedByAge).toBe(0);
		expect(result.deletedByCap).toBe(15);
		expect(result.deleted).toBe(15);
		const remaining = db.db.prepare("SELECT COUNT(*) AS c FROM action_log").get() as { c: number };
		expect(remaining.c).toBe(10);
		db.close();
	});
});

describe("pruneObservations", () => {
	it("delegates to KnowledgeGraphEntity.deleteStaleObservations with an ISO cutoff", async () => {
		const deleteSpy = vi.fn().mockResolvedValue(3);
		const kg = { deleteStaleObservations: deleteSpy } as unknown as KnowledgeGraphEntity;

		const result = await pruneObservations(kg, 7);

		expect(result).toEqual({ deleted: 3 });
		expect(deleteSpy).toHaveBeenCalledTimes(1);
		expect(deleteSpy.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("returns deleted: 0 when nothing is pruned", async () => {
		const kg = { deleteStaleObservations: vi.fn().mockResolvedValue(0) } as unknown as KnowledgeGraphEntity;

		expect(await pruneObservations(kg)).toEqual({ deleted: 0 });
	});

	it("logs the configured retention window", async () => {
		const logs: Array<Record<string, unknown>> = [];
		const removeSink = addLogSink((payload) => logs.push(payload.data));
		const kg = { deleteStaleObservations: vi.fn().mockResolvedValue(3) } as unknown as KnowledgeGraphEntity;

		try {
			await pruneObservations(kg, 14);
		} finally {
			removeSink();
		}

		expect(logs).toContainEqual(expect.objectContaining({ retentionDays: 14, deleted: 3 }));
	});
});

describe("pruneRelations observability", () => {
	it("logs the configured retention window", async () => {
		const logs: Array<Record<string, unknown>> = [];
		const removeSink = addLogSink((payload) => logs.push(payload.data));
		const kg = {
			deleteUnreachableRelations: vi.fn().mockResolvedValue(2),
			deleteOrphanEntities: vi.fn().mockResolvedValue(1),
			countPrunableRelations: vi.fn().mockReturnValue(4)
		} as unknown as KnowledgeGraphEntity;

		try {
			await pruneRelations(kg, 21, 100, 10);
		} finally {
			removeSink();
		}

		expect(logs).toContainEqual(expect.objectContaining({ retentionDays: 21, deleted: 2, remaining: 4 }));
	});

	it("counts the exact remainder when the run does NOT hit the cap (TASK-041)", async () => {
		const kg = {
			deleteUnreachableRelations: vi.fn().mockResolvedValue(2),
			deleteOrphanEntities: vi.fn().mockResolvedValue(1),
			countPrunableRelations: vi.fn().mockReturnValue(4)
		} as unknown as KnowledgeGraphEntity;

		// deleted 2 < maxRows 100 → tail reached → exact count is consulted.
		const result = await pruneRelations(kg, 21, 100, 10);

		expect(result).toEqual({ deleted: 2, orphanEntitiesDeleted: 1, remaining: 4 });
		expect(kg.countPrunableRelations).toHaveBeenCalledTimes(1);
	});

	it("SKIPS the expensive count and reports the sentinel when the run hits the cap (TASK-041)", async () => {
		const kg = {
			deleteUnreachableRelations: vi.fn().mockResolvedValue(100),
			deleteOrphanEntities: vi.fn().mockResolvedValue(1),
			countPrunableRelations: vi.fn().mockReturnValue(4)
		} as unknown as KnowledgeGraphEntity;

		// deleted 100 === maxRows 100 → cap hit → a backlog provably remains,
		// so the correlated count must NOT run.
		const result = await pruneRelations(kg, 21, 100, 10);

		expect(result).toEqual({ deleted: 100, orphanEntitiesDeleted: 1, remaining: -1 });
		expect(kg.countPrunableRelations).not.toHaveBeenCalled();
	});
});

describe("runStartupMaintenance (TASK-124 contract)", () => {
	let db: SQLiteStore;
	let withExclusiveWriteSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		db = await createTestStore();
		// Passthrough spy: crosses the lock boundary without real proper-lockfile.
		// OPT-PERF-09: runStartupMaintenance routes the whole sweep through the
		// exclusive write lock (withExclusiveWrite), not the fast-path withWrite.
		withExclusiveWriteSpy = vi.spyOn(db, "withExclusiveWrite").mockImplementation(async (fn) => fn());
		vi.spyOn(db.memoryArchives, "archiveExpiredMemories").mockReturnValue(2);
		vi.spyOn(db.memoryArchives, "archiveLowScoreMemories").mockReturnValue(1);
		vi.spyOn(db.knowledgeGraph, "deleteStaleObservations").mockResolvedValue(5);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("runs the full sweep and reports totalArchived = expired + lowScore + decay.archived", async () => {
		// A stale memory that decays (but stays above threshold) → decay.decayed = 1
		db.memories.insert(makeMemory({ id: VALID_UUID, importance: 4 }));

		const result = await runStartupMaintenance(db);

		expect(result.skipped).toBe(false);
		expect(result.decay.decayed).toBe(1);
		expect(result.decay.archived).toBe(0);
		expect(result.expiredArchived).toBe(2);
		expect(result.lowScoreArchived).toBe(1);
		expect(result.prunedActionLogRows).toBe(0);
		expect(result.prunedObservationsRows).toBe(5);
		expect(result.totalArchived).toBe(2 + 1 + 0);

		// TASK-033: the bounded incremental vacuum runs after the prunes and
		// reports its reclaimed-page count (0 on an in-memory / NONE-mode DB).
		expect(result.incrementalVacuumPages).toBe(0);

		// TASK-102: the whole sweep crosses the write-lock boundary exactly once.
		expect(withExclusiveWriteSpy).toHaveBeenCalledTimes(1);
		expect(db.memoryArchives.archiveExpiredMemories).toHaveBeenCalledWith(true);
		expect(db.memoryArchives.archiveLowScoreMemories).toHaveBeenCalledWith(true);
	});

	it("includes decay-archived memories in totalArchived (TASK-124)", async () => {
		// Stale memory whose post-decay importance (1) drops below threshold 2 → archived by decay.
		db.memories.insert(makeMemory({ id: VALID_UUID, importance: 1 }));

		const result = await runStartupMaintenance(db, { archiveThreshold: 2 });

		expect(result.decay.archived).toBe(1);
		expect(result.totalArchived).toBe(2 + 1 + 1);
		expect(db.memories.getById(VALID_UUID)!.status).toBe("archived");
	});

	it("records the run in memory_summary so a second run within 24h is skipped", async () => {
		await runStartupMaintenance(db);
		withExclusiveWriteSpy.mockClear();

		const second = await runStartupMaintenance(db);

		expect(second.skipped).toBe(true);
		expect(second.decay).toEqual({ decayed: 0, archived: 0, immunizedSkipped: 0 });
		expect(second.expiredArchived).toBe(0);
		expect(second.lowScoreArchived).toBe(0);
		expect(second.prunedActionLogRows).toBe(0);
		expect(second.prunedObservationsRows).toBe(0);
		expect(second.totalArchived).toBe(0);
		expect(withExclusiveWriteSpy).not.toHaveBeenCalled();
	});
});
