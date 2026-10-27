/**
 * Unit tests for the cold-tier archive (TASK-036 / DB-shrink L3):
 * `src/mcp/storage/cold-archive.ts` (ColdArchiveStore + resolveColdArchivePath)
 * and `src/mcp/services/cold-archive.ts` (offloadArchivedMemories /
 * runColdArchiveOffload), plus the runStartupMaintenance wiring.
 *
 * Strategy: a real in-memory SQLiteStore is the hot store; a second in-memory
 * ColdArchiveStore models the separate cold DB. A mkdtemp file DB is used only
 * for the WAL/path assertions. Never touches the real database.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { createTestStore, type SQLiteStore } from "../storage/sqlite";
import { ColdArchiveStore, resolveColdArchivePath } from "../storage/cold-archive";
import { offloadArchivedMemories, runColdArchiveOffload } from "../services/cold-archive";
import { runStartupMaintenance } from "../services/maintenance-job";
import type { MemoryEntry, MemoryRow } from "../types";

const OLD_DATE = "2024-01-01T00:00:00.000Z";
const RECENT_DATE = new Date().toISOString();
const MEM_A = "11111111-1111-4111-8111-111111111111";
const MEM_B = "22222222-2222-4222-8222-222222222222";
const MEM_C = "33333333-3333-4333-8333-333333333333";

/** Build a full MemoryEntry (defaults to a long-archived, offload-eligible row). */
function makeMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
	return {
		id: MEM_A,
		type: "code_fact",
		title: "Archived Target",
		content: "Memory archived and eligible for cold offload.",
		importance: 4,
		agent: "test",
		role: "backend",
		model: "test",
		scope: { owner: "acme", repo: "cold-test" },
		created_at: OLD_DATE,
		updated_at: OLD_DATE,
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: OLD_DATE,
		expires_at: null,
		supersedes: null,
		status: "archived",
		tags: ["cold", "archive"],
		metadata: {},
		is_global: false,
		...overrides
	};
}

/** Insert an entry into a throwaway hot store and read back its raw MemoryRow. */
async function makeRow(overrides: Partial<MemoryEntry> = {}): Promise<MemoryRow> {
	const db = await createTestStore();
	try {
		db.memories.insert(makeMemory(overrides));
		const rows = db.memoryArchives.selectArchivedForOffload(new Date(Date.now() + 60_000).toISOString(), 1);
		if (rows.length === 0) throw new Error("expected a selectable archived row");
		return rows[0];
	} finally {
		db.close();
	}
}

describe("resolveColdArchivePath", () => {
	it("keeps :memory: in memory", () => {
		expect(resolveColdArchivePath(":memory:")).toBe(":memory:");
	});

	it("places cold-archive.db alongside memory.db", () => {
		expect(resolveColdArchivePath("/data/store/memory.db")).toBe("/data/store/cold-archive.db");
	});
});

