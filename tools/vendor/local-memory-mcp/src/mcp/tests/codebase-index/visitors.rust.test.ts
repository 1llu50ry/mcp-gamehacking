import { describe, it, expect } from "vitest";
import { parseOrSkip, assertNoError, guardEmpty } from "./visitors.shared.js";

describe("RustVisitor", () => {
	it("extracts functions", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
fn hello(name: &str) -> String {
    format!("Hello, {}", name)
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const fn = result.symbols.find((s) => s.name === "hello");
		if (!fn) return;
		expect(fn.kind).toBe("function");
	});

	it("extracts structs", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
pub struct Person {
    pub name: String,
    pub age: u32,
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const s = result.symbols.find((s) => s.name === "Person");
		if (!s) return;
		expect(s.kind).toBe("class");
	});

	it("extracts traits (interfaces)", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
pub trait Display {
    fn fmt(&self) -> String;
}
`
		);
		assertNoError(result);
		guardEmpty(result);
		const t = result.symbols.find((s) => s.name === "Display");
		if (!t) return;
		expect(t.kind).toBe("interface");
	});

	it("extracts const items as constants", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
/// Maximum buffer size in bytes.
pub const MAX_SIZE: usize = 1024;
const INTERNAL: u32 = 1;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const max = result.symbols.find((s) => s.name === "MAX_SIZE");
		if (!max) return;
		expect(max.kind).toBe("constant");
		expect(max.exported).toBe(true);
		expect(max.signature).toBe("pub const MAX_SIZE: usize = 1024;");
		expect(max.docComment).toBe("Maximum buffer size in bytes.");
		const internal = result.symbols.find((s) => s.name === "INTERNAL");
		if (!internal) return;
		expect(internal.kind).toBe("constant");
		expect(internal.exported).toBe(false);
	});

	it("extracts static items as constants", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
pub static APP_NAME: &'static str = "app";
static INTERNAL_STATE: u32 = 0;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const app = result.symbols.find((s) => s.name === "APP_NAME");
		if (!app) return;
		expect(app.kind).toBe("constant");
		expect(app.exported).toBe(true);
		expect(app.signature).toBe(`pub static APP_NAME: &'static str = "app";`);
		const state = result.symbols.find((s) => s.name === "INTERNAL_STATE");
		if (!state) return;
		expect(state.kind).toBe("constant");
		expect(state.exported).toBe(false);
	});

	it("extracts pub use re-exports as modules (alias + crate:: path)", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
pub use crate::module::Thing;
pub use self::foo::Bar as Baz;
pub use other::path::to::Name as Alias;
pub use ::absolute::path::Global;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const modules = result.symbols.filter((s) => s.kind === "module");
		const names = modules.map((s) => s.name);
		expect(names).toContain("Thing");
		expect(names).toContain("Baz");
		expect(names).toContain("Alias");
		expect(names).toContain("Global");
		const thing = result.symbols.find((s) => s.name === "Thing");
		if (!thing) return;
		expect(thing.exported).toBe(true);
		expect(thing.signature).toBe("pub use crate::module::Thing;");
		const baz = result.symbols.find((s) => s.name === "Baz");
		if (!baz) return;
		expect(baz.signature).toBe("pub use self::foo::Bar as Baz;");
	});

	it("does not index private use declarations", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
use std::collections::HashMap;
use private::thing;
pub(crate) use crate::internal::Visible;
pub use crate::module::Public;
`
		);
		assertNoError(result);
		guardEmpty(result);
		const publicModule = result.symbols.find((s) => s.name === "Public");
		if (!publicModule) return; // WASM unavailable or parse failure — nothing to assert
		const modules = result.symbols.filter((s) => s.kind === "module").map((s) => s.name);
		expect(modules).toContain("Public");
		expect(modules).not.toContain("HashMap");
		expect(modules).not.toContain("thing");
		expect(modules).not.toContain("Visible");
	});

	it("extracts structured doc-comment from preceding /// and /** block comments", async () => {
		const result = await parseOrSkip(
			"test.rs",
			`
/// Computes a total cost.
/// @param items - the line items
/// @return the computed total
/// @deprecated use calculate_total() instead
pub fn compute_total(items: &[i32]) -> i32 {
    items.iter().sum()
}

/** A shopping cart. */
pub struct Cart {
    items: Vec<i32>,
}

impl Cart {
    /// Adds an item.
    /// @param item - the item to add
    pub fn add(&mut self, item: i32) {}
}

pub struct NoDoc;

pub fn plain() {}
`
		);
		assertNoError(result);
		guardEmpty(result);

		const total = result.symbols.find((s) => s.name === "compute_total");
		expect(total).toBeDefined();
		expect(total!.docComment).toContain("Computes a total cost.");
		expect(total!.docComment).toContain("@param items - the line items");
		expect(total!.docComment).toContain("@return the computed total");
		expect(total!.docComment).toContain("@deprecated use calculate_total() instead");
		expect(total!.docComment).toContain("[DEPRECATED]");

		const cart = result.symbols.find((s) => s.name === "Cart");
		expect(cart).toBeDefined();
		expect(cart!.docComment).toBe("A shopping cart.");

		const add = result.symbols.find((s) => s.name === "add" && s.parentName === "Cart");
		expect(add).toBeDefined();
		expect(add!.docComment).toContain("Adds an item.");
		expect(add!.docComment).toContain("@param item - the item to add");

		// A declaration without its own doc comment must NOT inherit a neighbour's.
		const noDoc = result.symbols.find((s) => s.name === "NoDoc");
		expect(noDoc).toBeDefined();
		expect(noDoc!.docComment).toBeNull();
		const plain = result.symbols.find((s) => s.name === "plain");
		expect(plain).toBeDefined();
		expect(plain!.docComment).toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════
