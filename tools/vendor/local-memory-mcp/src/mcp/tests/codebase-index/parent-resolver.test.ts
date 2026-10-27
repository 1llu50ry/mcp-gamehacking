/**
 * parent-resolver tests (TASK-300 — Wave 0 parent_symbol_id population).
 *
 * Pure unit tests for the shared policy util `resolveParentSymbolId` and the
 * pipeline integration `resolveFileParents` (same-file, name-based parent
 * linking with span-containment collision disambiguation).
 */

import { describe, it, expect } from "vitest";
import {
	resolveParentSymbolId,
	resolveFileParents,
	PARENT_ELIGIBLE_KINDS
} from "../../codebase-index/parser/parent-resolver";
import { SymbolKind, type ParsedSymbol } from "../../codebase-index/parser/language-visitor";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeSym(overrides: Partial<ParsedSymbol> & Pick<ParsedSymbol, "name" | "kind">): ParsedSymbol {
	return {
		startLine: 1,
		startCol: 0,
		endLine: 1,
		endCol: 10,
		signature: "",
		docComment: null,
		exported: false,
		defaultExport: false,
		parentName: null,
		...overrides
	};
}

function makeClass(name: string, startLine: number, endLine: number): ParsedSymbol {
	return makeSym({ name, kind: SymbolKind.Class, startLine, endLine });
}

// ════════════════════════════════════════════════════════════════════════
// resolveParentSymbolId — the plug-in policy util
// ════════════════════════════════════════════════════════════════════════

describe("resolveParentSymbolId", () => {
	it("returns null for an empty stack", () => {
		expect(resolveParentSymbolId([])).toBeNull();
	});

	it("returns the eligible container id, innermost-first", () => {
		const stack = [
			{ name: "ClassA", kind: SymbolKind.Class, startLine: 1, endLine: 50, symbolId: "class-id" },
			{ name: "methodX", kind: SymbolKind.Method, startLine: 5, endLine: 20, symbolId: "method-id" }
		];
		// Innermost (last) eligible wins: the method is the nearest container.
		expect(resolveParentSymbolId(stack)).toBe("method-id");
	});

	it("skips non-eligible kinds (variable, module, type)", () => {
		const stack = [
			{ name: "v", kind: SymbolKind.Variable, startLine: 1, endLine: 50, symbolId: "v-id" },
			{ name: "m", kind: SymbolKind.Module, startLine: 1, endLine: 50, symbolId: "m-id" },
			{ name: "t", kind: SymbolKind.Type, startLine: 1, endLine: 50, symbolId: "t-id" }
		];
		expect(resolveParentSymbolId(stack)).toBeNull();
	});

	it("falls through unassigned ids to the next eligible container", () => {
		const stack = [
			{ name: "Outer", kind: SymbolKind.Class, startLine: 1, endLine: 50, symbolId: "outer-id" },
			{ name: "Inner", kind: SymbolKind.Method, startLine: 5, endLine: 20, symbolId: null }
		];
		expect(resolveParentSymbolId(stack)).toBe("outer-id");
	});

	it("honors an overridable eligibility set", () => {
		const stack = [
			{ name: "c", kind: SymbolKind.Class, startLine: 1, endLine: 50, symbolId: "c-id" },
			{ name: "v", kind: SymbolKind.Variable, startLine: 1, endLine: 50, symbolId: "v-id" }
		];
		expect(resolveParentSymbolId(stack, new Set([SymbolKind.Variable]))).toBe("v-id");
		expect(resolveParentSymbolId(stack)).toBe("c-id");
	});

	it("default policy includes class/interface/enum/function/method", () => {
		for (const kind of [
			SymbolKind.Class,
			SymbolKind.Interface,
			SymbolKind.Enum,
			SymbolKind.Function,
			SymbolKind.Method
		]) {
			expect(PARENT_ELIGIBLE_KINDS.has(kind)).toBe(true);
		}
		expect(PARENT_ELIGIBLE_KINDS.has(SymbolKind.Variable)).toBe(false);
		expect(PARENT_ELIGIBLE_KINDS.has(SymbolKind.Property)).toBe(false);
	});
});

// ════════════════════════════════════════════════════════════════════════
// resolveFileParents — pipeline integration
// ════════════════════════════════════════════════════════════════════════

