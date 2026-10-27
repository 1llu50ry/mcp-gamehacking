import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("JavaVisitor reference emission (TASK-303)", () => {
	it("emits import edges per binding with static-member / last-segment resolution", async () => {
		const result = await parseOrSkip(
			"java-imports.java",
			`import foo.bar.Baz;
import static java.util.Collections.sort;
import java.util.*;
import com.acme.deep.Nested;
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
		// `import foo.bar.Baz` → 'Baz' (last segment); static import targets the
		// MEMBER name `sort`.
		expect(names).toContain("Baz@1");
		expect(names).toContain("sort@2");
		// Deep qualified import resolves to the LAST name segment.
		expect(names).toContain("Nested@4");
		// `import java.util.*` (wildcard) emits NO binding.
		expect(imports.filter((r) => r.callerLine === 3)).toHaveLength(0);

		// The pool fills callerFile; top-level imports carry no caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("java-imports.java");
		expect(first!.callerName).toBeNull();
	});

	it("emits extends + implements edges for class heritage with caller site", async () => {
		const result = await parseOrSkip(
			"java-heritage.java",
			`public class Foo extends Base implements IFoo, IBar {
    void run() {
        helper();
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

		const ext = refs.find((r) => r.symbolName === "Base" && r.kind === "extends");
		expect(ext).toBeDefined();
		expect(ext!.callerFile).toBe("java-heritage.java");
		expect(ext!.callerLine).toBe(1);
		expect(ext!.callerName).toBeNull();

		const implFoo = refs.find((r) => r.symbolName === "IFoo" && r.kind === "implements");
		expect(implFoo).toBeDefined();
		expect(implFoo!.callerLine).toBe(1);
		expect(implFoo!.callerName).toBeNull();

		const implBar = refs.find((r) => r.symbolName === "IBar" && r.kind === "implements");
		expect(implBar).toBeDefined();
		expect(implBar!.callerLine).toBe(1);

		// Call-site emission inside the method body (callerName = enclosing method).
		const call = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(call!.callerLine).toBe(3);
	});

	it("emits interface extends, enum/record implements and last-segment qualified names", async () => {
		const result = await parseOrSkip(
			"java-heritage-kinds.java",
			`interface IA {}
interface IB {}
interface IC extends IA, IB {}

abstract class Abs extends com.acme.deep.Base implements IFoo {}

enum Color implements E1, E2 { RED, GREEN }

record Pair(int x, int y) implements E1, E2 {}

class Nested extends java.util.ArrayList<String> implements GenericRepo<Item> {}
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

		// interface IC extends IA, IB → all 'extends'.
		expect(names).toContain("IA:extends");
		expect(names).toContain("IB:extends");
		const ifaceExt = refs.find((r) => r.symbolName === "IA" && r.kind === "extends");
		expect(ifaceExt!.callerLine).toBe(3);
		expect(ifaceExt!.callerName).toBeNull();

		// Qualified superclass → LAST name segment.
		expect(names).toContain("Base:extends");
		expect(names).toContain("IFoo:implements");

		// enum Color implements E1, E2 → per-target 'implements'.
		expect(names).toContain("E1:implements");
		expect(names).toContain("E2:implements");
		const enumImpl = refs.find((r) => r.symbolName === "E1" && r.kind === "implements");
		expect(enumImpl!.callerLine).toBe(7);

		// record Pair implements E1, E2 → 'implements' (records can only implement).
		// E2:implements exists on BOTH the enum edge (line 7) and the record edge (line 9);
		// scope the find to the record edge (callerLine 9) so the assertion is deterministic.
		const recordImpl = refs.find((r) => r.symbolName === "E2" && r.kind === "implements" && r.callerLine === 9);
		expect(recordImpl!.callerLine).toBe(9);

		// Generic qualified heritage → base last segment:
		// `extends java.util.ArrayList<Base>` → ArrayList; `implements GenericRepo<Item>` → GenericRepo.
		expect(names).toContain("ArrayList:extends");
		expect(names).toContain("GenericRepo:implements");
	});

	it("emits extends edges for generic type_bound constraints, excluding method-level type params", async () => {
		const result = await parseOrSkip(
			"java-heritage-generics.java",
			`class Cache<T extends Storable> {}

class Multi<T extends A & B> {}

class M {
    <R extends Bound> R method(R r) { return r; }
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

		// `T extends Storable` → kind 'extends' per type_bound target.
		expect(names).toContain("Storable:extends");
		const bound = refs.find((r) => r.symbolName === "Storable" && r.kind === "extends");
		expect(bound!.callerLine).toBe(1);
		expect(bound!.callerName).toBeNull();

		// `T extends A & B` → one 'extends' per bound.
		expect(names).toContain("A:extends");
		expect(names).toContain("B:extends");

		// Method-level `<R extends Bound>` is NOT heritage — excluded (only
		// declaration-level type_parameters feed type_bound edges).
		expect(names).not.toContain("Bound:extends");
		expect(names).not.toContain("Bound:implements");
	});

	it("does not emit heritage/instantiation edges for type annotations or new-expressions", async () => {
		const result = await parseOrSkip(
			"java-heritage-none.java",
			`import java.util.List;

class AlsoNoRef {
    List<String> items;
    void m(NotHeritage x) {
        new ArrayList<String>();
        int y = x.getSize() + 1;
        helper();
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
		// Parameter/field type annotations are NOT heritage — nothing extends
		// or implements in this file.
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");
		expect(heritage).toHaveLength(0);

		// `new ArrayList<String>()` is an object_creation_expression — Java
		// emits no instantiation edge (out of TASK-303 scope).
		expect(refs.filter((r) => r.kind === "instantiation")).toHaveLength(0);

		// Call-site emission inside methods still works (member + plain calls).
		const names = refs.map((r) => `${r.symbolName}:${r.kind}`);
		expect(names).toContain("getSize:call");
		const helper = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(helper).toBeDefined();
		expect(helper!.callerName).toBe("m");
	});
});
