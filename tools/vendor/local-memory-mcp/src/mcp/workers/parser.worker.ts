/**
 * parser.worker — off-main-thread tree-sitter parsing (FEAT-DAEMON-002C).
 *
 * Runs the ENTIRE parse pipeline inside a `node:worker_threads` worker owned by
 * the generic bounded WorkerPool (`src/mcp/workers/pool.ts`): web-tree-sitter
 * WASM init, lazy grammar loading, the synchronous `parser.parse()` call, and
 * language-visitor symbol/reference extraction. Moving this work off the main
 * thread keeps the MCP server's event loop responsive — the historical
 * synchronous `parser.parse()` blocked the HTTP `initialize` handshake for tens
 * of minutes on a large repo (3979 files ≈ 31 min).
 *
 * BYTE-IDENTICAL RESULTS: this module reuses the SAME language registry
 * (language-routing.ts), the SAME visitor factories, and the SAME
 * extension/basename routing as the former in-process parser, so the emitted
 * symbols + references are unchanged. Only the source string is marshalled IN
 * and the ParseResult OUT, both via structured clone.
 *
 * Protocol (matches WorkerPool in `pool.ts`):
 *   main  → worker : { id: number, payload: ParserWorkerRequest }
 *   worker → main  : { id, ok: true,  result: ParseResult | { warmed: true } }
 *                  | { id, ok: false, error: { message, name?, stack? } }
 *
 * Each worker owns its own Parser/Language instances; the pool guarantees one
 * in-flight task per worker, so no intra-worker concurrency is possible.
 */

import { parentPort } from "node:worker_threads";
import path from "node:path";
import { Parser, Language, type Tree } from "web-tree-sitter";
import {
	type LanguageConfig,
	getWasmPath,
	createRegistry,
	buildGenericCatchAll,
	buildRegistryMaps,
	removeConfigsForWasm,
	extensionlessLookupKey
} from "../codebase-index/parser/language-routing.js";
import { TREE_SITTER_PARSE_ERROR } from "../codebase-index/parser/parse-error-classifier.js";
import type { ParseResult } from "../codebase-index/parser/language-visitor.js";
import { logger } from "../utils/logger.js";

/** Fallback per-file parse deadline when the pool omits one. */
const DEFAULT_PARSE_TIMEOUT_MS = 10_000;

/** Request envelope accepted by this worker. */
export interface ParserWorkerRequest {
	op: "warmup" | "parse";
	/** Repo-relative or absolute path of the file being parsed (routes grammar). */
	filePath?: string;
	/** Full source text (marshalled by structured clone). */
	sourceCode?: string;
	/** Per-file parse deadline in ms (`0` disables the in-worker abort). */
	parseTimeoutMs?: number;
}

/** Response envelope produced by this worker (mirrors WorkerPool). */
export type ParserWorkerResponse = { warmed: true } | ParseResult;

// ── Language registry (built once per worker) ─────────────────────────

const registry: LanguageConfig[] = createRegistry();
registry.push(buildGenericCatchAll(registry));
const registryMaps = buildRegistryMaps(registry);
const extToConfig = registryMaps.extToConfig;
const basenameToConfig = registryMaps.basenameToConfig;

// Grammar cache: WASM file path → loaded Language.
const loadedGrammars = new Map<string, Language>();
// In-flight grammar loads: WASM path → pending load promise (dedup within a worker).
const inFlightGrammars = new Map<string, Promise<Language>>();

/** Memoized `Parser.init()` for this worker thread. */
let wasmInitPromise: Promise<void> | null = null;

function ensureWasmInitialized(): Promise<void> {
	if (!wasmInitPromise) {
		const wasmPath = getWasmPath();
		wasmInitPromise = Parser.init({
			locateFile(): string {
				return wasmPath;
			}
		}).catch((err: unknown) => {
			// Allow a later task to retry a transient init failure.
			wasmInitPromise = null;
			throw err;
		});
	}
	return wasmInitPromise;
}

// ── Grammar loading ───────────────────────────────────────────────────

async function getOrLoadGrammar(wasmPath: string): Promise<Language> {
	const existing = loadedGrammars.get(wasmPath);
	if (existing) return existing;

	const inFlight = inFlightGrammars.get(wasmPath);
	if (inFlight) return inFlight;

	const loading = loadGrammar(wasmPath);
	inFlightGrammars.set(wasmPath, loading);
	try {
		return await loading;
	} finally {
		inFlightGrammars.delete(wasmPath);
	}
}

