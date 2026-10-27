/**
 * SwiftVisitor — extracts symbols from Swift source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_declaration → Function
 * - class_declaration    → Class
 * - struct               → Class (type = Struct)
 * - enum                 → Enum
 * - protocol_declaration → Interface
 * - extension            → Class (type = Extension)
 * - actor                → Class (type = Actor)
 *
 * Export detection: `public` or `open` modifier.
 *
 * Reference emission (call-site + import + heritage edges) lives in
 * swift-reference-emission.ts — a pure-helper module this visitor delegates to.
 * See that module for the full node-type → edge-kind mapping (verified
 * EMPIRICALLY against the shipped tree-sitter-swift WASM, NOT guessed).
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";
import { extractSwiftReferences } from "./swift-reference-emission";
import { buildFirstLineSignature } from "./visitor-shared";

const FUNCTION_DECLARATION = "function_declaration";
const CLASS_DECLARATION = "class_declaration";
const STRUCT_DECLARATION = "struct_declaration";
const ENUM_DECLARATION = "enum_declaration";
const PROTOCOL_DECLARATION = "protocol_declaration";
const EXTENSION_DECLARATION = "extension_declaration";
const ACTOR_DECLARATION = "actor_declaration";
const CLASS_BODY = "class_body";
const MODIFIERS = "modifiers";
const COMMENT = "comment";
const MULTILINE_COMMENT = "multiline_comment";
const TYPE_IDENTIFIER = "type_identifier";

export class SwiftVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit reference edges (TASK-309 / Phase 1.1) by delegating to the
	 * pure-helper module swift-reference-emission.ts. See that module for the full
	 * node-type → edge-kind mapping and per-surface semantics.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		return extractSwiftReferences(tree.rootNode);
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class/struct/enum body: extract methods ──────
		if (insideClass) {
			if (type === FUNCTION_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
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

		// ── Function declaration ────────────────────────────────
		if (type === FUNCTION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Class declaration ───────────────────────────────────
		if (type === CLASS_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Struct ──────────────────────────────────────────────
		if (type === STRUCT_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Enum ────────────────────────────────────────────────
		if (type === ENUM_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Protocol declaration ────────────────────────────────
		if (type === PROTOCOL_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Interface, parentName));
			}
			return;
		}

		// ── Extension ───────────────────────────────────────────
		if (type === EXTENSION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Actor ───────────────────────────────────────────────
		if (type === ACTOR_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === TYPE_IDENTIFIER || c.type === "simple_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private isExported(node: TSNode): boolean {
		for (const child of node.children) {
			if (child.type === MODIFIERS) {
				const text = child.text.trim();
				if (text === "public" || text === "open") {
					return true;
				}
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
			exported: this.isExported(node),
			defaultExport: false,
			parentName
		};
	}

	private extractDocComment(node: TSNode): string | null {
		// Swift uses /// line docs (one COMMENT per line → run of siblings) and
		// /** block doc comments. Aggregate contiguous /// lines, else a single
		// /** block, and canonicalize.
		const raw = this.collectDocCommentRaw(node);
		if (raw !== null) return serializeDocBlock(raw);
		const prev = node.previousNamedSibling;
		if (prev && (prev.type === COMMENT || prev.type === MULTILINE_COMMENT) && prev.text.startsWith("/**")) {
			return serializeDocBlock(prev.text);
		}
		return null;
	}

	/** Aggregate contiguous preceding /// line COMMENT siblings for `node`. */
	private collectDocCommentRaw(node: TSNode): string | null {
		const lines: string[] = [];
		let sibling: TSNode | null = node.previousNamedSibling;
		while (sibling && sibling.type === COMMENT && sibling.text.startsWith("///")) {
			lines.unshift(sibling.text);
			sibling = sibling.previousNamedSibling;
		}
		return lines.length > 0 ? lines.join("\n") : null;
	}
}
