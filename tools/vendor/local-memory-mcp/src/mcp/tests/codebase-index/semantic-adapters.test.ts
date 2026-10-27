import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	SemanticAdapterRegistry,
	getDefaultSemanticRegistry,
	runAdapterWithIsolation,
	enrichSymbolsSemantic,
	repoPathFromAbsolute
} from "../../codebase-index/semantic/registry";
import type {
	SemanticAdapter,
	SemanticEnrichmentInput,
	SemanticEnrichmentResult,
	SemanticSymbolEnrichment
} from "../../codebase-index/semantic/adapter";
import { typescriptSemanticAdapter } from "../../codebase-index/semantic/typescript-enricher";
import { phpstanSemanticAdapter } from "../../codebase-index/semantic/phpstan-adapter";
import { symbolKey } from "../../codebase-index/semantic/typescript-enricher";
import { SymbolKind, type ParsedSymbol } from "../../codebase-index/parser/language-visitor";
import { runParsePipeline } from "../../codebase-index/services/parse-pipeline";
import { createTestStore } from "../../storage/sqlite";
import type { ParserPool } from "../../codebase-index/parser/language-visitor";

// ── Test adapters ────────────────────────────────────────────────────────────

function makeSymbol(name: string, startLine: number, kind: SymbolKind = SymbolKind.Function): ParsedSymbol {
	return {
		name,
		kind,
		startLine,
		startCol: 1,
		endLine: startLine,
		endCol: 10,
		signature: `sig ${name}`,
		docComment: null,
		exported: true,
		defaultExport: false,
		parentName: null
	};
}

class RecordingAdapter implements SemanticAdapter {
	readonly name: string;
	enriched = 0;
	constructor(name: string) {
		this.name = name;
	}
	supports(language: string): boolean {
		return language === "x-test";
	}
	async enrich(input: SemanticEnrichmentInput): Promise<SemanticEnrichmentResult> {
		this.enriched++;
		const bySymbolKey = new Map<string, SemanticSymbolEnrichment>();
		for (const sym of input.symbols) {
			bySymbolKey.set(symbolKey(sym.name, sym.startLine), {
				semanticSignature: `enriched:${sym.name}`,
				semanticSource: this.name
			});
		}
		return { bySymbolKey, source: this.name, provider: this.name, degraded: false };
	}
}

class ThrowingAdapter implements SemanticAdapter {
	readonly name = "throwing";
	supports(language: string): boolean {
		return language === "x-test";
	}
	async enrich(): Promise<SemanticEnrichmentResult> {
		throw new Error("boom");
	}
}

class SlowAdapter implements SemanticAdapter {
	readonly name = "slow";
	supports(language: string): boolean {
		return language === "x-test";
	}
	async enrich(): Promise<SemanticEnrichmentResult> {
		await new Promise((r) => setTimeout(r, 200));
		return { bySymbolKey: new Map(), source: this.name, provider: this.name, degraded: false };
	}
}

// ── 1. Adapter selection by language ──────────────────────────────────────────

describe("SemanticAdapterRegistry selection", () => {
	it("selects the TypeScript adapter for typescript-family languages", () => {
		const registry = getDefaultSemanticRegistry();
		expect(registry.select("typescript", "/repo")!.name).toBe("typescript-compiler");
		expect(registry.select("ts", "/repo")!.name).toBe("typescript-compiler");
		expect(registry.select("javascript", "/repo")!.name).toBe("typescript-compiler");
		expect(registry.select("tsx", "/repo")!.name).toBe("typescript-compiler");
	});

	it("selects the PHPStan adapter for php", () => {
		const registry = getDefaultSemanticRegistry();
		expect(registry.select("php", "/repo")!.name).toBe("phpstan");
	});

	it("returns null when no adapter supports the language", () => {
		const registry = getDefaultSemanticRegistry();
		expect(registry.select("python", "/repo")).toBeNull();
		expect(registry.select("go", "/repo")).toBeNull();
	});

	it("returns the first matching adapter in registration order", () => {
		const first = new RecordingAdapter("first");
		const second = new RecordingAdapter("second");
		second.supports = () => true;
		const registry = new SemanticAdapterRegistry().register(first).register(second);
		// first does NOT support x-test, so second wins
		expect(registry.select("x-test", "/repo")!.name).toBe("second");
	});

	it("treats a throwing supports() as not-supported", () => {
		const bad: SemanticAdapter = {
			name: "bad",
			supports: () => {
				throw new Error("supports crashed");
			},
			enrich: async () => ({ bySymbolKey: new Map(), source: "bad", provider: "bad", degraded: true })
		};
		const registry = new SemanticAdapterRegistry().register(bad).register(typescriptSemanticAdapter);
		expect(registry.select("typescript", "/repo")!.name).toBe("typescript-compiler");
	});
});

