import { afterEach, describe, it, expect, vi } from "vitest";
import { purgeEntityAndCleanup, type PurgeEntityItem } from "../../utils/purge-entity-cleanup";
import { MEMORY_STATUS_ARCHIVED } from "../../types";
import { logger } from "../../utils/logger";
import type { SQLiteStore } from "../../storage/sqlite";

function makeDb() {
	const run = vi.fn();
	const prepare = vi.fn(() => ({ run }));
	const transaction = vi.fn((fn: () => void) => ({ immediate: () => fn() }));
	const bulkUpdateMemories = vi.fn();
	const standardDelete = vi.fn();
	const updateTask = vi.fn();
	const clearChildrenParent = vi.fn();
	const removeTaskVector = vi.fn();
	const releaseClaimsForTask = vi.fn();
	const updatePendingHandoffsForTask = vi.fn();
	const deleteObservationsAndOrphans = vi.fn();
	const db = {
		db: { prepare, transaction },
		memories: { bulkUpdateMemories },
		standards: { delete: standardDelete },
		tasks: { updateTask, clearChildrenParent, removeTaskVector },
		handoffs: { releaseClaimsForTask, updatePendingHandoffsForTask },
		knowledgeGraph: { deleteObservationsAndOrphans }
	} as unknown as SQLiteStore;
	return {
		db,
		run,
		prepare,
		transaction,
		bulkUpdateMemories,
		standardDelete,
		updateTask,
		clearChildrenParent,
		removeTaskVector,
		releaseClaimsForTask,
		updatePendingHandoffsForTask,
		deleteObservationsAndOrphans
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("purgeEntityAndCleanup", () => {
	it("returns 0 and does nothing for an empty item list", () => {
		const m = makeDb();
		expect(purgeEntityAndCleanup(m.db, "memory", [])).toBe(0);
		expect(m.transaction).not.toHaveBeenCalled();
	});

	it("archives memories, purges queue jobs and cleans KG observations", () => {
		const m = makeDb();
		const items: PurgeEntityItem[] = [{ id: "u1", title: "Title A", repo: "repo-x" }];
		expect(purgeEntityAndCleanup(m.db, "memory", items)).toBe(1);
		expect(m.bulkUpdateMemories).toHaveBeenCalledWith(["u1"], { status: MEMORY_STATUS_ARCHIVED });
		expect(m.prepare).toHaveBeenCalledWith(
			expect.stringContaining("DELETE FROM queue_jobs WHERE entity_kind = ? AND entity_id IN (?)")
		);
		expect(m.run).toHaveBeenCalledWith("memory", "u1");
		expect(m.deleteObservationsAndOrphans).toHaveBeenCalledWith([
			{ text: "Mentioned in memory: Title A", repo: "repo-x" }
		]);
	});

	it("hard-deletes standards one by one", () => {
		const m = makeDb();
		purgeEntityAndCleanup(m.db, "standard", [
			{ id: "s1", title: "S" },
			{ id: "s2", title: "T" }
		]);
		expect(m.standardDelete).toHaveBeenNthCalledWith(1, "s1");
		expect(m.standardDelete).toHaveBeenNthCalledWith(2, "s2");
	});

	it("runs the full task cancel contract", () => {
		const m = makeDb();
		purgeEntityAndCleanup(m.db, "task", [{ id: "t1", title: "T" }]);
		expect(m.updateTask).toHaveBeenCalledWith("t1", {
			status: "canceled",
			canceled_at: expect.any(String)
		});
		expect(m.clearChildrenParent).toHaveBeenCalledWith("t1");
		expect(m.removeTaskVector).toHaveBeenCalledWith("t1");
		expect(m.releaseClaimsForTask).toHaveBeenCalledWith("t1");
		expect(m.updatePendingHandoffsForTask).toHaveBeenCalledWith("t1", "expired");
	});

	it("reports progress per item plus a final total call", () => {
		const m = makeDb();
		const progress: string[] = [];
		purgeEntityAndCleanup(
			m.db,
			"memory",
			[
				{ id: "1", title: "a" },
				{ id: "2", title: "b" },
				{ id: "3", title: "c" }
			],
			{ onProgress: (p, total) => progress.push(`${p}/${total}`) }
		);
		expect(progress).toEqual(["0/3", "1/3", "2/3", "3/3"]);
	});

	it("skips KG cleanup for phantom items without a title", () => {
		const m = makeDb();
		purgeEntityAndCleanup(m.db, "memory", [{ id: "u1" }]);
		expect(m.run).toHaveBeenCalledWith("memory", "u1");
		expect(m.deleteObservationsAndOrphans).not.toHaveBeenCalled();
	});

	it("scopes KG cleanup per item to its own repo, omitting phantoms", () => {
		const m = makeDb();
		purgeEntityAndCleanup(m.db, "task", [
			{ id: "t1", title: "T", repo: "r1" },
			{ id: "t2" },
			{ id: "t3", title: "U", repo: "r2" }
		]);
		expect(m.deleteObservationsAndOrphans).toHaveBeenCalledWith([
			{ text: "Mentioned in task: T", repo: "r1" },
			{ text: "Mentioned in task: U", repo: "r2" }
		]);
	});

	it("chunks the queue purge at the 500-item bound", () => {
		const m = makeDb();
		const items: PurgeEntityItem[] = Array.from({ length: 501 }, (_, i) => ({
			id: `u${i}`,
			title: `T${i}`,
			repo: "r"
		}));
		purgeEntityAndCleanup(m.db, "memory", items);
		expect(m.prepare).toHaveBeenCalledTimes(2);
		// First chunk: kind + 500 ids; second chunk: kind + 1 id.
		expect(m.run.mock.calls[0].length).toBe(501);
		expect(m.run.mock.calls[1].length).toBe(2);
		expect(m.bulkUpdateMemories).toHaveBeenCalledTimes(1);
		expect(m.bulkUpdateMemories.mock.calls[0][0]).toHaveLength(501);
	});

	it("swallows KG cleanup errors and still returns the purge count", () => {
		const m = makeDb();
		m.deleteObservationsAndOrphans.mockImplementation(() => {
			throw new Error("kg boom");
		});
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		const result = purgeEntityAndCleanup(m.db, "memory", [{ id: "u1", title: "T", repo: "r" }]);
		expect(result).toBe(1);
		expect(warnSpy).toHaveBeenCalled();
	});

	it("returns the number of purged items", () => {
		const m = makeDb();
		expect(purgeEntityAndCleanup(m.db, "standard", [{ id: "s1", title: "S" }])).toBe(1);
		expect(purgeEntityAndCleanup(m.db, "standard", [])).toBe(0);
	});
});
