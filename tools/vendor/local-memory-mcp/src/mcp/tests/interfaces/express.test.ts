import { describe, it, expect, expectTypeOf } from "vitest";
import type {
	IdParams,
	ListQuery,
	MemoryListQuery,
	NameParams,
	PageParams,
	Params,
	SearchParams,
	SortParams,
	TaskListQuery
} from "../../interfaces/express";

// ---------------------------------------------------------------------------
// src/mcp/interfaces/express.ts — pure type contracts. There is no runtime
// surface, so positive cases assert structural type equality/assignability via
// expectTypeOf (enforced at compile time by `tsc -p tsconfig.test.json`) and
// negative cases pin rejection through @ts-expect-error directives (the
// compiler errors with "unused directive" if a rejected shape ever starts
// compiling). Consumers: src/dashboard/controllers/{Memories,Tasks}Controller.
// ---------------------------------------------------------------------------

describe("PageParams", () => {
	it("is exactly { page?: string; limit?: string }", () => {
		expectTypeOf<PageParams>().toEqualTypeOf<{ page?: string; limit?: string }>();
	});

	it("accepts a fully populated query object", () => {
		const params: PageParams = { page: "2", limit: "50" };
		expect(params).toEqual({ page: "2", limit: "50" });
	});

	it("accepts an empty object (both fields optional)", () => {
		const params: PageParams = {};
		expect(Object.keys(params)).toEqual([]);
	});

	it("rejects a numeric page value", () => {
		// @ts-expect-error — page must be a string when present
		const bad: PageParams = { page: 42 };
		expect(bad).toBeDefined();
	});

	it("rejects a numeric limit value", () => {
		// @ts-expect-error — limit must be a string when present
		const bad: PageParams = { limit: 10 };
		expect(bad).toBeDefined();
	});
});

describe("SortParams", () => {
	it("is exactly { sortBy?: string; sortOrder?: string }", () => {
		expectTypeOf<SortParams>().toEqualTypeOf<{ sortBy?: string; sortOrder?: string }>();
	});

	it("accepts a fully populated sort object", () => {
		const params: SortParams = { sortBy: "created_at", sortOrder: "desc" };
		expect(params).toEqual({ sortBy: "created_at", sortOrder: "desc" });
	});

	it("rejects a numeric sortBy value", () => {
		// @ts-expect-error — sortBy must be a string when present
		const bad: SortParams = { sortBy: 1 };
		expect(bad).toBeDefined();
	});

	it("rejects a boolean sortOrder value", () => {
		// @ts-expect-error — sortOrder must be a string when present
		const bad: SortParams = { sortOrder: true };
		expect(bad).toBeDefined();
	});
});

describe("SearchParams", () => {
	it("is exactly { search?: string }", () => {
		expectTypeOf<SearchParams>().toEqualTypeOf<{ search?: string }>();
	});

	it("accepts a search term", () => {
		const params: SearchParams = { search: "auth" };
		expect(params.search).toBe("auth");
	});

	it("rejects an array search value", () => {
		// @ts-expect-error — search must be a string when present
		const bad: SearchParams = { search: ["auth"] };
		expect(bad).toBeDefined();
	});
});

describe("Params<T>", () => {
	it("maps a single key to a required string property", () => {
		expectTypeOf<Params<"owner">>().toEqualTypeOf<{ owner: string }>();
	});

	it("maps a union of keys to required string properties", () => {
		expectTypeOf<Params<"owner" | "repo">>().toEqualTypeOf<{ owner: string; repo: string }>();
	});

	it("accepts an object with all mapped keys", () => {
		const params: Params<"owner" | "repo"> = { owner: "vheins", repo: "local-memory-mcp" };
		expect(params).toEqual({ owner: "vheins", repo: "local-memory-mcp" });
	});

	it("rejects an object missing a mapped key (keys are required)", () => {
		// @ts-expect-error — Params<"page"> requires the page key
		const bad: Params<"page"> = {};
		expect(bad).toBeDefined();
	});

	it("rejects a non-string value for a mapped key", () => {
		// @ts-expect-error — mapped values must be strings
		const bad: Params<"page"> = { page: 42 };
		expect(bad).toBeDefined();
	});
});

