import { describe, it, expect, vi } from "vitest";
import { inferReadMode, collectEntityIds, type ReadModeSpec } from "../../utils/auto-infer";
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

// Legacy spec: search-first with default "defined" presence (an explicit empty
// string still counts as present; retained for callers that need that shape).
const definedSpec: ReadModeSpec<"search" | "detail" | "recap"> = {
	rules: [
		{ mode: "search", fields: ["query"] },
		{ mode: "detail", fields: ["id", "code", "ids", "codes"] }
	],
	fallback: "recap"
};

// Read-tool spec (task-read / memory-read / standard-read / handoff.read):
// identifier-first with "non-empty" presence so a serialize-all client that
// emits `query: ""` cannot hijack the mode.
const nonEmptySpec: ReadModeSpec<"search" | "detail" | "recap"> = {
	rules: [
		{ mode: "detail", fields: ["id", "code", "ids", "codes"], presence: "non-empty" },
		{ mode: "search", fields: ["query"], presence: "non-empty" }
	],
	fallback: "recap"
};

describe("inferReadMode", () => {
	it("selects the first matching rule (search beats detail under 'defined')", () => {
		expect(inferReadMode({ query: "q", id: "1" }, definedSpec)).toBe("search");
	});

	it("gives identifier precedence over query under the read-tool 'non-empty' spec", () => {
		expect(inferReadMode({ query: "q", id: "1" }, nonEmptySpec)).toBe("detail");
		expect(inferReadMode({ query: "q", code: "C-1" }, nonEmptySpec)).toBe("detail");
	});

	it("selects detail when an identifier field is present", () => {
		expect(inferReadMode({ id: "1" }, nonEmptySpec)).toBe("detail");
		expect(inferReadMode({ ids: ["1"] }, nonEmptySpec)).toBe("detail");
		expect(inferReadMode({ codes: ["C-1"] }, nonEmptySpec)).toBe("detail");
	});

	it("treats an explicit empty query as present under 'defined' semantics", () => {
		expect(inferReadMode({ query: "" }, definedSpec)).toBe("search");
	});

	it("treats empty / whitespace-only / empty-array values as absent under 'non-empty'", () => {
		expect(inferReadMode({ query: "" }, nonEmptySpec)).toBe("recap");
		expect(inferReadMode({ query: "   " }, nonEmptySpec)).toBe("recap");
		expect(inferReadMode({ query: "\t\n" }, nonEmptySpec)).toBe("recap");
		expect(inferReadMode({ query: null }, nonEmptySpec)).toBe("recap");
		expect(inferReadMode({ id: "" }, nonEmptySpec)).toBe("recap");
		expect(inferReadMode({ ids: [] }, nonEmptySpec)).toBe("recap");
		expect(inferReadMode({ codes: [] }, nonEmptySpec)).toBe("recap");
		// Blank-only arrays must be absent too — `.length > 0` alone would route
		// `ids: [""]` to DETAIL, where collectEntityIds filters the blank and
		// handleDetailMode throws (FIX-READMODE-002 L1).
		expect(inferReadMode({ ids: [""] }, nonEmptySpec)).toBe("recap");
		expect(inferReadMode({ codes: ["  "] }, nonEmptySpec)).toBe("recap");
	});

	it("treats non-empty strings and non-empty arrays as present under 'non-empty'", () => {
		expect(inferReadMode({ query: "q" }, nonEmptySpec)).toBe("search");
		expect(inferReadMode({ id: "1" }, nonEmptySpec)).toBe("detail");
		expect(inferReadMode({ ids: ["1"] }, nonEmptySpec)).toBe("detail");
		expect(inferReadMode({ code: " C-1 " }, nonEmptySpec)).toBe("detail");
		// An array with at least one non-blank element stays present.
		expect(inferReadMode({ ids: ["", "1"] }, nonEmptySpec)).toBe("detail");
	});

	it("returns the fallback when no rule matches", () => {
		expect(inferReadMode({}, nonEmptySpec)).toBe("recap");
		expect(inferReadMode({ unrelated: 1 }, nonEmptySpec)).toBe("recap");
	});

	it("honors 'truthy' presence for boolean flags", () => {
		const flagSpec: ReadModeSpec<"detail" | "list"> = {
			rules: [{ mode: "detail", fields: ["claim"], presence: "truthy" }],
			fallback: "list"
		};
		expect(inferReadMode({ claim: false }, flagSpec)).toBe("list");
		expect(inferReadMode({ claim: true }, flagSpec)).toBe("detail");
	});
});

describe("collectEntityIds", () => {
	it("resolves singular and bulk identifiers in canonical order", () => {
		const { storage, memoryGetByCode } = makeStorage();
		memoryGetByCode.mockImplementation((code: string) => ({ id: `id-${code}` }));
		const ids = collectEntityIds({ ids: ["MEM-2"], id: "MEM-1", codes: ["MEM-4"], code: "MEM-3" }, "memory", storage, {
			owner: "o",
			repo: "r"
		});
		expect(ids).toEqual(["id-MEM-1", "id-MEM-3", "id-MEM-2", "id-MEM-4"]);
	});

	it("resolves task_code and task_codes through the task store", () => {
		const { storage, taskGetByCode } = makeStorage();
		taskGetByCode.mockImplementation((_o: string, _r: string, code: string) => ({ id: `task-${code}` }));
		const ids = collectEntityIds({ task_code: "TASK-1", task_codes: ["TASK-2"] }, "task", storage);
		expect(ids).toEqual(["task-TASK-1", "task-TASK-2"]);
		expect(taskGetByCode).toHaveBeenNthCalledWith(1, "", "", "TASK-1");
	});

	it("consults the localMap before the database", () => {
		const { storage, memoryGetByCode } = makeStorage();
		const localMap = new Map<string, string>([["MEM-BATCH", "batch-uuid"]]);
		const ids = collectEntityIds({ code: "MEM-BATCH" }, "memory", storage, { localMap });
		expect(ids).toEqual(["batch-uuid"]);
		expect(memoryGetByCode).not.toHaveBeenCalled();
	});

	it("ignores empty strings and non-string array items", () => {
		const { storage, memoryGetByCode } = makeStorage();
		memoryGetByCode.mockImplementation((code: string) => ({ id: `id-${code}` }));
		const ids = collectEntityIds(
			{ code: "", ids: [""], codes: ["MEM-1", "", 42, null] as unknown as string[] },
			"memory",
			storage
		);
		expect(ids).toEqual(["id-MEM-1"]);
	});

	it("returns an empty array when no identifiers are present", () => {
		const { storage, memoryGetByCode } = makeStorage();
		expect(collectEntityIds({ query: "q" }, "memory", storage)).toEqual([]);
		expect(memoryGetByCode).not.toHaveBeenCalled();
	});

	it("throws when a non-empty identifier cannot be resolved", () => {
		const { storage } = makeStorage();
		expect(() => collectEntityIds({ code: "MEM-404" }, "memory", storage)).toThrow("Memory not found: MEM-404");
	});
});
