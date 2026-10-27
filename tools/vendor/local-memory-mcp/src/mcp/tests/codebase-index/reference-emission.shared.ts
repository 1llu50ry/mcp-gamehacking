import { beforeAll } from "vitest";
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
		console.warn("[reference-emission] WASM not available — tests skipped");
		pool = null;
	}
}, 60_000);

export async function parseOrSkip(fileName: string, source: string): Promise<ParseResult> {
	if (!wasmAvailable || !pool) {
		return { symbols: [], references: [], error: "skipped", durationMs: 0 };
	}
	return pool.parseFile(fileName, source);
}
