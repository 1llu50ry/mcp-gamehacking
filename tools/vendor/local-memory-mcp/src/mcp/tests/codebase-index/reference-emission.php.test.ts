import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("PhpVisitor reference emission", () => {
	it("emits call and instantiation references for function/member calls and new", async () => {
		const result = await parseOrSkip(
			"repo.php",
			`<?php
class Repo {
  public function save() {
    $u = new User();
    $u->save();
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
		const inst = refs.find((r) => r.symbolName === "User" && r.kind === "instantiation");
		expect(inst).toBeDefined();
		expect(inst!.callerFile).toBe("repo.php");
		expect(inst!.callerName).toBe("save");
		// `new User();` sits on source line 4 (`$u->save();` is line 5).
		expect(inst!.callerLine).toBe(4);

		const memberCall = refs.find((r) => r.symbolName === "save" && r.kind === "call");
		expect(memberCall).toBeDefined();
		expect(memberCall!.callerName).toBe("save");

		const fnCall = refs.find((r) => r.symbolName === "helper" && r.kind === "call");
		expect(fnCall).toBeDefined();
		expect(fnCall!.callerName).toBe("save");
	});

	it("indexes scoped (static) calls and functional call through project scope", async () => {
		const result = await parseOrSkip(
			"scoped.php",
			`<?php
class A {
  public function go() { self::make(); static::run(); }
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
		expect(names).toContain("make:call");
		expect(names).toContain("run:call");
	});
});

