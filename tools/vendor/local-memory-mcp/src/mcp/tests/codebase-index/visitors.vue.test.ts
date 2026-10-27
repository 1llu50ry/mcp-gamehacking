import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("VueVisitor doc-comment extraction", () => {
	it("extracts structured doc-comment from preceding JSDoc block comments in <script>", async () => {
		const result = await parseOrSkip(
			"vue-docblock.vue",
			`<template>
  <div>Hello</div>
</template>

<script lang="ts">
/**
 * Computes a total cost.
 * @param items the line items
 * @return the computed total
 * @deprecated use calculateTotal() instead
 */
function computeTotal(items: number[]): number {
  return items.reduce((a, b) => a + b, 0)
}

/** A shopping cart. */
class Cart {
  /** Adds an item. */
  add(item: number) {}
}

class NoDoc {
  plain() {}
}
</script>
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

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

		// Vue regex scanner does not emit class-body methods — no `add`/`plain`
		// symbols are emitted, so no method-level assertions here.

		// A declaration without its own JSDoc must NOT inherit a neighbour's.
		const noDoc = result.symbols.find((s) => s.name === "NoDoc");
		expect(noDoc).toBeDefined();
		expect(noDoc!.docComment).toBeNull();
	});

	it("extracts single-line /** */ JSDoc preceding a declaration", async () => {
		const result = await parseOrSkip(
			"vue-inline-doc.vue",
			`<script>
/** The max count. */
const MAX = 100

/** Compute value. */
function compute() { return 0; }
</script>
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const max = result.symbols.find((s) => s.name === "MAX");
		expect(max).toBeDefined();
		expect(max!.docComment).toBe("The max count.");

		const compute = result.symbols.find((s) => s.name === "compute");
		expect(compute).toBeDefined();
		expect(compute!.docComment).toBe("Compute value.");
	});
});

// ══════════════════════════════════════════════════════════════════════
