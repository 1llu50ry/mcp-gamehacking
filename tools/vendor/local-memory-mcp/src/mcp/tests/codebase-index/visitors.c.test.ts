import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("CVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.c",
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

	it("extracts structs", async () => {
		const result = await parseOrSkip(
			"test.c",
			`
struct Point {
    int x;
    int y;
};
`
		);
		assertNoError(result);
		guardEmpty(result);
		const s = result.symbols.find((s) => s.name === "Point");
		if (!s) return;
		expect(s.kind).toBe("class");
	});
	it("extracts structured doc-comment from preceding block comments", async () => {
		const result = await parseOrSkip(
			"test.c",
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

/** A point in 2D space. */
struct Point {
    /** The x coordinate. */
    int x;
    /** The y coordinate. */
    int y;
};

struct NoDoc {
    int plain;
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

		const point = result.symbols.find((s) => s.name === "Point");
		expect(point).toBeDefined();
		expect(point!.docComment).toBe("A point in 2D space.");

		const x = result.symbols.find((s) => s.name === "x" && s.parentName === "Point");
		expect(x).toBeDefined();
		expect(x!.docComment).toBe("The x coordinate.");

		const y = result.symbols.find((s) => s.name === "y" && s.parentName === "Point");
		expect(y).toBeDefined();
		expect(y!.docComment).toBe("The y coordinate.");

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
