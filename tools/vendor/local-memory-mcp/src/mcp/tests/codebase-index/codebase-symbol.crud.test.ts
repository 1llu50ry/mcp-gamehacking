import { describe, it, expect, beforeEach } from "vitest";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import { CodebaseSymbolEntity } from "../../entities/codebase-symbol.js";

describe("CodebaseSymbol Entity", () => {
	let store: SQLiteStore;
	let entity: CodebaseSymbolEntity;

	beforeEach(async () => {
		store = await createTestStore();
		entity = store.codebaseSymbols;
	});

	it("bulkUpsertSymbols inserts symbols and getSymbolsByFile retrieves them", () => {
		const count = entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/index.ts",
				name: "calculateTotal",
				kind: "function",
				exported: true,
				start_line: 42,
				end_line: 55,
				doc_comment: "Computes the total order amount"
			},
			{
				repo: "test-repo",
				file_path: "src/index.ts",
				name: "OrderService",
				kind: "class",
				exported: true,
				start_line: 10,
				end_line: 100,
				doc_comment: "Service for order operations"
			},
			{
				repo: "test-repo",
				file_path: "src/utils.ts",
				name: "helperFn",
				kind: "function",
				exported: false,
				start_line: 5,
				end_line: 12
			}
		]);

		expect(count).toBe(3);

		const indexSymbols = entity.getSymbolsByFile("test-repo", "src/index.ts");
		expect(indexSymbols.length).toBe(2);

		// Should be ordered by start_line
		expect(indexSymbols[0].name).toBe("OrderService");
		expect(indexSymbols[0].kind).toBe("class");
		expect(indexSymbols[0].start_line).toBe(10);
		expect(indexSymbols[1].name).toBe("calculateTotal");
		expect(indexSymbols[1].kind).toBe("function");
		expect(indexSymbols[1].start_line).toBe(42);

		// Verify boolean fields
		const exportedSymbol = indexSymbols.find((s) => s.name === "calculateTotal")!;
		expect(exportedSymbol.exported).toBe(true);
		expect(exportedSymbol.default_export).toBe(false);

		const utilsSymbols = entity.getSymbolsByFile("test-repo", "src/utils.ts");
		expect(utilsSymbols.length).toBe(1);
		expect(utilsSymbols[0].exported).toBe(false);

		// Empty file
		const empty = entity.getSymbolsByFile("test-repo", "nonexistent.ts");
		expect(empty).toEqual([]);
	});

	it("getSymbolByName returns all symbols with matching name across files", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/a.ts",
				name: "init",
				kind: "function",
				start_line: 1
			},
			{
				repo: "test-repo",
				file_path: "src/b.ts",
				name: "init",
				kind: "function",
				start_line: 20
			},
			{
				repo: "test-repo",
				file_path: "src/c.ts",
				name: "other",
				kind: "variable",
				start_line: 5
			}
		]);

		const results = entity.getSymbolByName("test-repo", "init");
		expect(results.length).toBe(2);
		expect(results[0].file_path).toBe("src/a.ts");
		expect(results[1].file_path).toBe("src/b.ts");

		const noResults = entity.getSymbolByName("test-repo", "nonexistent");
		expect(noResults).toEqual([]);

		// Wrong repo
		const wrongRepo = entity.getSymbolByName("other-repo", "init");
		expect(wrongRepo).toEqual([]);
	});

	it("searchSymbols uses FTS5 for partial match in doc_comment", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/auth.ts",
				name: "login",
				kind: "function",
				doc_comment: "Authenticate user with JWT token validation"
			},
			{
				repo: "test-repo",
				file_path: "src/auth.ts",
				name: "logout",
				kind: "function",
				doc_comment: "Invalidate user session"
			},
			{
				repo: "test-repo",
				file_path: "src/orders.ts",
				name: "createOrder",
				kind: "function",
				doc_comment: "Create a new order with JWT user context"
			}
		]);

		const result = entity.searchSymbols({
			query: "JWT",
			repo: "test-repo",
			limit: 10
		});

		expect(result.symbols.length).toBe(2);
		expect(result.total).toBe(2);
		expect(result.hasMore).toBe(false);
		expect(result.symbols.map((s) => s.name).sort()).toEqual(["createOrder", "login"]);
	});

	it("searchSymbols matches a docblock summary term inside the structured doc_comment", () => {
		// The visitor recomposes a structured doc_comment (summary + tags +
		// @deprecated). Every word of that string is FTS5-indexed via the
		// doc_comment column, so a bare summary term must surface the symbol.
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/quixotic.ts",
				name: "quixoticLattice",
				kind: "function",
				doc_comment:
					"[DEPRECATED] Navigates the quixotic lattice.\n@param node - the node\n@return Promise<Node>\n@deprecated use nav() instead"
			},
			{
				repo: "test-repo",
				file_path: "src/other.ts",
				name: "unrelated",
				kind: "function",
				doc_comment: "Handles routing for the dashboard"
			}
		]);

		const result = entity.searchSymbols({
			query: "quixotic",
			repo: "test-repo",
			limit: 10
		});

		expect(result.symbols.map((s) => s.name)).toContain("quixoticLattice");
		expect(result.symbols.some((s) => s.name === "unrelated")).toBe(false);
		expect(result.total).toBe(1);
	});

	it("searchSymbols finds symbols via distinctive signature tokens (v18 FTS)", () => {
		// Migration v18 (TASK-227 / #79) added the signature column to the
		// codebase_symbols_fts index; a MATCH covers the whole FTS row, so a
		// bare signature token must surface the symbol.
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/math.ts",
				name: "foo",
				kind: "function",
				signature: "fn foo(x: u32) -> bool"
			},
			{
				repo: "test-repo",
				file_path: "src/io.ts",
				name: "unrelated",
				kind: "function",
				signature: "fn unrelated(s: string) -> void"
			}
		]);

		const result = entity.searchSymbols({
			query: "u32",
			repo: "test-repo",
			limit: 10
		});

		expect(result.symbols.map((s) => s.name)).toContain("foo");
		expect(result.symbols.some((s) => s.name === "unrelated")).toBe(false);
		expect(result.total).toBe(1);
	});

	it("searchSymbols filters by kind", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/models.ts",
				name: "User",
				kind: "class",
				doc_comment: "User entity"
			},
			{
				repo: "test-repo",
				file_path: "src/models.ts",
				name: "Email",
				kind: "type",
				doc_comment: "Email type alias"
			},
			{
				repo: "test-repo",
				file_path: "src/services.ts",
				name: "UserService",
				kind: "class",
				doc_comment: "User service"
			}
		]);

		const result = entity.searchSymbols({
			query: "User",
			repo: "test-repo",
			kind: "class",
			limit: 10
		});

		expect(result.symbols.length).toBe(2);
		expect(result.symbols.every((s) => s.kind === "class")).toBe(true);
	});

	it("deleteSymbolsByFile removes symbols and leaves other files intact", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/remove.ts",
				name: "fn1",
				kind: "function",
				start_line: 1
			},
			{
				repo: "test-repo",
				file_path: "src/remove.ts",
				name: "fn2",
				kind: "function",
				start_line: 10
			},
			{
				repo: "test-repo",
				file_path: "src/keep.ts",
				name: "keep",
				kind: "function",
				start_line: 1
			}
		]);

		const deleted = entity.deleteSymbolsByFile("test-repo", "src/remove.ts");
		expect(deleted).toBe(2);

		const removed = entity.getSymbolsByFile("test-repo", "src/remove.ts");
		expect(removed).toEqual([]);

		const kept = entity.getSymbolsByFile("test-repo", "src/keep.ts");
		expect(kept.length).toBe(1);
		expect(kept[0].name).toBe("keep");

		// Delete nonexistent file
		const noDelete = entity.deleteSymbolsByFile("test-repo", "nonexistent.ts");
		expect(noDelete).toBe(0);
	});

	it("handles parent-child symbol hierarchy (method inside class)", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/UserService.ts",
				name: "UserService",
				kind: "class",
				start_line: 5,
				end_line: 80,
				doc_comment: "User management service"
			}
		]);

		const parentSymbols = entity.getSymbolsByFile("test-repo", "src/UserService.ts");
		expect(parentSymbols.length).toBe(1);
		const parentId = parentSymbols[0].id;

		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/UserService.ts",
				name: "createUser",
				kind: "method",
				start_line: 10,
				end_line: 25,
				doc_comment: "Create a new user",
				parent_symbol_id: parentId
			},
			{
				repo: "test-repo",
				file_path: "src/UserService.ts",
				name: "deleteUser",
				kind: "method",
				start_line: 30,
				end_line: 40,
				doc_comment: "Delete user by ID",
				parent_symbol_id: parentId
			}
		]);

		const allSymbols = entity.getSymbolsByFile("test-repo", "src/UserService.ts");
		expect(allSymbols.length).toBe(3);

		const methods = allSymbols.filter((s) => s.kind === "method");
		expect(methods.length).toBe(2);
		expect(methods.every((m) => m.parent_symbol_id === parentId)).toBe(true);
		expect(methods[0].start_line).toBe(10);
		expect(methods[1].start_line).toBe(30);
	});

	it("honors pre-assigned ids and links parents in a single batch (TASK-300 pipeline shape)", () => {
		// The parse pipeline (resolveFileParents) now assigns ids BEFORE insert
		// so children can reference their parent's id in the same batch — the
		// entity must persist the provided id verbatim (no re-generation).
		const classId = "pipeline-class-0001";
		entity.bulkUpsertSymbols([
			{
				id: classId,
				repo: "test-repo",
				file_path: "src/Order.ts",
				name: "Order",
				kind: "class",
				start_line: 5,
				end_line: 60
			},
			{
				id: "pipeline-method-0002",
				repo: "test-repo",
				file_path: "src/Order.ts",
				name: "total",
				kind: "method",
				start_line: 10,
				end_line: 20,
				parent_symbol_id: classId
			},
			{
				id: "pipeline-method-0003",
				repo: "test-repo",
				file_path: "src/Order.ts",
				name: "ship",
				kind: "method",
				start_line: 30,
				end_line: 40,
				parent_symbol_id: classId
			}
		]);

		const allSymbols = entity.getSymbolsByFile("test-repo", "src/Order.ts");
		expect(allSymbols.length).toBe(3);

		const parent = allSymbols.find((s) => s.kind === "class")!;
		expect(parent.id).toBe(classId);

		const methods = allSymbols.filter((s) => s.kind === "method");
		expect(methods).toHaveLength(2);
		expect(methods.every((m) => m.parent_symbol_id === classId)).toBe(true);

		// Children are findable by parent id (the hierarchy query shape TRACE
		// resolves in memory from the same parent_symbol_id link).
		const children = allSymbols.filter((s) => s.parent_symbol_id === parent.id);
		expect(children.map((c) => c.name).sort()).toEqual(["ship", "total"]);
	});

	it("deleteSymbolsByRepo removes all symbols for the repo", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "del-repo",
				file_path: "src/a.ts",
				name: "funcA",
				kind: "function",
				start_line: 1
			},
			{
				repo: "del-repo",
				file_path: "src/b.ts",
				name: "funcB",
				kind: "function",
				start_line: 1
			},
			{
				repo: "keep-repo",
				file_path: "src/c.ts",
				name: "funcC",
				kind: "function",
				start_line: 1
			}
		]);

		const deleted = entity.deleteSymbolsByRepo("del-repo");
		expect(deleted).toBe(2);

		expect(entity.getSymbolsByFile("del-repo", "src/a.ts")).toEqual([]);
		expect(entity.getSymbolsByFile("del-repo", "src/b.ts")).toEqual([]);
		expect(entity.getSymbolsByFile("keep-repo", "src/c.ts").length).toBe(1);
	});

	it("searchSymbols paginates results", () => {
		const symbols = Array.from({ length: 5 }, (_, i) => ({
			repo: "test-repo",
			file_path: `src/file${i}.ts`,
			name: `func${i}`,
			kind: "function",
			doc_comment: `Documentation for func${i}`
		}));
		entity.bulkUpsertSymbols(symbols);

		const page1 = entity.searchSymbols({
			query: "func",
			repo: "test-repo",
			limit: 3,
			offset: 0
		});
		expect(page1.symbols.length).toBe(3);
		expect(page1.total).toBe(5);
		expect(page1.hasMore).toBe(true);

		const page2 = entity.searchSymbols({
			query: "func",
			repo: "test-repo",
			limit: 3,
			offset: 3
		});
		expect(page2.symbols.length).toBe(2);
		expect(page2.total).toBe(5);
		expect(page2.hasMore).toBe(false);
	});

	it("searchSymbols supports exportedOnly filter", () => {
		entity.bulkUpsertSymbols([
			{
				repo: "test-repo",
				file_path: "src/module.ts",
				name: "exportedFn",
				kind: "function",
				exported: true,
				doc_comment: "Exported function"
			},
			{
				repo: "test-repo",
				file_path: "src/module.ts",
				name: "internalFn",
				kind: "function",
				exported: false,
				doc_comment: "Internal function"
			}
		]);

		const result = entity.searchSymbols({
			query: "function",
			repo: "test-repo",
			exportedOnly: true,
			limit: 10
		});

		expect(result.symbols.length).toBe(1);
		expect(result.symbols[0].name).toBe("exportedFn");
	});

});
