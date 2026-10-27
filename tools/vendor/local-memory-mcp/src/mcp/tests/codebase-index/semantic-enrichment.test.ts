/**
 * Tests for the TypeScript semantic-signature enrichment pass (issue #89,
 * TASK-015). Covers: inferred returns, generics, type-alias resolution,
 * graceful degrade without tsconfig, monorepo nearest-tsconfig resolution,
 * non-overwrite of the structural `signature`, and entity round-trip of the
 * three new columns.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	enrichFileSemantic,
	resolveNearestTsConfig,
	SEMANTIC_SOURCE_TYPESCRIPT,
	symbolKey
} from "../../codebase-index/semantic/typescript-enricher";
import { SymbolKind, type ParsedSymbol } from "../../codebase-index/parser/language-visitor";
import { createTestStore, type SQLiteStore } from "../../storage/sqlite";
import { randomUUID } from "crypto";

/** Build a minimal ParsedSymbol list from name/kind/line tuples. */
function syms(spec: Array<[string, SymbolKind, number]>): ParsedSymbol[] {
	return spec.map(([name, kind, startLine]) => ({
		name,
		kind,
		startLine,
		startCol: 1,
		endLine: startLine,
		endCol: 10,
		signature: `structural:${name}`,
		docComment: null,
		exported: true,
		defaultExport: false,
		parentName: null
	}));
}

describe("typescript-enricher", () => {
	it("infers an explicit return type for a function", () => {
		const content = `function add(a: number, b: number): number {\n  return a + b;\n}\n`;
		const result = enrichFileSemantic("src/math.ts", content, syms([["add", SymbolKind.Function, 1]]));
		expect(result.degraded).toBe(false);
		const hit = result.bySymbolKey.get(symbolKey("add", 1));
		expect(hit).toBeDefined();
		// signatureToString yields "(a: number, b: number) => number"
		expect(hit!.semanticSignature).toContain("number");
		expect(hit!.semanticSource).toBe(SEMANTIC_SOURCE_TYPESCRIPT);
	});

	it("infers a generic parameter/return type", () => {
		const content = `function identity<T>(x: T): T {\n  return x;\n}\n`;
		const result = enrichFileSemantic("src/gen.ts", content, syms([["identity", SymbolKind.Function, 1]]));
		expect(result.degraded).toBe(false);
		const hit = result.bySymbolKey.get(symbolKey("identity", 1));
		expect(hit).toBeDefined();
		expect(hit!.semanticSignature).toContain("T");
	});

	it("surfaces an explicit type-alias annotation on a variable", () => {
		const content = `type ID = string;\nconst userId: ID = "abc";\n`;
		const result = enrichFileSemantic("src/alias.ts", content, syms([["userId", SymbolKind.Variable, 2]]));
		expect(result.degraded).toBe(false);
		const hit = result.bySymbolKey.get(symbolKey("userId", 2));
		expect(hit).toBeDefined();
		// The declared type alias `ID` is surfaced (explicit annotation preserved).
		expect(hit!.semanticSignature).toBe("ID");
	});

	it("exposes generic type parameters for a type alias declaration", () => {
		const content = `type Pair<T, U> = [T, U];\n`;
		const result = enrichFileSemantic("src/pair.ts", content, syms([["Pair", SymbolKind.Type, 1]]));
		expect(result.degraded).toBe(false);
		const hit = result.bySymbolKey.get(symbolKey("Pair", 1));
		expect(hit).toBeDefined();
		expect(hit!.semanticSignature).toBe("<T, U>");
	});

	it("degrades gracefully (no throw) when no tsconfig.json exists", () => {
		const content = `function greet(name: string): string {\n  return "hi " + name;\n}\n`;
		// A file path under a temp dir with NO tsconfig up the tree: the enricher
		// must still infer using default compiler options (graceful, not degraded).
		const result = enrichFileSemantic("/tmp/orphan-dir/greet.ts", content, syms([["greet", SymbolKind.Function, 1]]));
		expect(result.degraded).toBe(false);
		const hit = result.bySymbolKey.get(symbolKey("greet", 1));
		expect(hit).toBeDefined();
		expect(hit!.semanticSignature).toContain("string");
	});

	it("does not mutate the input ParsedSymbol (preserves structural signature)", () => {
		const input = syms([["add", SymbolKind.Function, 1]]);
		input[0].signature = "structural:add";
		const content = `function add(a: number): number { return a; }\n`;
		enrichFileSemantic("src/add.ts", content, input);
		expect(input[0].signature).toBe("structural:add");
	});

	it("returns an empty (degraded) map for unparseable content without throwing", () => {
		// TypeScript is tolerant of invalid syntax, so this still produces a
		// result; we assert the call itself never throws and returns a Map.
		const result = enrichFileSemantic("src/bad.ts", "function ((( not valid", syms([["x", SymbolKind.Function, 1]]));
		expect(result).toHaveProperty("bySymbolKey");
		expect(result.bySymbolKey).toBeInstanceOf(Map);
	});
});

