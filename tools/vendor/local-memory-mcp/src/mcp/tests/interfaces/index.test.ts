import { describe, it, expect, expectTypeOf } from "vitest";
import * as interfaces from "../../interfaces";

// ---------------------------------------------------------------------------
// src/mcp/interfaces/index.ts — re-export barrel (`export * from "./prompt"`
// and `export * from "./express"`). Both source modules are type-only, so the
// runtime namespace is empty; the export-surface contract is enforced at
// compile time (missing/changed names fail `tsc -p tsconfig.test.json`).
// ---------------------------------------------------------------------------

// Compile-time surface map: if any expected interface is missing from the
// barrel, this alias fails to compile, so the pinned surface is enforced.
type ExportSurface = {
	LoadedPrompt: interfaces.LoadedPrompt;
	PageParams: interfaces.PageParams;
	SortParams: interfaces.SortParams;
	SearchParams: interfaces.SearchParams;
	Params: interfaces.Params;
	ListQuery: interfaces.ListQuery;
	IdParams: interfaces.IdParams;
	NameParams: interfaces.NameParams;
	TaskListQuery: interfaces.TaskListQuery;
	MemoryListQuery: interfaces.MemoryListQuery;
};

describe("interfaces barrel", () => {
	it("re-exports LoadedPrompt unchanged from prompt.ts", () => {
		expectTypeOf<interfaces.LoadedPrompt>().toEqualTypeOf<import("../../interfaces/prompt").LoadedPrompt>();
	});

	it("re-exports every express.ts type unchanged", () => {
		expectTypeOf<interfaces.PageParams>().toEqualTypeOf<import("../../interfaces/express").PageParams>();
		expectTypeOf<interfaces.SortParams>().toEqualTypeOf<import("../../interfaces/express").SortParams>();
		expectTypeOf<interfaces.SearchParams>().toEqualTypeOf<import("../../interfaces/express").SearchParams>();
		expectTypeOf<interfaces.Params>().toEqualTypeOf<import("../../interfaces/express").Params>();
		expectTypeOf<interfaces.ListQuery>().toEqualTypeOf<import("../../interfaces/express").ListQuery>();
		expectTypeOf<interfaces.IdParams>().toEqualTypeOf<import("../../interfaces/express").IdParams>();
		expectTypeOf<interfaces.NameParams>().toEqualTypeOf<import("../../interfaces/express").NameParams>();
		expectTypeOf<interfaces.TaskListQuery>().toEqualTypeOf<import("../../interfaces/express").TaskListQuery>();
		expectTypeOf<interfaces.MemoryListQuery>().toEqualTypeOf<import("../../interfaces/express").MemoryListQuery>();
	});

	it("rejects accesses to names the barrel does not export", () => {
		// @ts-expect-error — not a member of the interfaces barrel
		const leaked = interfaces.notAnExport;
		expect(leaked).toBeUndefined();
	});

	it("exposes no runtime members (type-only barrel)", () => {
		// index.ts re-exports two type-only modules, so nothing survives the
		// type-erasure pass at runtime.
		expect(Object.keys(interfaces)).toEqual([]);
	});

	// Keep the alias referenced so the compile-time surface pin is exercised
	// even if the barrel gains runtime exports.
	void (null as unknown as ExportSurface);
});
