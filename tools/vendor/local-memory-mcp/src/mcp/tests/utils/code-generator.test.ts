import { describe, it, expect, vi } from "vitest";
import { generateNextCode, resolveEntityCode } from "../../utils/code-generator";
import type { SQLiteStore } from "../../storage/sqlite";

function makeStorage(maxSeq: number | null = null) {
	const prepare = vi.fn((_sql: string) => ({ get: vi.fn(() => ({ max_seq: maxSeq })) }));
	const isTaskCodeDuplicate = vi.fn((_o: string, _r: string, _code: string) => false);
	const memoryGetByCode = vi.fn((_code: string, _owner?: string, _repo?: string): { id: string } | null => null);
	const standardGetByCode = vi.fn((_code: string, _owner?: string, _repo?: string): { id: string } | null => null);
	const storage = {
		db: { prepare },
		tasks: { isTaskCodeDuplicate },
		memories: { getByCode: memoryGetByCode },
		standards: { getByCode: standardGetByCode }
	} as unknown as SQLiteStore;
	return { storage, prepare, isTaskCodeDuplicate, memoryGetByCode, standardGetByCode };
}

describe("generateNextCode", () => {
	it("generates the first sequential code when the table is empty", () => {
		const { storage } = makeStorage(null);
		expect(generateNextCode("o", "r", "task", storage)).toBe("TASK-001");
	});

	it("increments from the current max sequence", () => {
		const { storage } = makeStorage(42);
		expect(generateNextCode("o", "r", "task", storage)).toBe("TASK-043");
	});

	it("does not truncate beyond three digits", () => {
		const { storage } = makeStorage(999);
		expect(generateNextCode("o", "r", "task", storage)).toBe("TASK-1000");
	});

	it("accounts for codes generated earlier in the same batch", () => {
		const { storage } = makeStorage(null);
		const batch = new Set(["TASK-050"]);
		expect(generateNextCode("o", "r", "task", storage, batch)).toBe("TASK-051");
	});

	it("ignores batch codes that do not parse as numbers", () => {
		const { storage } = makeStorage(null);
		const batch = new Set(["TASK-abc", "MEM-1", "garbage"]);
		expect(generateNextCode("o", "r", "task", storage, batch)).toBe("TASK-001");
	});

	it("uses the memory prefix and table", () => {
		const { storage, prepare } = makeStorage(0);
		expect(generateNextCode("o", "r", "memory", storage)).toBe("MEM-001");
		const sql = String(prepare.mock.calls[0][0]);
		expect(sql).toContain("FROM memories");
		expect(sql).toContain("code");
	});

	it("uses the standard prefix and table", () => {
		const { storage, prepare } = makeStorage(0);
		expect(generateNextCode("o", "r", "standard", storage)).toBe("STD-001");
		const sql = String(prepare.mock.calls[0][0]);
		expect(sql).toContain("FROM coding_standards");
		expect(sql).toContain("code");
	});

	it("queries the task table and column with a bound LIKE pattern", () => {
		const { storage, prepare } = makeStorage(null);
		generateNextCode("o", "r", "task", storage);
		const sql = String(prepare.mock.calls[0][0]);
		expect(sql).toContain("FROM tasks");
		expect(sql).toContain("task_code");
		expect(sql).toContain("LIKE ?");
	});
});

describe("resolveEntityCode", () => {
	it("auto-generates a sequential code when no preference is given", () => {
		const { storage } = makeStorage(null);
		const batch = new Set<string>();
		const code = resolveEntityCode(null, "o", "r", "task", storage, { batchCodes: batch });
		expect(code).toBe("TASK-001");
		expect(batch.has("TASK-001")).toBe(true);
	});

	it("keeps a unique preferred code", () => {
		const { storage, isTaskCodeDuplicate } = makeStorage();
		const code = resolveEntityCode("TASK-007", "o", "r", "task", storage);
		expect(code).toBe("TASK-007");
		expect(isTaskCodeDuplicate).toHaveBeenCalledWith("o", "r", "TASK-007");
	});

	it("appends a random hex suffix when the preferred code is taken", () => {
		const { storage, isTaskCodeDuplicate } = makeStorage();
		isTaskCodeDuplicate.mockImplementation((_o: string, _r: string, code: string) => code === "TASK-007");
		const code = resolveEntityCode("TASK-007", "o", "r", "task", storage);
		expect(code).toMatch(/^TASK-007-[0-9a-f]{4}$/);
	});

	it("treats a batch-reserved code as taken", () => {
		const { storage } = makeStorage();
		const batch = new Set(["TASK-007"]);
		const code = resolveEntityCode("TASK-007", "o", "r", "task", storage, { batchCodes: batch });
		expect(code).toMatch(/^TASK-007-[0-9a-f]{4}$/);
		expect(batch.has(code)).toBe(true);
	});

	it("registers a unique preferred code in the batch set", () => {
		const { storage } = makeStorage();
		const batch = new Set<string>();
		resolveEntityCode("TASK-009", "o", "r", "task", storage, { batchCodes: batch });
		expect(batch.has("TASK-009")).toBe(true);
	});

	it("falls back to sequential generation when 20 suffix attempts all collide", () => {
		const { storage, isTaskCodeDuplicate } = makeStorage(null);
		isTaskCodeDuplicate.mockReturnValue(true);
		const code = resolveEntityCode("TASK-007", "o", "r", "task", storage);
		expect(code).toBe("TASK-001");
		expect(isTaskCodeDuplicate).toHaveBeenCalledTimes(21); // preferred + 20 candidates
	});

	it("checks memory uniqueness via getByCode", () => {
		const { storage, memoryGetByCode } = makeStorage();
		memoryGetByCode.mockImplementation((code: string) => (code === "MEM-9" ? { id: "existing" } : null));
		const code = resolveEntityCode("MEM-9", "o", "r", "memory", storage);
		expect(code).toMatch(/^MEM-9-[0-9a-f]{4}$/);
		expect(memoryGetByCode).toHaveBeenCalledWith("MEM-9", "o", "r");
	});

	it("checks standard uniqueness via getByCode", () => {
		const { storage, standardGetByCode } = makeStorage();
		standardGetByCode.mockImplementation((code: string) => (code === "STD-5" ? { id: "existing" } : null));
		const code = resolveEntityCode("STD-5", "o", "r", "standard", storage);
		expect(code).toMatch(/^STD-5-[0-9a-f]{4}$/);
	});

	it("keeps a unique memory preferred code", () => {
		const { storage } = makeStorage();
		expect(resolveEntityCode("MEM-1", "o", "r", "memory", storage)).toBe("MEM-1");
	});
});
