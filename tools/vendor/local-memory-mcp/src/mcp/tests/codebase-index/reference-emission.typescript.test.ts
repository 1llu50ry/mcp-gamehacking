import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("TypeScriptVisitor reference emission", () => {
	it("emits call, instantiation and import references with enclosing caller name", async () => {
		const result = await parseOrSkip(
			"svc.ts",
			`import { connect } from "./db";
export class Svc {
  run() {
    const user = new Config();
    connect();
  }
}
`
		);
		if (
			result.error &&
			(result.error.startsWith("Unsupported extension") || result.error.startsWith("Failed to load grammar"))
		)
			return;
		if (!wasmAvailable) return;

		const refs = result.references ?? [];
		const importRef = refs.find((r) => r.symbolName === "connect" && r.kind === "import");
		expect(importRef).toBeDefined();
		// The pool fills callerFile from the file path.
		expect(importRef!.callerFile).toBe("svc.ts");
		expect(importRef!.callerLine).toBe(1);

		const inst = refs.find((r) => r.symbolName === "Config" && r.kind === "instantiation");
		expect(inst).toBeDefined();
		expect(inst!.callerName).toBe("run");
		expect(inst!.callerLine).toBe(4);

		const call = refs.find((r) => r.symbolName === "connect" && r.kind === "call");
		expect(call).toBeDefined();
		expect(call!.callerName).toBe("run");
		expect(call!.callerLine).toBe(5);
	});

	it("resolves member-expression calls to their property name", async () => {
		const result = await parseOrSkip(
			"calls.ts",
			`class Svc {
  run() { ns.helper(); obj?.method(); (foo.new().bar()); }
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
		expect(names).toContain("helper:call");
		expect(names).toContain("method:call");
		expect(names).toContain("bar:call");
		expect(names).toContain("new:call"); // `foo.new()` — member property is `new`
	});
});
