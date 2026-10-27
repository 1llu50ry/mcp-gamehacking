import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("KotlinVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.kt",
			`
fun hello(name: String): String {
    return "Hello, $name"
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
			"test.kt",
			`
class Person(val name: String, val age: Int)
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts interfaces", async () => {
		const result = await parseOrSkip(
			"test.kt",
			`
interface Drawable {
    fun draw()
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const iface = result.symbols.find((s) => s.name === "Drawable");
		if (!iface) return;
		expect(iface.kind).toBe("interface");
	});
	it("extracts structured doc-comment from preceding KDoc block comments", async () => {
		const result = await parseOrSkip(
			"test.kt",
			`
/**
 * Computes a total cost.
 * @param items the line items
 * @return the computed total
 * @deprecated use calculateTotal() instead
 */
fun computeTotal(items: List<Int>): Int {
    return items.sum()
}

/** A shopping cart. */
class Cart(val items: MutableList<Int> = mutableListOf()) {
    /**
     * Adds an item.
     * @param item the item to add
     */
    fun add(item: Int) {}
}

class NoDoc {
    fun plain() {}
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
		expect(add!.docComment).toContain("@param item the item to add");

		// A declaration without its own KDoc must NOT inherit a neighbour's.
		const noDoc = result.symbols.find((s) => s.name === "NoDoc");
		expect(noDoc).toBeDefined();
		expect(noDoc!.docComment).toBeNull();
		const plain = result.symbols.find((s) => s.name === "plain" && s.parentName === "NoDoc");
		expect(plain).toBeDefined();
		expect(plain!.docComment).toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════