describe("ListQuery", () => {
	it("exposes the base repo/status filter fields", () => {
		expectTypeOf<ListQuery>().toMatchTypeOf<{ repo?: string; status?: string }>();
	});

	it("composes page, sort and search params into the query shape", () => {
		expectTypeOf<ListQuery>().toMatchTypeOf<{
			page?: string;
			limit?: string;
			sortBy?: string;
			sortOrder?: string;
			search?: string;
		}>();
	});

	it("accepts an arbitrary string key (open index signature)", () => {
		const query: ListQuery = { repo: "vheins/local-memory-mcp", owner: "vheins", severity: "high" };
		expect(query.owner).toBe("vheins");
	});

	it("accepts a fully populated query", () => {
		const query: ListQuery = {
			repo: "vheins/local-memory-mcp",
			status: "pending",
			page: "1",
			limit: "20",
			sortBy: "created_at",
			sortOrder: "desc",
			search: "auth"
		};
		expect(query.status).toBe("pending");
		expect(query.limit).toBe("20");
	});

	it("rejects a numeric page value", () => {
		// @ts-expect-error — page must be a string when present
		const bad: ListQuery = { page: 1 };
		expect(bad).toBeDefined();
	});

	it("rejects a non-string base field value", () => {
		// @ts-expect-error — repo must be a string when present
		const bad: ListQuery = { repo: 42 };
		expect(bad).toBeDefined();
	});

	it("rejects a non-string value for an arbitrary key", () => {
		// @ts-expect-error — index signature values are strings
		const bad: ListQuery = { custom: 42 };
		expect(bad).toBeDefined();
	});
});

describe("TaskListQuery", () => {
	it("is an alias of ListQuery", () => {
		expectTypeOf<TaskListQuery>().toEqualTypeOf<ListQuery>();
	});

	it("accepts query fields", () => {
		const query: TaskListQuery = { status: "completed", page: "2" };
		expect(query.status).toBe("completed");
	});

	it("rejects a numeric page value", () => {
		// @ts-expect-error — page must be a string when present
		const bad: TaskListQuery = { status: "completed", page: 2 };
		expect(bad).toBeDefined();
	});
});

describe("MemoryListQuery", () => {
	it("extends ListQuery with type/importance filter keys", () => {
		expectTypeOf<MemoryListQuery>().toMatchTypeOf<ListQuery<"type" | "minImportance" | "maxImportance">>();
		expectTypeOf<MemoryListQuery>().toMatchTypeOf<{
			type?: string;
			minImportance?: string;
			maxImportance?: string;
		}>();
	});

	it("accepts a fully populated memory query", () => {
		const query: MemoryListQuery = {
			repo: "vheins/local-memory-mcp",
			type: "decision",
			minImportance: "3",
			maxImportance: "5",
			page: "1"
		};
		expect(query.type).toBe("decision");
		expect(query.minImportance).toBe("3");
	});

	it("rejects a numeric type filter", () => {
		// @ts-expect-error — type must be a string when present
		const bad: MemoryListQuery = { type: 1 };
		expect(bad).toBeDefined();
	});

	it("rejects a numeric minImportance filter", () => {
		// @ts-expect-error — minImportance must be a string when present
		const bad: MemoryListQuery = { minImportance: 3 };
		expect(bad).toBeDefined();
	});
});

describe("IdParams", () => {
	it("is exactly { id: string }", () => {
		expectTypeOf<IdParams>().toEqualTypeOf<{ id: string }>();
	});

	it("accepts an id value", () => {
		const params: IdParams = { id: "abc-123" };
		expect(params.id).toBe("abc-123");
	});

	it("rejects an object missing the required id", () => {
		// @ts-expect-error — id is required
		const bad: IdParams = {};
		expect(bad).toBeDefined();
	});

	it("rejects a numeric id", () => {
		// @ts-expect-error — id must be a string
		const bad: IdParams = { id: 123 };
		expect(bad).toBeDefined();
	});
});

describe("NameParams", () => {
	it("is exactly { name: string }", () => {
		expectTypeOf<NameParams>().toEqualTypeOf<{ name: string }>();
	});

	it("accepts a name value", () => {
		const params: NameParams = { name: "task-memory-executor" };
		expect(params.name).toBe("task-memory-executor");
	});

	it("rejects an object missing the required name", () => {
		// @ts-expect-error — name is required
		const bad: NameParams = {};
		expect(bad).toBeDefined();
	});

	it("rejects a non-string name", () => {
		// @ts-expect-error — name must be a string
		const bad: NameParams = { name: 42 };
		expect(bad).toBeDefined();
	});
});
