import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("PythonVisitor reference emission (TASK-305)", () => {
	it("emits import edges per binding with alias / last-segment resolution", async () => {
		const result = await parseOrSkip(
			"python-imports.py",
			`import os
import a.b.c
import numpy as np
from collections import OrderedDict
from typing import Optional, List as L
from os import path as osp
from . import sibling
from ..pkg import mod
import xml.etree.ElementTree as ET, json
from foo import *
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
		// Plain import → the module name as written (fixture line 1).
		expect(names).toContain("os@1");
		// Dotted import resolves to the LAST name segment (ADR-002 name-based).
		expect(names).toContain("c@2");
		// Alias wins (`import numpy as np` → 'np').
		expect(names).toContain("np@3");
		// from-import: the imported binding, NOT the module path.
		expect(names).toContain("OrderedDict@4");
		expect(names).not.toContain("collections");
		// Multiple bindings → one edge each; alias wins per binding.
		expect(names).toContain("Optional@5");
		expect(names).toContain("L@5");
		expect(names).toContain("osp@6");
		// Relative imports: `from . import sibling` / `from ..pkg import mod`.
		expect(names).toContain("sibling@7");
		expect(names).toContain("mod@8");
		// Multi-import statement → one edge per imported name.
		expect(names).toContain("ET@9");
		expect(names).toContain("json@9");
		// Wildcard `from foo import *` emits NO binding.
		expect(imports.filter((r) => r.callerLine === 10)).toHaveLength(0);

		// The pool fills callerFile; top-level imports carry no caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("python-imports.py");
		expect(first!.callerName).toBeNull();
	});

	it("emits extends edges per base class with caller site", async () => {
		const result = await parseOrSkip(
			"python-heritage.py",
			`class Base:
    pass

class Foo(Base, Mixin):
    pass

class Generic(Base[Thing]):
    pass

class Qualified(alpha.beta.Gamma):
    pass

class NoBases:
    pass

class MetaIn(Base, metaclass=MyMeta):
    pass
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends");

		// `class Foo(Base, Mixin)` → one 'extends' edge per base at the
		// declaration line, callerName null per the heritage contract.
		const extBase = heritage.find((r) => r.symbolName === "Base");
		expect(extBase).toBeDefined();
		expect(extBase!.callerFile).toBe("python-heritage.py");
		expect(extBase!.callerLine).toBe(4);
		expect(extBase!.callerName).toBeNull();
		const extMixin = heritage.find((r) => r.symbolName === "Mixin");
		expect(extMixin).toBeDefined();
		expect(extMixin!.callerLine).toBe(4);
		expect(extMixin!.callerName).toBeNull();

		// Generic base `Base[Thing]` → 'Base' (subscript value field).
		const extGeneric = heritage.find((r) => r.symbolName === "Base" && r.callerLine === 7);
		expect(extGeneric).toBeDefined();

		// Qualified base `alpha.beta.Gamma` → LAST segment 'Gamma'.
		const extQualified = heritage.find((r) => r.symbolName === "Gamma");
		expect(extQualified).toBeDefined();
		expect(extQualified!.callerLine).toBe(10);

		// No bases (`class NoBases:`) → no edge.
		expect(heritage.filter((r) => r.callerLine === 13)).toHaveLength(0);

		// Keyword arguments in the superclasses list (metaclass=MyMeta) are
		// NOT base classes → only 'Base' emitted on the MetaIn line.
		const metaLine = refs.filter((r) => r.callerLine === 16);
		expect(metaLine.map((r) => `${r.symbolName}:${r.kind}`)).toEqual(["Base:extends"]);
	});

	it("emits call edges with the enclosing function/method as caller", async () => {
		const result = await parseOrSkip(
			"python-calls.py",
			`class Service:
    def run(self):
        helper()
        return self.save()

    def notify(self):
        return outer_helper()

def top():
    return util.shuffle(items)
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

		// Plain call → 'helper'; member call → LAST segment 'save'.
		expect(names).toContain("helper@3");
		expect(names).toContain("save@4");
		// Nested method bodies track their own caller names.
		expect(names).toContain("outer_helper@7");
		// Function-level call with caller.
		expect(names).toContain("shuffle@10");

		const helperCall = calls.find((r) => r.symbolName === "helper");
		expect(helperCall!.callerName).toBe("run");
		expect(helperCall!.callerFile).toBe("python-calls.py");

		const shuffleCall = calls.find((r) => r.symbolName === "shuffle");
		expect(shuffleCall!.callerName).toBe("top");

		// No spurious self/class-name call targets.
		expect(calls.some((r) => r.symbolName === "self")).toBe(false);
	});
});
