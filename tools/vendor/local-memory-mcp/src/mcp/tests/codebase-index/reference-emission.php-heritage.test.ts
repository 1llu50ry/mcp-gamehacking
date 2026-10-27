import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("PhpVisitor heritage + import reference emission (TASK-302)", () => {
	it("emits import edges per binding with alias / last-segment resolution", async () => {
		const result = await parseOrSkip(
			"php-imports.php",
			`<?php
use Foo\\Bar;
use Foo\\Bar as Baz;
use function foo\\helper;
use NS\\Util\\{Factory, Repo as Store};
use A\\B, C;
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
		// `use Foo\Bar;` → 'Bar' (last segment); `as Baz` → 'Baz' (alias).
		expect(names).toContain("Bar@2");
		expect(names).toContain("Baz@3");
		// `use function foo\helper;` resolves the same way (last segment).
		expect(names).toContain("helper@4");
		// Group form `use NS\Util\{Factory, Repo as Store};`.
		expect(names).toContain("Factory@5");
		expect(names).toContain("Store@5");
		// Multi-clause plain form `use A\B, C;`.
		expect(names).toContain("B@6");
		expect(names).toContain("C@6");

		// The pool fills callerFile; top-level imports carry no caller.
		const first = imports[0];
		expect(first!.callerFile).toBe("php-imports.php");
		expect(first!.callerName).toBeNull();
	});

	it("emits extends + implements edges for class heritage with caller site", async () => {
		const result = await parseOrSkip(
			"php-heritage.php",
			`<?php
class Foo extends Bar implements IFoo, IBar {
  public function run() {
    helper();
  }
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

		const ext = refs.find((r) => r.symbolName === "Bar" && r.kind === "extends");
		expect(ext).toBeDefined();
		expect(ext!.callerFile).toBe("php-heritage.php");
		expect(ext!.callerLine).toBe(2);
		expect(ext!.callerName).toBeNull();

		const implFoo = refs.find((r) => r.symbolName === "IFoo" && r.kind === "implements");
		expect(implFoo).toBeDefined();
		expect(implFoo!.callerLine).toBe(2);
		expect(implFoo!.callerName).toBeNull();

		const implBar = refs.find((r) => r.symbolName === "IBar" && r.kind === "implements");
		expect(implBar).toBeDefined();
		expect(implBar!.callerLine).toBe(2);

		// Existing call emission inside the class body is unchanged.
		const call = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(call!.callerLine).toBe(4);
	});

	it("emits interface multiple-extends, enum implements and last-segment qualified names", async () => {
		const result = await parseOrSkip(
			"php-heritage-types.php",
			`<?php
interface A extends B, C {
  public function m(): void;
}

abstract class Abs extends \\App\\Models\\Base implements IFoo {}

enum E implements E1, E2 {
  case One;
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
		const names = refs.map((r) => `${r.symbolName}:${r.kind}`);

		// interface A extends B, C → two extends edges at the interface line.
		expect(names).toContain("B:extends");
		expect(names).toContain("C:extends");
		const ifaceExt = refs.find((r) => r.symbolName === "B" && r.kind === "extends");
		expect(ifaceExt!.callerLine).toBe(2);
		expect(ifaceExt!.callerName).toBeNull();

		// abstract class Abs extends \App\Models\Base implements IFoo →
		// 'Base' is the LAST name segment of the qualified name.
		expect(names).toContain("Base:extends");
		expect(names).toContain("IFoo:implements");

		// enum E implements E1, E2 → per-target implements edges.
		expect(names).toContain("E1:implements");
		expect(names).toContain("E2:implements");
		const enumImpl = refs.find((r) => r.symbolName === "E1" && r.kind === "implements");
		// `enum E` is on line 8 of the fixture (blank line 7 between the abstract class and the enum).
		expect(enumImpl!.callerLine).toBe(8);
	});

	it("does not emit import/heritage edges for trait use or type annotations", async () => {
		const result = await parseOrSkip(
			"php-heritage-none.php",
			`<?php
trait Greets {
  public function hi() {}
}

class Foo {
  use Greets;
  public function run(Greets $g): void {
    $g->hi();
  }
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
		// Trait `use` (use_declaration) is NOT an import; parameter type
		// annotations (named_type) are NOT heritage.
		const imports = refs.filter((r) => r.kind === "import");
		expect(imports).toHaveLength(0);
		const heritage = refs.filter((r) => r.kind === "extends" || r.kind === "implements");
		expect(heritage).toHaveLength(0);

		// Call-site emission inside methods still works.
		expect(refs.some((r) => r.symbolName === "hi" && r.kind === "call")).toBe(true);
	});
});
