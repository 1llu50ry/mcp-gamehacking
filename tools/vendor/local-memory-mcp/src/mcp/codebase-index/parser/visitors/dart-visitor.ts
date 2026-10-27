/**
 * DartVisitor — extracts symbols and reference edges from Dart source code
 * using tree-sitter's AST.
 *
 * Symbol node type mappings:
 * - class_definition             → Class
 * - enum_declaration             → Enum
 * - function_declaration / function_signature → Function (top-level)
 * - method_signature                           → Method
 * - constructor_signature        → Method (special)
 * - extension_declaration        → Class
 * - type_alias                   → Type
 * - initialized_variable_definition → Variable
 *
 * Reference emission (TASK-311 / Phase 1.1) is delegated to
 * dart-reference-emission.ts (TASK-557 split) — a pure-helper module holding
 * the verified grammar node mappings, the import/heritage/call emitters and
 * the caller-tracking walk. See that module for the full semantics + the
 * empirically-verified node-type notes.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";
import { walkDartReferences } from "./dart-reference-emission";
import { buildFirstLineSignature } from "./visitor-shared";

const CLASS_DEFINITION = "class_definition";
const ENUM_DECLARATION = "enum_declaration";
const FUNCTION_SIGNATURE = "function_signature";
const FUNCTION_DECLARATION = "function_declaration";
const METHOD_SIGNATURE = "method_signature";
const CONSTRUCTOR_SIGNATURE = "constructor_signature";
const EXTENSION_DECLARATION = "extension_declaration";
const TYPE_ALIAS = "type_alias";
const INITIALIZED_VARIABLE_DEFINITION = "initialized_variable_definition";
const CLASS_BODY = "class_body";
const ENUM_BODY = "enum_body";
const DOCUMENTATION_COMMENT = "documentation_comment";

export class DartVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit reference edges (TASK-311 / Phase 1.1) — library-import edges,
	 * class/mixin heritage (extends / implements / with) and call sites.
	 * The walk lives in dart-reference-emission.ts (TASK-557 split); see its
	 * header JSDoc for the verified grammar node mappings and edge-kind
	 * decisions.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		if (!tree) return refs;
		walkDartReferences(tree.rootNode, refs, null);
		return refs;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class/enum body: extract methods ─────────────
		if (insideClass) {
			if (type === METHOD_SIGNATURE || type === CONSTRUCTOR_SIGNATURE) {
				const nameNode = node.namedChildren.find((c) => c.type === "identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
				}
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true);
			}
			return;
		}

		// ── Class definition ────────────────────────────────────
		if (type === CLASS_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Enum declaration ────────────────────────────────────
		if (type === ENUM_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
				const body = node.namedChildren.find((c) => c.type === ENUM_BODY || c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Top-level function ──────────────────────────────────
		if (type === FUNCTION_DECLARATION || type === FUNCTION_SIGNATURE) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Extension declaration ───────────────────────────────
		if (type === EXTENSION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
			}
			return;
		}

		// ── Type alias ──────────────────────────────────────────
		if (type === TYPE_ALIAS) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Initialized variable definition (top-level) ─────────
		if (type === INITIALIZED_VARIABLE_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
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
			exported: false,
			defaultExport: false,
			parentName
		};
	}

	private extractDocComment(node: TSNode): string | null {
		// Dart uses /// line doc comments and /** blocks — tree-sitter-dart
		// emits BOTH as `documentation_comment` (NOT `comment`), verified
		// against the shipped dist/grammars WASM. Plain `comment` (//, /* */)
		// is not a doc comment. TASK-462 routing kept, FIX-464 node-type fix.
		const raw = this.collectDocCommentRaw(node);
		if (raw !== null) return serializeDocBlock(raw);
		const prev = node.previousNamedSibling;
		if (prev && prev.type === DOCUMENTATION_COMMENT && prev.text.startsWith("/**")) {
			return serializeDocBlock(prev.text);
		}
		return null;
	}

	/** Gather the contiguous run of /// `documentation_comment` siblings that
	 *  immediately precede `node` (walking backwards), in source order.
	 *  Returns null when no doc-comment run is adjacent. */
	private collectDocCommentRaw(node: TSNode): string | null {
		const lines: string[] = [];
		let sibling: TSNode | null = node.previousNamedSibling;
		while (sibling && sibling.type === DOCUMENTATION_COMMENT && sibling.text.startsWith("///")) {
			lines.unshift(sibling.text);
			sibling = sibling.previousNamedSibling;
		}
		return lines.length > 0 ? lines.join("\n") : null;
	}
}
