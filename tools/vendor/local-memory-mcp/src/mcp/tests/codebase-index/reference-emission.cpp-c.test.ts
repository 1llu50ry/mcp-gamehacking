import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("CppVisitor & CVisitor reference emission (TASK-308)", () => {
	it("C++: emits 'import' edges per preproc_include with the FULL stripped header path", async () => {
		const result = await parseOrSkip(
			"cpp-includes.cpp",
			`#include "base.h"
#include <vector>
#include "utils/math.h"
#include <sys/stat.h>

void run() {}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const imports = refs.filter((r) => r.kind === "import");
		const names = imports.map((r) => `${r.symbolName}@${r.callerLine}`);

		// The include path string IS the name (mapping header→symbol is out
		// of scope per TASK-308): full path, delimiters stripped — quotes for
		// string_literal, angle brackets for system_lib_string.
		expect(names).toContain("base.h@1");
		expect(names).toContain("vector@2");
		expect(names).toContain("utils/math.h@3");
		expect(names).toContain("sys/stat.h@4");

		// The pool fills callerFile; includes carry no enclosing caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("cpp-includes.cpp");
		expect(first!.callerName).toBeNull();
	});

	it("C++: emits 'extends' for the first base and 'implements' for each subsequent base", async () => {
		const result = await parseOrSkip(
			"cpp-heritage.cpp",
			`class Derived : public Base, protected ILeft, virtual IRight {
public:
  void run() {}
};
struct S : Base2 { int x; };
class Single : virtual Lonely {};
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// FIRST base → 'extends' at the declaration line; subsequent bases →
		// 'implements' (position-based heuristic per TASK-308; `virtual` and
		// access_specifier nodes are not bases and don't shift the position).
		const extBase = heritage.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(extBase).toBeDefined();
		expect(extBase!.callerFile).toBe("cpp-heritage.cpp");
		expect(extBase!.callerLine).toBe(1);
		expect(extBase!.callerName).toBeNull();

		const implILeft = heritage.find((r) => r.symbolName === "ILeft" && r.kind === "implements");
		expect(implILeft).toBeDefined();
		expect(implILeft!.callerLine).toBe(1);

		const implIRight = heritage.find((r) => r.symbolName === "IRight" && r.kind === "implements");
		expect(implIRight).toBeDefined();
		expect(implIRight!.callerLine).toBe(1);

		// Non-virtual single base on a struct → 'extends' (line 5).
		const extBase2 = heritage.find((r) => r.symbolName === "Base2" && r.kind === "extends");
		expect(extBase2).toBeDefined();
		expect(extBase2!.callerLine).toBe(5);

		// Single protected base → 'extends' (line 6).
		const extLonely = heritage.find((r) => r.symbolName === "Lonely" && r.kind === "extends");
		expect(extLonely).toBeDefined();
		expect(extLonely!.callerLine).toBe(6);
	});

	it("C++: resolves template / qualified bases to the LAST name segment; access specifiers leak nothing", async () => {
		const result = await parseOrSkip(
			"cpp-template-bases.cpp",
			`template <typename T>
class Gen : public Generic<T> {};
class Templ : public Base<int>, private Other<T>, virtual IFace {};
struct Alt { int x; };
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// template_type `Generic<T>` → base is the first named child:
		// 'Generic' (template_declaration-wrapped class, line 2).
		const extGeneric = heritage.find((r) => r.symbolName === "Generic" && r.kind === "extends");
		expect(extGeneric).toBeDefined();
		expect(extGeneric!.callerLine).toBe(2);

		// `Base<int>` → 'Base':extends; `Other<T>` (private) →
		// 'Other':implements; `virtual IFace` → 'IFace':implements (all on
		// the Templ declaration line 3).
		const line3 = heritage.filter((r) => r.callerLine === 3);
		expect(line3.map((r) => `${r.symbolName}:${r.kind}`).sort()).toEqual([
			"Base:extends",
			"IFace:implements",
			"Other:implements"
		]);

		// Access specifiers (public/private/protected), template arguments
		// (int, typename T) and the `virtual` keyword never leak as base
		// targets — only the resolved base names are edges.
		expect(
			heritage.some((r) => ["public", "private", "protected", "virtual", "int", "typename", "T"].includes(r.symbolName))
		).toBe(false);
	});

	it("C++: emits call edges with the enclosing method as caller; dynamic calls emit nothing", async () => {
		const result = await parseOrSkip(
			"cpp-calls.cpp",
			`class Foo {
public:
  void update() {
    helper();
    obj.method();
    ns::func();
    a.b.c();
    X::Y::z();
    (*fp)();
  }
};
void top() {
  helper();
}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const calls = refs.filter((r) => r.kind === "call");
		const names = calls.map((r) => `${r.symbolName}@${r.callerLine}`);

		// identifier → 'helper'; field_expression → LAST segment
		// ('obj.method' → 'method'); qualified_identifier → LAST segment
		// ('ns::func' → 'func'); nested `a.b.c()` → 'c'; `X::Y::z()` → 'z'.
		expect(names).toContain("helper@4");
		expect(names).toContain("method@5");
		expect(names).toContain("func@6");
		expect(names).toContain("c@7");
		expect(names).toContain("z@8");
		// `(*fp)()` → parenthesized_expression function → no edge.
		expect(calls.some((r) => r.symbolName === "fp")).toBe(false);

		// Method-body call tracks the METHOD name as caller; function-body
		// call tracks the FUNCTION name.
		const methodCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 4);
		expect(methodCall!.callerName).toBe("update");
		expect(methodCall!.callerFile).toBe("cpp-calls.cpp");

		const fnCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 13);
		expect(fnCall!.callerName).toBe("top");
	});

	it("C: emits include edges and call edges; structs have no heritage", async () => {
		const result = await parseOrSkip(
			"c-sanity.c",
			`#include <stdio.h>
#include "local.h"
#include <sys/types.h>
void run() {
  helper();
  obj.method();
  p->save();
  (*fp)();
}
struct S { int x; };
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const imports = refs.filter((r) => r.kind === "import");
		expect(imports.map((r) => `${r.symbolName}@${r.callerLine}`)).toEqual(["stdio.h@1", "local.h@2", "sys/types.h@3"]);
		const first = imports[0];
		expect(first!.callerFile).toBe("c-sanity.c");
		expect(first!.callerName).toBeNull();

		const calls = refs.filter((r) => r.kind === "call");
		const names = calls.map((r) => `${r.symbolName}@${r.callerLine}`);
		expect(names).toContain("helper@5");
		expect(names).toContain("method@6");
		expect(names).toContain("save@7");
		// `(*fp)()` → no edge.
		expect(calls.some((r) => r.symbolName === "fp")).toBe(false);
		const methodCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 5);
		expect(methodCall!.callerName).toBe("run");

		// C has NO class heritage — `struct S { int x; }` emits no
		// extends/implements edges at all.
		expect(refs.some((r) => r.kind === "extends" || r.kind === "implements")).toBe(false);
	});

	it("C++/C: callerName pierces declarator wrappers (out-of-line, pointer/ref-returning, destructor) — FIX-349", async () => {
		const result = await parseOrSkip(
			"cpp-callername-pierce.cpp",
			`void Widget::outline() { helper2(); }
int *getPtr() { aCall(); }
int& getRef() { bCall(); }
class W {
public:
  ~W() { dCall(); }
};
void f(int x) { q(); }
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const calls = refs.filter((r) => r.kind === "call");
		const byLine = new Map(calls.map((r) => [r.callerLine, r]));

		// Out-of-line definition: name is a qualified_identifier inside the
		// function_declarator → LAST segment 'outline' (was null before).
		expect(byLine.get(1)!.symbolName).toBe("helper2");
		expect(byLine.get(1)!.callerName).toBe("outline");
		// Pointer / reference-returning: function_declarator nested inside
		// pointer_declarator / reference_declarator → 'getPtr' / 'getRef'
		// (both were null before).
		expect(byLine.get(2)!.symbolName).toBe("aCall");
		expect(byLine.get(2)!.callerName).toBe("getPtr");
		expect(byLine.get(3)!.symbolName).toBe("bCall");
		expect(byLine.get(3)!.callerName).toBe("getRef");
		// Destructor: name is a destructor_name inside the
		// function_declarator → inner identifier 'W' (was null before).
		expect(byLine.get(6)!.symbolName).toBe("dCall");
		expect(byLine.get(6)!.callerName).toBe("W");
		// Parameter names (identifiers inside parameter_list) never leak as
		// the caller name — 'f' is the function, not 'x'.
		expect(byLine.get(8)!.symbolName).toBe("q");
		expect(byLine.get(8)!.callerName).toBe("f");
		expect(calls.some((r) => r.callerName === "x")).toBe(false);
	});

	it("C: callerName pierces pointer_declarator for pointer-returning functions — FIX-349", async () => {
		const result = await parseOrSkip(
			"c-callername-pierce.c",
			`int *getPtr() { aCall(); }
void top() { helper(); }
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const calls = refs.filter((r) => r.kind === "call");
		const byLine = new Map(calls.map((r) => [r.callerLine, r]));
		expect(byLine.get(1)!.symbolName).toBe("aCall");
		expect(byLine.get(1)!.callerName).toBe("getPtr");
		expect(byLine.get(2)!.symbolName).toBe("helper");
		expect(byLine.get(2)!.callerName).toBe("top");
	});

	it("C++: attribute_declaration in base_class_clause is skipped — no spurious edge, first base stays extends — FIX-350", async () => {
		const result = await parseOrSkip(
			"cpp-attr-base.cpp",
			`class X : [[deprecated]] Base {};
class Y : public Base, [[nodiscard]] I2 {};
class Z : public B1, I3 {};
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// `[[deprecated]]` is an attribute-specifier on the base-specifier —
		// legal C++, parses cleanly, but is NOT a base: it must not emit an
		// edge and must not shift the first REAL base to 'implements'.
		expect(heritage.some((r) => r.symbolName === "deprecated")).toBe(false);
		expect(heritage.some((r) => r.symbolName === "nodiscard")).toBe(false);
		const line1 = heritage.filter((r) => r.callerLine === 1);
		expect(line1).toHaveLength(1);
		expect(line1[0]).toMatchObject({ symbolName: "Base", kind: "extends", callerLine: 1, callerName: null });
		// Attribute mid-list: Base is still the first (extends) base, I2 the
		// second (implements).
		const line2 = heritage.filter((r) => r.callerLine === 2);
		expect(line2.map((r) => `${r.symbolName}:${r.kind}`).sort()).toEqual(["Base:extends", "I2:implements"]);
		// Regression: plain multi-base still extends-then-implements.
		const line3 = heritage.filter((r) => r.callerLine === 3);
		expect(line3.map((r) => `${r.symbolName}:${r.kind}`).sort()).toEqual(["B1:extends", "I3:implements"]);
	});
});
