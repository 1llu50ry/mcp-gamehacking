import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("RustVisitor reference emission (TASK-307)", () => {
	it("emits 'import' edges per use binding — alias wins, last segment, glob/self emit nothing", async () => {
		const result = await parseOrSkip(
			"rust-imports.rs",
			`use crate::a::b::Thing;
use foo::{x, y as z, deep::Nested};
use nested::{inner::{a, b as c}};
use bar::*;
use std::collections::HashMap as Map;
use std::fmt;
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

		// Simple path `use crate::a::b::Thing` → LAST segment 'Thing';
		// `use std::fmt` → 'fmt'.
		expect(names).toContain("Thing@1");
		expect(names).toContain("fmt@6");
		// Grouped `use foo::{...}` → per-member edges; alias wins (`y as z` → 'z');
		// `deep::Nested` → 'Nested'.
		expect(names).toContain("x@2");
		expect(names).toContain("z@2");
		expect(names).toContain("Nested@2");
		// Nested group `use nested::{inner::{...}}` recurses.
		expect(names).toContain("a@3");
		expect(names).toContain("c@3");
		// `as Map` alias wins over the path's last segment ('HashMap').
		expect(names).toContain("Map@5");
		expect(names).not.toContain("HashMap@5");
		// Glob `use bar::*` binds no name — nothing on its line, no '*' edge.
		expect(imports.filter((r) => r.callerLine === 4)).toHaveLength(0);
		expect(names.some((n) => n.includes("*"))).toBe(false);

		// The pool fills callerFile; top-level imports carry no caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("rust-imports.rs");
		expect(first!.callerName).toBeNull();
		expect(first!.callerLine).toBe(1);
	});

	it("emits 'implements' edges for impl Trait for Type (qualified/generic); inherent impls emit nothing", async () => {
		const result = await parseOrSkip(
			"rust-impl.rs",
			`use std::fmt;

impl std::fmt::Display for crate::models::User {}
impl serde::Serialize for MyType {}
impl Iterator<Item = u8> for MyVec {}
impl<T> MyTrait for MyStruct<T> {}
impl Base { fn a() {} }
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "implements");
		const names = heritage.map((r) => `${r.symbolName}@${r.callerLine}`);

		// Qualified trait path → LAST segment: std::fmt::Display → 'Display',
		// serde::Serialize → 'Serialize'.
		expect(names).toContain("Display@3");
		expect(names).toContain("Serialize@4");
		// Generic trait `Iterator<Item = u8>` → 'Iterator'; generic impl
		// `impl<T> MyTrait for ...` works.
		expect(names).toContain("Iterator@5");
		expect(names).toContain("MyTrait@6");
		// Inherent impl `impl Base { ... }` has NO trait field → no edge.
		expect(heritage.filter((r) => r.callerLine === 7)).toHaveLength(0);

		// Heritage contract: callerLine = the impl block line; callerName null;
		// target fields left null (name-based resolution per ADR-002).
		const implDisplay = heritage.find((r) => r.symbolName === "Display");
		expect(implDisplay!.callerFile).toBe("rust-impl.rs");
		expect(implDisplay!.callerLine).toBe(3);
		expect(implDisplay!.callerName).toBeNull();
		expect(implDisplay!.targetFile).toBeNull();
		expect(implDisplay!.targetSymbolId).toBeNull();

		// The `use std::fmt;` import edge still emits alongside.
		expect(refs.filter((r) => r.kind === "import").map((r) => r.symbolName)).toContain("fmt");
	});

	it("emits 'extends' edges for trait supertraits, skipping lifetime bounds", async () => {
		const result = await parseOrSkip(
			"rust-trait.rs",
			`pub trait SuperTrait {}

pub trait MyTrait: SuperTrait + OtherTrait {}

pub trait Qualified: crate::base::TraitBase + core::fmt::Debug {}

pub trait Bounded: Foo<u8> + std::ops::Add<f64> + 'static + Sized {}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends");
		const names = heritage.map((r) => `${r.symbolName}@${r.callerLine}`);

		// Plain supertraits.
		expect(names).toContain("SuperTrait@3");
		expect(names).toContain("OtherTrait@3");
		// Qualified supertraits → LAST segment: crate::base::TraitBase →
		// 'TraitBase', core::fmt::Debug → 'Debug'.
		expect(names).toContain("TraitBase@5");
		expect(names).toContain("Debug@5");
		// Generic bounds: Foo<u8> → 'Foo', std::ops::Add<f64> → 'Add'.
		expect(names).toContain("Foo@7");
		expect(names).toContain("Add@7");
		// 'static lifetime bound is NOT a trait → no edge and no spurious
		// 'static symbol; Sized is a real (auto)trait.
		expect(names).toContain("Sized@7");
		expect(heritage.some((r) => r.symbolName === "static")).toBe(false);
		expect(heritage).toHaveLength(7);

		const extSuper = heritage.find((r) => r.symbolName === "SuperTrait");
		expect(extSuper!.callerFile).toBe("rust-trait.rs");
		expect(extSuper!.callerName).toBeNull();
	});

	it("emits 'implements' edges per derived trait in #[derive(...)], skipping non-derive attributes", async () => {
		const result = await parseOrSkip(
			"rust-derive.rs",
			`#[derive(Debug, Clone, serde::Serialize)]
pub struct User {}

#[derive(PartialEq)]
enum Color { Red, Green }

#[repr(C)]
#[derive(Copy, Clone)]
pub struct Plain {}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "implements");
		const names = heritage.map((r) => `${r.symbolName}@${r.callerLine}`);

		// One edge per derived trait, anchored at the STRUCT/ENUM declaration
		// line (the derived type), NOT the attribute line.
		expect(names).toContain("Debug@2");
		expect(names).toContain("Clone@2");
		// Qualified derive path `serde::Serialize` → LAST segment 'Serialize'
		// (the token_tree is flat — 'serde' must not leak a spurious edge).
		expect(names).toContain("Serialize@2");
		expect(heritage.some((r) => r.symbolName === "serde")).toBe(false);
		// Enum derive.
		expect(names).toContain("PartialEq@5");
		// Stacked attributes: `#[repr(C)]` is NOT a derive → skipped, only
		// `#[derive(Copy, Clone)]` on the Plain struct emits.
		expect(names).toContain("Copy@9");
		expect(names).toContain("Clone@9");
		expect(heritage.some((r) => r.symbolName === "repr" || r.symbolName === "C")).toBe(false);
		expect(heritage).toHaveLength(6);

		const deriveDebug = heritage.find((r) => r.symbolName === "Debug");
		expect(deriveDebug!.callerFile).toBe("rust-derive.rs");
		expect(deriveDebug!.callerName).toBeNull();
	});

	it("emits call edges with the enclosing function/method as caller; macros emit nothing", async () => {
		const result = await parseOrSkip(
			"rust-calls.rs",
			`impl Greeter {
    fn greet(&self) { helper(); }
}

pub fn run() {
    let s = obj.method();
    std::io::read(&s);
    self::helper();
    helper();
    println!("hi");
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
		const calls = refs.filter((r) => r.kind === "call");
		const names = calls.map((r) => `${r.symbolName}@${r.callerLine}`);

		// Plain call → 'helper'; method body calls track the METHOD name;
		// function body calls track the FUNCTION name as caller.
		expect(names).toContain("helper@2");
		const methodCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 2);
		expect(methodCall!.callerName).toBe("greet");
		expect(methodCall!.callerFile).toBe("rust-calls.rs");

		// `obj.method()` → field_expression field 'method'; `std::io::read()`
		// and `self::helper()` → scoped_identifier name (LAST segment).
		expect(names).toContain("method@6");
		expect(names).toContain("read@7");
		expect(names).toContain("helper@8");
		expect(names).toContain("helper@9");
		const fnCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 9);
		expect(fnCall!.callerName).toBe("run");

		// `println!` is a macro_invocation, NOT a call_expression → no edge.
		expect(calls.some((r) => r.symbolName === "println")).toBe(false);
	});
});
