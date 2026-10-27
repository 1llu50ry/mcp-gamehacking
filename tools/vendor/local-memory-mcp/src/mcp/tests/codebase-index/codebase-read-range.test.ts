import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { createTestStore, SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";
import type { CodebaseSymbolInsert } from "../../types/codebase-symbol.js";
import type { CodebaseReferenceInsert } from "../../types/codebase-reference.js";
import type { McpResponse } from "../../utils/mcp-response.js";

const REPO = "range-test";
const FILE = "sample.ts";

function noopVectorStore(): VectorStore {
	return {
		async upsert(): Promise<void> {},
		async remove(): Promise<void> {},
		async search(): Promise<[]> {
			return [];
		}
	};
}

function data(resp: McpResponse): Record<string, unknown> {
	return resp.structuredContent as Record<string, unknown>;
}

let store: SQLiteStore;
let vectors: VectorStore;

beforeAll(async () => {
	store = await createTestStore();
	vectors = noopVectorStore();

	// File with a class containing two nested methods, plus top-level symbols.
	// `parent_symbol_id` wires render/update under Widget so references emitted
	// by a method resolve as "emitted by an enclosing symbol".
	store.codebaseFiles.upsertFile({ repo: REPO, file_path: FILE, language: "typescript", lines: 27, size_bytes: 600 });

	const symbols: CodebaseSymbolInsert[] = [
		{
			id: "w",
			repo: REPO,
			file_path: FILE,
			name: "Widget",
			kind: "class",
			exported: true,
			start_line: 1,
			start_col: 1,
			end_line: 20,
			end_col: 1,
			signature: "class Widget",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "r",
			repo: REPO,
			file_path: FILE,
			name: "render",
			kind: "method",
			exported: false,
			start_line: 3,
			start_col: 2,
			end_line: 8,
			end_col: 2,
			signature: "render(): void",
			doc_comment: null,
			parent_symbol_id: "w"
		},
		{
			id: "u",
			repo: REPO,
			file_path: FILE,
			name: "update",
			kind: "method",
			exported: false,
			start_line: 10,
			start_col: 2,
			end_line: 15,
			end_col: 2,
			signature: "update(v: number): void",
			doc_comment: null,
			parent_symbol_id: "w"
		},
		{
			id: "p",
			repo: REPO,
			file_path: FILE,
			name: "Point",
			kind: "interface",
			exported: true,
			start_line: 22,
			start_col: 1,
			end_line: 25,
			end_col: 1,
			signature: "interface Point",
			doc_comment: null,
			parent_symbol_id: null
		},
		{
			id: "c",
			repo: REPO,
			file_path: FILE,
			name: "Coord",
			kind: "type",
			exported: true,
			start_line: 27,
			start_col: 1,
			end_line: 27,
			end_col: 10,
			signature: "type Coord = [number, number]",
			doc_comment: null,
			parent_symbol_id: null
		}
	];
	store.codebaseSymbols.bulkUpsertSymbols(symbols);

	// ref A: a call emitted inside render's body (line 6) → caller_name render.
	// ref B/C: 'type' edges emitted by Widget → Point / Coord (issue #84 graph).
	// ref D: a call emitted by Point at line 23 (OUTSIDE the Widget range).
	const refs: CodebaseReferenceInsert[] = [
		{
			repo: REPO,
			symbol_name: "helper",
			caller_file: FILE,
			caller_line: 6,
			caller_name: "render",
			kind: "call"
		},
		{
			repo: REPO,
			symbol_name: "Point",
			caller_file: FILE,
			caller_line: 2,
			caller_name: "Widget",
			kind: "type",
			role: "property",
			target_symbol_id: "p"
		},
		{
			repo: REPO,
			symbol_name: "Coord",
			caller_file: FILE,
			caller_line: 2,
			caller_name: "Widget",
			kind: "type",
			role: "property",
			target_symbol_id: "c"
		},
		{
			repo: REPO,
			symbol_name: "validate",
			caller_file: FILE,
			caller_line: 23,
			caller_name: "Point",
			kind: "call"
		}
	];
	store.codebaseReferences.bulkUpsertReferences(REPO, refs);
});

afterAll(() => {
	store.close();
});

async function readRange(extra: Record<string, unknown>): Promise<McpResponse> {
	return handleCodebaseRead({ owner: "vheins", json: true, repo: REPO, filePath: FILE, ...extra }, store, vectors);
}

describe("codebase-read FILE mode — range awareness (#88 / TASK-014)", () => {
	it("exact overlap: a symbol fully within the range is primary context (enclosing class also included)", async () => {
		const resp = await readRange({ startLine: 3, endLine: 8 });
		const d = data(resp);
		expect(d.error).toBeUndefined();
		expect(d.range).toEqual({ startLine: 3, endLine: 8 });
		const names = (d.symbols as Array<Record<string, unknown>>).map((s) => s.name);
		expect(names).toContain("render"); // fully inside the range
		expect(names).toContain("Widget"); // encloses the range
		expect(names).not.toContain("update"); // outside range
		expect(names).not.toContain("Point"); // outside range
	});

	it("nested members: a range inside a method surfaces the method + class and scopes its emitted references", async () => {
		const resp = await readRange({ startLine: 5, endLine: 6 });
		const d = data(resp);
		const names = (d.symbols as Array<Record<string, unknown>>).map((s) => s.name);
		expect(names).toEqual(expect.arrayContaining(["render", "Widget"]));
		expect(names).not.toContain("update");

		// The call emitted inside render (ref A, line 6) is in scope because
		// render is an enclosing emitter; the Point call (line 23) is excluded.
		const refs = d.references as Array<Record<string, unknown>>;
		const lines = refs.map((r) => r.startLine);
		expect(lines).toContain(6);
		expect(lines).not.toContain(23);
	});

	it("multiple symbols in one range are all returned", async () => {
		const resp = await readRange({ startLine: 1, endLine: 20 });
		const d = data(resp);
		const names = (d.symbols as Array<Record<string, unknown>>).map((s) => s.name);
		expect(names).toEqual(expect.arrayContaining(["Widget", "render", "update"]));
		expect(names).not.toContain("Point");
		expect(d.primarySymbolCount).toBe(3);
		expect(d.fileSymbolCount).toBe(5);
	});

	it("empty range (startLine === endLine) returns the enclosing symbols", async () => {
		const resp = await readRange({ startLine: 3, endLine: 3 });
		const d = data(resp);
		expect(d.error).toBeUndefined();
		const names = (d.symbols as Array<Record<string, unknown>>).map((s) => s.name);
		expect(names).toEqual(expect.arrayContaining(["render", "Widget"]));
		expect(names).not.toContain("Point");
	});

	it("full-file fallback: no range preserves the original all-symbols FILE behavior", async () => {
		const resp = await readRange({});
		const d = data(resp);
		expect(d.error).toBeUndefined();
		expect(d.range).toBeUndefined();
		expect(d.total).toBe(5);
		const names = (d.symbols as Array<Record<string, unknown>>).map((s) => s.name);
		expect(names).toEqual(expect.arrayContaining(["Widget", "render", "update", "Point", "Coord"]));
	});

	it("invalid range: only startLine provided → RANGE_INCOMPLETE", async () => {
		const resp = await readRange({ startLine: 3 });
		const d = data(resp);
		expect(d.code).toBe("RANGE_INCOMPLETE");
		expect(d.error).toContain("together");
	});

	it("invalid range: only endLine provided → RANGE_INCOMPLETE", async () => {
		const resp = await readRange({ endLine: 8 });
		const d = data(resp);
		expect(d.code).toBe("RANGE_INCOMPLETE");
	});

	it("invalid range: endLine < startLine → RANGE_OUT_OF_ORDER", async () => {
		const resp = await readRange({ startLine: 8, endLine: 3 });
		const d = data(resp);
		expect(d.code).toBe("RANGE_OUT_OF_ORDER");
	});

	it("out-of-range: endLine beyond file length → RANGE_OUT_OF_BOUNDS", async () => {
		const resp = await readRange({ startLine: 1, endLine: 999 });
		const d = data(resp);
		expect(d.code).toBe("RANGE_OUT_OF_BOUNDS");
		expect(d.error).toContain("27");
	});

	it("includeRelatedTypes: folds the related-type graph for the enclosing symbol(s)", async () => {
		const resp = await readRange({ startLine: 1, endLine: 20, includeRelatedTypes: true });
		const d = data(resp);
		expect(d.error).toBeUndefined();
		const related = d.relatedTypes as Array<Record<string, unknown>>;
		expect(related.length).toBe(2);
		const targets = related.map((e) => e.targetName);
		expect(targets).toEqual(expect.arrayContaining(["Point", "Coord"]));
	});

	it("contextBudget: bounds the enriched result to a token-budgeted pack", async () => {
		const resp = await readRange({ startLine: 1, endLine: 20, contextBudget: 1000 });
		const d = data(resp);
		expect(d.error).toBeUndefined();
		const pack = d.contextPack as Record<string, unknown> | undefined;
		expect(pack).toBeDefined();
		const items = pack!.items as Array<Record<string, unknown>>;
		expect(items.length).toBeGreaterThanOrEqual(1);
		// The Widget root (an enclosing symbol) is always in the pack.
		expect(items.some((i) => i.name === "Widget")).toBe(true);
		expect(typeof pack!.estimatedTokens).toBe("number");
	});

	it("range excludes unrelated symbols: a non-overlapping symbol is never returned", async () => {
		const resp = await readRange({ startLine: 1, endLine: 20 });
		const d = data(resp);
		const names = (d.symbols as Array<Record<string, unknown>>).map((s) => s.name);
		expect(names).not.toContain("Coord"); // Coord at line 27 is outside [1,20]
	});
});
