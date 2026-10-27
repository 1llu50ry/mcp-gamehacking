import { describe, it, expect, beforeEach, vi } from "vitest";
import { SQLiteStore } from "../storage/sqlite";
import { StubVectorStore } from "../storage/vectors.stub";
import { handleSearchMode as handleStandardSearchMode } from "../tools/standard-read/search";
import { handleMemoryRead } from "../tools/memory.read";
import { handleSearchMode as handleCodebaseSearchMode } from "../tools/codebase-read/search";
import type { VectorStore, MemoryEntry, MemoryScope } from "../types";
import type { StandardReadInput } from "../tools/schemas/standard-read";
import type { CodebaseReadInput } from "../tools/schemas/codebase-read";

// ── Integration: inline tags yield the same effective filter as structured ──
// Verifies TASK-443's merge rule (union/B) end-to-end: a model that packs
// `language:php stack:laravel` into the free-text query gets identical filtering
// to one that uses the structured Zod params.

// Shared in-memory store + stub vector store for every test in this file.
let db: SQLiteStore;
let vectors: VectorStore;

beforeEach(() => {
	db = new SQLiteStore(":memory:");
	vectors = new StubVectorStore(db);
});

describe("inline tag extraction — integration", () => {
	it("standard-read: query:'language:php stack:laravel' == structured language/stack", async () => {
		const spy = vi.spyOn(db.standards, "searchBySimilarity").mockReturnValue([]);

		const structured = {
			query: "auth",
			language: "php",
			stack: ["laravel"],
			owner: "test",
			repo: "repo",
			offset: 0,
			limit: 5
		} as StandardReadInput;
		const tagged = {
			query: "auth language:php stack:laravel",
			owner: "test",
			repo: "repo",
			offset: 0,
			limit: 5
		} as StandardReadInput;

		await handleStandardSearchMode(structured, db, vectors);
		const structuredOpts = spy.mock.calls[0]![1] as Record<string, unknown>;
		spy.mockClear();

		await handleStandardSearchMode(tagged, db, vectors);
		const taggedOpts = spy.mock.calls[0]![1] as Record<string, unknown>;

		expect(taggedOpts.language).toBe(structuredOpts.language);
		expect(taggedOpts.stack).toEqual(structuredOpts.stack);
		expect(taggedOpts.language).toBe("php");
		expect(taggedOpts.stack).toEqual(["laravel"]);
	});

	it("memory-read: query:'tag:a,b' == structured current_tags", async () => {
		const spy = vi.spyOn(db.memoryVectors, "searchBySimilarity").mockReturnValue([]);

		await handleMemoryRead({ query: "auth tag:a,b", owner: "test", repo: "repo" }, db, vectors);
		const taggedTags = spy.mock.calls[0]![5] as string[];
		spy.mockClear();

		await handleMemoryRead({ query: "auth", current_tags: ["a", "b"], owner: "test", repo: "repo" }, db, vectors);
		const structuredTags = spy.mock.calls[0]![5] as string[];

		expect(taggedTags).toEqual(structuredTags);
		expect(taggedTags).toEqual(["a", "b"]);
	});

	it("codebase-read: query:'foo kind:function' == structured kind (and strips the tag from the search text)", async () => {
		const spy = vi.spyOn(db.codebaseSymbols, "searchSymbols").mockReturnValue({ symbols: [], total: 0 } as never);

		const structured = {
			query: "foo",
			kind: "function",
			owner: "",
			repo: "repo",
			offset: 0,
			limit: 5
		} as CodebaseReadInput;
		const tagged = {
			query: "foo kind:function",
			owner: "",
			repo: "repo",
			offset: 0,
			limit: 5
		} as CodebaseReadInput;

		await handleCodebaseSearchMode(structured, db, vectors);
		const structuredArg = spy.mock.calls[0]![0] as { query: string; kind: string | undefined };
		spy.mockClear();

		await handleCodebaseSearchMode(tagged, db, vectors);
		const taggedArg = spy.mock.calls[0]![0] as { query: string; kind: string | undefined };

		expect(taggedArg.kind).toBe(structuredArg.kind);
		expect(taggedArg.kind).toBe("function");
		// The tag is stripped from the symbol-search text (FTS won't see "kind:function").
		expect(taggedArg.query).toBe("foo");
	});
});

// ── TASK-444 / TASK-446: memory.read inline lang/folder/branch/path tags ──
// Inline `lang:`/`language:`/`folder:`/`branch:`/`path:` tags (TASK-443) must
// drive the SAME workspace-affinity boost as the structured `scope` /
// `current_file_path` params. Each case asserts the matching memory is ranked
// first both via the inline tag and via the structured param (parity), proving
// the extracted values are wired into the boost (not silent no-ops).

/** Build a full MemoryEntry with a controllable similarity for mock candidates. */
function makeMemory(opts: {
	id: string;
	similarity: number;
	scope?: Partial<MemoryScope>;
}): MemoryEntry & { similarity: number } {
	const scope: MemoryScope = { owner: "test", repo: "repo", ...opts.scope };
	return {
		id: opts.id,
		code: opts.id,
		type: "code_fact",
		title: opts.id,
		content: "",
		importance: 3,
		agent: "a",
		role: "r",
		model: "m",
		scope,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: null,
		supersedes: null,
		status: "active",
		tags: [],
		metadata: {},
		is_global: false,
		similarity: opts.similarity
	};
}

/** Top-ranked memory id from a memory.read response. */
function topMemoryId(res: Awaited<ReturnType<typeof handleMemoryRead>>): string {
	return ((res.structuredContent as { rows: unknown[][] }).rows[0] as unknown[])[0] as string;
}

