import { describe, expect, it } from "vitest";
import { wasmAvailable, parseOrSkip } from "./reference-emission.shared.js";
import {
	ReexportResolver,
	buildReexportResolverContext,
	type ReexportSpec
} from "../../codebase-index/parser/reexport-resolution.js";
import { preferCanonicalSymbols, isBarrelFile } from "../../tools/codebase-read/search.js";
import { buildReexportChain, traceSymbol } from "../../codebase-index/services/trace-service.js";
import type { CodebaseReference, CodebaseSymbol } from "../../types.js";
import { RankTier, type RankedSymbol } from "../../codebase-index/services/symbol-ranking.js";

// ═══════════════════════════════════════════════════════════════════════════
// VISITOR EMISSION (real tree-sitter WASM)
// ═══════════════════════════════════════════════════════════════════════════

describe("TypeScriptVisitor re-export emission (issue #87 / TASK-013)", () => {
	it("emits a named re-export edge carrying the canonical name + module specifier", async () => {
		const result = await parseOrSkip("app.ts", `export { User } from './user';\n`);
		if (!wasmAvailable || (result.error && result.error.startsWith("Failed to load grammar"))) return;

		const refs = result.references ?? [];
		const re = refs.filter((r) => r.kind === "reexport");
		expect(re.length).toBe(1);
		expect(re[0].symbolName).toBe("User");
		expect(re[0].callerFile).toBe("app.ts");
		expect(re[0].importInfo).toEqual({
			localName: "User",
			importedName: "User",
			moduleSpecifier: "./user",
			importKind: "named"
		});
		// Targets stay null — resolution is the pipeline/resolver's job.
		expect(re[0].targetFile).toBeUndefined();
	});

	it("emits an aliased re-export edge separating the local alias from the canonical name", async () => {
		const result = await parseOrSkip("app.ts", `export { User as DomainUser } from './user';\n`);
		if (!wasmAvailable || (result.error && result.error.startsWith("Failed to load grammar"))) return;

		const re = (result.references ?? []).find((r) => r.kind === "reexport");
		expect(re).toBeDefined();
		expect(re!.symbolName).toBe("User");
		expect(re!.importInfo).toEqual({
			localName: "DomainUser",
			importedName: "User",
			moduleSpecifier: "./user",
			importKind: "named"
		});
	});

	it("emits a wildcard re-export edge with importedName null", async () => {
		const result = await parseOrSkip("app.ts", `export * from './types';\n`);
		if (!wasmAvailable || (result.error && result.error.startsWith("Failed to load grammar"))) return;

		const re = (result.references ?? []).find((r) => r.kind === "reexport");
		expect(re).toBeDefined();
		expect(re!.importInfo!.importKind).toBe("wildcard");
		expect(re!.importInfo!.importedName).toBeNull();
		expect(re!.importInfo!.localName).toBe("*");
		expect(re!.importInfo!.moduleSpecifier).toBe("./types");
	});

	it("does NOT emit a re-export edge for a local `export { x }` (no source)", async () => {
		const result = await parseOrSkip("app.ts", `const x = 1;\nexport { x };\n`);
		if (!wasmAvailable || (result.error && result.error.startsWith("Failed to load grammar"))) return;

		const re = (result.references ?? []).filter((r) => r.kind === "reexport");
		expect(re.length).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// REEPORT RESOLVER (pure unit — barrel chains, cycles, wildcard expansion)
// ═══════════════════════════════════════════════════════════════════════════

function sym(file: string, name: string, id: string, exported = true): CodebaseSymbol {
	return {
		id,
		repo: "r",
		file_path: file,
		name,
		kind: "class",
		exported,
		default_export: false,
		start_line: 1,
		start_col: 0,
		end_line: 1,
		end_col: 0,
		doc_comment: null
	} as CodebaseSymbol;
}

function reexportRef(
	caller: string,
	specifier: string,
	imported: string,
	alias: string | null,
	kind: "named" | "wildcard"
): CodebaseReference {
	return {
		id: "x",
		repo: "r",
		symbol_name: imported,
		caller_file: caller,
		caller_line: 1,
		caller_name: null,
		kind: "reexport",
		target_file: null,
		target_symbol_id: null,
		role: null,
		local_name: alias ?? imported,
		imported_name: kind === "wildcard" ? null : imported,
		module_specifier: specifier,
		import_kind: kind,
		created_at: ""
	} as CodebaseReference;
}

describe("ReexportResolver canonical resolution (issue #87 / TASK-013)", () => {
	it("resolves a multi-hop barrel chain to the canonical declaration", () => {
		const symbols = [
			sym("src/domain/user.ts", "User", "u1"),
			sym("src/domain/index.ts", "User", "u2"),
			sym("src/index.ts", "User", "u3")
		];
		const refs = [
			reexportRef("src/domain/index.ts", "./user", "User", null, "named"),
			reexportRef("src/index.ts", "./domain", "User", null, "named")
		];
		const indexed = new Set(["src/domain/user.ts", "src/domain/index.ts", "src/index.ts"]);
		const resolver = new ReexportResolver(buildReexportResolverContext(refs, symbols, indexed));

		// `export { User } from './domain'` from src/index.ts must chase the
		// barrel chain src/index.ts → src/domain/index.ts → src/domain/user.ts.
		const resolved = resolver.resolve("src/index.ts", {
			moduleSpecifier: "./domain",
			importedName: "User",
			aliasName: null,
			importKind: "named"
		} as ReexportSpec);

		expect(resolved.length).toBe(1);
		expect(resolved[0].targetFile).toBe("src/domain/user.ts");
		expect(resolved[0].targetSymbolId).toBe("u1");
		expect(resolved[0].canonicalName).toBe("User");
	});

	it("terminates safely on a self-referential barrel cycle and returns the canonical symbol", () => {
		const symbols = [sym("circular.ts", "Foo", "f1")];
		const refs = [reexportRef("circular.ts", "./circular", "Foo", null, "named")];
		const indexed = new Set(["circular.ts"]);
		const resolver = new ReexportResolver(buildReexportResolverContext(refs, symbols, indexed));

		// `export { Foo } from './circular'` points at its own file — the cycle
		// must be cut (no infinite loop) and the same-file canonical wins.
		const resolved = resolver.resolve("circular.ts", {
			moduleSpecifier: "./circular",
			importedName: "Foo",
			aliasName: null,
			importKind: "named"
		} as ReexportSpec);

		expect(resolved.length).toBe(1);
		expect(resolved[0].targetSymbolId).toBe("f1");
	});

	it("terminates safely on a mutual barrel cycle with no canonical symbol (empty, no throw)", () => {
		const symbols: CodebaseSymbol[] = [];
		const refs = [reexportRef("a.ts", "./b", "B", null, "named"), reexportRef("b.ts", "./a", "B", null, "named")];
		const indexed = new Set(["a.ts", "b.ts"]);
		const resolver = new ReexportResolver(buildReexportResolverContext(refs, symbols, indexed));

		const resolved = resolver.resolve("a.ts", {
			moduleSpecifier: "./b",
			importedName: "B",
			aliasName: null,
			importKind: "named"
		} as ReexportSpec);

		expect(resolved).toEqual([]);
	});

	it("expands a wildcard `export *` into one resolved target per exported symbol", () => {
		const symbols = [
			sym("src/types.ts", "Foo", "f1"),
			sym("src/types.ts", "Bar", "b1"),
			sym("src/types.ts", "Internal", "i1", false) // not exported — excluded
		];
		const refs = [reexportRef("src/index.ts", "./types", "Foo", null, "wildcard")];
		const indexed = new Set(["src/types.ts", "src/index.ts"]);
		const resolver = new ReexportResolver(buildReexportResolverContext(refs, symbols, indexed));

		const resolved = resolver.resolve("src/index.ts", {
			moduleSpecifier: "./types",
			importedName: null,
			aliasName: "*",
			importKind: "wildcard"
		} as ReexportSpec);

		expect(resolved.map((r) => r.canonicalName).sort()).toEqual(["Bar", "Foo"]);
		expect(resolved.every((r) => r.targetFile === "src/types.ts")).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH canonical preference (issue #87 / TASK-013)
// ═══════════════════════════════════════════════════════════════════════════

describe("SEARCH canonical preference (issue #87 / TASK-013)", () => {
	it("isBarrelFile detects index.* modules", () => {
		expect(isBarrelFile("src/domain/index.ts")).toBe(true);
		expect(isBarrelFile("src/domain/index.tsx")).toBe(true);
		expect(isBarrelFile("src/domain/user.ts")).toBe(false);
	});

	it("drops the barrel-file duplicate in favor of the canonical declaration", () => {
		const ranked: RankedSymbol[] = [
			{ symbol: sym("src/domain/index.ts", "User", "barrel"), rankTier: RankTier.Substring, score: 0.5 },
			{ symbol: sym("src/domain/user.ts", "User", "canon"), rankTier: RankTier.Substring, score: 0.5 }
		];
		const out = preferCanonicalSymbols(ranked);
		expect(out.length).toBe(1);
		expect(out[0].symbol.file_path).toBe("src/domain/user.ts");
	});

	it("keeps both copies when a name appears only in barrel files (never drops results)", () => {
		const ranked: RankedSymbol[] = [
			{ symbol: sym("src/a/index.ts", "X", "a"), rankTier: RankTier.Substring, score: 0.5 },
			{ symbol: sym("src/b/index.ts", "X", "b"), rankTier: RankTier.Substring, score: 0.5 }
		];
		const out = preferCanonicalSymbols(ranked);
		expect(out.length).toBe(2);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// TRACE export chain (issue #87 / TASK-013)
// ═══════════════════════════════════════════════════════════════════════════

describe("TRACE export chain (issue #87 / TASK-013)", () => {
	const userSym = sym("src/domain/user.ts", "User", "u1");

	const storedRefs = [
		{
			filePath: "src/domain/index.ts",
			startLine: 1,
			startCol: 0,
			endLine: 1,
			endCol: 0,
			context: "",
			kind: "reexport",
			targetSymbolId: "u1",
			targetFile: "src/domain/user.ts",
			localName: "User",
			importedName: "User",
			moduleSpecifier: "./user",
			importKind: "named"
		},
		{
			filePath: "src/index.ts",
			startLine: 3,
			startCol: 0,
			endLine: 3,
			endCol: 0,
			context: "",
			kind: "reexport",
			targetSymbolId: "u1",
			targetFile: "src/domain/user.ts",
			localName: "DomainUser",
			importedName: "User",
			moduleSpecifier: "./domain",
			importKind: "named"
		}
	];

	it("buildReexportChain exposes every module that re-exports the symbol", () => {
		const chain = buildReexportChain(userSym, storedRefs as any);
		expect(chain.length).toBe(2);
		const aliased = chain.find((c) => c.filePath === "src/index.ts");
		expect(aliased?.aliasName).toBe("DomainUser");
		expect(aliased?.canonicalName).toBe("User");
		expect(aliased?.moduleSpecifier).toBe("./domain");
	});

	it("traceSymbol surfaces the reexportChain on the result", () => {
		const res = traceSymbol("User", "r", [userSym], true, storedRefs as any);
		expect(res.reexportChain.length).toBe(2);
		expect(res.symbol.id).toBe("u1");
	});
});