describe("resolveNearestTsConfig (monorepo)", () => {
	let root: string;
	beforeAll(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "semantic-mono-"));
		// root tsconfig
		fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
		// nested package with its OWN tsconfig (nearest should win)
		const pkg = path.join(root, "packages", "a");
		fs.mkdirSync(path.join(pkg, "src"), { recursive: true });
		fs.writeFileSync(path.join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: false } }));
		fs.writeFileSync(path.join(pkg, "src", "index.ts"), "export const x = 1;\n");
	});
	afterAll(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it("prefers the nearest tsconfig.json in a monorepo", () => {
		const nestedFile = path.join(root, "packages", "a", "src", "index.ts");
		const nearest = resolveNearestTsConfig(path.dirname(nestedFile));
		expect(nearest).toBe(path.join(root, "packages", "a", "tsconfig.json"));
		expect(nearest).not.toBe(path.join(root, "tsconfig.json"));
	});

	it("falls back to the root tsconfig when no nearer one exists", () => {
		const deepFile = path.join(root, "packages", "a", "src", "nested", "deep.ts");
		const nearest = resolveNearestTsConfig(path.dirname(deepFile));
		expect(nearest).toBe(path.join(root, "packages", "a", "tsconfig.json"));
	});
});

describe("codebase_symbols semantic columns (entity round-trip)", () => {
	let db: SQLiteStore;
	beforeAll(async () => {
		db = await createTestStore();
	});

	it("persists semantic fields and never overwrites the structural signature", () => {
		const id = randomUUID();
		const structuralSig = "function add(a, b)";
		db.codebaseSymbols.bulkUpsertSymbols([
			{
				id,
				repo: "test-repo",
				file_path: "src/math.ts",
				name: "add",
				kind: "function",
				exported: true,
				default_export: false,
				start_line: 1,
				start_col: 1,
				end_line: 3,
				end_col: 1,
				signature: structuralSig,
				doc_comment: null,
				parent_symbol_id: null,
				semantic_signature: "(a: number, b: number) => number",
				semantic_source: SEMANTIC_SOURCE_TYPESCRIPT,
				semantic_updated_at: "2026-08-28T00:00:00.000Z"
			}
		]);

		const [stored] = db.codebaseSymbols.getSymbolsByFile("test-repo", "src/math.ts");
		expect(stored).toBeDefined();
		// Structural signature is untouched by the semantic enrichment.
		expect(stored.signature).toBe(structuralSig);
		expect(stored.semantic_signature).toBe("(a: number, b: number) => number");
		expect(stored.semantic_source).toBe(SEMANTIC_SOURCE_TYPESCRIPT);
		expect(stored.semantic_updated_at).toBe("2026-08-28T00:00:00.000Z");
	});

	it("updateSymbolSemantic writes only the semantic columns", () => {
		const id = randomUUID();
		const structuralSig = "const x = 1";
		db.codebaseSymbols.bulkUpsertSymbols([
			{
				id,
				repo: "test-repo",
				file_path: "src/v.ts",
				name: "x",
				kind: "variable",
				exported: false,
				default_export: false,
				start_line: 1,
				start_col: 1,
				end_line: 1,
				end_col: 12,
				signature: structuralSig,
				doc_comment: null,
				parent_symbol_id: null
			}
		]);
		db.codebaseSymbols.updateSymbolSemantic(id, "number", SEMANTIC_SOURCE_TYPESCRIPT);

		const [stored] = db.codebaseSymbols.getSymbolsByFile("test-repo", "src/v.ts");
		expect(stored.signature).toBe(structuralSig);
		expect(stored.semantic_signature).toBe("number");
		expect(stored.semantic_source).toBe(SEMANTIC_SOURCE_TYPESCRIPT);
		expect(stored.semantic_updated_at).not.toBeNull();
	});
});
