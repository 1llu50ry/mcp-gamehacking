/**
 * Language routing — file extension detection, grammar selection, and
 * language-specific configuration for tree-sitter parsing.
 *
 * Architecture:
 * - Language registry: declarative config per language (extensions, WASM paths,
 *   visitor factory). Adding a new language = adding one entry in createRegistry().
 * - Reverse maps: extension → config (O(1) lookup), grammar path → loaded Language.
 * - The generic catch-all covers every extension not handled by a tree-sitter grammar,
 *   using the GenericTextVisitor (regex-based extraction).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LanguageVisitor } from "./language-visitor";
import { TypeScriptVisitor } from "./typescript-visitor";
import { GoVisitor } from "./visitors/go-visitor";
import { PythonVisitor } from "./visitors/python-visitor";
import { PhpVisitor } from "./visitors/php-visitor";
import { DartVisitor } from "./visitors/dart-visitor";
import { RustVisitor } from "./visitors/rust-visitor";
import { JavaVisitor } from "./visitors/java-visitor";
import { RubyVisitor } from "./visitors/ruby-visitor";
import { KotlinVisitor } from "./visitors/kotlin-visitor";
import { SwiftVisitor } from "./visitors/swift-visitor";
import { CVisitor } from "./visitors/c-visitor";
import { CppVisitor } from "./visitors/cpp-visitor";
import { VueVisitor } from "./visitors/vue-visitor";
import { MarkdownVisitor } from "./markdown-visitor";
import { GenericTextVisitor } from "./generic-visitor";
import { logger } from "../../utils/logger";

// ── Interfaces ────────────────────────────────────────────────────────

/** Configuration for a single language's parser setup. */
export interface LanguageConfig {
	/** Unique identifier for this language entry (e.g. "typescript", "go"). */
	languageId: string;
	/** File extensions this config handles. */
	extensions: string[];
	/** WASM grammar file paths (some languages need multiple, e.g. TS + TSX). */
	grammarWasms: string[];
	/** Factory function to create a new visitor instance. */
	createVisitor: () => LanguageVisitor;
}

// ── Path resolution ──────────────────────────────────────────────────

/**
 * Resolve the project root at runtime.
 *
 * Search order:
 * 1. Walk up from this file's directory looking for `dist/grammars/` (bundled package).
 * 2. Walk up looking for `node_modules` (development / npx cache install).
 */
