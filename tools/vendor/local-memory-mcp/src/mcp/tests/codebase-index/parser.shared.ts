import { beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Language } from "web-tree-sitter";
import { SymbolKind } from "../../codebase-index/parser/language-visitor.js";
import { TypeScriptVisitor } from "../../codebase-index/parser/typescript-visitor.js";
import { TreeSitterParserPool } from "../../codebase-index/parser/parser-pool.js";
import { FatalError } from "../../codebase-index/types/errors.js";

export { FatalError };
export { SymbolKind, TreeSitterParserPool };
export { Parser, Language, TypeScriptVisitor };

export interface WasmPaths {
	wasm: string;
	tsGrammar: string;
	tsxGrammar: string;
}

export let wasmPaths: WasmPaths | null = null;
export let wasmAvailable = false;

function findProjectRoot(): string | null {
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	let dir = moduleDir;
	for (let i = 0; i < 10; i++) {
		if (fs.existsSync(path.join(dir, "node_modules"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

export function resolveWasmPaths(): WasmPaths | null {
	const root = findProjectRoot();
	if (!root) return null;

	const candidates = {
		wasm: path.join(root, "node_modules", "web-tree-sitter", "web-tree-sitter.wasm"),
		tsGrammar: path.join(root, "node_modules", "tree-sitter-typescript", "tree-sitter-typescript.wasm"),
		tsxGrammar: path.join(root, "node_modules", "tree-sitter-typescript", "tree-sitter-tsx.wasm")
	};

	if (!fs.existsSync(candidates.wasm)) return null;
	if (!fs.existsSync(candidates.tsGrammar)) return null;

	return candidates;
}

export async function initTreeSitter(): Promise<{ tsLang: Language }> {
	if (!wasmPaths) throw new Error("WASM not available");

	await Parser.init({
		locateFile(): string {
			return wasmPaths!.wasm;
		}
	});

	const tsLang = await Language.load(wasmPaths.tsGrammar);
	return { tsLang };
}

export function touch(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

export function parseSource(sourceCode: string, tsLang: Language) {
	const parser = new Parser();
	parser.setLanguage(tsLang);

	const tree = parser.parse(sourceCode);
	if (!tree) {
		parser.delete();
		throw new Error("Parse returned null");
	}

	const visitor = new TypeScriptVisitor();
	const symbols = visitor.extractSymbols(tree, sourceCode);

	tree.delete();
	parser.delete();

	return symbols;
}

beforeAll(() => {
	wasmPaths = resolveWasmPaths();
	if (!wasmPaths) {
		console.warn("[parser] WASM files not found — WASM-dependent tests will be skipped");
		return;
	}
	wasmAvailable = true;
});
