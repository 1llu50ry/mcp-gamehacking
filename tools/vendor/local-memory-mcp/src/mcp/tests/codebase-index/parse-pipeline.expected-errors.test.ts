/**
 * Parse-pipeline expected-error classification tests (FIX-030).
 *
 * Exercises the real `runParsePipeline` against a fake ParserPool that returns
 * the canonical tree-sitter partial-results sentinel. Expected inputs
 * (JSX-in-plain-JS) are downgraded to debug and counted in
 * `expectedParseErrors`; REAL inputs (malformed .ts) keep their failure.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runParsePipeline } from "../../codebase-index/services/parse-pipeline/index.js";
import { TREE_SITTER_PARSE_ERROR } from "../../codebase-index/parser/parse-error-classifier.js";
import { createTestStore } from "../../storage/sqlite.js";
import type { SQLiteStore } from "../../storage/sqlite.js";
import type { ParserPool, ParseResult } from "../../codebase-index/parser/language-visitor.js";

/** Parser that always reports the canonical partial-results error. */
function sentinelPool(): ParserPool {
	return {
		async initialize(): Promise<void> {},
		isInitialized(): boolean {
			return true;
		},
		async parseFile(): Promise<ParseResult> {
			return { symbols: [], error: TREE_SITTER_PARSE_ERROR, durationMs: 0 };
		}
	};
}

/** Write a file into the temp repo and return its absolute path. */
function write(root: string, rel: string, content: string): string {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf-8");
	return abs;
}

describe("parse pipeline — expected parse-error classification (FIX-030)", () => {
	let store: SQLiteStore;
	let tempDir: string;

	afterEach(() => {
		store?.close();
		if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("downgrades JSX-in-plain-JS partial errors (expected) and keeps real ones", async () => {
		store = await createTestStore();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-fix030-"));

		// Expected: JSX in a .js file (javascript grammar has no JSX).
		const jsxAbs = write(tempDir, "src/app/page.js", "export default () => <div>hi</div>;\n");
		// Real: malformed hand-written .ts.
		const brokenAbs = write(tempDir, "src/broken.ts", "export function f( { return\n");

		const result = await runParsePipeline(
			store,
			sentinelPool(),
			"repo",
			[
				{
					action: "parse",
					filePath: "src/app/page.js",
					absolutePath: jsxAbs,
					language: "javascript",
					sizeBytes: 40
				},
				{
					action: "parse",
					filePath: "src/broken.ts",
					absolutePath: brokenAbs,
					language: "typescript",
					sizeBytes: 30
				}
			],
			new Map(),
			new Map(),
			new Map(),
			new Set(),
			{}
		);

		// The JSX-in-JS error is expected → downgraded, NOT counted as failure.
		expect(result.expectedParseErrors).toBe(1);
		// The malformed .ts error is real → still a failure + recorded.
		expect(result.failedFiles).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].filePath).toBe("src/broken.ts");
		expect(result.errors[0].error).toBe(TREE_SITTER_PARSE_ERROR);
	});

	it("clean parses produce neither failures nor expected errors (negative control)", async () => {
		store = await createTestStore();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cbi-fix030-clean-"));

		const cleanPool: ParserPool = {
			async initialize(): Promise<void> {},
			isInitialized(): boolean {
				return true;
			},
			async parseFile(): Promise<ParseResult> {
				return { symbols: [], error: null, durationMs: 0 };
			}
		};
		const abs = write(tempDir, "src/ok.ts", "export const x = 1;\n");

		const result = await runParsePipeline(
			store,
			cleanPool,
			"repo",
			[{ action: "parse", filePath: "src/ok.ts", absolutePath: abs, language: "typescript", sizeBytes: 20 }],
			new Map(),
			new Map(),
			new Map(),
			new Set(),
			{}
		);

		expect(result.parsedFiles).toBe(1);
		expect(result.failedFiles).toBe(0);
		expect(result.expectedParseErrors).toBe(0);
		expect(result.errors).toHaveLength(0);
	});
});
