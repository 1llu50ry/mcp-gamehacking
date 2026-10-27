import { describe, it, expect } from "vitest";
import { traceSymbol } from "../../codebase-index/services/trace-service.js";
import { SymbolNotFoundError } from "../../codebase-index/services/trace-service.js";
import { AmbiguousSymbolError } from "../../codebase-index/services/trace-service.js";
import type { CodebaseSymbol } from "../../types/codebase-symbol.js";

function makeSym(overrides: Partial<CodebaseSymbol> & Pick<CodebaseSymbol, "name" | "file_path">): CodebaseSymbol {
	return {
		id: `sym-${overrides.name}-${Math.random().toString(36).slice(2, 6)}`,
		repo: "test-repo",
		kind: "function",
		exported: false,
		default_export: false,
		start_line: 1,
		start_col: 0,
		end_line: 1,
		end_col: 10,
		signature: null,
		doc_comment: null,
		parent_symbol_id: null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides
	};
}

describe("traceSymbol (pure unit)", () => {
	it("SymbolNotFoundError has correct name and message", () => {
		const err = new SymbolNotFoundError("foo", "my/repo");
		expect(err.name).toBe("SymbolNotFoundError");
		expect(err.message).toContain('"foo"');
		expect(err.message).toContain('"my/repo"');
	});

	it("SymbolNotFoundError without repo", () => {
		const err = new SymbolNotFoundError("bar");
		expect(err.message).toContain('"bar"');
		expect(err.message).not.toContain("repo");
	});

	it("AmbiguousSymbolError has disambiguation array", () => {
		const sym1 = makeSym({ name: "dup", file_path: "a.ts" });
		const sym2 = makeSym({ name: "dup", file_path: "b.ts" });
		const err = new AmbiguousSymbolError("dup", [sym1, sym2], "my/repo");
		expect(err.name).toBe("AmbiguousSymbolError");
		expect(err.disambiguation).toHaveLength(2);
		expect(err.message).toContain("2 matches");
	});

	it("references: checks signature for symbol name", () => {
		const target = makeSym({ name: "connect", file_path: "src/db.ts", exported: true });
		const ref = makeSym({
			name: "initDb",
			file_path: "src/app.ts",
			id: "ref-1",
			signature: "function initDb(connection: typeof connect)"
		});

		const result = traceSymbol("connect", "test/repo", [target, ref], true);
		expect(result.references.length).toBeGreaterThanOrEqual(1);
		expect(result.references[0].filePath).toBe("src/app.ts");
	});

	it("references: excludes self from references", () => {
		const target = makeSym({
			name: "selfRef",
			file_path: "src/a.ts",
			doc_comment: "Uses selfRef internally"
		});

		const result = traceSymbol("selfRef", undefined, [target], true);
		expect(result.references).toEqual([]);
	});

	it("extractContext: falls back to first line when search not found", () => {
		const target = makeSym({ name: "targetFn", file_path: "src/a.ts", exported: true });
		const ref = makeSym({
			name: "otherFn",
			file_path: "src/b.ts",
			id: "ref-2",
			doc_comment: "Some unrelated documentation",
			signature: "function otherFn(target: typeof targetFn)"
		});

		const result = traceSymbol("targetFn", "test/repo", [target, ref], true);
		expect(result.references.length).toBeGreaterThanOrEqual(1);
		const refEntry = result.references.find((r) => r.filePath === "src/b.ts");
		expect(refEntry).toBeDefined();
		expect(refEntry!.context).toContain("targetFn");
	});

	it("returns empty references when includeReferences is false", () => {
		const target = makeSym({ name: "noRefs", file_path: "src/x.ts", exported: true });
		const other = makeSym({
			name: "useNoRefs",
			file_path: "src/y.ts",
			doc_comment: "calls noRefs"
		});

		const result = traceSymbol("noRefs", undefined, [target, other], false);
		expect(result.references).toEqual([]);
	});

	it("surfaces parent + children from parent_symbol_id links (TASK-300)", () => {
		const service = makeSym({
			id: "svc-1",
			name: "UserService",
			file_path: "src/UserService.ts",
			kind: "class",
			start_line: 5,
			end_line: 50
		});
		const create = makeSym({
			id: "m-1",
			name: "createUser",
			file_path: "src/UserService.ts",
			kind: "method",
			start_line: 10,
			end_line: 20,
			parent_symbol_id: "svc-1"
		});
		const del = makeSym({
			id: "m-2",
			name: "deleteUser",
			file_path: "src/UserService.ts",
			kind: "method",
			start_line: 30,
			end_line: 40,
			parent_symbol_id: "svc-1"
		});
		const unrelated = makeSym({ id: "fn-1", name: "helper", file_path: "src/util.ts", kind: "function" });

		// Class trace: parent null, children = both methods (start-line ordered).
		const classResult = traceSymbol("UserService", "test/repo", [service, create, del, unrelated], false);
		expect(classResult.parent).toBeNull();
		expect(classResult.children.map((c) => c.name)).toEqual(["createUser", "deleteUser"]);

		// Method trace: parent = the class; children empty.
		const methodResult = traceSymbol("createUser", "test/repo", [service, create, del, unrelated], false);
		expect(methodResult.parent).toEqual({
			id: "svc-1",
			name: "UserService",
			kind: "class",
			filePath: "src/UserService.ts",
			line: 5
		});
		expect(methodResult.children).toEqual([]);

		// Unrelated top-level symbol: no parent, no children.
		const fnResult = traceSymbol("helper", "test/repo", [service, create, del, unrelated], false);
		expect(fnResult.parent).toBeNull();
		expect(fnResult.children).toEqual([]);
	});
});

// ── Tests ───────────────────────────────────────────────────────────────
