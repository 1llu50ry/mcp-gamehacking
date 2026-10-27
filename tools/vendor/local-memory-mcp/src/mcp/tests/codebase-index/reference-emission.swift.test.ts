import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("SwiftVisitor reference emission (TASK-309)", () => {
	it("emits 'import' edges per import_declaration with LAST-segment binding; the import-kind keyword is anonymous", async () => {
		const result = await parseOrSkip(
			"swift-imports.swift",
			`import UIKit
import class Foundation.URLSession
import func Darwin.pow

func run() {}
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

		// One edge per statement; plain `import UIKit` → 'UIKit'; the
		// import-KIND keyword ('class' | 'func' | ...) is ANONYMOUS at the
		// AST level (verified against the shipped WASM), so the binding is
		// the LAST name segment: 'Foundation.URLSession' → 'URLSession'.
		expect(names).toEqual(["UIKit@1", "URLSession@2", "pow@3"]);

		// The pool fills callerFile; imports carry no enclosing caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("swift-imports.swift");
		expect(first!.callerName).toBeNull();
	});

	it("emits 'extends' for the first class base and 'implements' for each subsequent (incl. & composition); protocols extend every target", async () => {
		const result = await parseOrSkip(
			"swift-heritage.swift",
			`class Foo: Base, Proto1, Proto2 {
    func helper() { _ = self.save() }
}

class Composed: Base & Proto {
}

protocol P: Q, R {
  func requirement()
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
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// FIRST base → 'extends' at the declaration line, subsequent →
		// 'implements' (position-based heuristic; Swift can't name-distinguish
		// a lone first protocol from a superclass — documented limitation).
		const extBase = heritage.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(extBase).toBeDefined();
		expect(extBase!.callerFile).toBe("swift-heritage.swift");
		expect(extBase!.callerLine).toBe(1);
		expect(extBase!.callerName).toBeNull();

		const implProto1 = heritage.find((r) => r.symbolName === "Proto1" && r.kind === "implements");
		expect(implProto1).toBeDefined();
		expect(implProto1!.callerLine).toBe(1);
		expect(implProto1!.callerName).toBeNull();

		const implProto2 = heritage.find((r) => r.symbolName === "Proto2" && r.kind === "implements");
		expect(implProto2).toBeDefined();
		expect(implProto2!.callerLine).toBe(1);

		// `Base & Proto` composition → one inheritance_specifier PER element
		// (verified in the WASM): first 'extends', second 'implements'.
		const compBase = heritage.find((r) => r.symbolName === "Base" && r.callerLine === 5);
		expect(compBase!.kind).toBe("extends");
		const compProto = heritage.find((r) => r.symbolName === "Proto" && r.kind === "implements");
		expect(compProto).toBeDefined();
		expect(compProto!.callerLine).toBe(5);

		// protocol P: Q, R → EVERY inheritance target is 'extends'.
		const extQ = heritage.find((r) => r.symbolName === "Q" && r.kind === "extends");
		expect(extQ).toBeDefined();
		expect(extQ!.callerLine).toBe(8);
		const extR = heritage.find((r) => r.symbolName === "R" && r.kind === "extends");
		expect(extR).toBeDefined();
		expect(extR!.callerLine).toBe(8);

		// Regression: call emission inside a method body unchanged — the
		// method name is threaded as callerName.
		const saveCall = refs.find((r) => r.symbolName === "save" && r.kind === "call");
		expect(saveCall).toBeDefined();
		expect(saveCall!.callerLine).toBe(2);
		expect(saveCall!.callerName).toBe("helper");
	});

	it("emits 'implements' for struct/extension conformances and LAST-segment resolution; enum heritage is skipped", async () => {
		const result = await parseOrSkip(
			"swift-conformances.swift",
			`struct S: ProtoA, ProtoB {
  var x: Int = 0
}

extension Foo: ExtraProto {
  func helper() { _ = multiply(2, 3) }
}

enum E: Int, CaseIterable {
  case a
}

class Generic<T>: Base<T>, ns.GenericProto {
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
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// struct S: ProtoA, ProtoB — structs have no superclass → every
		// conformance is 'implements'.
		const implProtoA = heritage.find((r) => r.symbolName === "ProtoA" && r.kind === "implements");
		expect(implProtoA).toBeDefined();
		expect(implProtoA!.callerLine).toBe(1);
		expect(implProtoA!.callerName).toBeNull();
		expect(heritage.find((r) => r.symbolName === "ProtoB" && r.kind === "implements")).toBeDefined();

		// extension Foo: ExtraProto — same: 'implements' at the declaration line.
		const implExtra = heritage.find((r) => r.symbolName === "ExtraProto" && r.kind === "implements");
		expect(implExtra).toBeDefined();
		expect(implExtra!.callerLine).toBe(5);

		// enum E: Int, CaseIterable — SKIPPED entirely: 'Int' is a raw-value
		// type sharing the exact AST shape of a conformance; name-based
		// resolution cannot distinguish them (documented limitation).
		expect(heritage.some((r) => r.symbolName === "Int" || r.symbolName === "CaseIterable")).toBe(false);

		// generic Base<T> → 'Base':extends (type_arguments excluded); dotted
		// ns.GenericProto → LAST segment 'GenericProto':implements.
		const extGeneric = heritage.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(extGeneric).toBeDefined();
		expect(extGeneric!.callerLine).toBe(13);
		expect(heritage.find((r) => r.symbolName === "GenericProto" && r.kind === "implements")).toBeDefined();

		// Method call regression inside the extension body.
		const multCall = refs.find((r) => r.symbolName === "multiply" && r.kind === "call");
		expect(multCall).toBeDefined();
		expect(multCall!.callerName).toBe("helper");
		expect(multCall!.callerLine).toBe(6);
	});

	it("emits 'call' edges (identifier / navigation LAST segment) with the enclosing function as caller; dynamic targets emit nothing", async () => {
		const result = await parseOrSkip(
			"swift-calls.swift",
			`func topCall() {
  helper()
  obj.save()
  self.update()
  a.b.c()
  (getFactory)()
  NSObject.init()
  let c = C()
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

		// identifier → 'helper'; navigation_expression → LAST simple identifier
		// segment: 'obj.save' → 'save', 'self.update' → 'update', 'a.b.c' → 'c'.
		expect(names).toContain("helper@2");
		expect(names).toContain("save@3");
		expect(names).toContain("update@4");
		expect(names).toContain("c@5");
		// `NSObject.init()` → LAST segment 'init' (name-based, documented);
		// `C()` initializer call → 'C'.
		expect(names).toContain("init@7");
		expect(names).toContain("C@8");
		// `(getFactory)()` → tuple_expression-call target (dynamic) → no edge
		// (and no 'getFactory' from a paren-wrapped identifier).
		expect(calls.some((r) => r.symbolName === "getFactory")).toBe(false);

		// Every call tracks the enclosing FUNCTION name as caller.
		for (const c of calls) {
			expect(c.callerName).toBe("topCall");
			expect(c.callerFile).toBe("swift-calls.swift");
		}
	});
});
