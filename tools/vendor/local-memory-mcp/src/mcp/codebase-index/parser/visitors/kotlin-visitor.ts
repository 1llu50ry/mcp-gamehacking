/**
 * KotlinVisitor — extracts symbols from Kotlin source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_declaration → Function
 * - class_declaration    → Class (interfaces/enums are the same node with an
 *                          anonymous `interface`/`enum` token child — see TASK-131)
 * - interface            → Interface
 * - type_alias           → Type
 * - variable_declaration → Variable
 *
 * Reference emission (call-site + import + heritage edges) lives in
 * kotlin-reference-emission.ts — a pure-helper module this visitor delegates to.
 * See that module for the full node-type → edge-kind mapping (verified empirically
 * against the shipped tree-sitter-kotlin v0.3.8 WASM, NOT guessed).
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";
import { extractKotlinReferences } from "./kotlin-reference-emission";
import { buildFirstLineSignature } from "./visitor-shared";

const FUNCTION_DECLARATION = "function_declaration";
const CLASS_DECLARATION = "class_declaration";
const TYPE_ALIAS = "type_alias";
const VARIABLE_DECLARATION = "variable_declaration";
const CLASS_BODY = "class_body";
const MODIFIERS = "modifiers";
const LINE_COMMENT = "line_comment";
const BLOCK_COMMENT = "block_comment";
const KDOC_COMMENT = "kdoc_comment";
const MULTILINE_COMMENT = "multiline_comment";

export class KotlinVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit call-site references + import and heritage edges (TASK-304 / Phase 1.1)
	 * by delegating to the pure-helper module kotlin-reference-emission.ts. See that
	 * module for the full node-type → edge-kind mapping and per-surface semantics.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		return extractKotlinReferences(tree.rootNode);
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class body: extract methods ──────────────────
		if (insideClass) {
			if (type === FUNCTION_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
				}
				return;
			}
			if (type === CLASS_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier" || c.type === "type_identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
					const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
					if (body) {
						this.walkNode(body, symbols, nameNode.text, true);
					}
				}
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true);
			}
			return;
		}

		// ── Function declaration ────────────────────────────────
		if (type === FUNCTION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Class/Interface declaration (tree-sitter-kotlin uses class_declaration for both) ──
		if (type === CLASS_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier" || c.type === "type_identifier");
			if (nameNode) {
				// TASK-131: tree-sitter-kotlin emits `interface` as a raw (unnamed)
				// token direct child of class_declaration. Scan node.children so
				// preceding modifiers/annotations (e.g. `internal interface Foo`,
				// `@Ann interface Foo`) do not break detection — the old
				// `node.text.startsWith("interface")` check only matched when the
				// `interface` keyword was the very first character of the node.
				const isInterface = node.children.some((c) => c.type === "interface");
				const kind = isInterface ? SymbolKind.Interface : SymbolKind.Class;
				symbols.push(this.makeSymbol(node, nameNode.text, kind, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Type alias ──────────────────────────────────────────
		if (type === TYPE_ALIAS) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Variable declaration ────────────────────────────────
		if (type === VARIABLE_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Variable, parentName));
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private isPublic(node: TSNode): boolean {
		for (const child of node.children) {
			if (child.type === MODIFIERS && child.text.includes("public")) {
				return true;
			}
		}
		return false;
	}

	private makeSymbol(node: TSNode, name: string, kind: SymbolKind, parentName: string | null): ParsedSymbol {
		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: buildFirstLineSignature(node),
			docComment: this.extractDocComment(node),
			exported: this.isPublic(node),
			defaultExport: false,
			parentName
		};
	}

	private extractDocComment(node: TSNode): string | null {
		const prev = node.previousNamedSibling;
		// Shipped tree-sitter-kotlin v0.3.8 emits KDoc /** ... */ as
		// `multiline_comment` (an external — see grammar.js `externals` /
		// `extras`), not `kdoc_comment`. Handle both so a grammar swap stays
		// correct. Keep the /** guard so a plain /* ... */ is not treated as a
		// doc comment.
		if (
			prev &&
			(prev.type === KDOC_COMMENT ||
				prev.type === BLOCK_COMMENT ||
				prev.type === LINE_COMMENT ||
				prev.type === MULTILINE_COMMENT) &&
			prev.text.startsWith("/**")
		) {
			return serializeDocBlock(prev.text);
		}
		return null;
	}
}