// ── 2. No-adapter fallback ────────────────────────────────────────────────────

describe("no-adapter fallback", () => {
	it("enrichSymbolsSemantic returns null with an empty registry (structural unchanged)", async () => {
		const registry = new SemanticAdapterRegistry();
		const symbols = [makeSymbol("foo", 1)];
		const result = await enrichSymbolsSemantic(
			registry,
			"python",
			"a.py",
			"/repo",
			"def foo():\n  pass\n",
			symbols,
			1000
		);
		expect(result).toBeNull();
		// structural input is never mutated
		expect(symbols[0].signature).toBe("sig foo");
	});

	it("does not run any adapter for an unsupported language", async () => {
		const adapter = new RecordingAdapter("rec");
		const registry = new SemanticAdapterRegistry().register(adapter);
		const out = await enrichSymbolsSemantic(registry, "python", "a.py", "/repo", "", [makeSymbol("x", 1)], 1000);
		expect(out).toBeNull();
		expect(adapter.enriched).toBe(0);
	});

	it("keeps structural indexing working when no adapter is available (pipeline integration)", async () => {
		const db = await createTestStore();
		const pool = fakePool([
			{
				filePath: "src/Model.php",
				language: "php",
				symbols: [makeSymbol("getUser", 3, SymbolKind.Method)]
			}
		]);
		const emptyRegistry = new SemanticAdapterRegistry();
		// The pipeline reads the plan's absolutePath from disk — create the
		// fixture so the file exists (test-environment setup, not a code path).
		const filePath = path.join(os.tmpdir(), "repo", "src", "Model.php");
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, "<?php\nclass Model { public function getUser() {} }\n");
		const result = await runParsePipeline(
			db,
			pool,
			"repo",
			[
				{
					action: "parse",
					filePath: "src/Model.php",
					absolutePath: filePath,
					language: "php",
					sizeBytes: 50
				}
			],
			new Map(),
			new Map(),
			new Map(),
			new Set(),
			{ semanticRegistry: emptyRegistry }
		);
		expect(result.parsedFiles).toBe(1);
		expect(result.totalSymbols).toBe(1);
		expect(result.failedFiles).toBe(0);
		expect(result.errors).toHaveLength(0);
		expect(result.semanticEnriched).toBe(0);
		const stored = db.codebaseSymbols.getSymbolsByFile("repo", "src/Model.php")[0];
		expect(stored.source_fingerprint).toMatch(/^[a-f0-9]{64}$/);
	});
});

// ── 3. Timeout isolation ─────────────────────────────────────────────────────

describe("timeout isolation", () => {
	it("resolves to a degraded result instead of hanging on a slow adapter", async () => {
		const result = await runAdapterWithIsolation(new SlowAdapter(), sampleInput(), 20);
		expect(result.degraded).toBe(true);
		expect(result.reason).toMatch(/timeout/);
		expect(result.bySymbolKey.size).toBe(0);
	});

	it("does not fail repo indexing when an adapter times out", async () => {
		const registry = new SemanticAdapterRegistry().register(new SlowAdapter());
		// x-test is supported by SlowAdapter; with a 10ms timeout it will time out.
		const out = await enrichSymbolsSemantic(registry, "x-test", "a.ts", "/repo", "", [makeSymbol("foo", 1)], 10);
		// timeout ⇒ degraded ⇒ null map; indexing continues regardless
		expect(out).toBeNull();
	});
});

// ── 4. Failed enrichment isolation ───────────────────────────────────────────

describe("failed enrichment isolation", () => {
	it("a throwing adapter resolves to a degraded result (never throws)", async () => {
		const result = await runAdapterWithIsolation(new ThrowingAdapter(), sampleInput(), 1000);
		expect(result.degraded).toBe(true);
		expect(result.reason).toBe("boom");
	});

	it("a failing adapter does not fail repo indexing (pipeline integration)", async () => {
		const db = await createTestStore();
		const pool = fakePool([
			{
				filePath: "src/Model.php",
				language: "php",
				symbols: [makeSymbol("getUser", 3, SymbolKind.Method)]
			}
		]);
		const failingRegistry = new SemanticAdapterRegistry().register(new ThrowingAdapter());
		// The pipeline reads the plan's absolutePath from disk — create the
		// fixture so the file exists (test-environment setup, not a code path).
		const filePath = path.join(os.tmpdir(), "repo", "src", "Model.php");
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, "<?php\nclass Model { public function getUser() {} }\n");
		const result = await runParsePipeline(
			db,
			pool,
			"repo",
			[
				{
					action: "parse",
					filePath: "src/Model.php",
					absolutePath: filePath,
					language: "x-test",
					sizeBytes: 50
				}
			],
			new Map(),
			new Map(),
			new Map(),
			new Set(),
			{ semanticRegistry: failingRegistry }
		);
		expect(result.parsedFiles).toBe(1);
		expect(result.totalSymbols).toBe(1);
		expect(result.failedFiles).toBe(0);
		expect(result.errors).toHaveLength(0);
		expect(result.semanticEnriched).toBe(0);
	});
});

