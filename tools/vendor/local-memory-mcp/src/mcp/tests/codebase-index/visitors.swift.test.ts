import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("SwiftVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.swift",
			`
func hello(name: String) -> String {
    return "Hello, \\(name)"
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.swift",
			`
class Person {
    var name: String
    init(name: String) { self.name = name }
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts protocols (interfaces)", async () => {
		const result = await parseOrSkip(
			"test.swift",
			`
protocol Drawable {
    func draw()
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const p = result.symbols.find((s) => s.name === "Drawable");
		if (!p) return;
		expect(p.kind).toBe("interface");
	});
	it("extracts structured doc-comment from preceding /// and /** block comments", async () => {
		const result = await parseOrSkip(
			"test.swift",
			`
/// Computes a total cost.
/// @param items the line items
/// @return the computed total
/// @deprecated use calculateTotal() instead
func computeTotal(items: [Int]) -> Int {
    return items.reduce(0, +)
}

/** A shopping cart. */
class Cart {
    /** Adds an item. */
    func add(item: Int) {}
}

class NoDoc {
    func plain() {}
}
`
		);
		assertNoError(result);
		guardEmpty(result);

		const total = result.symbols.find((s) => s.name === "computeTotal");
		expect(total).toBeDefined();
		expect(total!.docComment).toContain("Computes a total cost.");
		expect(total!.docComment).toContain("@param items the line items");
		expect(total!.docComment).toContain("@return the computed total");
		expect(total!.docComment).toContain("@deprecated use calculateTotal() instead");
		expect(total!.docComment).toContain("[DEPRECATED]");

		const cart = result.symbols.find((s) => s.name === "Cart");
		expect(cart).toBeDefined();
		expect(cart!.docComment).toBe("A shopping cart.");

		const add = result.symbols.find((s) => s.name === "add" && s.parentName === "Cart");
		expect(add).toBeDefined();
		expect(add!.docComment).toContain("Adds an item.");

		// A declaration without its own doc comment must NOT inherit a neighbour's.
		const noDoc = result.symbols.find((s) => s.name === "NoDoc");
		expect(noDoc).toBeDefined();
		expect(noDoc!.docComment).toBeNull();
		const plain = result.symbols.find((s) => s.name === "plain" && s.parentName === "NoDoc");
		expect(plain).toBeDefined();
		expect(plain!.docComment).toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════
