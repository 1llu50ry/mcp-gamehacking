/**
 * Parser worker equivalence (FEAT-DAEMON-002C).
 *
 * The off-main-thread parse pipeline MUST produce BYTE-IDENTICAL results to the
 * former in-process path. This suite parses the SAME source two ways and
 * deep-compares the output:
 *
 *   1. IN-PROCESS — web-tree-sitter + the same language visitor, on the test's
 *      own thread (the historical path).
 *   2. WORKER — the production `TreeSitterParserPool`, which now dispatches to
 *      the bounded worker pool.
 *
 * Both paths share the language registry, so any divergence would indicate a
 * marshalling / routing / resource-lifecycle bug in the offload.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Parser, Language, type Tree } from "web-tree-sitter";
import { TreeSitterParserPool } from "../../codebase-index/parser/parser-pool.js";
import { createRegistry } from "../../codebase-index/parser/language-routing.js";
import type { LanguageConfig } from "../../codebase-index/parser/language-routing.js";
import type { ParseResult } from "../../codebase-index/parser/language-visitor.js";

function findProjectRoot(): string | null {
	let dir = path.dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 10; i++) {
		if (fs.existsSync(path.join(dir, "node_modules"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

const root = findProjectRoot();
const wasmRuntime = root ? path.join(root, "node_modules", "web-tree-sitter", "web-tree-sitter.wasm") : null;
const wasmAvailable = !!wasmRuntime && fs.existsSync(wasmRuntime);

let parserReady: Promise<void> | null = null;
function ensureInProcessParser(): Promise<void> {
	parserReady ??= Parser.init({ locateFile: () => wasmRuntime! });
	return parserReady;
}

/** The registry config that would route `filePath` (extension, then basename). */
function configFor(filePath: string): LanguageConfig | undefined {
	const registry = createRegistry();
	const ext = path.extname(filePath).toLowerCase();
	if (ext !== "") return registry.find((c) => c.extensions.includes(ext));
	const base = path.basename(filePath).toLowerCase();
	return registry.find((c) => c.extensions.includes(base));
}

/** Parse in-process (the historical path) and return the canonical ParseResult. */
async function parseInProcess(filePath: string, sourceCode: string): Promise<ParseResult> {
	await ensureInProcessParser();
	const config = configFor(filePath);
	if (!config) return { symbols: [], error: `Unsupported extension`, durationMs: 0 };
	if (config.grammarWasms.length === 0) {
		const visitor = config.createVisitor();
		return {
			symbols: visitor.extractSymbols(null, sourceCode),
			references: (visitor.extractReferences?.(null, sourceCode) ?? []).map((r) => ({
				...r,
				callerFile: filePath
			})),
			error: null,
			durationMs: 0
		};
	}
	const lang = await Language.load(config.grammarWasms[0]);
	const parser = new Parser();
	let tree: Tree | null = null;
	try {
		parser.setLanguage(lang);
		tree = parser.parse(sourceCode, null);
		const visitor = config.createVisitor();
		return {
			symbols: visitor.extractSymbols(tree, sourceCode),
			references: (visitor.extractReferences?.(tree, sourceCode) ?? []).map((r) => ({
				...r,
				callerFile: filePath
			})),
			error: tree?.rootNode.hasError ? "Parse errors detected (partial results returned)" : null,
			durationMs: 0
		};
	} finally {
		tree?.delete();
		parser.delete();
	}
}

/** Strip the wall-clock field (differs run-to-run) before comparing. */
function stable(result: ParseResult): unknown {
	return { symbols: result.symbols, references: result.references ?? [], error: result.error };
}

const SAMPLES: Array<{ filePath: string; source: string }> = [
	{
		filePath: "sample.ts",
		source: `import { User } from "./user";
/** Fetch a user. */
export async function fetchUser(id: string): Promise<User> {
	return db.users.find(id);
}
export class UserService {
	private cache = new Map<string, User>();
	getUser(id: number): User { return {} as User; }
}
export interface Config { name: string; retries: number; }
export type Handler = (x: number) => void;
export const enum Mode { A, B }
export default class Default {}
`
	},
	{
		filePath: "sample.tsx",
		source: `import React from "react";
interface Props { name: string; }
export const Greeting: React.FC<Props> = ({ name }) => <div>Hi {name}</div>;
export default function Header(): JSX.Element { return <h1>Header</h1>; }
`
	},
	{
		filePath: "sample.py",
		source: `import os
from typing import List

class Widget:
    def render(self, x: int) -> str:
        return os.getcwd()

def main(argv: List[str]) -> None:
    Widget().render(1)
`
	},
	{
		filePath: "sample.go",
		source: `package main

import "fmt"

type Server struct { Port int }

func (s *Server) Start() error {
	fmt.Println(s.Port)
	return nil
}

func main() { s := &Server{}; _ = s.Start() }
`
	},
	{
		filePath: "sample.rb",
		source: `require "json"

class Greeter
  def greet(name)
    puts "hi #{name}"
  end
end

Greeter.new.greet("x")
`
	},
	{
		filePath: "README.md",
		source: `# Title

Some text.

## Section

\`\`\`ts
const x = 1;
\`\`\`
`
	}
];

describe("parser worker equivalence (FEAT-DAEMON-002C)", () => {
	it("produces byte-identical results to the in-process path", { timeout: 60_000 }, async () => {
		if (!wasmAvailable) {
			console.warn("  Skipped: WASM runtime not available");
			return;
		}

		const pool = new TreeSitterParserPool({ concurrency: 2 });
		try {
			for (const { filePath, source } of SAMPLES) {
				const inProcess = await parseInProcess(filePath, source);
				const viaWorker = await pool.parseFile(filePath, source);
				// JSON round-trip makes the comparison order-sensitive and
				// byte-exact (no `undefined`-vs-missing leniency).
				expect(JSON.stringify(stable(viaWorker)), `${filePath} differs`).toBe(JSON.stringify(stable(inProcess)));
			}
		} finally {
			await pool.close();
		}
	});

	it("degrades gracefully on an unsupported extension (same error string)", { timeout: 30_000 }, async () => {
		if (!wasmAvailable) return;
		const pool = new TreeSitterParserPool();
		try {
			const result = await pool.parseFile("thing.unknown", "content");
			expect(result.symbols).toEqual([]);
			expect(result.error).toBe("Unsupported extension: .unknown");
		} finally {
			await pool.close();
		}
	});
});
