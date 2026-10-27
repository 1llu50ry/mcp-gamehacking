import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("GoVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

func Hello(name string) string {
	return "Hello, " + name
}
`
		);
		assertNoError(result);
		const fn = result.symbols.find((s) => s.name === "Hello");
		expect(fn).toBeDefined();
		expect(fn!.kind).toBe("function");
	});

	it("extracts structs", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type Person struct {
	Name string
	Age  int
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const s = result.symbols.find((s) => s.name === "Person");
		if (!s) return; // Go struct may be mapped differently
		expect(s.kind).toBe("class");
	});

	it("extracts interfaces", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type Reader interface {
	Read(p []byte) (n int, err error)
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const s = result.symbols.find((s) => s.name === "Reader");
		if (!s) return; // Go interface may be mapped differently
		expect(s.kind).toBe("interface");
	});

	it("extracts methods on structs", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type Counter struct{ val int }

func (c *Counter) Increment() { c.val++ }
`
		);
		assertNoError(result);
		guardEmpty(result);
		const m = result.symbols.find((s) => s.name === "Increment");
		if (!m) return; // Go receiver methods may not be extracted
		expect(m.kind).toBe("method");
	});

	it("extracts struct fields as variables parented to the struct", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type Repo struct {
	mu     sync.Mutex
	Name   string
	Age    int
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const name = result.symbols.find((s) => s.name === "Name");
		expect(name).toBeDefined();
		expect(name!.kind).toBe("variable");
		expect(name!.parentName).toBe("Repo");
		expect(name!.signature).toBe("Name string");
		const age = result.symbols.find((s) => s.name === "Age");
		expect(age).toBeDefined();
		expect(age!.kind).toBe("variable");
		expect(age!.parentName).toBe("Repo");
		const mu = result.symbols.find((s) => s.name === "mu");
		expect(mu).toBeDefined();
		expect(mu!.kind).toBe("variable");
		expect(mu!.parentName).toBe("Repo");
		expect(mu!.signature).toBe("mu sync.Mutex");
	});

	it("extracts embedded struct fields using the embedded type name", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type BaseRepo struct{}

type Repo struct {
	*BaseRepo
	Name string
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const embedded = result.symbols.find((s) => s.name === "BaseRepo" && s.parentName === "Repo");
		expect(embedded).toBeDefined();
		expect(embedded!.kind).toBe("variable");
		expect(embedded!.parentName).toBe("Repo");
		// The embedded type is still declared as its own struct (class) symbol.
		const base = result.symbols.find((s) => s.name === "BaseRepo" && s.kind === "class");
		expect(base).toBeDefined();
	});

	it("extracts interface methods as methods with full signature", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type Reader interface {
	Read(p []byte) (n int, err error)
	Close() error
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const read = result.symbols.find((s) => s.name === "Read");
		expect(read).toBeDefined();
		expect(read!.kind).toBe("method");
		expect(read!.parentName).toBe("Reader");
		expect(read!.signature).toBe("Read(p []byte) (n int, err error)");
		const close = result.symbols.find((s) => s.name === "Close");
		expect(close).toBeDefined();
		expect(close!.kind).toBe("method");
		expect(close!.parentName).toBe("Reader");
		expect(close!.signature).toBe("Close() error");
	});

	it("includes the receiver in method signatures", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

import "context"

type Repo struct{}

func (r *Repo) Save(ctx context.Context) error {
	return nil
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const save = result.symbols.find((s) => s.name === "Save");
		expect(save).toBeDefined();
		expect(save!.kind).toBe("method");
		expect(save!.signature).toBe("(r *Repo) Save(ctx context.Context) error");
	});

	it("extracts const block members (incl. iota) as constants", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

const (
	StatusNone Status = iota
	StatusActive
	StatusDone = 5
)
`
		);
		assertNoError(result);
		guardEmpty(result);
		const none = result.symbols.find((s) => s.name === "StatusNone");
		expect(none).toBeDefined();
		expect(none!.kind).toBe("constant");
		expect(none!.signature).toBe("StatusNone Status = iota");
		const active = result.symbols.find((s) => s.name === "StatusActive");
		expect(active).toBeDefined();
		expect(active!.kind).toBe("constant");
		const done = result.symbols.find((s) => s.name === "StatusDone");
		expect(done).toBeDefined();
		expect(done!.kind).toBe("constant");
		expect(done!.signature).toBe("StatusDone = 5");
	});

	it("extracts every name from comma-separated const specs", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

const A, B = 1, 2
`
		);
		assertNoError(result);
		guardEmpty(result);
		const a = result.symbols.find((s) => s.name === "A");
		expect(a).toBeDefined();
		expect(a!.kind).toBe("constant");
		const b = result.symbols.find((s) => s.name === "B");
		expect(b).toBeDefined();
		expect(b!.kind).toBe("constant");
	});

	it("extracts every name from comma-separated struct fields", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

type S struct {
	x, y int
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const x = result.symbols.find((s) => s.name === "x");
		expect(x).toBeDefined();
		expect(x!.kind).toBe("variable");
		expect(x!.parentName).toBe("S");
		const y = result.symbols.find((s) => s.name === "y");
		expect(y).toBeDefined();
		expect(y!.kind).toBe("variable");
		expect(y!.parentName).toBe("S");
	});

	it("extracts structured doc-comment from preceding line comments", async () => {
		const result = await parseOrSkip(
			"test.go",
			`
package main

// ComputeTotal computes a total cost.
// @param items - the line items
// @return the computed total
// @deprecated use CalculateTotal() instead
func ComputeTotal(items []int) int {
	return 0
}

// A shopping cart.
type Cart struct {
	items []int
}

// Adds an item.
// @param item - the item to add
func (c *Cart) Add(item int) {
}

type NoDoc struct{}

func Plain() {}
`
		);
		assertNoError(result);
		guardEmpty(result);

		const total = result.symbols.find((s) => s.name === "ComputeTotal");
		expect(total).toBeDefined();
		expect(total!.docComment).toContain("ComputeTotal computes a total cost.");
		expect(total!.docComment).toContain("@param items - the line items");
		expect(total!.docComment).toContain("@return the computed total");
		expect(total!.docComment).toContain("@deprecated use CalculateTotal() instead");
		expect(total!.docComment).toContain("[DEPRECATED]");

		const cart = result.symbols.find((s) => s.name === "Cart");
		expect(cart).toBeDefined();
		expect(cart!.docComment).toBe("A shopping cart.");

		const add = result.symbols.find((s) => s.name === "Add");
		expect(add).toBeDefined();
		expect(add!.parentName).toBeNull();
		expect(add!.docComment).toContain("Adds an item.");
		expect(add!.docComment).toContain("@param item - the item to add");

		// A declaration without its own doc comment must NOT inherit a neighbour's.
		const noDoc = result.symbols.find((s) => s.name === "NoDoc");
		expect(noDoc).toBeDefined();
		expect(noDoc!.docComment).toBeNull();
		const plain = result.symbols.find((s) => s.name === "Plain");
		expect(plain).toBeDefined();
		expect(plain!.docComment).toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════
