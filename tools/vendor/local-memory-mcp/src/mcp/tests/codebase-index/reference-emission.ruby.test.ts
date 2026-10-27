import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("RubyVisitor reference emission (TASK-310)", () => {
	it("emits 'import' edges for require/require_relative/load with the full literal path as the name; interpolated/non-literal args emit nothing", async () => {
		const result = await parseOrSkip(
			"ruby-imports.rb",
			`require "json"
require_relative "./models/user"
load "tasks/seed.rb"

class Boot
  require "nested/req"
  require "#{dir}/dynamic"
  require File.join("a", "b")
end
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

		// The FULL literal path is the imported name (mirrors the C/C++
		// include-path decision — TASK-308; a require path is a single
		// identifier, no last-segment splitting).
		expect(names).toContain("json@1");
		expect(names).toContain("./models/user@2");
		expect(names).toContain("tasks/seed.rb@3");
		// require works inside class bodies too.
		expect(names).toContain("nested/req@6");
		// Interpolated ("#{dir}/x") and non-literal (File.join(...)) require
		// args have no statically resolvable path → no import edge.
		expect(imports.filter((r) => r.callerLine === 7 || r.callerLine === 8)).toHaveLength(0);

		// The pool fills callerFile; requires are file-scope statements.
		const first = imports[0];
		expect(first!.callerFile).toBe("ruby-imports.rb");
		expect(first!.callerName).toBeNull();
		expect(first!.callerLine).toBe(1);
		expect(first!.targetFile).toBeNull();
		expect(first!.targetSymbolId).toBeNull();
	});

	it("emits 'extends' for the class superclass (incl. qualified LAST segment) and for include/extend/prepend mixins", async () => {
		const result = await parseOrSkip(
			"ruby-heritage.rb",
			`class Vehicle
end

class Car < Vehicle
  include Drivable, Enumerable
  extend Other::Mod, Addon
  prepend Observable
end

module Outer
  class Inner < Outer::Base
  end
end
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

		// Class superclass → 'extends' at the declaration line; callerName null.
		const extVehicle = heritage.find((r) => r.symbolName === "Vehicle" && r.kind === "extends");
		expect(extVehicle).toBeDefined();
		expect(extVehicle!.callerFile).toBe("ruby-heritage.rb");
		expect(extVehicle!.callerLine).toBe(4);
		expect(extVehicle!.callerName).toBeNull();
		expect(extVehicle!.targetFile).toBeNull();
		expect(extVehicle!.targetSymbolId).toBeNull();

		// Qualified superclass `Outer::Base` → LAST segment 'Base'.
		const extBase = heritage.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(extBase).toBeDefined();
		expect(extBase!.callerLine).toBe(11);

		// include/extend/prepend mixins → 'extends' per argument at the call
		// line; multi-arg include emits one edge per module; qualified module
		// names resolve to the LAST segment ('Other::Mod' → 'Mod').
		expect(heritage.map((r) => `${r.symbolName}@${r.callerLine}`)).toContain("Drivable@5");
		expect(heritage.map((r) => `${r.symbolName}@${r.callerLine}`)).toContain("Enumerable@5");
		expect(heritage.map((r) => `${r.symbolName}@${r.callerLine}`)).toContain("Mod@6");
		expect(heritage.map((r) => `${r.symbolName}@${r.callerLine}`)).toContain("Addon@6");
		const mixin = heritage.find((r) => r.symbolName === "Drivable");
		expect(mixin!.callerName).toBeNull();
	});

	it("emits 'call' edges with the enclosing method as caller; chained receivers emit only the LAST segment", async () => {
		const result = await parseOrSkip(
			"ruby-calls.rb",
			`def drive
  helper()
  obj.save
  a.b.c
  self.update
  attr_accessor :name
end
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

		// Plain identifier → 'helper'; member-style receiver → the method
		// field identifier ('save', 'update'); `attr_accessor` is a plain call.
		expect(names).toContain("helper@2");
		expect(names).toContain("save@3");
		expect(names).toContain("update@5");
		expect(names).toContain("attr_accessor@6");
		// `a.b.c` — the receiver subtree is a path component, so ONLY the LAST
		// segment 'c' is emitted (no 'b' edge).
		expect(names).toContain("c@4");
		expect(calls.some((r) => r.symbolName === "b")).toBe(false);

		// Every call tracks the enclosing METHOD name as caller.
		for (const c of calls) {
			expect(c.callerName).toBe("drive");
			expect(c.callerFile).toBe("ruby-calls.rb");
			expect(c.targetFile).toBeNull();
			expect(c.targetSymbolId).toBeNull();
		}
	});
});
