/**
 * RustVisitor — extracts symbols from Rust source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_item   → Function
 * - struct_item     → Class
 * - enum_item       → Enum
 * - trait_item      → Interface
 * - type_item       → Type
 * - impl_item       → (container; methods → Method)
 * - const_item      → Constant
 * - static_item     → Constant
 * - use_declaration → Module (pub re-exports only; private `use` is not indexed)
 *
 * Export detection: checks for `visibility_modifier` child containing `pub`.
 * `pub(crate)` / `pub(super)` restricted visibilities are NOT treated as
 * exported (consistent with isExported).
 *
 * Reference emission (TASK-307 / Phase 1.1): delegated to the
 * rust-reference-emission.ts helper module — 'import' edges per use binding,
 * 'implements' edges per trait impl / `#[derive(...)]`, 'extends' edges per
 * supertrait, and 'call' edges per call_expression. See that module for the
 * full semantics + verified grammar node mappings.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";
import { walkReferences } from "./rust-reference-emission";
export {
	callTargetName,
	emitDeriveEdges,
	emitImplHeritage,
	emitTraitBounds,
	emitUseArgument,
	emitUseImports,
	emitUseList,
	pathTargetName,
	pushRef,
	walkReferences
} from "./rust-reference-emission";

const FUNCTION_ITEM = "function_item";
const STRUCT_ITEM = "struct_item";
const ENUM_ITEM = "enum_item";
const TRAIT_ITEM = "trait_item";
const TYPE_ITEM = "type_item";
const IMPL_ITEM = "impl_item";
const CONST_ITEM = "const_item";
const STATIC_ITEM = "static_item";
const USE_DECLARATION = "use_declaration";
const USE_AS_CLAUSE = "use_as_clause";
const SCOPED_IDENTIFIER = "scoped_identifier";
const IDENTIFIER = "identifier";
const SELF = "self";
const SUPER = "super";
const CRATE = "crate";
const COMMENT = "comment";
const LINE_COMMENT = "line_comment";
const BLOCK_COMMENT = "block_comment";
const VISIBILITY_MODIFIER = "visibility_modifier";

export class RustVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit reference edges (TASK-307 / Phase 1.1) — imports, trait-impl
	 * heritage, supertraits, derives and call sites. Delegates the walk to
	 * rust-reference-emission.ts (extracted in TASK-348) — the helper module
	 * owns the traversal and the verified grammar node mappings.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		if (!tree) return refs;
		walkReferences(tree.rootNode, refs, null);
		return refs;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideImpl: boolean): void {
		const type = node.type;

		// ── Inside impl block: extract methods ─────────────────
		if (insideImpl) {
			if (type === FUNCTION_ITEM) {
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

		// ── Function item ───────────────────────────────────────
		if (type === FUNCTION_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
			}
			return;
		}

		// ── Struct item ─────────────────────────────────────────
		if (type === STRUCT_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
			}
			return;
		}

		// ── Enum item ───────────────────────────────────────────
		if (type === ENUM_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
			}
			return;
		}

		// ── Trait item ──────────────────────────────────────────
		if (type === TRAIT_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Interface, parentName));
			}
			return;
		}

		// ── Type item ───────────────────────────────────────────
		if (type === TYPE_ITEM) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Const item ──────────────────────────────────────────
		// Only top-level / module-scope items reach here: function bodies are
		// never walked (the function_item branch returns early) and associated
		// consts inside impl blocks are consumed by the insideImpl branch.
		if (type === CONST_ITEM) {
			const nameNode = node.childForFieldName("name");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Constant, parentName));
			}
			return;
		}

		// ── Static item ─────────────────────────────────────────
		if (type === STATIC_ITEM) {
			const nameNode = node.childForFieldName("name");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Constant, parentName));
			}
			return;
		}

		// ── Use declaration (pub re-exports only) ───────────────
		if (type === USE_DECLARATION) {
			this.extractPubUse(node, symbols, parentName);
			return;
		}

		// ── Impl item: recurse for methods ──────────────────────
		if (type === IMPL_ITEM) {
			let implParent: string | null;
			const forIdx = node.children.findIndex((c) => c.type === "for");
			if (forIdx >= 0) {
				const afterFor = node.namedChildren.find(
					(c) => c.type === "type_identifier" && c.startIndex > node.children[forIdx]!.startIndex
				);
				implParent = afterFor?.text ?? parentName;
			} else {
				const typeId = node.namedChildren.find((c) => c.type === "type_identifier");
				implParent = typeId?.text ?? parentName;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, implParent, true);
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
			if (child.type === VISIBILITY_MODIFIER && child.text === "pub") {
				return true;
			}
		}
		return false;
	}

	/**
	 * Extract a `pub use` re-export as a Module symbol.
	 *
	 * Only declarations with plain `pub` visibility are indexed (matching
	 * isExported). Private `use` statements and restricted visibilities such as
	 * `pub(crate)` / `pub(super)` are skipped.
	 *
	 * Name resolution: `pub use path::to::Name as Alias` uses the `Alias`;
	 * otherwise the name is the final path segment. tree-sitter's
	 * `scoped_identifier` `name` field already yields the last segment, so any
	 * `self::`, `crate::` or leading `::` prefix is inherently stripped.
	 * Grouped (`use a::{b, c}`) and glob (`use a::*`) forms carry no single
	 * name and are not indexed.
	 */
	private extractPubUse(node: TSNode, symbols: ParsedSymbol[], parentName: string | null): void {
		if (!this.isExported(node)) return;
		const arg = node.childForFieldName("argument");
		if (!arg) return;

		let name: string | null = null;
		if (arg.type === USE_AS_CLAUSE) {
			name = arg.childForFieldName("alias")?.text ?? null;
		} else if (arg.type === SCOPED_IDENTIFIER) {
			name = arg.childForFieldName("name")?.text ?? null;
		} else if (arg.type === IDENTIFIER || arg.type === SELF || arg.type === SUPER || arg.type === CRATE) {
			name = arg.text;
		}
		if (!name || name.length === 0) return;

		symbols.push(this.makeSymbol(node, name, SymbolKind.Module, parentName));
	}

	private makeSymbol(node: TSNode, name: string, kind: SymbolKind, parentName: string | null): ParsedSymbol {
		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: this.buildSignature(node),
			docComment: this.extractDocComment(node),
			exported: this.isExported(node),
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	private extractDocComment(node: TSNode): string | null {
		// Rust doc comments are /// and //! line docs (one node per line,
		// so a multi-line block is a run of siblings) plus /** blocks.
		// Aggregate contiguous preceding /// / //! lines, else fall back to
		// a single /** block, and canonicalize.
		const raw = this.collectDocCommentRaw(node);
		if (raw !== null) return serializeDocBlock(raw);
		const prev = node.previousNamedSibling;
		if (prev && (prev.type === COMMENT || prev.type === BLOCK_COMMENT) && prev.text.startsWith("/**")) {
			return serializeDocBlock(prev.text);
		}
		return null;
	}

	/** Aggregate contiguous preceding /// / //! line_comment nodes. */
	private collectDocCommentRaw(node: TSNode): string | null {
		const lines: string[] = [];
		let sibling: TSNode | null = node.previousNamedSibling;
		while (
			sibling &&
			(sibling.type === COMMENT || sibling.type === LINE_COMMENT) &&
			(sibling.text.startsWith("///") || sibling.text.startsWith("//!"))
		) {
			lines.unshift(sibling.text);
			sibling = sibling.previousNamedSibling;
		}
		return lines.length > 0 ? lines.join("\n") : null;
	}
}
