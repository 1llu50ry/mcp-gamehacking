/**
 * LanguageVisitor — abstract interface for language-specific parsers.
 *
 * Each language implementation traverses its tree-sitter AST and extracts
 * structured symbol information (functions, classes, interfaces, etc.).
 */

import type { Tree } from "web-tree-sitter";

/**
 * Coarse taxonomy of a reference edge (call-site, heritage, or type-only).
 * 'call' | 'instantiation' | 'import' are runtime/structural edges (TASK-236);
 * 'extends' | 'implements' are heritage edges (Phase 1.1, TASK-301); 'type'
 * (issue #82, v26) is a type-only dependency edge (parameter/return/property/
 * alias/generic/union/intersection usage) distinguished by an optional `role`.
 * 'reexport' (issue #87, TASK-013) is an `export { X } from './mod'` /
 * `export * from './mod'` edge — reuses ImportInfo metadata for resolution.
 */
export type ReferenceKind = "call" | "instantiation" | "import" | "extends" | "implements" | "type" | "reexport";

/** Relation role of a 'type' reference edge (issue #82). Null = no role. */
export type ReferenceRole =
	| "parameter"
	| "return"
	| "property"
	| "field"
	| "alias"
	| "generic"
	| "constraint"
	| "union"
	| "intersection"
	| null;

/**
 * Import form of an 'import' / 'reexport' reference edge (#83/#87):
 * 'default' | 'named' | 'namespace' | 'side-effect' | 'wildcard'.
 */
export type ImportKind = "default" | "named" | "namespace" | "side-effect" | "wildcard" | null;

/**
 * Import metadata for an 'import' reference edge (issue #83) — persisted by
 * the parse pipeline onto the v27 columns and surfaced by TRACE. `importedName`
 * is null only for side-effect imports (`import 'x'`); `localName` is the
 * LOCAL binding name (`import { User as DomainUser }` → 'DomainUser').
 */
export interface ImportInfo {
	localName: string;
	importedName: string | null;
	moduleSpecifier: string | null;
	importKind: ImportKind;
}

/**
 * A single reference edge emitted by a language visitor — two families:
 *
 *   1. Call-site edges (existing): `symbolName` is the referenced symbol (the
 *      called identifier, constructed class, or imported binding); `callerLine`
 *      is the 1-based start line of the call site; `callerName` is the
 *      enclosing function/method name when determinable (else null).
 *   2. Heritage edges (Wave 1, kinds 'extends' | 'implements'): `symbolName`
 *      is the referenced base class / implemented interface; `callerLine` is
 *      the derived type's declaration line; `callerName` is null.
 *
 * The parser pool fills `callerFile` from the file being parsed (visitors emit
 * references without it). `targetFile` / `targetSymbolId` locate the referenced
 * symbol when resolvable at parse time (name-based resolution per ADR-002 — no
 * LSP); both default to null for unresolved names.
 */
export interface ParsedReference {
	symbolName: string;
	/** File containing the call / heritage site — filled by the parser pool. */
	callerFile: string;
	/** Call-site / heritage-site line, 1-based. */
	callerLine: number;
	/** Enclosing function/method name, when determinable. */
	callerName: string | null;
	kind: ReferenceKind;
	/** File path of the referenced symbol when resolvable at parse time. */
	targetFile?: string | null;
	/** codebase_symbols(id) of the referenced symbol when resolvable. */
	targetSymbolId?: string | null;
	/** Relation role for 'type' edges (issue #82, v26) — null/absent otherwise. */
	role?: ReferenceRole;
	/**
	 * Import metadata for 'import' edges (issue #83, v27): local/imported
	 * names + module specifier + import form. Absent for non-import kinds.
	 */
	importInfo?: ImportInfo;
}

/** Classification of a parsed symbol. */
export enum SymbolKind {
	Function = "function",
	Class = "class",
	Interface = "interface",
	Type = "type",
	Enum = "enum",
	Variable = "variable",
	Method = "method",
	Property = "property",
	/** Class constant or top-level constant (PHP `const`, `define`, etc.). */
	Constant = "constant",
	/** Namespace import / module reference (PHP `use Foo\Bar;`, Python `import`, etc.). */
	Module = "module",
	/** Markdown H1 heading. */
	Heading1 = "heading1",
	/** Markdown H2 heading. */
	Heading2 = "heading2",
	/** Markdown H3–H6 heading. */
	Heading = "heading",
	/** Markdown fenced code block. */
	CodeBlock = "code_block",
	/** Route declaration (generic regex visitor). */
	Route = "route",
	/** Config key-value pair (generic regex visitor). */
	Key = "key"
}

/** A parsed symbol extracted from source code. */
export interface ParsedSymbol {
	/** Human-readable identifier (e.g. "fetchUser"). */
	name: string;
	/** Classification of the symbol. */
	kind: SymbolKind;
	/** 1-based start line. */
	startLine: number;
	/** 1-based start column. */
	startCol: number;
	/** 1-based end line. */
	endLine: number;
	/** 1-based end column. */
	endCol: number;
	/** Human-readable signature (first line of the declaration or type annotation). */
	signature: string;
	/** JSDoc-style doc comment text (null if none). */
	docComment: string | null;
	/** Whether the symbol is exported. */
	exported: boolean;
	/** Whether the symbol is a default export. */
	defaultExport: boolean;
	/** Name of the enclosing symbol (class name for methods, null for top-level). */
	parentName: string | null;
}

/** Contract that every language parser must implement. */
export interface LanguageVisitor {
	/**
	 * Extract symbols from a pre-parsed tree-sitter AST.
	 * For non-tree-sitter visitors (e.g. markdown), the tree is unused and may be null.
	 */
	extractSymbols(tree: Tree | null, sourceCode: string): ParsedSymbol[];

	/**
	 * OPTIONAL — emit reference edges (call-site + heritage) for the parsed tree.
	 *
	 * Additive passthrough added in TASK-236 (#64) so language visitors can
	 * index calls/instantiations/imports WITHOUT breaking existing visitors
	 * that only implement `extractSymbols`. Phase 1.1 (TASK-299) generalized
	 * the contract to BOTH edge families: call/instantiation/import (existing)
	 * plus heritage edges 'extends' | 'implements', with optional
	 * targetFile/targetSymbolId for resolvable targets. Implementers return
	 * references without `callerFile` (the pool fills it); absent references
	 * resolve to `[]`. All tree-sitter language visitors implement it since
	 * Phase 1.1 (TS/TSX, Vue, Go, Python, PHP, Dart, Rust, Java, Ruby, Kotlin,
	 * Swift, C, C++ — 14 configs / 13 visitor classes); only Markdown and
	 * GenericText emit no edges (return `[]`).
	 */
	extractReferences?(tree: Tree | null, sourceCode: string): ParsedReference[];
}

/** Result of a single parse operation. */
export interface ParseResult {
	/** Symbols extracted from the file. */
	symbols: ParsedSymbol[];
	/** Call-site references extracted from the file (empty when none / visitor lacks support). */
	references?: ParsedReference[];
	/** Error message if parsing failed, null on success. */
	error: string | null;
	/** Wall-clock duration of the parse in milliseconds. */
	durationMs: number;
}

/** Manages the lifecycle of tree-sitter WASM parsers. */
export interface ParserPool {
	/** Lazy-init: loads WASM and creates parser on first call. */
	initialize(): Promise<void>;

	/** Whether the pool has been initialized. */
	isInitialized(): boolean;

	/** Parse a single file, returning extracted symbols. */
	parseFile(filePath: string, sourceCode: string): Promise<ParseResult>;
}
