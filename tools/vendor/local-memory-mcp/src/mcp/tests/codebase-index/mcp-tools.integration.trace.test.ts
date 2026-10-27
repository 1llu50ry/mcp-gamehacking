import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { handleCodebaseRead } from "../../tools/codebase.read";
import { REPO, data, setupIntegrationFixture } from "./mcp-tools.integration.shared.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { VectorStore } from "../../types.js";

let store: SQLiteStore;
let vectors: VectorStore;

beforeAll(async () => {
	const fixture = await setupIntegrationFixture();
	store = fixture.store;
	vectors = fixture.vectors;
});

afterAll(() => {
	store.close();
});

describe("handleCodebaseRead (trace mode)", () => {
	it("returns definition for a known exported function", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, name: "formatSize", repo: REPO },
			store,
			vectors
		);
		const d = data(resp);

		expect(d.symbol).toBeDefined();
		const symbol = d.symbol as Record<string, unknown>;
		expect(symbol.name).toBe("formatSize");
		expect(symbol.kind).toBe("function");

		const definition = d.definition as Record<string, unknown>;
		expect(definition.file).toBe("utils.ts");
		expect(definition.line).toBe(5);

		const exportChain = d.exportChain as Record<string, unknown>;
		expect(exportChain.exported).toBe(true);
		expect(exportChain.defaultExport).toBe(false);
	});

	it("returns disambiguation for ambiguous names", async () => {
		// Insert a second symbol with name "Button" in a different file
		store.codebaseSymbols.bulkUpsertSymbols([
			{
				repo: REPO,
				file_path: "types.ts",
				name: "Button",
				kind: "type",
				exported: true,
				default_export: false,
				start_line: 50,
				start_col: 1,
				end_line: 50,
				end_col: 9,
				signature: "type Button = string",
				doc_comment: null,
				parent_symbol_id: null
			}
		]);

		const resp = await handleCodebaseRead({ owner: "vheins", json: true, name: "Button", repo: REPO }, store, vectors);
		const d = data(resp);

		expect(resp.isError).toBe(true);
		expect(d).toMatchObject({ schema: "tool-error", code: "AMBIGUOUS_SYMBOL", retryable: false });
		const disamb = (d.details as Record<string, unknown>).disambiguation as Array<Record<string, unknown>>;
		expect(disamb.length).toBe(2);

		const names = disamb.map((s) => s.name);
		expect(names).toEqual(["Button", "Button"]);

		// Clean up the duplicate
		store.codebaseSymbols.deleteSymbolsByFile(REPO, "types.ts");
		// Re-insert the original types.ts symbols
		store.codebaseSymbols.bulkUpsertSymbols([
			{
				repo: REPO,
				file_path: "types.ts",
				name: "User",
				kind: "interface",
				exported: true,
				default_export: false,
				start_line: 5,
				start_col: 1,
				end_line: 11,
				end_col: 1,
				signature: "interface User",
				doc_comment: "User entity with role-based access.",
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "UserRole",
				kind: "type",
				exported: true,
				default_export: false,
				start_line: 13,
				start_col: 1,
				end_line: 13,
				end_col: 47,
				signature: "type UserRole",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "SearchResult",
				kind: "interface",
				exported: true,
				default_export: false,
				start_line: 15,
				start_col: 1,
				end_line: 21,
				end_col: 1,
				signature: "interface SearchResult<T>",
				doc_comment: "Generic search result wrapper.",
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "PaginationParams",
				kind: "interface",
				exported: true,
				default_export: false,
				start_line: 23,
				start_col: 1,
				end_line: 28,
				end_col: 1,
				signature: "interface PaginationParams",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "SearchQuery",
				kind: "type",
				exported: true,
				default_export: false,
				start_line: 30,
				start_col: 1,
				end_line: 34,
				end_col: 2,
				signature: "type SearchQuery",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "Status",
				kind: "enum",
				exported: true,
				default_export: false,
				start_line: 36,
				start_col: 1,
				end_line: 40,
				end_col: 1,
				signature: "enum Status",
				doc_comment: null,
				parent_symbol_id: null
			},
			{
				repo: REPO,
				file_path: "types.ts",
				name: "AuditEntry",
				kind: "interface",
				exported: true,
				default_export: false,
				start_line: 42,
				start_col: 1,
				end_line: 48,
				end_col: 1,
				signature: "interface AuditEntry",
				doc_comment: null,
				parent_symbol_id: null
			}
		]);
	});

	it("returns error for non-existent symbol", async () => {
		const resp = await handleCodebaseRead(
			{ owner: "vheins", json: true, name: "zzzNonexistentFn", repo: REPO },
			store,
			vectors
		);
		const d = data(resp);

		expect(resp.isError).toBe(true);
		expect(d).toMatchObject({
			schema: "tool-error",
			code: "SYMBOL_NOT_FOUND",
			retryable: false,
			message: expect.stringContaining("not found")
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// codebase-read: code mode (via content — TASK-316)
// ═══════════════════════════════════════════════════════════════════════