describe("resolveFileParents", () => {
	it("parents methods to their enclosing class by name", () => {
		const service = makeClass("UserService", 5, 45);
		const create = makeSym({
			name: "createUser",
			kind: SymbolKind.Method,
			startLine: 10,
			endLine: 20,
			parentName: "UserService"
		});
		const del = makeSym({
			name: "deleteUser",
			kind: SymbolKind.Method,
			startLine: 25,
			endLine: 40,
			parentName: "UserService"
		});
		const helper = makeSym({ name: "helper", kind: SymbolKind.Function, startLine: 50, endLine: 60 });

		const resolved = resolveFileParents([service, create, del, helper]);

		const serviceResolved = resolved.find((s) => s.name === "UserService")!;
		expect(resolved.find((s) => s.name === "createUser")!.resolvedParentSymbolId).toBe(serviceResolved.id);
		expect(resolved.find((s) => s.name === "deleteUser")!.resolvedParentSymbolId).toBe(serviceResolved.id);
		// Top-level functions stay unparented.
		expect(resolved.find((s) => s.name === "helper")!.resolvedParentSymbolId).toBeNull();
	});

	it("assigns a unique id to every symbol", () => {
		const resolved = resolveFileParents([
			makeClass("A", 1, 10),
			makeSym({ name: "b", kind: SymbolKind.Method, parentName: "A", startLine: 2, endLine: 5 })
		]);
		expect(resolved).toHaveLength(2);
		const ids = new Set(resolved.map((s) => s.id));
		expect(ids.size).toBe(2);
		expect(resolved.every((s) => typeof s.id === "string" && s.id.length > 0)).toBe(true);
	});

	it("parents interface and enum members to their containers", () => {
		const iface = makeSym({ name: "Repository", kind: SymbolKind.Interface, startLine: 3, endLine: 20 });
		const find = makeSym({
			name: "find",
			kind: SymbolKind.Method,
			startLine: 5,
			endLine: 8,
			parentName: "Repository"
		});
		const en = makeSym({ name: "Role", kind: SymbolKind.Enum, startLine: 25, endLine: 30 });
		const admin = makeSym({
			name: "ADMIN",
			kind: SymbolKind.Constant,
			startLine: 27,
			endLine: 27,
			parentName: "Role"
		});

		const resolved = resolveSymbols([iface, find, en, admin]);

		const ifaceResolved = resolved.find((s) => s.name === "Repository")!;
		const enResolved = resolved.find((s) => s.name === "Role")!;
		expect(resolved.find((s) => s.name === "find")!.resolvedParentSymbolId).toBe(ifaceResolved.id);
		expect(resolved.find((s) => s.name === "ADMIN")!.resolvedParentSymbolId).toBe(enResolved.id);
	});

	it("disambiguates same-name containers by span containment (innermost wins)", () => {
		// `class Cache` (5-40) and `interface Cache` (50-70) coexist in one file;
		// members inside the class body must link to the class, members inside
		// the interface body must link to the interface.
		const classSym = makeClass("Cache", 5, 40);
		const ifaceSym = makeSym({ name: "Cache", kind: SymbolKind.Interface, startLine: 50, endLine: 70 });
		const get = makeSym({
			name: "get",
			kind: SymbolKind.Method,
			startLine: 10,
			endLine: 15,
			parentName: "Cache"
		});
		const getSig = makeSym({
			name: "get",
			kind: SymbolKind.Method,
			startLine: 55,
			endLine: 58,
			parentName: "Cache"
		});

		const resolved = resolveSymbols([classSym, ifaceSym, get, getSig]);

		expect(resolved.find((s) => s.name === "get" && s.startLine === 10)!.resolvedParentSymbolId).toBe(
			resolved.find((s) => s.name === "Cache" && s.kind === SymbolKind.Class)!.id
		);
		expect(resolved.find((s) => s.name === "get" && s.startLine === 55)!.resolvedParentSymbolId).toBe(
			resolved.find((s) => s.name === "Cache" && s.kind === SymbolKind.Interface)!.id
		);
	});

	it("resolves to the INNER container when two same-name containers both enclose a child", () => {
		// `function foo` (1-10) nests `function foo` (2-5); `child` (3-4) sits
		// inside BOTH. The util contract is innermost-LAST / innermost wins, so
		// the child must link to the INNER foo — never the outer one (regression:
		// the pipeline previously fed the util an innermost-FIRST stack, making
		// the OUTER container win; Wave 1 languages emitting nested same-name
		// containers — Python def, PHP nested functions, C++ nested classes —
		// would persist wrong parent links).
		const outer = makeSym({ name: "foo", kind: SymbolKind.Function, startLine: 1, endLine: 10 });
		const inner = makeSym({ name: "foo", kind: SymbolKind.Function, startLine: 2, endLine: 5 });
		const child = makeSym({
			name: "child",
			kind: SymbolKind.Function,
			startLine: 3,
			endLine: 4,
			parentName: "foo"
		});

		const resolved = resolveSymbols([outer, inner, child]);

		const innerId = resolved.find((s) => s.name === "foo" && s.startLine === 2)!.id;
		expect(resolved.find((s) => s.name === "child")!.resolvedParentSymbolId).toBe(innerId);
	});

	it("never self-parents a constructor-style member (`class Foo { Foo() {} }`)", () => {
		// The method `Foo` is same-name AND parent-eligible; without
		// self-exclusion it would win the innermost-LAST scan and link to its
		// OWN id (the naive sort flip alone creates this regression). It must
		// resolve to the enclosing CLASS, never to itself.
		const cls = makeClass("Foo", 1, 10);
		const ctor = makeSym({
			name: "Foo",
			kind: SymbolKind.Method,
			startLine: 3,
			endLine: 5,
			parentName: "Foo"
		});

		const resolved = resolveSymbols([cls, ctor]);

		const ctorResolved = resolved.find((s) => s.name === "Foo" && s.kind === SymbolKind.Method)!;
		const clsResolved = resolved.find((s) => s.name === "Foo" && s.kind === SymbolKind.Class)!;
		expect(ctorResolved.resolvedParentSymbolId).toBe(clsResolved.id);
		expect(ctorResolved.resolvedParentSymbolId).not.toBe(ctorResolved.id);
	});

	it("excludes self from the candidate stack even when the class also matches", () => {
		// Sibling members named like their container (e.g. an overload-style
		// method `Foo`) must not shadow the container for OTHER members, and
		// the container must still resolve to null (top-level), not to itself.
		const cls = makeClass("Foo", 1, 10);
		const methodFoo = makeSym({
			name: "Foo",
			kind: SymbolKind.Method,
			startLine: 3,
			endLine: 5,
			parentName: "Foo"
		});
		const other = makeSym({
			name: "bar",
			kind: SymbolKind.Method,
			startLine: 7,
			endLine: 9,
			parentName: "Foo"
		});

		const resolved = resolveSymbols([cls, methodFoo, other]);

		const clsResolved = resolved.find((s) => s.name === "Foo" && s.kind === SymbolKind.Class)!;
		// The class is top-level: it has no parentName, so it stays unparented.
		expect(clsResolved.resolvedParentSymbolId).toBeNull();
		// `bar` resolves to the CLASS (the class is the only enclosing container
		// of line 7 — the method `Foo`'s span 3-5 does not reach it).
		expect(resolved.find((s) => s.name === "bar")!.resolvedParentSymbolId).toBe(clsResolved.id);
	});

	it("falls back to a same-name container when none encloses (name-based, ADR-002)", () => {
		const s = makeClass("Foo", 1, 10);
		const method = makeSym({
			name: "bar",
			kind: SymbolKind.Method,
			startLine: 100,
			endLine: 105,
			parentName: "Foo"
		});
		const resolved = resolveSymbols([s, method]);
		expect(resolved.find((x) => x.name === "bar")!.resolvedParentSymbolId).toBe(
			resolved.find((x) => x.name === "Foo")!.id
		);
	});

	it("never links to a non-eligible parent (variable/type are not containers)", () => {
		const v = makeSym({ name: "state", kind: SymbolKind.Variable, startLine: 1, endLine: 10 });
		const child = makeSym({
			name: "child",
			kind: SymbolKind.Method,
			startLine: 5,
			endLine: 8,
			parentName: "state"
		});
		const resolved = resolveSymbols([v, child]);
		expect(resolved.find((x) => x.name === "child")!.resolvedParentSymbolId).toBeNull();
	});

	it("leaves symbols whose parent container is absent unresolved", () => {
		const orphan = makeSym({
			name: "orphanMethod",
			kind: SymbolKind.Method,
			startLine: 5,
			endLine: 8,
			parentName: "MissingClass"
		});
		const resolved = resolveSymbols([orphan]);
		expect(resolved[0].resolvedParentSymbolId).toBeNull();
	});
});

// ── Local helper ────────────────────────────────────────────────────────

function resolveSymbols(symbols: ParsedSymbol[]) {
	return resolveFileParents(symbols);
}
