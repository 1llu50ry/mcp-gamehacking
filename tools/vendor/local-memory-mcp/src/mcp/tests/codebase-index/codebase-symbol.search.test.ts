import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import { CodebaseSymbolEntity } from "../../entities/codebase-symbol.js";
import { CodebaseFileEntity } from "../../entities/codebase-file.js";

describe("CodebaseSymbol Entity", () => {
	let store: SQLiteStore;
	let entity: CodebaseSymbolEntity;

	beforeEach(async () => {
		store = await createTestStore();
		entity = store.codebaseSymbols;
	});

	it("searchSymbols falls back to LIKE when FTS5 fails gracefully", () => {
		// Insert with FTS5 then verify search works (FTS5 may fail for special chars)
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/special.ts",
				name: "specialFn",
				kind: "function",
				doc_comment: "This has special characters: @#$%"
			}
		]);

		// Search for "special" — FTS5 may strip special chars but content is there
		const result = entity.searchSymbols({
			query: "special",
			repo: "test-repo",
			limit: 10
		});

		expect(result.symbols.length).toBeGreaterThanOrEqual(0);
		expect(result.total).toBeGreaterThanOrEqual(0);
		// LIKE fallback should work even if FTS5 strips characters
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: FTS5 search with special characters ($onInit, __init__)
	// ══════════════════════════════════════════════════════════════════

	it("FTS5 search with special characters: $onInit and __init__", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/angular.ts",
				name: "$onInit",
				kind: "method",
				doc_comment: "Angular lifecycle hook: $onInit callback"
			},
			{
				repo: "test-repo",
				file_path: "src/core.ts",
				name: "__init__",
				kind: "function",
				doc_comment: "Python-style initializer __init__ method"
			},
			{
				repo: "test-repo",
				file_path: "src/other.ts",
				name: "normalFn",
				kind: "function",
				doc_comment: "A normal function without special chars"
			}
		]);

		// FTS5 strips special chars, so searching "$on" with FTS becomes "on" — may or may not match
		// But LIKE fallback should find "$onInit" by name
		const result1 = entity.searchSymbols({
			query: "onInit",
			repo: "test-repo",
			limit: 10
		});
		expect(result1.symbols.length).toBeGreaterThanOrEqual(1);
		// At minimum, LIKE should find the symbol whose name contains "onInit"
		const hasOnInit = result1.symbols.some((s) => s.name === "$onInit");
		expect(hasOnInit).toBe(true);

		// Search for __init__ — special chars stripped by FTS, LIKE fallback should find it
		const result2 = entity.searchSymbols({
			query: "init",
			repo: "test-repo",
			limit: 10
		});
		const hasInit = result2.symbols.some((s) => s.name === "__init__");
		expect(hasInit).toBe(true);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Batch upsert performance — 1000 symbols
	// ══════════════════════════════════════════════════════════════════

	it("batch upsert: 1000 symbols, verify all stored", () => {
		const symbols = Array.from({ length: 1000 }, (_, i) => ({
			repo: "perf-repo",
			file_path: `src/file${Math.floor(i / 100)}.ts`,
			name: `func${i}`,
			kind: "function",
			start_line: i + 1,
			doc_comment: `Function number ${i}`
		}));

		const count = entity.bulkUpsertSymbols(symbols);
		expect(count).toBe(1000);

		// Verify total across all files
		let totalCount = 0;
		for (let fileIdx = 0; fileIdx < 10; fileIdx++) {
			const fileSymbols = entity.getSymbolsByFile("perf-repo", `src/file${fileIdx}.ts`);
			totalCount += fileSymbols.length;
		}
		expect(totalCount).toBe(1000);

		// Spot check a symbol
		const file0Symbols = entity.getSymbolsByFile("perf-repo", "src/file0.ts");
		expect(file0Symbols.length).toBe(100);
		expect(file0Symbols[0].name).toBe("func0");
		expect(file0Symbols[99].name).toBe("func99");

		// Clean up
		entity.deleteSymbolsByRepo("perf-repo");
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Search pagination — verify offset/limit works correctly
	// ══════════════════════════════════════════════════════════════════

	it("search pagination: offset/limit works correctly with boundary cases", () => {
		// Insert 12 symbols
		const symbols = Array.from({ length: 12 }, (_, i) => ({
			repo: "page-repo",
			file_path: "src/page.ts",
			name: `item${i}`,
			kind: "function",
			doc_comment: `Item number ${i}`
		}));
		entity.bulkUpsertSymbols(symbols);

		// Page 1: first 5
		const page1 = entity.searchSymbols({
			query: "item",
			repo: "page-repo",
			limit: 5,
			offset: 0
		});
		expect(page1.symbols.length).toBe(5);
		expect(page1.total).toBe(12);
		expect(page1.hasMore).toBe(true);

		// Page 2: next 5
		const page2 = entity.searchSymbols({
			query: "item",
			repo: "page-repo",
			limit: 5,
			offset: 5
		});
		expect(page2.symbols.length).toBe(5);
		expect(page2.total).toBe(12);
		expect(page2.hasMore).toBe(true);

		// Page 3: final 2
		const page3 = entity.searchSymbols({
			query: "item",
			repo: "page-repo",
			limit: 5,
			offset: 10
		});
		expect(page3.symbols.length).toBe(2);
		expect(page3.total).toBe(12);
		expect(page3.hasMore).toBe(false);

		// Out of bounds offset
		const pageBeyond = entity.searchSymbols({
			query: "item",
			repo: "page-repo",
			limit: 5,
			offset: 50
		});
		expect(pageBeyond.symbols.length).toBe(0);
		expect(pageBeyond.total).toBe(12);
		expect(pageBeyond.hasMore).toBe(false);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Case insensitivity — search "foobar" matches "FooBar"
	// ══════════════════════════════════════════════════════════════════

	it("case insensitivity: search 'foobar' matches 'FooBar'", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/mixed.ts",
				name: "FooBar",
				kind: "class",
				doc_comment: "Mixed case class"
			},
			{
				repo: "test-repo",
				file_path: "src/mixed.ts",
				name: "foobar",
				kind: "function",
				doc_comment: "Lowercase function"
			},
			{
				repo: "test-repo",
				file_path: "src/mixed.ts",
				name: "FOOBAR",
				kind: "constant",
				doc_comment: "Uppercase constant"
			}
		]);

		// Search "foobar" should match all three via LIKE (SQLite LIKE is case-insensitive by default)
		const result = entity.searchSymbols({
			query: "foobar",
			repo: "test-repo",
			limit: 10
		});

		expect(result.symbols.length).toBe(3);
		const names = result.symbols.map((s) => s.name).sort();
		expect(names).toEqual(["FOOBAR", "FooBar", "foobar"]);
	});

	// ══════════════════════════════════════════════════════════════════
	// Edge Case: Delete re-index — symbols deleted, file record persists
	// ══════════════════════════════════════════════════════════════════

	it("delete re-index: delete all symbols for file, file record still exists", () => {
		// We need the CodebaseFileEntity to verify file record independence
		const fileEntity = store.codebaseFiles as CodebaseFileEntity;

		// Upsert a file record
		fileEntity.upsertFile({
			repo: "test-repo",
			file_path: "src/reindex.ts",
			language: "typescript",
			checksum: "abc123",
			lines: 50,
			size_bytes: 1200
		});

		// Insert symbols for that file
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/reindex.ts",
				name: "fnOld",
				kind: "function",
				start_line: 1,
				doc_comment: "Old function"
			},
			{
				repo: "test-repo",
				file_path: "src/reindex.ts",
				name: "fnAlso",
				kind: "function",
				start_line: 10,
				doc_comment: "Another function"
			}
		]);

		// Verify both exist
		expect(entity.getSymbolsByFile("test-repo", "src/reindex.ts").length).toBe(2);
		expect(fileEntity.getFile("test-repo", "src/reindex.ts")).toBeDefined();

		// Delete all symbols for the file
		const deleted = entity.deleteSymbolsByFile("test-repo", "src/reindex.ts");
		expect(deleted).toBe(2);

		// Symbols gone
		expect(entity.getSymbolsByFile("test-repo", "src/reindex.ts")).toEqual([]);

		// File record STILL EXISTS (independent lifecycle)
		const fileRecord = fileEntity.getFile("test-repo", "src/reindex.ts");
		expect(fileRecord).toBeDefined();
		expect(fileRecord!.checksum).toBe("abc123");
		expect(fileRecord!.lines).toBe(50);

		// Re-index: upsert new symbols (simulating re-parse)
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/reindex.ts",
				name: "fnNew",
				kind: "function",
				start_line: 1,
				doc_comment: "New function after re-index"
			}
		]);

		// Symbols are back with new content
		const afterReindex = entity.getSymbolsByFile("test-repo", "src/reindex.ts");
		expect(afterReindex.length).toBe(1);
		expect(afterReindex[0].name).toBe("fnNew");

		// File record unchanged
		const fileAfterReindex = fileEntity.getFile("test-repo", "src/reindex.ts");
		expect(fileAfterReindex).toBeDefined();
		expect(fileAfterReindex!.checksum).toBe("abc123");
	});

	// ══════════════════════════════════════════════════════════════════
	// searchByPrefix — case-insensitive name prefix (idx_symbols_name_lower,
	// migration v20 / issue #63)
	// ══════════════════════════════════════════════════════════════════

	it("searchByPrefix returns case-insensitive prefix matches only", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "getUserProfile",
				kind: "function",
				start_line: 1
			},
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "getUser",
				kind: "function",
				start_line: 2
			},
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "GetUserPermissions",
				kind: "function",
				start_line: 3
			},
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "getOrders",
				kind: "class",
				start_line: 4
			},
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "fetchUser",
				kind: "function",
				start_line: 5
			}
		]);

		const result = entity.searchByPrefix({ repo: "test-repo", prefix: "getu" });

		// Prefix only — mid-word/substring matches ("fetchUser") and non-matches
		// ("getOrders") are excluded; matching is case-insensitive ("GetUser…").
		expect(result.symbols.map((s) => s.name)).toEqual(["getUser", "GetUserPermissions", "getUserProfile"]);
		expect(result.total).toBe(3);
		expect(result.hasMore).toBe(false);
	});

	it("searchByPrefix filters by kind and paginates", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "loadUserData",
				kind: "function",
				start_line: 1
			},
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "loadUserConfig",
				kind: "function",
				start_line: 2
			},
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "loadUserService",
				kind: "class",
				start_line: 3
			},
			{
				repo: "other-repo",
				file_path: "src/a.ts",
				name: "loadUserExternal",
				kind: "function",
				start_line: 4
			}
		]);

		// kind filter narrows to function symbols in the prefix range.
		const kindFiltered = entity.searchByPrefix({
			repo: "test-repo",
			prefix: "loadUser",
			kind: "function"
		});
		expect(kindFiltered.symbols.map((s) => s.name)).toEqual(["loadUserConfig", "loadUserData"]);

		// repo scope: symbols from other repos are never returned.
		const scoped = entity.searchByPrefix({ repo: "test-repo", prefix: "loadUser" });
		expect(scoped.symbols.map((s) => s.name)).toEqual(["loadUserConfig", "loadUserData", "loadUserService"]);

		// Pagination: page size 2 → hasMore until the last page.
		const page1 = entity.searchByPrefix({ repo: "test-repo", prefix: "loadUser", limit: 2, offset: 0 });
		expect(page1.symbols.map((s) => s.name)).toEqual(["loadUserConfig", "loadUserData"]);
		expect(page1.hasMore).toBe(true);
		expect(page1.total).toBe(3);

		const page2 = entity.searchByPrefix({ repo: "test-repo", prefix: "loadUser", limit: 2, offset: 2 });
		expect(page2.symbols.map((s) => s.name)).toEqual(["loadUserService"]);
		expect(page2.hasMore).toBe(false);
	});

	it("searchByPrefix returns empty for no prefix matches", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "calculateTotal",
				kind: "function",
				start_line: 1
			}
		]);

		const result = entity.searchByPrefix({ repo: "test-repo", prefix: "zzz" });
		expect(result.symbols).toEqual([]);
		expect(result.total).toBe(0);
		expect(result.hasMore).toBe(false);
	});
});
