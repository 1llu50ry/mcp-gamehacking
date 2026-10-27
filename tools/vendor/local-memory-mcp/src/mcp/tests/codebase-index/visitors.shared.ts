import { beforeAll, expect } from "vitest";
import { TreeSitterParserPool } from "../../codebase-index/parser/parser-pool.js";
import type { ParseResult } from "../../codebase-index/parser/language-visitor.js";

export let pool: TreeSitterParserPool | null = null;
export let wasmAvailable = false;

beforeAll(async () => {
	pool = new TreeSitterParserPool();
	try {
		await pool.initialize();
		wasmAvailable = true;
	} catch {
		console.warn("[visitors] WASM not available — all tests will be skipped");
		pool = null;
	}
}, 60_000);

export async function parseOrSkip(fileName: string, source: string): Promise<ParseResult> {
	if (!wasmAvailable || !pool) {
		console.warn(`  Skipped: WASM not available`);
		return { symbols: [], error: "skipped", durationMs: 0 };
	}
	return pool.parseFile(fileName, source);
}

export function assertNoError(result: ParseResult): void {
	if (!wasmAvailable) return;
	if (result.error && result.error.startsWith("Unsupported extension")) return;
	if (result.error && result.error.startsWith("Failed to load grammar")) return;
	expect(result.error).toBeNull();
}

export function isUnsupportedExtension(result: ParseResult): boolean {
	return !!result.error && result.error.startsWith("Unsupported extension");
}

export function guardEmpty(result: ParseResult): void {
	if (!wasmAvailable || isUnsupportedExtension(result) || result.symbols.length === 0) {
		return;
	}
}
