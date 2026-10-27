/**
 * GoVisitor — extracts symbols from Go source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_declaration → Function
 * - method_declaration   → Method (signature includes the receiver)
 * - type_spec (struct_type) → Class (field_declaration → Variable, parented to the struct)
 * - type_spec (interface_type) → Interface (method_elem → Method with full signature)
 *  - type_spec (other)    → Type
 *  - const_declaration (const_spec) → Constant (incl. iota blocks)
 *
 * Export convention: names starting with uppercase are exported.
 *
 * Reference emission (TASK-306 / Phase 1.1): delegated to the
 * go-reference-emission.ts helper module — 'import' edges per import_spec
 * binding, 'extends' edges per embedded interface/struct type, and 'call'
 * edges per call_expression. Go has NO declarative implements (structural
 * satisfaction, not statically declared). See that module for the full
 * semantics + verified grammar node mappings.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";
import { walkReferences } from "./go-reference-emission";
export {
	callTargetName,
	embeddedTypeName,
	emitImportEdges,
	emitImportSpec,
	emitInterfaceEmbeds,
	emitStructEmbeds,
	importBindingName,
	walkReferences
} from "./go-reference-emission";

const FUNCTION_DECLARATION = "function_declaration";
const METHOD_DECLARATION = "method_declaration";
const TYPE_DECLARATION = "type_declaration";
const TYPE_SPEC = "type_spec";
const STRUCT_TYPE = "struct_type";
const INTERFACE_TYPE = "interface_type";
const FIELD_DECLARATION = "field_declaration";
const METHOD_ELEM = "method_elem";
const CONST_DECLARATION = "const_declaration";
const CONST_SPEC = "const_spec";
const COMMENT = "comment";

export class GoVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false, false);
		return symbols;
	}

	// ── Reference emission (TASK-306 / Phase 1.1) ─────────────────

	/**
	 * Emit reference edges (TASK-306 / Phase 1.1): imports, interface/struct
	 * embeds ('extends') and call sites. Delegates the walk to
	 * go-reference-emission.ts (extracted in TASK-346) — the helper module
	 * owns the traversal and the verified grammar node mappings.
	 *
	 * `callerName` is the enclosing function/method name (tracked by
	 * descending into function/method declaration bodies) and null for
	 * heritage edges and imports (they belong to a declaration, not a
	 * function — Go imports are package-level only). `targetFile` /
	 * `targetSymbolId` are left null — name-based resolution per ADR-002
	 * happens at query time, not parse time.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		walkReferences(tree.rootNode, null, refs);
		return refs;
	}

	private walkNode(
		node: TSNode,
		symbols: ParsedSymbol[],
		parentName: string | null,
		insideStruct: boolean,
		insideInterface: boolean
	): void {
		// ── Inside struct body: extract fields ──────────────────
		if (insideStruct) {
			if (node.type === FIELD_DECLARATION) {
				// `x, y int` declares multiple names in one node — emit one
				// symbol per name (tree-sitter-go: commaSep1(field('name', ...))).
				const nameNodes = node.childrenForFieldName("name");
				const typeNode = node.childForFieldName("type");
				// Embedded structs (e.g. `*BaseRepo`) have no name field —
				// fall back to the embedded type as the symbol name.
				const names = nameNodes.length > 0 ? nameNodes.map((n) => n.text) : typeNode ? [typeNode.text] : [];
				for (const name of names) {
					symbols.push(this.makeSymbol(node, name, SymbolKind.Variable, parentName));
				}
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true, false);
			}
			return;
		}

		// ── Inside interface body: extract methods ──────────────
		if (insideInterface) {
			if (node.type === METHOD_ELEM) {
				const nameNode = node.childForFieldName("name");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
				}
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, false, true);
			}
			return;
		}

		const type = node.type;

		// ── Function declaration ────────────────────────────────
		if (type === FUNCTION_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
				// Functions can have local type declarations inside
				for (const child of node.namedChildren) {
					this.walkNode(child, symbols, null, false, false);
				}
			}
			return;
		}

		// ── Method declaration ──────────────────────────────────
		if (type === METHOD_DECLARATION) {
			const nameNode = node.childForFieldName("name");
			if (nameNode) {
				symbols.push(
					this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName, this.buildMethodSignature(node))
				);
			}
			return;
		}

		// ── Type declaration (struct, interface, type alias) ────
		if (type === TYPE_DECLARATION) {
			const spec = node.namedChildren.find((c) => c.type === TYPE_SPEC);
			if (!spec) return;

			const nameNode = spec.childForFieldName("name");
			if (!nameNode) return;

			const typeNode = spec.childForFieldName("type");

			if (typeNode?.type === STRUCT_TYPE) {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Class, parentName));
				this.walkNode(typeNode, symbols, nameNode.text, true, false);
			} else if (typeNode?.type === INTERFACE_TYPE) {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Interface, parentName));
				this.walkNode(typeNode, symbols, nameNode.text, false, true);
			} else {
				symbols.push(this.makeSymbol(spec, nameNode.text, SymbolKind.Type, parentName));
			}
			return;
		}

		// ── Const declaration (incl. iota blocks) ───────────────
		if (type === CONST_DECLARATION) {
			for (const child of node.namedChildren) {
				if (child.type === CONST_SPEC) {
					// `const A, B = 1, 2` declares multiple names in one spec —
					// emit one symbol per name.
					const nameNodes = child.childrenForFieldName("name");
					for (const nameNode of nameNodes) {
						symbols.push(this.makeSymbol(child, nameNode.text, SymbolKind.Constant, parentName));
					}
				}
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private makeSymbol(
		node: TSNode,
		name: string,
		kind: SymbolKind,
		parentName: string | null,
		signature?: string
	): ParsedSymbol {
		const exported = name.length > 0 && name[0] !== name[0]!.toLowerCase();

		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: signature ?? this.buildSignature(node),
			docComment: this.extractDocComment(node),
			exported,
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	/**
	 * Build a method signature that includes the receiver:
	 * `(r *Repo) Save(ctx context.Context) error`.
	 * Parameters attach directly to the method name (no space before `(`).
	 */
	private buildMethodSignature(node: TSNode): string {
		const receiver = node.childForFieldName("receiver");
		const name = node.childForFieldName("name");
		const parameters = node.childForFieldName("parameters");
		const result = node.childForFieldName("result");

		const head: string[] = [];
		if (receiver) head.push(receiver.text);
		if (name) {
			head.push(parameters ? `${name.text}${parameters.text}` : name.text);
		} else if (parameters) {
			head.push(parameters.text);
		}
		if (result) head.push(result.text);

		return head.join(" ").replace(/\s+/g, " ").trim();
	}

	private extractDocComment(node: TSNode): string | null {
		// Go doc comments are // line comments (tree-sitter: one COMMENT per
		// line). Aggregate contiguous preceding // lines and canonicalize so
		// // /** ... */ style and @tags round-trip via serializeDocBlock.
		// FIX-465: for `type_spec` the doc lives on its parent
		// `type_declaration` sibling, not on the spec itself (the spec is
		// the only named child of the declaration — no comment siblings).
		// Fall back to the declaration ancestor while KEEPING the
		// function // aggregation from FIX-462 intact.
		let raw = this.collectDocCommentRaw(node);
		if (raw === null && node.type === TYPE_SPEC && node.parent?.type === TYPE_DECLARATION) {
			raw = this.collectDocCommentRaw(node.parent);
		}
		if (raw === null) return null;
		// Plain `/* ... */` (godoc) never sits as a named sibling in this
		// grammar, but if the run looks like a block delimiter, skip it —
		// only // line doc comments are canonical here.
		return serializeDocBlock(raw);
	}

	/** Gather contiguous // COMMENT siblings immediately preceding `node`. */
	private collectDocCommentRaw(node: TSNode): string | null {
		const lines: string[] = [];
		let sibling: TSNode | null = node.previousNamedSibling;
		while (sibling && sibling.type === COMMENT && sibling.text.startsWith("//")) {
			lines.unshift(sibling.text);
			sibling = sibling.previousNamedSibling;
		}
		return lines.length > 0 ? lines.join("\n") : null;
	}
}
