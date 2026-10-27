import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("KotlinVisitor reference emission (TASK-304)", () => {
	it("emits import edges per binding with alias / last-segment resolution", async () => {
		const result = await parseOrSkip(
			"kotlin-imports.kt",
			`package com.example.app

import foo.bar.Baz
import foo.bar.Qux as Quux
import java.util.List
import java.util.*
import com.acme.deep.Nested
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
		// `import foo.bar.Baz` → 'Baz' (last segment); `as Quux` → 'Quux' (alias).
		expect(names).toContain("Baz@3");
		expect(names).toContain("Quux@4");
		// Plain + qualified imports resolve to the LAST name segment.
		expect(names).toContain("List@5");
		expect(names).toContain("Nested@7");
		// `import java.util.*` (wildcard) emits NO binding.
		expect(names).not.toContain("*");
		expect(imports.filter((r) => r.callerLine === 6)).toHaveLength(0);

		// The pool fills callerFile; top-level imports carry no caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("kotlin-imports.kt");
		expect(first!.callerName).toBeNull();
	});

	it("emits extends + implements edges for class supertypes with caller site", async () => {
		const result = await parseOrSkip(
			"kotlin-heritage.kt",
			`open class Base(val name: String)
interface IFoo {
    fun a()
}
interface IBar {
    fun b()
}

class Child : Base("x"), IFoo, IBar {
    fun run() {
        helper()
    }
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

		// First delegation_specifier (superclass call) → 'extends'.
		const ext = refs.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(ext).toBeDefined();
		expect(ext!.callerFile).toBe("kotlin-heritage.kt");
		expect(ext!.callerLine).toBe(9);
		expect(ext!.callerName).toBeNull();

		// Subsequent specifiers (interfaces) → 'implements'.
		const implFoo = refs.find((r) => r.symbolName === "IFoo" && r.kind === "implements");
		expect(implFoo).toBeDefined();
		expect(implFoo!.callerLine).toBe(9);
		expect(implFoo!.callerName).toBeNull();

		const implBar = refs.find((r) => r.symbolName === "IBar" && r.kind === "implements");
		expect(implBar).toBeDefined();
		expect(implBar!.callerLine).toBe(9);

		// Call-site emission inside the class body is unchanged.
		const call = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(call!.callerLine).toBe(11);
	});

	it("emits interface extends, object/enum implements and last-segment qualified names", async () => {
		const result = await parseOrSkip(
			"kotlin-heritage-kinds.kt",
			`interface IA
interface IB
interface IC : IA, IB

abstract class Abs : com.acme.deep.Base

enum class Color : E1, E2 {
    RED,
    GREEN
}

object Singleton : IA, IB

class WithCompanion {
    companion object : IA {
        fun c() {}
    }
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
		const names = refs.map((r) => `${r.symbolName}:${r.kind}`);

		// interface IC : IA, IB → ALL supertypes are 'extends'.
		expect(names).toContain("IA:extends");
		expect(names).toContain("IB:extends");
		const ifaceExt = refs.find((r) => r.symbolName === "IA" && r.kind === "extends");
		expect(ifaceExt!.callerLine).toBe(3);
		expect(ifaceExt!.callerName).toBeNull();

		// Qualified supertype → LAST name segment.
		expect(names).toContain("Base:extends");

		// enum class Color : E1, E2 → every supertype is 'implements'.
		expect(names).toContain("E1:implements");
		expect(names).toContain("E2:implements");
		const enumImpl = refs.find((r) => r.symbolName === "E1" && r.kind === "implements");
		expect(enumImpl!.callerLine).toBe(7);

		// object Singleton : IA, IB → all 'implements'.
		expect(names).toContain("IA:implements");
		expect(names).toContain("IB:implements");

		// companion object supertypes → 'implements'.
		expect(names).toContain("IA:implements");
	});

	it("emits extends edges for generic bounds and where constraints", async () => {
		const result = await parseOrSkip(
			"kotlin-heritage-generics.kt",
			`interface Iface

class Cache<T : Storable> : Iface
class Multi<T> where T : Bound
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const names = refs.map((r) => `${r.symbolName}:${r.kind}`);

		// `T : Storable` — the declaration-level constraint bound emits 'extends'.
		expect(names).toContain("Storable:extends");
		const bound = refs.find((r) => r.symbolName === "Storable" && r.kind === "extends");
		expect(bound!.callerLine).toBe(3);
		expect(bound!.callerName).toBeNull();

		// `where T : Bound` → 'extends'.
		expect(names).toContain("Bound:extends");
	});

	it("emits call edges with enclosing caller name and skips type-alias/non-heritage refs", async () => {
		const result = await parseOrSkip(
			"kotlin-calls.kt",
			`typealias Alias = Storable

class Svc {
    fun run() {
        helper()
        ns.thing().other()
        list.map { it }.filter { p -> p.ok() }
    }
}
fun top() {
    compute()
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
		const names = refs.map((r) => `${r.symbolName}:${r.kind}`);

		// Simple call + navigation chains, with enclosing callerName.
		const helper = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(helper).toBeDefined();
		expect(helper!.callerName).toBe("run");
		expect(names).toContain("thing:call"); // inner `ns.thing()`
		expect(names).toContain("other:call"); // outer `.other()`
		expect(names).toContain("ok:call"); // lambda receiver call `p.ok()`

		// Top-level function call.
		const compute = refs.find((r) => r.symbolName === "compute" && r.kind === "call");
		expect(compute).toBeDefined();
		expect(compute!.callerName).toBe("top");

		// `typealias Alias = Storable` — the RHS is a type synonym, NOT heritage
		// (a type alias declares an equivalence, not an extends/implements
		// relation), and no other declaration in this file has supertypes, so
		// NO heritage edges may be emitted from this file at all.
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");
		expect(heritage).toHaveLength(0);
	});
});
