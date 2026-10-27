import fs from "node:fs";
import path from "node:path";
import type { ParserPool, ParseResult, ParsedSymbol } from "../../codebase-index/parser/language-visitor.js";
import { SymbolKind } from "../../codebase-index/parser/language-visitor.js";

export { type ParserPool, type ParseResult, type ParsedSymbol, SymbolKind };

export interface MockParserPoolOptions {
	delayMs?: number | undefined;
	simulateTimeout?: boolean | undefined;
	crashFiles?: Set<string> | undefined;
}

export function touch(filePath: string, content: string): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

export async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error("waitFor timed out");
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

export function createMockParserPool(opts?: MockParserPoolOptions): ParserPool {
	const delayMs = opts?.delayMs ?? 0;
	const simulateTimeout = opts?.simulateTimeout ?? false;
	const crashFiles = opts?.crashFiles ?? new Set<string>();
	let initialized = false;
	return {
		async initialize(): Promise<void> {
			initialized = true;
		},
		isInitialized(): boolean {
			return initialized;
		},
		async parseFile(filePath: string, _sourceCode: string): Promise<ParseResult> {
			if (delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs));
			}

			const basename = path.basename(filePath);

			if (crashFiles.has(basename)) {
				throw new Error(`Simulated crash in parser for: ${basename}`);
			}

			if (simulateTimeout) {
				return {
					symbols: [],
					error: "Parse timeout after 10000ms for: " + filePath,
					durationMs: 0
				};
			}

			if (basename === "error.ts") {
				return {
					symbols: [],
					error: "Parse errors detected (partial results returned)",
					durationMs: 0
				};
			}

			if (basename === "crash.ts") {
				return {
					symbols: [],
					error: "Syntax error: unexpected token",
					durationMs: 0
				};
			}

			const symbols: ParsedSymbol[] = [];
			const stem = path.parse(basename).name;

			symbols.push({
				name: stem,
				kind: SymbolKind.Function,
				startLine: 1,
				startCol: 1,
				endLine: 1,
				endCol: stem.length + 8,
				signature: `function ${stem}()`,
				docComment: `Documentation for ${stem}`,
				exported: true,
				defaultExport: false,
				parentName: null
			});

			return {
				symbols,
				error: null,
				durationMs: 0
			};
		}
	};
}