async function loadGrammar(wasmPath: string): Promise<Language> {
	try {
		const lang = await Language.load(wasmPath);
		loadedGrammars.set(wasmPath, lang);
		return lang;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.warn("[ParserWorker] Grammar load failed — skipping language", { wasmPath, error: message });
		removeConfigsForWasm(extToConfig, wasmPath);
		throw new Error(`Failed to load grammar: ${wasmPath} — ${message}`, { cause: err });
	}
}

// ── Parse ─────────────────────────────────────────────────────────────

/**
 * Parse one file, mirroring the former in-process `_doParse`. Errors are
 * captured into `ParseResult.error` (never thrown) so the caller always gets a
 * graceful per-file result — the same contract as before the offload.
 */
async function parseFileInWorker(filePath: string, sourceCode: string, parseTimeoutMs: number): Promise<ParseResult> {
	try {
		return await doParse(filePath, sourceCode, parseTimeoutMs);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.warn("[ParserWorker] Parse failed", { filePath, error: message });
		return { symbols: [], error: message, durationMs: 0 };
	}
}

async function doParse(filePath: string, sourceCode: string, parseTimeoutMs: number): Promise<ParseResult> {
	await ensureWasmInitialized();

	const ext = path.extname(filePath).toLowerCase();
	let config = extToConfig.get(ext);

	// Fallback: extensionless files (Dockerfile, Makefile, Justfile, Containerfile).
	if (!config && ext === "") {
		config = basenameToConfig.get(extensionlessLookupKey(filePath));
	}

	if (!config) {
		return { symbols: [], error: `Unsupported extension: ${ext || "(none)"}`, durationMs: 0 };
	}

	// Non-tree-sitter visitors: no grammar WASM needed, create visitor directly.
	if (config.grammarWasms.length === 0) {
		const visitor = config.createVisitor();
		const symbols = visitor.extractSymbols(null, sourceCode);
		const references = (visitor.extractReferences?.(null, sourceCode) ?? []).map((r) => ({
			...r,
			callerFile: filePath
		}));
		return { symbols, references, error: null, durationMs: 0 };
	}

	const wasmPath = config.grammarWasms[0];
	if (!wasmPath) {
		return { symbols: [], error: `No grammar configured for: ${config.languageId}`, durationMs: 0 };
	}

	let language: Language;
	try {
		language = await getOrLoadGrammar(wasmPath);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { symbols: [], error: message, durationMs: 0 };
	}

	// The Parser instance is created OUTSIDE the try/finally guard — if
	// `new Parser()` itself throws there is no resource to free yet. The guard
	// starts immediately after creation so a synchronous throw from
	// setLanguage / parse / visitor ALWAYS releases the WASM heap: tree (when
	// produced) and parser are deleted in finally regardless of the throw point.
	const parser = new Parser();
	let tree: Tree | null = null;
	try {
		parser.setLanguage(language);

		const parseStart = Date.now();
		tree = parser.parse(sourceCode, null, {
			progressCallback: (): boolean => {
				return parseTimeoutMs > 0 && Date.now() - parseStart > parseTimeoutMs;
			}
		});
		if (!tree) {
			return { symbols: [], error: "Parse timeout or parser returned null tree", durationMs: 0 };
		}

		const hasErrors = tree.rootNode.hasError;

		const visitor = config.createVisitor();
		const symbols = visitor.extractSymbols(tree, sourceCode);
		const references = (visitor.extractReferences?.(tree, sourceCode) ?? []).map((r) => ({
			...r,
			callerFile: filePath
		}));

		return {
			symbols,
			references,
			error: hasErrors ? TREE_SITTER_PARSE_ERROR : null,
			durationMs: 0
		};
	} finally {
		tree?.delete();
		parser.delete();
	}
}

// ── Message plumbing ──────────────────────────────────────────────────

async function handle(request: ParserWorkerRequest): Promise<ParserWorkerResponse> {
	if (request.op === "warmup") {
		await ensureWasmInitialized();
		return { warmed: true };
	}
	const filePath = request.filePath ?? "";
	const sourceCode = request.sourceCode ?? "";
	const parseTimeoutMs = request.parseTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS;
	return parseFileInWorker(filePath, sourceCode, parseTimeoutMs);
}

const port = parentPort;
if (!port) {
	throw new Error("parser.worker must be started via worker_threads (parentPort is null)");
}

port.on("message", (message: { id: number; payload: ParserWorkerRequest }) => {
	const { id, payload } = message ?? {};
	void (async () => {
		try {
			const result = await handle(payload);
			port.postMessage({ id, ok: true, result });
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			port.postMessage({ id, ok: false, error: { message: error.message, name: error.name, stack: error.stack } });
		}
	})();
});