function resolveProjectRoot(): string {
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	let dir = moduleDir;
	while (dir !== path.parse(dir).root) {
		if (fs.existsSync(path.join(dir, "dist", "grammars"))) {
			return dir;
		}
		if (fs.existsSync(path.join(dir, "node_modules"))) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	throw new Error("Cannot locate project root (dist/grammars or node_modules not found)");
}

/** Path to the web-tree-sitter WASM file. */
export function getWasmPath(): string {
	const root = resolveProjectRoot();

	// First try: bundled WASM in dist/grammars/web-tree-sitter/
	const bundledPath = path.join(root, "dist", "grammars", "web-tree-sitter", "web-tree-sitter.wasm");
	if (fs.existsSync(bundledPath)) return bundledPath;

	// Fallback: node_modules
	return path.join(root, "node_modules", "web-tree-sitter", "web-tree-sitter.wasm");
}

/**
 * Resolve a tree-sitter grammar WASM file path.
 *
 * Search order:
 * 1. Bundled grammar in dist/grammars/<packageName>/<wasmFilename>
 * 2. Direct path in node_modules/<packageName>/<wasmFilename>
 * 3. Alternate path in node_modules/<packageName>/wasm/<wasmFilename>
 *
 * Returns `null` if the grammar WASM is not found — the caller should skip
 * the language entry rather than crash.
 */
export function getGrammarPath(packageName: string, wasmFilename: string): string | null {
	const root = resolveProjectRoot();

	// Try bundled path first (grammars shipped with the package itself)
	const bundledPath = path.join(root, "dist", "grammars", packageName, wasmFilename);
	if (fs.existsSync(bundledPath)) return bundledPath;

	// Fallback to node_modules paths (for local development or if bundled was removed)
	const pkgDir = path.join(root, "node_modules", packageName);
	const directPath = path.join(pkgDir, wasmFilename);
	if (fs.existsSync(directPath)) return directPath;

	const altPath = path.join(pkgDir, "wasm", wasmFilename);
	if (fs.existsSync(altPath)) return altPath;

	logger.warn(`[ParserPool] Grammar WASM not found: ${wasmFilename} (skipping language)`);
	return null;
}

// ── Registry construction ─────────────────────────────────────────────

/**
 * Build the language registry with all supported tree-sitter grammars.
 *
 * Each language entry is wrapped in an IIFE that checks grammar availability
 * and returns null if the WASM file is missing (graceful degradation).
 */
export function createRegistry(): LanguageConfig[] {
	const g = (pkg: string, file: string): string | null => getGrammarPath(pkg, file);

	const entries: (LanguageConfig | null)[] = [
		// TypeScript
		(() => {
			const ts = g("tree-sitter-typescript", "tree-sitter-typescript.wasm");
			if (!ts) return null;
			return {
				languageId: "typescript",
				extensions: [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".svelte", ".astro"],
				grammarWasms: [ts],
				createVisitor: () => new TypeScriptVisitor()
			};
		})(),
		// TSX
		(() => {
			const tsx = g("tree-sitter-typescript", "tree-sitter-tsx.wasm");
			if (!tsx) return null;
			return {
				languageId: "tsx",
				extensions: [".tsx", ".jsx"],
				grammarWasms: [tsx],
				createVisitor: () => new TypeScriptVisitor()
			};
		})(),
		// Vue
		(() => {
			const w = g("tree-sitter-vue", "tree-sitter-vue.wasm");
			if (!w) return null;
			return { languageId: "vue", extensions: [".vue"], grammarWasms: [w], createVisitor: () => new VueVisitor() };
		})(),
		// Go
		(() => {
			const w = g("tree-sitter-go", "tree-sitter-go.wasm");
			if (!w) return null;
			return { languageId: "go", extensions: [".go"], grammarWasms: [w], createVisitor: () => new GoVisitor() };
		})(),
		// Python
		(() => {
			const w = g("tree-sitter-python", "tree-sitter-python.wasm");
			if (!w) return null;
			return {
				languageId: "python",
				extensions: [".py"],
				grammarWasms: [w],
				createVisitor: () => new PythonVisitor()
			};
		})(),
		// PHP
		(() => {
			const w = g("tree-sitter-php", "tree-sitter-php_only.wasm");
			if (!w) return null;
			return { languageId: "php", extensions: [".php"], grammarWasms: [w], createVisitor: () => new PhpVisitor() };
		})(),
		// Dart
		(() => {
			const w = g("tree-sitter-dart", "tree-sitter-dart.wasm");
			if (!w) return null;
			return { languageId: "dart", extensions: [".dart"], grammarWasms: [w], createVisitor: () => new DartVisitor() };
		})(),
		// Rust
		(() => {
			const w = g("tree-sitter-rust", "tree-sitter-rust.wasm");
			if (!w) return null;
			return { languageId: "rust", extensions: [".rs"], grammarWasms: [w], createVisitor: () => new RustVisitor() };
		})(),
		// Java
		(() => {
			const w = g("tree-sitter-java", "tree-sitter-java.wasm");
			if (!w) return null;
			return { languageId: "java", extensions: [".java"], grammarWasms: [w], createVisitor: () => new JavaVisitor() };
		})(),
		// Ruby
		(() => {
			const w = g("tree-sitter-ruby", "tree-sitter-ruby.wasm");
			if (!w) return null;
			return { languageId: "ruby", extensions: [".rb"], grammarWasms: [w], createVisitor: () => new RubyVisitor() };
		})(),
		// Kotlin
		(() => {
			const w = g("tree-sitter-kotlin", "tree-sitter-kotlin.wasm");
			if (!w) return null;
			return {
				languageId: "kotlin",
				extensions: [".kt", ".kts"],
				grammarWasms: [w],
				createVisitor: () => new KotlinVisitor()
			};
		})(),
		// Swift
		(() => {
			const w = g("tree-sitter-swift", "tree-sitter-swift.wasm");
			if (!w) return null;
			return {
				languageId: "swift",
				extensions: [".swift"],
				grammarWasms: [w],
				createVisitor: () => new SwiftVisitor()
			};
		})(),
		// C
		(() => {
			const w = g("tree-sitter-c", "tree-sitter-c.wasm");
			if (!w) return null;
			return { languageId: "c", extensions: [".c", ".h"], grammarWasms: [w], createVisitor: () => new CVisitor() };
		})(),
		// C++
		(() => {
			const w = g("tree-sitter-cpp", "tree-sitter-cpp.wasm");
			if (!w) return null;
			return {
				languageId: "cpp",
				extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
				grammarWasms: [w],
				createVisitor: () => new CppVisitor()
			};
		})(),
		// Markdown (no WASM needed)
		{
			languageId: "markdown",
			extensions: [".md", ".mdx"],
			grammarWasms: [],
			createVisitor: () => new MarkdownVisitor()
		}
	];

	return entries.filter((e): e is LanguageConfig => e !== null);
}

// ── Generic catch-all ────────────────────────────────────────────────

/**
 * Build the catch-all generic config covering every extension not already
 * handled by a tree-sitter grammar.
 *
 * By appending this after all specialist configs, the earlier Map.set() calls
 * take priority in `extToConfig` (first-write-wins), so tree-sitter grammars
 * are never shadowed by the generic fallback.
 */
export function buildGenericCatchAll(registry: LanguageConfig[]): LanguageConfig {
	const handled = new Set<string>();
	for (const config of registry) {
		for (const ext of config.extensions) {
			handled.add(ext);
		}
	}

	const allGenericExtensions = [
		// Web
		".html",
		".htm",
		".xhtml",
		".css",
		".scss",
		".sass",
		".less",
		// Scripting & Backend
		".rb",
		".go",
		".rs",
		".java",
		".kt",
		".kts",
		".scala",
		".cs",
		".fs",
		".swift",
		".zig",
		".erl",
		".ex",
		".exs",
		".clj",
		".dart",
		".lua",
		".pl",
		".pm",
		".t",
		".r",
		".jl",
		// Mobile / Native (non-tree-sitter)
		".m",
		".mm",
		// Templates
		".ejs",
		".hbs",
		".mustache",
		".njk",
		".pug",
		".haml",
		".liquid",
		".twig",
		".razor",
		// Config & Data
		".json",
		".yaml",
		".yml",
		".toml",
		".ini",
		".cfg",
		".conf",
		".xml",
		".svg",
		".plist",
		".xib",
		".storyboard",
		".pbxproj",
		".xcconfig",
		".entitlements",
		".gradle",
		// Shell & Scripts
		".sh",
		".bash",
		".zsh",
		".fish",
		".ps1",
		".bat",
		".cmd",
		// Framework-specific
		".webc",
		".wxp",
		".wxt",
		// Docs
		".tex",
		".bib",
		".rst",
		".asciidoc",
		".adoc",
		// Template engines
		".latte",
		".smarty",
		".tpl",
		// GraphQL
		".graphql",
		".gql",
		// Protocol
		".proto",
		".thrift",
		// Extensionless named files (detected via basename in _doParse).
		// Canonical LOWERCASE tokens only: the basename lookup lowercases the
		// file's basename before the map lookup, so listing both "Dockerfile"
		// and "dockerfile" previously produced a spurious
		// `[ParserPool] Duplicate basename mapping` warning on EVERY pool
		// construction (FIX-030 — ~66 log lines of pure noise).
		"dockerfile",
		"makefile",
		"justfile",
		"containerfile"
	];

	return {
		languageId: "generic",
		extensions: allGenericExtensions.filter((ext) => !handled.has(ext)),
		grammarWasms: [],
		createVisitor: () => new GenericTextVisitor()
	};
}

// ── Map building ──────────────────────────────────────────────────────

/** Mapping result returned by buildRegistryMaps(). */
export interface RegistryMaps {
	/** Extension → LanguageConfig (e.g. ".ts" → config). */
	extToConfig: Map<string, LanguageConfig>;
	/** Canonical lowercase basename → LanguageConfig for extensionless files. */
	basenameToConfig: Map<string, LanguageConfig>;
}

/**
 * Canonical lookup key for an extensionless file: its lowercased basename.
 *
 * The ParserPool resolves an extensionless file (`Dockerfile`, `Makefile`, …)
 * by basename, NOT by full path — every `**`/`Dockerfile` anywhere in the tree
 * maps to the SAME generic config, which is intended. Normalizing through this
 * single helper keeps the registry keys and the runtime lookup identical, so
 * two files sharing a basename across directories can never disagree about
 * their config (FIX-030).
 */
export function extensionlessLookupKey(filePath: string): string {
	return path.basename(filePath).toLowerCase();
}

/**
 * Build the O(1) extension → config and basename → config maps from a registry.
 *
 * The basename map is keyed by the canonical lowercase basename
 * ({@link extensionlessLookupKey}). A registry entry that maps to the SAME
 * config as an existing key is NOT a collision — it is the same language
 * registered twice (e.g. the generic catch-all listing both a display-cased
 * and a lowercase token). Only a genuine conflict (two DIFFERENT configs
 * claiming one basename) is warned, which keeps pool construction quiet
 * (FIX-030 — the spurious `Duplicate basename mapping` noise).
 */
export function buildRegistryMaps(registry: LanguageConfig[]): RegistryMaps {
	const extToConfig = new Map<string, LanguageConfig>();
	const basenameToConfig = new Map<string, LanguageConfig>();

	for (const config of registry) {
		for (const ext of config.extensions) {
			if (ext.startsWith(".")) {
				if (extToConfig.has(ext)) {
					logger.warn(`[ParserPool] Duplicate extension mapping: ${ext}`);
				}
				extToConfig.set(ext, config);
			} else {
				// Extensionless entries (e.g. "Dockerfile", "Makefile") go to the
				// basename map, keyed by canonical lowercase basename.
				const key = extensionlessLookupKey(ext);
				const existing = basenameToConfig.get(key);
				if (existing && existing !== config) {
					logger.warn(`[ParserPool] Duplicate basename mapping: ${key}`);
				}
				basenameToConfig.set(key, config);
			}
		}
	}

	return { extToConfig, basenameToConfig };
}

/**
 * Remove all extension → config mappings that reference a failed WASM path.
 * Called when a grammar fails to load — prevents runtime errors on parse.
 */
export function removeConfigsForWasm(extToConfig: Map<string, LanguageConfig>, wasmPath: string): void {
	for (const [ext, config] of extToConfig.entries()) {
		if (config.grammarWasms.includes(wasmPath)) {
			extToConfig.delete(ext);
		}
	}
}