// ── 5. PHPStan PoC adapter contract ─────────────────────────────────────────

describe("PhpStanSemanticAdapter (non-TS PoC)", () => {
	it("supports php only", () => {
		expect(phpstanSemanticAdapter.supports("php", "/repo")).toBe(true);
		expect(phpstanSemanticAdapter.supports("typescript", "/repo")).toBe(false);
		expect(phpstanSemanticAdapter.name).toBe("phpstan");
	});

	it("returns a graceful 'not configured' degraded result by default", async () => {
		const result = await phpstanSemanticAdapter.enrich({
			filePath: "a.php",
			repoPath: "/repo",
			language: "php",
			content: "<?php\n",
			symbols: [makeSymbol("foo", 1)]
		});
		expect(result.degraded).toBe(true);
		expect(result.reason).toMatch(/not configured/);
		expect(result.bySymbolKey.size).toBe(0);
	});

	it("extracts phpdoc @param/@return into a semantic signature when enabled", async () => {
		const prev = process.env.CODEBASE_SEMANTIC_PHPSTAN_ENABLED;
		process.env.CODEBASE_SEMANTIC_PHPSTAN_ENABLED = "true";
		try {
			const content = [
				"<?php",
				"/**",
				" * @param int $id",
				" * @param string $name",
				" * @return User",
				" */",
				"function find(int $id, string $name): User {}"
			].join("\n");
			const symbols = [makeSymbol("find", 7, SymbolKind.Function)];
			const result = await phpstanSemanticAdapter.enrich({
				filePath: "a.php",
				repoPath: "/repo",
				language: "php",
				content,
				symbols
			});
			expect(result.degraded).toBe(false);
			const hit = result.bySymbolKey.get(symbolKey("find", 7));
			expect(hit).toBeDefined();
			expect(hit!.semanticSignature).toBe("(id: int, name: string): User");
			expect(hit!.semanticSource).toBe("phpstan");
		} finally {
			if (prev === undefined) delete process.env.CODEBASE_SEMANTIC_PHPSTAN_ENABLED;
			else process.env.CODEBASE_SEMANTIC_PHPSTAN_ENABLED = prev;
		}
	});

	it("does not mutate the input symbols", async () => {
		const symbols = [makeSymbol("foo", 1)];
		const before = JSON.stringify(symbols);
		await phpstanSemanticAdapter.enrich({
			filePath: "a.php",
			repoPath: "/repo",
			language: "php",
			content: "<?php\n",
			symbols
		});
		expect(JSON.stringify(symbols)).toBe(before);
	});
});

// ── 6. TypeScript adapter implements the contract ─────────────────────────────

describe("TypeScriptSemanticAdapter contract", () => {
	it("is registered in the default registry and supports TS family", () => {
		expect(typescriptSemanticAdapter.name).toBe("typescript-compiler");
		expect(typescriptSemanticAdapter.supports("typescript", "/repo")).toBe(true);
		expect(typescriptSemanticAdapter.supports("javascript", "/repo")).toBe(true);
		expect(typescriptSemanticAdapter.supports("php", "/repo")).toBe(false);
		expect(
			getDefaultSemanticRegistry()
				.list()
				.some((a) => a.name === "typescript-compiler")
		).toBe(true);
	});

	it("derives repo root via repoPathFromAbsolute", () => {
		expect(repoPathFromAbsolute("/repo/src/a.ts", "src/a.ts")).toBe(path.resolve("/repo"));
		expect(repoPathFromAbsolute("/repo/src/a.ts", "other/b.ts")).toBe(path.dirname("/repo/src/a.ts"));
	});
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function sampleInput(): SemanticEnrichmentInput {
	return {
		filePath: "a.ts",
		repoPath: "/repo",
		language: "x-test",
		content: "",
		symbols: [makeSymbol("foo", 1)]
	};
}

/** Minimal ParserPool that returns canned symbols without touching tree-sitter. */
function fakePool(files: { filePath: string; language: string; symbols: ParsedSymbol[] }[]): ParserPool {
	const map = new Map(files.map((f) => [f.filePath, f]));
	return {
		async initialize() {},
		isInitialized() {
			return true;
		},
		async parseFile(filePath: string) {
			const entry = map.get(filePath);
			return {
				symbols: entry ? entry.symbols : [],
				references: [],
				error: null,
				durationMs: 0
			};
		}
	} as ParserPool;
}
