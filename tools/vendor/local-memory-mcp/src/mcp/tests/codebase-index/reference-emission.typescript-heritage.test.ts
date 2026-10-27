import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("TypeScriptVisitor heritage reference emission (TASK-301)", () => {
	it("emits extends + implements edges for class heritage with caller site", async () => {
		const result = await parseOrSkip(
			"heritage.ts",
			`export class Foo extends Base implements IFoo, IBar {
  run() {
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
		expect(ext!.callerFile).toBe("heritage.ts");
		expect(ext!.callerLine).toBe(1);
		expect(ext!.callerName).toBeNull();

		const implFoo = refs.find((r) => r.symbolName === "IFoo" && r.kind === "implements");
		expect(implFoo).toBeDefined();
		expect(implFoo!.callerLine).toBe(1);
		expect(implFoo!.callerName).toBeNull();

		const implBar = refs.find((r) => r.symbolName === "IBar" && r.kind === "implements");
		expect(implBar).toBeDefined();
		expect(implBar!.callerLine).toBe(1);

		// Existing call emission inside the class body is unchanged.
		const call = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(call!.callerLine).toBe(3);
	});

	it("emits extends edges for interface heritage and abstract classes", async () => {
		const result = await parseOrSkip(
			"heritage-abstract.ts",
			`interface A extends B, C {
  m(): void;
}

export abstract class Abs extends Base implements I {
  abstract go(): void;
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

		// interface A extends B, C → two extends edges at the interface line.
		expect(names).toContain("B:extends");
		expect(names).toContain("C:extends");
		const ifaceExt = refs.find((r) => r.symbolName === "B" && r.kind === "extends");
		expect(ifaceExt!.callerLine).toBe(1);

		// abstract class Abs extends Base implements I
		expect(names).toContain("Base:extends");
		expect(names).toContain("I:implements");
	});

	it("emits extends edges for generics constraints (generics basics)", async () => {
		const result = await parseOrSkip(
			"heritage-generics.ts",
			`export class Cache<T extends Storable> implements Iface {
  put(x: T) { store(); }
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

		// `T extends Storable` — the constraint's type ref emits 'extends'.
		expect(names).toContain("Storable:extends");
		expect(names).toContain("Iface:implements");

		const constraint = refs.find((r) => r.symbolName === "Storable" && r.kind === "extends");
		expect(constraint!.callerLine).toBe(1);
		expect(constraint!.callerName).toBeNull();

		// Call-site emission inside the class body is unchanged.
		expect(names).toContain("store:call");
	});

	it("resolves heritage targets to their last name segment (name-based, ADR-002)", async () => {
		const result = await parseOrSkip(
			"heritage-names.ts",
			`export class Foo extends ns.Base implements UI.Iface {
  m() {}
}
class Generic extends Base<Thing> implements Repo<Item> { }
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
		expect(names).toContain("Base:extends"); // ns.Base → Base (member expression property)
		expect(names).toContain("Iface:implements"); // UI.Iface → Iface (nested type identifier)
		expect(names).toContain("Base:extends"); // Base<Thing> → Base (generic base name)
		expect(names).toContain("Repo:implements"); // Repo<Item> → Repo
	});

	it("does not emit heritage edges for non-heritage type references", async () => {
		const result = await parseOrSkip(
			"heritage-none.ts",
			`function fn(x: Base, y: Iface): void {
  return;
}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		// Type annotations are NOT heritage — only extends/implements clauses
		// and generics constraints emit heritage edges.
		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");
		expect(heritage).toHaveLength(0);
	});
});