describe("ColdArchiveStore", () => {
	let cold: ColdArchiveStore | undefined;

	afterEach(() => {
		cold?.close();
		cold = undefined;
	});

	it("creates the schema and starts empty", () => {
		cold = new ColdArchiveStore(":memory:");
		expect(cold.countColdMemories()).toBe(0);
		expect(cold.getColdMemoryById("missing")).toBeNull();
		expect(cold.countByIds([])).toBe(0);
		expect(cold.insertMemories([], RECENT_DATE)).toBe(0);
	});

	it("round-trips a memory row (content, parsed tags, offloaded_at)", async () => {
		cold = new ColdArchiveStore(":memory:");
		const row = await makeRow();

		expect(cold.insertMemories([row], RECENT_DATE)).toBe(1);
		expect(cold.countByIds([row.id])).toBe(1);

		const entry = cold.getColdMemoryById(row.id);
		expect(entry).not.toBeNull();
		expect(entry?.content).toBe(row.content);
		expect(entry?.tags).toEqual(["cold", "archive"]);
		expect(entry?.scope.owner).toBe("acme");
		expect(entry?.scope.repo).toBe("cold-test");
		expect(entry?.offloaded_at).toBe(RECENT_DATE);
	});

	it("INSERT OR REPLACE keeps one row per id on a retried offload", async () => {
		cold = new ColdArchiveStore(":memory:");
		const row = await makeRow();

		cold.insertMemories([row], RECENT_DATE);
		cold.insertMemories([row], RECENT_DATE);

		expect(cold.countColdMemories()).toBe(1);
	});

	it("filters by owner/repo/type and matches a literal substring query", async () => {
		cold = new ColdArchiveStore(":memory:");
		const a = await makeRow({ id: MEM_A, content: "Needle alpha", scope: { owner: "acme", repo: "r1" } });
		const b = await makeRow({
			id: MEM_B,
			content: "Other beta",
			type: "decision",
			scope: { owner: "acme", repo: "r2" }
		});
		cold.insertMemories([a, b], RECENT_DATE);

		expect(cold.searchColdMemories({ owner: "acme", repo: "r1" }).map((e) => e.id)).toEqual([MEM_A]);
		expect(cold.searchColdMemories({ type: "decision" }).map((e) => e.id)).toEqual([MEM_B]);
		expect(cold.searchColdMemories({ query: "needle" }).map((e) => e.id)).toEqual([MEM_A]);
		// LIKE metacharacters are escaped, so "%" is literal and matches nothing.
		expect(cold.searchColdMemories({ query: "%" })).toHaveLength(0);
	});

	it("opens a file database in WAL mode (persisted on reopen)", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cold-archive-test-"));
		const file = path.join(dir, "cold-archive.db");
		try {
			const store = new ColdArchiveStore(file);
			expect(store.getColdPath()).toBe(file);
			store.close();

			const probe = new Database(file);
			expect(probe.pragma("journal_mode", { simple: true })).toBe("wal");
			probe.close();
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("offloadArchivedMemories", () => {
	let db: SQLiteStore | undefined;

	afterEach(() => {
		vi.restoreAllMocks();
		db?.close();
		db = undefined;
	});

	it("copies eligible archived rows to the cold store then deletes them from hot", async () => {
		db = await createTestStore();
		db.memories.insert(makeMemory({ id: MEM_A, updated_at: OLD_DATE, status: "archived" }));
		// Active rows and recently-archived rows must remain in the hot store.
		db.memories.insert(makeMemory({ id: MEM_B, status: "active", updated_at: OLD_DATE }));
		db.memories.insert(makeMemory({ id: MEM_C, status: "archived", updated_at: RECENT_DATE }));

		const result = offloadArchivedMemories(db, { now: new Date(RECENT_DATE) });

		expect(result).toEqual({ candidates: 1, copied: 1, deleted: 1, preserved: 0, skipped: false });
		expect(db.memories.getById(MEM_A)).toBeNull();
		expect(db.memories.getById(MEM_B)).not.toBeNull();
		expect(db.memories.getById(MEM_C)).not.toBeNull();

		// Read path from the cold store.
		const archived = db.getColdMemoryById(MEM_A);
		expect(archived?.content).toBe("Memory archived and eligible for cold offload.");
		expect(db.searchColdMemories({ repo: "cold-test" }).map((e) => e.id)).toEqual([MEM_A]);
	});

	it("drains oldest first and honors the per-run row cap", async () => {
		db = await createTestStore();
		db.memories.insert(makeMemory({ id: MEM_A, updated_at: "2023-01-01T00:00:00.000Z" }));
		db.memories.insert(makeMemory({ id: MEM_B, updated_at: "2023-06-01T00:00:00.000Z" }));
		db.memories.insert(makeMemory({ id: MEM_C, updated_at: OLD_DATE }));

		const result = offloadArchivedMemories(db, { maxRows: 2, now: new Date(RECENT_DATE) });

		expect(result.candidates).toBe(2);
		expect(result.deleted).toBe(2);
		expect(db.memories.getById(MEM_A)).toBeNull();
		expect(db.memories.getById(MEM_B)).toBeNull();
		expect(db.memories.getById(MEM_C)).not.toBeNull();
	});

	it("retains hot rows when the cold copy cannot be verified", async () => {
		db = await createTestStore();
		db.memories.insert(makeMemory({ id: MEM_A, updated_at: OLD_DATE }));
		vi.spyOn(db.coldArchive, "countByIds").mockReturnValue(0);

		const result = offloadArchivedMemories(db);

		expect(result).toMatchObject({ skipped: true, reason: "verification_failed", deleted: 0 });
		expect(db.memories.getById(MEM_A)).not.toBeNull();
	});

	it("is a no-op when there are no candidates", async () => {
		db = await createTestStore();
		db.memories.insert(makeMemory({ id: MEM_A, status: "active" }));

		const result = offloadArchivedMemories(db);

		expect(result).toEqual({ candidates: 0, copied: 0, deleted: 0, preserved: 0, skipped: false });
	});

	it("preserves candidates modified concurrently between selection and deletion", async () => {
		const store = await createTestStore();
		db = store;
		store.memories.insert(makeMemory({ id: MEM_A, updated_at: OLD_DATE, status: "archived" }));
		store.memories.insert(makeMemory({ id: MEM_B, updated_at: OLD_DATE, status: "archived" }));

		// Simulate a concurrent writer editing MEM_A after selection but before
		// the hot-store delete. The copy step runs between the two, so mutate
		// there: `update()` bumps updated_at, invalidating the guarded delete.
		const insertMemories = store.coldArchive.insertMemories.bind(store.coldArchive);
		vi.spyOn(store.coldArchive, "insertMemories").mockImplementation((rows, offloadedAt) => {
			const result = insertMemories(rows, offloadedAt);
			store.memories.update(MEM_A, { content: "concurrent edit" });
			return result;
		});

		const result = offloadArchivedMemories(store, { now: new Date(RECENT_DATE) });

		// Both rows were copied, but only the untouched candidate was deleted.
		expect(result).toEqual({ candidates: 2, copied: 2, deleted: 1, preserved: 1, skipped: false });
		expect(store.memories.getById(MEM_A)?.content).toBe("concurrent edit");
		expect(store.memories.getById(MEM_B)).toBeNull();
		// The concurrent revision is also preserved in the cold store.
		expect(store.getColdMemoryById(MEM_A)).not.toBeNull();
	});

	it("preserves candidates unarchived concurrently before deletion", async () => {
		const store = await createTestStore();
		db = store;
		store.memories.insert(makeMemory({ id: MEM_A, updated_at: OLD_DATE, status: "archived" }));

		const insertMemories = store.coldArchive.insertMemories.bind(store.coldArchive);
		vi.spyOn(store.coldArchive, "insertMemories").mockImplementation((rows, offloadedAt) => {
			const result = insertMemories(rows, offloadedAt);
			store.memories.update(MEM_A, { status: "active" });
			return result;
		});

		const result = offloadArchivedMemories(store, { now: new Date(RECENT_DATE) });

		expect(result).toEqual({ candidates: 1, copied: 1, deleted: 0, preserved: 1, skipped: false });
		expect(store.memories.getById(MEM_A)?.status).toBe("active");
	});

	it("returns null when disabled and swallows failures", async () => {
		db = await createTestStore();
		expect(runColdArchiveOffload(db, false)).toBeNull();

		vi.spyOn(db.memoryArchives, "selectArchivedForOffload").mockImplementation(() => {
			throw new Error("cold store unavailable");
		});
		expect(runColdArchiveOffload(db, true)).toEqual({
			candidates: 0,
			copied: 0,
			deleted: 0,
			preserved: 0,
			skipped: true,
			reason: "error"
		});
	});
});

describe("runStartupMaintenance cold-tier wiring", () => {
	let db: SQLiteStore | undefined;

	afterEach(() => {
		vi.restoreAllMocks();
		db?.close();
		db = undefined;
	});

	it("offloads long-archived memories during the sweep", async () => {
		db = await createTestStore();
		vi.spyOn(db, "withExclusiveWrite").mockImplementation(async (fn) => fn());
		db.memories.insert(makeMemory({ id: MEM_A, updated_at: OLD_DATE, status: "archived" }));

		const result = await runStartupMaintenance(db);

		expect(result.skipped).toBe(false);
		expect(result.coldArchivedOffloaded).toBe(1);
		expect(db.memories.getById(MEM_A)).toBeNull();
		expect(db.getColdMemoryById(MEM_A)).not.toBeNull();
	});
});
