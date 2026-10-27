/**
 * TypeScriptVisitor — extracts symbols from TypeScript/JavaScript source using
 * tree-sitter's AST. Implements the LanguageVisitor interface.
 *
 * Symbol extraction:
 * - Top-level declarations: functions, classes, interfaces, type aliases, enums,
 *   variable/lexical declarations, arrow functions.
 * - Class body: methods + fields (with accessibility modifiers / readonly),
 *   decorated members (@Injectable, @Component, etc.).
 * - Interface body: property signatures → Property, method signatures → Method,
 *   parented to the interface.
 * - Enum members → Constant, parented to the enum.
 * - Generic `type_parameters` are retained in signatures (TASK-059).
 *
 * This file keeps only the visitor's public entry points (extractSymbols /
 * extractReferences); the recursive walkers live in sibling modules
 * (ts-symbol-walker, ts-reference-walker) and symbol construction in
 * ts-symbol-builder (TASK-556 split). Grammar node-type constants and the
 * other standalone helpers live in the parser-level sibling modules
 * (ts-node-types, ts-export-scanner, ts-doc-comment, ts-signature,
 * ts-reference-emission).
 */

import type { Tree as TSTree } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { walkSymbolTree } from "./ts-symbol-walker";
import { walkReferenceTree } from "./ts-reference-walker";

export class TypeScriptVisitor implements LanguageVisitor {
	/** Walk a parsed tree and extract all symbols. */
	extractSymbols(tree: TSTree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];

		walkSymbolTree(root, symbols);

		return symbols;
	}

	/**
	 * Emit call-site references (TASK-236 / issue #64) + heritage edges
	 * (TASK-301 / Phase 1.1) + type-reference edges (TASK-008 / issue #82).
	 *
	 * The walker lives in ts-reference-walker; see its JSDoc for the full
	 * node-type dispatch and callerName-threading semantics.
	 */
	extractReferences(tree: TSTree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		walkReferenceTree(tree.rootNode, refs);
		return refs;
	}
}
