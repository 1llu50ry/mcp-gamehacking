import { describe, it, expect, vi } from "vitest";
import { resolveEntityRef } from "../../utils/entity-ref";
import type { SQLiteStore } from "../../storage/sqlite";

function makeStorage() {
	const memoryGetByCode = vi.fn();
	const standardGetByCode = vi.fn();
	const taskGetByCode = vi.fn();
	const storage = {
		memories: { getByCode: memoryGetByCode },
		standards: { getByCode: standardGetByCode },
		tasks: { getTaskByCode: taskGetByCode }
	} as unknown as SQLiteStore;
	return { storage, memoryGetByCode, standardGetByCode, taskGetByCode };
}

const UUID = "d8597488-f19c-4958-96b9-1dee148f2e91";

describe("resolveEntityRef", () => {
	it("returns null for null, undefined and empty values", () => {
		const { storage } = makeStorage();
		expect(resolveEntityRef(storage, "memory", null)).toBeNull();
		expect(resolveEntityRef(storage, "memory", undefined)).toBeNull();
		expect(resolveEntityRef(storage, "memory", "")).toBeNull();
	});

	it("passes a valid UUID through unchanged for any kind", () => {
		const { storage } = makeStorage();
		expect(resolveEntityRef(storage, "memory", UUID)).toBe(UUID);
		expect(resolveEntityRef(storage, "standard", UUID)).toBe(UUID);
		expect(resolveEntityRef(storage, "task", UUID)).toBe(UUID);
	});

	it("prefers the localMap over the database", () => {
		const { storage, memoryGetByCode } = makeStorage();
		const localMap = new Map<string, string>([["TASK-1", "batch-id"]]);
		expect(resolveEntityRef(storage, "task", "TASK-1", "o", "r", { localMap })).toBe("batch-id");
		expect(memoryGetByCode).not.toHaveBeenCalled();
	});

	it("resolves a memory code through the store", () => {
		const { storage, memoryGetByCode } = makeStorage();
		memoryGetByCode.mockReturnValue({ id: "mem-id" });
		expect(resolveEntityRef(storage, "memory", "MEM-1", "o", "r")).toBe("mem-id");
		expect(memoryGetByCode).toHaveBeenCalledWith("MEM-1", "o", "r");
	});

	it("resolves a standard code through the store", () => {
		const { storage, standardGetByCode } = makeStorage();
		standardGetByCode.mockReturnValue({ id: "std-id" });
		expect(resolveEntityRef(storage, "standard", "STD-2", "o", "r")).toBe("std-id");
		expect(standardGetByCode).toHaveBeenCalledWith("STD-2", "o", "r");
	});

	it("resolves a task code through the store", () => {
		const { storage, taskGetByCode } = makeStorage();
		taskGetByCode.mockReturnValue({ id: "task-id" });
		expect(resolveEntityRef(storage, "task", "TASK-3", "o", "r")).toBe("task-id");
		expect(taskGetByCode).toHaveBeenCalledWith("o", "r", "TASK-3");
	});

	it("uses the canonical entity label in not-found errors", () => {
		const { storage } = makeStorage();
		expect(() => resolveEntityRef(storage, "standard", "STD-404", "o", "r")).toThrow(
			"Coding standard not found: STD-404"
		);
	});

	it("uses the caller-supplied label in not-found errors", () => {
		const { storage } = makeStorage();
		expect(() => resolveEntityRef(storage, "task", "TASK-404", "o", "r", { label: "Epic" })).toThrow(
			"Epic not found: TASK-404"
		);
	});

	it("throws for whitespace-only values that do not resolve", () => {
		const { storage } = makeStorage();
		expect(() => resolveEntityRef(storage, "memory", "   ")).toThrow("Memory not found:    ");
	});
});
