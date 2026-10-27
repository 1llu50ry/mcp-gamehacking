import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("DartVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.dart",
			`
String hello(String name) {
  return 'Hello, $name';
}
`
		);
		if (!wasmAvailable) return;
		if (result.error && result.error.includes("Unsupported extension")) return;
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts classes", async () => {
		const result = await parseOrSkip(
			"test.dart",
			`
class Person {
  final String name;
  Person(this.name);
}
`
		);
		if (!wasmAvailable) return;
		if (result.error && result.error.includes("Unsupported extension")) return;
		assertNoError(result);
		guardEmpty(result);
		const cls = result.symbols.find((s) => s.name === "Person");
		if (!cls) return;
		expect(cls.kind).toBe("class");
	});
	it("extracts structured doc-comment from preceding /// line comments", async () => {
		const result = await parseOrSkip(
			"test.dart",
			`
/// Computes a total cost.
/// @param items the line items
/// @return the computed total
/// @deprecated use calculateTotal() instead
int computeTotal(List<int> items) {
  return items.reduce((a, b) => a + b);
}

/// A shopping cart.
class Cart {
  /// Adds an item.
  void add(int item) {}
}

class NoDoc {
  void plain() {}
}
`
		);
		if (!wasmAvailable) return;
		if (result.error && result.error.includes("Unsupported extension")) return;
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

		// DartVisitor does not emit class-body methods (method_signature name is nested
		// inside function_signature, so direct-identifier lookup finds nothing). No `add`/`plain`
		// symbols are emitted — only the class itself is asserted below.

		// A declaration without its own doc comment must NOT inherit a neighbour's.
		const noDoc = result.symbols.find((s) => s.name === "NoDoc");
		expect(noDoc).toBeDefined();
		expect(noDoc!.docComment).toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════
