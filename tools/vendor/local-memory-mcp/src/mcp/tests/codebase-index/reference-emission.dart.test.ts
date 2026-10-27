import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("DartVisitor reference emission (TASK-311)", () => {
	it("emits one 'import' edge per library import with the full URI (quotes stripped) as the name; exports and parts emit nothing", async () => {
		const result = await parseOrSkip(
			"dart-imports.dart",
			`import 'dart:math';
import 'package:foo/bar.dart' as fb show Baz, qux hide Secret;
import "src/local.dart";

export 'src/dep.dart';
part 'src/other.dart';
part of 'src/library.dart';
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

		// The FULL URI path is the imported name (quotes stripped); the `as`
		// alias and show/hide combinators are selection granularity, NOT edges.
		expect(names).toContain("dart:math@1");
		expect(names).toContain("package:foo/bar.dart@2");
		expect(names).toContain("src/local.dart@3");
		// export / part / part-of are NOT imports.
		expect(imports).toHaveLength(3);

		// The pool fills callerFile; imports are file-scope statements.
		const first = imports[0];
		expect(first!.callerFile).toBe("dart-imports.dart");
		expect(first!.callerName).toBeNull();
		expect(first!.callerLine).toBe(1);
		expect(first!.targetFile).toBeNull();
		expect(first!.targetSymbolId).toBeNull();
	});

	it("emits 'extends' for the superclass and with-mixins, 'implements' per interface, the mixin on-constraint and the class-level generic bound", async () => {
		const result = await parseOrSkip(
			"dart-heritage.dart",
			`abstract class Animal implements Comparable<Animal> {
  int get age;
}

class Dog extends Animal with Fable, Juggable implements Barkable, Playable {
}

mixin Fetcher {
  void fetch() {}
}

mixin Jumper on Animal {
  void jump() {}
}

class Generic<T extends Animal> implements Listenable<T> {
  final T value;
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
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");

		// Class superclass → 'extends' at the declaration line; callerName null
		// per the heritage contract.
		const extAnimal = heritage.find((r) => r.symbolName === "Animal" && r.kind === "extends" && r.callerLine === 5);
		expect(extAnimal).toBeDefined();
		expect(extAnimal!.callerFile).toBe("dart-heritage.dart");
		expect(extAnimal!.callerLine).toBe(5);
		expect(extAnimal!.callerName).toBeNull();
		expect(extAnimal!.targetFile).toBeNull();
		expect(extAnimal!.targetSymbolId).toBeNull();

		const hnames = heritage.map((r) => `${r.symbolName}:${r.kind}@${r.callerLine}`);
		// with-mixins → 'extends' (inheritance-like heritage, per the task decision).
		expect(hnames).toContain("Fable:extends@5");
		expect(hnames).toContain("Juggable:extends@5");
		// implements list → one 'implements' per DIRECT interface target.
		expect(hnames).toContain("Barkable:implements@5");
		expect(hnames).toContain("Playable:implements@5");
		// The declaring class itself and generic type-argument targets are NOT
		// edges ('Comparable<Animal>' → 'Comparable' only; type args nested).
		expect(heritage.some((r) => r.symbolName === "Dog")).toBe(false);
		expect(hnames).toContain("Comparable:implements@1");
		expect(heritage.some((r) => r.symbolName === "Animal" && r.kind === "implements")).toBe(false);
		// mixin `on` applicability constraint → 'extends' (no edge for a mixin
		// without an `on` clause — 'Fetcher').
		expect(hnames).toContain("Animal:extends@12");
		expect(heritage.some((r) => r.symbolName === "Fetcher")).toBe(false);
		// class-level generic bound → 'extends' (mirrors TS TASK-301).
		expect(hnames).toContain("Listenable:implements@16");
		expect(hnames).toContain("Animal:extends@16");
	});

	it("resolves qualified (library-prefixed) heritage names to the LAST segment — the library prefix is never an edge", async () => {
		const result = await parseOrSkip(
			"dart-heritage-qualified.dart",
			`class C extends pkg.Base {}
class D implements pkg.A, B {}
class E with pkg.M1, M2 {}
mixin F on pkg.T {}
mixin H on pkg.T, U {}
class G<T extends pkg.V> implements Listenable<T> {}
`
		);
		if (!wasmAvailable) return;
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;

		const refs = result.references ?? [];
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");
		const hnames = heritage.map((r) => `${r.symbolName}:${r.kind}@${r.callerLine}`);

		// The hidden _type_name/_type_dot_identifier rules hoist BOTH 'pkg' and
		// 'Base' as direct type_identifiers — the LAST per segment wins.
		expect(hnames).toContain("Base:extends@1");
		expect(hnames).toContain("A:implements@2");
		expect(hnames).toContain("B:implements@2");
		expect(hnames).toContain("M1:extends@3");
		expect(hnames).toContain("M2:extends@3");
		expect(hnames).toContain("T:extends@4");
		expect(hnames).toContain("T:extends@5");
		expect(hnames).toContain("U:extends@5");
		expect(hnames).toContain("V:extends@6");
		expect(hnames).toContain("Listenable:implements@6");
		// The library prefix is a path component — never a heritage target, and
		// generic type arguments stay nested (no edge).
		expect(heritage.some((r) => r.symbolName === "pkg")).toBe(false);
		expect(heritage.some((r) => r.symbolName === "T" && r.kind === "implements")).toBe(false);
	});

	it("emits 'call' edges with the enclosing method as caller; chained receivers, nested calls and cascades emit only the LAST callee; bare property selectors and bare cascade properties emit nothing", async () => {
		const result = await parseOrSkip(
			"dart-calls.dart",
			`class Greeter {
  String greet(String name) {
    final msg = format(name);
    return msg.length;
  }
}
String format(String name) => 'Hi $name';
void main() {
  final g = Greeter();
  g.greet('bob');
  print('done');
  g.greet('a').toUpperCase();
  final nested = foo(bar());
  list..add(1)..add(2);
  list..length;
  list..first;
  list..add(1)..first;
}
int foo(int x) => x;
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

		expect(names).toContain("format@3");
		expect(names).toContain("Greeter@9");
		expect(names).toContain("greet@10");
		expect(names).toContain("print@11");
		// `g.greet('a').toUpperCase()` → 'greet' AND 'toUpperCase'; the receiver
		// `g` is a path component, never a call site.
		expect(names).toContain("greet@12");
		expect(names).toContain("toUpperCase@12");
		expect(calls.some((r) => r.symbolName === "g")).toBe(false);
		// Nested call `foo(bar())` → BOTH callees.
		expect(names).toContain("foo@13");
		expect(names).toContain("bar@13");
		// Cascade `list..add(1)..add(2)` → one 'add' edge PER cascade section.
		expect(calls.filter((r) => r.symbolName === "add" && r.callerLine === 14)).toHaveLength(2);
		// Bare property access (`msg.length`) without `()` is NOT a call.
		expect(calls.some((r) => r.symbolName === "length")).toBe(false);
		// Bare cascade property selectors (`list..length`, `list..first`) carry
		// no argument list → NOT calls, at any position in a cascade chain.
		expect(calls.some((r) => r.symbolName === "length" && r.callerLine === 15)).toBe(false);
		expect(calls.some((r) => r.symbolName === "first")).toBe(false);
		// `list..add(1)..first` → the trailing `..first` is property access but
		// the `..add(1)` section before it still emits exactly one call.
		expect(calls.filter((r) => r.symbolName === "add" && r.callerLine === 17)).toHaveLength(1);

		// callerName = the enclosing method/function name.
		const formatCall = calls.find((r) => r.symbolName === "format");
		expect(formatCall!.callerName).toBe("greet");
		const greetCall = calls.find((r) => r.symbolName === "greet" && r.callerLine === 10);
		expect(greetCall!.callerName).toBe("main");
		expect(greetCall!.callerFile).toBe("dart-calls.dart");
		expect(greetCall!.targetFile).toBeNull();
		expect(greetCall!.targetSymbolId).toBeNull();
	});
});
