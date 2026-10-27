import { describe, it, expect } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";

describe("GoVisitor reference emission (TASK-306)", () => {
	it("emits import edges per binding with alias / last-segment resolution — blank and dot imports emit nothing", async () => {
		const result = await parseOrSkip(
			"go-imports.go",
			`package main

import "fmt"
import alias "strings"
import _ "net/http/pprof"
import . "math"
import (
    "net/http"
    "os"
    s "sync"
    _ "unsafe"
)

func main() {}
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

		// Plain import → binding is the LAST path segment: "fmt" → 'fmt',
		// "net/http" → 'http' (Go binds the package name, not the full path).
		expect(names).toContain("fmt@3");
		expect(names).toContain("http@8");
		// Explicit alias wins: `import alias "strings"` → 'alias',
		// `s "sync"` → 's'.
		expect(names).toContain("alias@4");
		expect(names).toContain("s@10");
		// Grouped form `import ( ... )` emits per-spec edges.
		expect(names).toContain("os@9");
		// Blank `_ "net/http/pprof"` / `_ "unsafe"` and dot `. "math"` imports
		// bind no name — nothing emitted.
		expect(names).not.toContain("pprof");
		expect(names).not.toContain("unsafe");
		expect(names).not.toContain("math");
		expect(names).not.toContain("_");

		// The pool fills callerFile; import callerLine = the spec line (the
		// binding site); imports carry no enclosing caller (package-level).
		const first = imports[0];
		expect(first!.callerFile).toBe("go-imports.go");
		expect(first!.callerName).toBeNull();
		expect(first!.callerLine).toBe(3);
	});

	it("emits 'extends' edges for embedded interfaces, skipping unions/approximations and methods", async () => {
		const result = await parseOrSkip(
			"go-interface-embed.go",
			`package shapes

type Named interface {
    Name() string
}

type Embedded interface {
    Named
    Extra() int
}

type Reader interface {
    io.Reader
    Close() error
}

type Constrained interface {
    ~int | ~string
    Comparable
}

type Plain interface {
    int | float64
    Marker
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
		const heritage = refs.filter((r) => r.kind === "extends");

		// `interface Embedded { Named }` → 'Named' extends at the interface
		// declaration line, callerName null per the heritage contract.
		const extNamed = heritage.find((r) => r.symbolName === "Named");
		expect(extNamed).toBeDefined();
		expect(extNamed!.callerFile).toBe("go-interface-embed.go");
		expect(extNamed!.callerLine).toBe(7);
		expect(extNamed!.callerName).toBeNull();

		// Qualified embed `io.Reader` → LAST name segment 'Reader'.
		const extReader = heritage.find((r) => r.symbolName === "Reader");
		expect(extReader).toBeDefined();
		expect(extReader!.callerLine).toBe(12);
		expect(extReader!.callerName).toBeNull();

		// Plain embed inside a constraint interface.
		const extComparable = heritage.find((r) => r.symbolName === "Comparable");
		expect(extComparable).toBeDefined();
		expect(extComparable!.callerLine).toBe(17);

		// Union / approximation elements (`~int | ~string`) are NOT embedded
		// interfaces — no edges. Checked on union TERM (symbolName) rather
		// than callerLine: extends edges attach at the type_spec line
		// (17/22), never at a union-element line — the old `callerLine ===
		// 18` check was vacuous (always empty, even when the first union
		// element leaked an edge at line 17).
		expect(heritage.some((r) => r.symbolName === "int" || r.symbolName === "float64")).toBe(false);

		// Plain (non-approximated) union `int | float64` + standalone embed
		// `Marker`: the union is ONE type_elem with multiple named children
		// (skipped by the single-element guard), so 'Marker' is the ONLY
		// extends emitted from Plain — catches the regression where the
		// union's first element ('int') leaked a spurious edge at the spec
		// line.
		const extMarker = heritage.find((r) => r.symbolName === "Marker");
		expect(extMarker).toBeDefined();
		expect(extMarker!.callerFile).toBe("go-interface-embed.go");
		expect(extMarker!.callerLine).toBe(22);
		expect(extMarker!.callerName).toBeNull();

		// interface method requirements (Name/Extra/Close) are NOT embeds —
		// no edges for them (only the 4 extends above exist).
		expect(heritage).toHaveLength(4);
	});

	it("emits 'extends' edges for embedded struct fields (pointer/qualified/generic); named fields emit nothing", async () => {
		const result = await parseOrSkip(
			"go-struct-embed.go",
			`package repo

import "sync"

type Base struct {
    ID int
}

type Foo struct {
    Base
    *Mutex
    sync.RWMutex
    Base[int]
    name string
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
		const heritage = refs.filter((r) => r.kind === "extends");

		// All four embedded (anonymous) fields on the Foo declaration line,
		// callerName null per the heritage contract:
		//   Base          → type_identifier
		//   *Mutex        → pointer embed → 'Mutex' (LAST segment)
		//   sync.RWMutex  → qualified embed → 'RWMutex' (LAST segment)
		//   Base[int]     → generic embed → 'Base'
		const line9 = heritage.filter((r) => r.callerLine === 9);
		expect(line9.map((r) => r.symbolName).sort()).toEqual(["Base", "Base", "Mutex", "RWMutex"]);

		const extNamed = heritage.find((r) => r.symbolName === "Base");
		expect(extNamed!.callerFile).toBe("go-struct-embed.go");
		expect(extNamed!.callerName).toBeNull();

		// Named fields (`ID int`, `name string`) are NOT embeds — no edges on
		// their lines, and no 'name'/'ID'/'int' targets.
		expect(heritage.filter((r) => r.callerLine === 6)).toHaveLength(0);
		expect(heritage.some((r) => r.symbolName === "name" || r.symbolName === "ID" || r.symbolName === "int")).toBe(
			false
		);

		// The `import "sync"` edge still emits alongside the extends edges.
		const imports = refs.filter((r) => r.kind === "import");
		expect(imports.map((r) => r.symbolName)).toContain("sync");
	});

	it("emits call edges with the enclosing function/method as caller", async () => {
		const result = await parseOrSkip(
			"go-calls.go",
			`package main

type Repo struct{}

func (r *Repo) Save() error { return helper() }

func helper(x int) int { return x }

func main() {
    helper(1)
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

		// Plain call → 'helper'.
		expect(names).toContain("helper@5");
		expect(names).toContain("helper@10");

		// Method body calls track the METHOD name; function calls track the
		// FUNCTION name as caller.
		const methodCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 5);
		expect(methodCall!.callerName).toBe("Save");
		expect(methodCall!.callerFile).toBe("go-calls.go");

		const fnCall = calls.find((r) => r.symbolName === "helper" && r.callerLine === 10);
		expect(fnCall!.callerName).toBe("main");
	});
});