describe("memory-read inline tag → affinity boost (TASK-444)", () => {
	function mockCandidates(matches: (MemoryEntry & { similarity: number })[]): void {
		vi.spyOn(db.memoryVectors, "searchBySimilarity").mockReturnValue(matches);
		// Disable the FTS keyword feed so only the affinity boost differentiates.
		vi.spyOn(db.memories, "searchByFtsScored").mockReturnValue([]);
	}

	it("query:'branch:main' ranks matching scope.branch first like structured scope.branch", async () => {
		const matching = makeMemory({ id: "m-branch", similarity: 0.5, scope: { branch: "main" } });
		const other = makeMemory({ id: "m-other-branch", similarity: 0.5, scope: { branch: "feature/x" } });
		mockCandidates([matching, other]);

		const tagged = await handleMemoryRead(
			{ query: "branch:main", owner: "test", repo: "repo", json: true },
			db,
			vectors
		);
		const structured = await handleMemoryRead(
			{ query: "x", owner: "test", repo: "repo", json: true, scope: { owner: "test", repo: "repo", branch: "main" } },
			db,
			vectors
		);

		expect(topMemoryId(tagged)).toBe("m-branch");
		expect(topMemoryId(structured)).toBe("m-branch");
	});

	it("query:'path:src/foo' ranks matching scope.folder first like structured current_file_path", async () => {
		const matching = makeMemory({ id: "m-path", similarity: 0.5, scope: { folder: "src/foo" } });
		const other = makeMemory({ id: "m-other-path", similarity: 0.5, scope: { folder: "src/bar" } });
		mockCandidates([matching, other]);

		const tagged = await handleMemoryRead(
			{ query: "path:src/foo", owner: "test", repo: "repo", json: true },
			db,
			vectors
		);
		const structured = await handleMemoryRead(
			{ query: "x", owner: "test", repo: "repo", json: true, current_file_path: "src/foo" },
			db,
			vectors
		);

		expect(topMemoryId(tagged)).toBe("m-path");
		expect(topMemoryId(structured)).toBe("m-path");
	});

	it("query:'lang:php' ranks matching scope.language first like structured scope.language (THE FIX)", async () => {
		const matching = makeMemory({ id: "m-lang", similarity: 0.5, scope: { language: "php" } });
		const other = makeMemory({ id: "m-other-lang", similarity: 0.5, scope: { language: "ts" } });
		mockCandidates([matching, other]);

		const tagged = await handleMemoryRead({ query: "lang:php", owner: "test", repo: "repo", json: true }, db, vectors);
		const structured = await handleMemoryRead(
			{ query: "x", owner: "test", repo: "repo", json: true, scope: { owner: "test", repo: "repo", language: "php" } },
			db,
			vectors
		);

		expect(topMemoryId(tagged)).toBe("m-lang");
		expect(topMemoryId(structured)).toBe("m-lang");
	});

	it("query:'folder:src/foo' ranks matching scope.folder first like structured scope.folder (THE FIX)", async () => {
		const matching = makeMemory({ id: "m-folder", similarity: 0.5, scope: { folder: "src/foo" } });
		const other = makeMemory({ id: "m-other-folder", similarity: 0.5, scope: { folder: "src/bar" } });
		mockCandidates([matching, other]);

		const tagged = await handleMemoryRead(
			{ query: "folder:src/foo", owner: "test", repo: "repo", json: true },
			db,
			vectors
		);
		const structured = await handleMemoryRead(
			{
				query: "x",
				owner: "test",
				repo: "repo",
				json: true,
				scope: { owner: "test", repo: "repo", folder: "src/foo" }
			},
			db,
			vectors
		);

		expect(topMemoryId(tagged)).toBe("m-folder");
		expect(topMemoryId(structured)).toBe("m-folder");
	});
});

// ── TASK-445 / TASK-446: codebase-read multi-kind OR ──
// `kind:function,class` must return symbols of BOTH kinds. Before TASK-445 the
// merged kind array was truncated to its first element at the DB boundary, so
// only `function` symbols came back.

describe("codebase-read multi-kind OR (TASK-445)", () => {
	it("query:'foo kind:function,class' returns symbols of BOTH kinds", async () => {
		db.codebaseSymbols.bulkUpsertSymbols([
			{ repo: "repok", file_path: "src/a.ts", name: "fooFunc", kind: "function", doc_comment: "" },
			{ repo: "repok", file_path: "src/b.ts", name: "fooClass", kind: "class", doc_comment: "" }
		]);

		const res = await handleCodebaseSearchMode(
			{
				query: "foo kind:function,class",
				owner: "",
				repo: "repok",
				offset: 0,
				limit: 10,
				json: true
			} as CodebaseReadInput,
			db,
			vectors
		);

		const kinds = (res.structuredContent as { symbols: { kind: string }[] }).symbols.map((s) => s.kind);
		expect(kinds).toContain("function");
		expect(kinds).toContain("class");
	});

	it("query:'foo kind:function,class' passes the merged kind array to searchSymbols", async () => {
		const spy = vi
			.spyOn(db.codebaseSymbols, "searchSymbols")
			.mockReturnValue({ symbols: [], total: 0, hasMore: false });

		await handleCodebaseSearchMode(
			{
				query: "foo kind:function,class",
				owner: "",
				repo: "repok",
				offset: 0,
				limit: 10,
				json: true
			} as CodebaseReadInput,
			db,
			vectors
		);

		// The DB boundary must receive the full OR list, not just the first kind.
		expect(spy.mock.calls[0]![0].kind).toEqual(["function", "class"]);
	});
});
