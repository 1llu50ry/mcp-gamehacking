import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("CppVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.cpp",
			`
int add(int a, int b) {
    return a + b;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "add");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.cpp",
			`
class Person {
public:
    std::string name;
};
`
		);
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});

	it("extracts structured doc-comment from preceding block comments", async () => {
		const result = await parseOrSkip(
			"test.cpp",
			`
/**
 * Computes a total cost.
 * @param items the line items
 * @return the computed total
 * @deprecated use calculateTotal() instead
 */
int computeTotal(int items[], int n) {
    return 0;
}

/** A shopping cart. */
class Cart {
    /** The item count. */
    int count = 0;

    /**
     * Adds an item.
     * @param item the item to add
     */
    void add(int item) {}
};

class NoDoc {
    void plain() {}
};
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

		const count = result.symbols.find((s) => s.name === "count" && s.parentName === "Cart");
		expect(count).toBeDefined();
		expect(count!.docComment).toBe("The item count.");

		const add = result.symbols.find((s) => s.name === "add" && s.parentName === "Cart");
		expect(add).toBeDefined();
		expect(add!.docComment).toContain("Adds an item.");
		expect(add!.docComment).toContain("@param item the item to add");

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
