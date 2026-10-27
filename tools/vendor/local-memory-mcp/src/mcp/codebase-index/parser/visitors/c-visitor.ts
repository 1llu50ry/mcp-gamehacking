/**
 * CVisitor — extracts symbols from C source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_definition → Function
 * - struct_specifier    → Class (type = Struct)
 * - enum_specifier      → Enum
 * - type_definition     → Type
 *
 * C has no visibility modifiers — all top-level symbols are accessible (exported = true).
 *
 * Reference emission (TASK-308 / Phase 1.1) — node types verified EMPIRICALLY
 * against the shipped tree-sitter-c WASM (NOT guessed):
 * - `preproc_include` (field `path` = `string_literal` for `"local.h"` —
 *   with a `string_content` child — or `system_lib_string` for `<stdio.h>`)
 *   → one 'import' edge per include; the symbol name is the header path with
 *   delimiters stripped (`"local.h"` → 'local.h', `<sys/stat.h>` →
 *   'sys/stat.h'). Mapping a header to a symbol is out of scope — the name
 *   is the include path string itself (per the TASK-308 spec).
 * - `call_expression` → 'call' edges: `helper()` → 'helper' (identifier),
 *   `obj.method()` / `p->save()` → LAST segment (field_expression).
 *
 * C has NO classes/structs with heritage (verified: `struct S { ... }` has
 * no base_class_clause) — includes + calls only.
 *
 * The enclosing function name (call-site `callerName`) is resolved by
 * PIERCING declarator wrappers, verified empirically against the shipped
 * tree-sitter-c WASM: the name is NOT always a direct identifier child of the
 * direct function_declarator — pointer/reference-returning functions
 * (`int *getPtr()`, `int& getRef()`) nest the function_declarator inside a
 * `pointer_declarator` / `reference_declarator`, so the naive direct-child
 * lookup returned null and dropped caller attribution for the whole body.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";

const FUNCTION_DEFINITION = "function_definition";
const STRUCT_SPECIFIER = "struct_specifier";
const ENUM_SPECIFIER = "enum_specifier";
const TYPE_DEFINITION = "type_definition";
const FIELD_DECLARATION = "field_declaration";
const COMMENT = "comment";

// Reference-emission node types (TASK-308 / Phase 1.1).
const PREPROC_INCLUDE = "preproc_include";
const STRING_LITERAL = "string_literal";
const STRING_CONTENT = "string_content";
const SYSTEM_LIB_STRING = "system_lib_string";
const CALL_EXPRESSION = "call_expression";
const FIELD_EXPRESSION = "field_expression";
const QUALIFIED_IDENTIFIER = "qualified_identifier";
const IDENTIFIER = "identifier";
const FIELD_IDENTIFIER = "field_identifier";
const FUNCTION_DECLARATOR = "function_declarator";
const POINTER_DECLARATOR = "pointer_declarator";
const REFERENCE_DECLARATOR = "reference_declarator";
const PARENTHESIZED_DECLARATOR = "parenthesized_declarator";
const PARAMETER_LIST = "parameter_list";

export class CVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	// ── Reference emission (TASK-308 / Phase 1.1) ─────────────────

	/**
	 * Emit reference edges (TASK-308 / Phase 1.1), mirroring the GoVisitor /
	 * JavaVisitor / PythonVisitor structure.
	 *
	 * Cheap single AST pass over the reference surfaces of the tree-sitter-c
	 * grammar:
	 * - `preproc_include` → kind 'import' — one edge per include; the symbol
	 *   name is the header path with delimiters stripped (`"local.h"` →
	 *   'local.h', `<sys/stat.h>` → 'sys/stat.h'). Mapping header→symbol is
	 *   out of scope — the include path string is the name (TASK-308 spec).
	 * - `call_expression` → kind 'call' (`helper()`, `obj.method()`,
	 *   `p->save()` — LAST segment for member calls).
	 *
	 * C has NO classes/structs with heritage (verified: `struct S { ... }`
	 * has no base_class_clause) — includes + calls only.
	 *
	 * `callerName` is the enclosing function name (tracked by descending
	 * into function_definition bodies) and null for includes (they belong to
	 * a translation unit, not a function). `targetFile` / `targetSymbolId`
	 * are left null — name-based resolution per ADR-002 happens at query
	 * time, not parse time.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		this.walkReferences(tree.rootNode, null, refs);
		return refs;
	}

	private walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
		switch (node.type) {
			// Track the enclosing function name for call-site edges, then
			// recurse into the body (identical to the default branch).
			case FUNCTION_DEFINITION: {
				const fnName = this.functionName(node);
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			// Include edges (TASK-308): one 'import' reference per
			// preproc_include. Do NOT recurse — the path child
			// (string_literal / system_lib_string) is pure name, never a
			// call site.
			case PREPROC_INCLUDE: {
				this.emitIncludeEdge(node, refs);
				return;
			}
			// Call sites (TASK-308, optional — cheap): `helper()`,
			// `obj.method()`, `p->save()`.
			case CALL_EXPRESSION: {
				const target = this.callTargetName(node);
				if (target) {
					refs.push({
						symbolName: target,
						callerFile: "",
						callerLine: node.startPosition.row + 1,
						callerName,
						kind: "call"
					});
				}
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			default:
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
		}
	}

	/**
	 * Name of a function definition, PIERCING declarator wrappers (verified
	 * empirically against the shipped tree-sitter-c WASM — the name is not
	 * always a direct identifier child of a direct function_declarator):
	 *   - plain `void top()` → function_declarator → 'top';
	 *   - pointer/ref-returning `int *getPtr()` / `int& getRef()` →
	 *     pointer_declarator / reference_declarator wrapping the
	 *     function_declarator → 'getPtr' / 'getRef'.
	 * Returns null only when no name node is found (same as before the
	 * pierce — the previous direct-child lookup returned null for these
	 * shapes, dropping caller attribution for the whole body).
	 */
	private functionName(node: TSNode): string | null {
		const declarator = this.findFunctionDeclarator(node);
		if (!declarator) return null;
		const nameNode = this.findDeclaratorName(declarator);
		return nameNode ? this.lastSegmentName(nameNode) : null;
	}

	/**
	 * Locate the function_declarator of a function_definition, descending
	 * ONLY through declarator wrappers (`pointer_declarator`,
	 * `reference_declarator`, `parenthesized_declarator`). The wrappers are
	 * never descended into for names — just pierced to reach the
	 * function_declarator. Returns null if none is found.
	 */
	private findFunctionDeclarator(node: TSNode): TSNode | null {
		for (const child of node.namedChildren) {
			if (child.type === FUNCTION_DECLARATOR) return child;
			if (
				child.type === POINTER_DECLARATOR ||
				child.type === REFERENCE_DECLARATOR ||
				child.type === PARENTHESIZED_DECLARATOR
			) {
				const nested = this.findFunctionDeclarator(child);
				if (nested) return nested;
			}
		}
		return null;
	}

	/**
	 * Name-bearing node inside a function_declarator: an
	 * identifier / field_identifier / qualified_identifier. Pierces nested
	 * declarators (parenthesized_declarator / pointer_declarator around the
	 * name, e.g. function-pointer shapes) but NEVER descends into the
	 * parameter_list — parameter names are identifiers too and must not be
	 * mistaken for the function name.
	 */
	private findDeclaratorName(node: TSNode): TSNode | null {
		if (node.type === IDENTIFIER || node.type === FIELD_IDENTIFIER || node.type === QUALIFIED_IDENTIFIER) {
			return node;
		}
		for (const child of node.namedChildren) {
			if (child.type === PARAMETER_LIST) continue;
			const name = this.findDeclaratorName(child);
			if (name) return name;
		}
		return null;
	}

	/**
	 * Emit one 'import' reference edge per preproc_include (TASK-308).
	 *
	 * Grammar (verified empirically against the shipped tree-sitter-c WASM):
	 * preproc_include has a `path` field holding a `string_literal`
	 * (`#include "local.h"` — a `string_content` child carries the inner
	 * text) or a `system_lib_string` (`#include <stdio.h>` — raw text with
	 * angle brackets). The referenced symbol is the header path with
	 * delimiters stripped — the FULL path (`"utils/math.h"` →
	 * 'utils/math.h', `<sys/stat.h>` → 'sys/stat.h'), NOT the last segment:
	 * mapping a header to a symbol is out of scope and the include path
	 * string is the natural name unit (per the TASK-308 spec; last-segment
	 * would mangle 'sys/stat.h' → 'stat.h'). `callerLine` = the include
	 * line; `callerName` null (includes are not inside functions).
	 */
	private emitIncludeEdge(node: TSNode, refs: ParsedReference[]): void {
		const pathNode = node.childForFieldName("path");
		if (!pathNode) return;
		const header = this.includeHeaderName(pathNode);
		if (!header) return;
		refs.push({
			symbolName: header,
			callerFile: "",
			callerLine: node.startPosition.row + 1,
			callerName: null,
			kind: "import"
		});
	}

	/**
	 * Resolve the include header name from the `path` child of a
	 * preproc_include: `string_literal` → its `string_content`
	 * ('local.h', 'utils/math.h'); `system_lib_string` → inner text with
	 * angle brackets stripped ('stdio.h', 'sys/stat.h'); a bare `identifier`
	 * (macro form `#include FOO`) → its text. Returns null for unrecognized
	 * shapes (no edge emitted).
	 */
	private includeHeaderName(pathNode: TSNode): string | null {
		if (pathNode.type === STRING_LITERAL) {
			const content = pathNode.namedChildren.find((c) => c.type === STRING_CONTENT);
			if (content) return content.text;
			const text = pathNode.text;
			return text.length >= 2 ? text.slice(1, -1) : null;
		}
		if (pathNode.type === SYSTEM_LIB_STRING) {
			const text = pathNode.text;
			return text.length >= 2 ? text.slice(1, -1) : null;
		}
		if (pathNode.type === IDENTIFIER) return pathNode.text;
		return null;
	}

	/**
	 * Read the referenced identifier from a call_expression (TASK-308):
	 * - `helper()`     → `function` field identifier → 'helper'.
	 * - `obj.method()` / `p->save()` / `a.b.c()` → `function` field
	 *   field_expression → LAST segment (field_identifier → 'method' /
	 *   'save' / 'c').
	 * Returns null for dynamic function expressions (`(*fp)()`,
	 * parenthesized_expression) which can't be name-indexed.
	 */
	private callTargetName(node: TSNode): string | null {
		const fn = node.childForFieldName("function");
		if (!fn) return null;
		if (fn.type === IDENTIFIER) return fn.text;
		if (fn.type === FIELD_EXPRESSION || fn.type === QUALIFIED_IDENTIFIER) {
			return this.lastSegmentName(fn);
		}
		return null;
	}

	/** LAST name segment of a (possibly nested) member expression. */
	private lastSegmentName(node: TSNode): string | null {
		if (node.type === IDENTIFIER || node.type === FIELD_IDENTIFIER) return node.text;
		const last = node.namedChildren[node.namedChildren.length - 1];
		if (!last) return null;
		return this.lastSegmentName(last);
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideStruct: boolean): void {
		const type = node.type;

		// ── Inside struct: extract field declarations ───────────
		if (insideStruct) {
			if (type === FIELD_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "field_identifier" || c.type === "identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Property, parentName));
				}
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true);
			}
			return;
		}

		// ── Function definition ─────────────────────────────────
		if (type === FUNCTION_DEFINITION) {
			const declarator = node.namedChildren.find((c) => c.type === "function_declarator");
			if (declarator) {
				const nameNode = declarator.namedChildren.find((c) => c.type === "identifier" || c.type === "field_identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName));
				}
			}
			return;
		}

		// ── Struct specifier ────────────────────────────────────
		if (type === STRUCT_SPECIFIER) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				// Recurse for fields
				const body = node.namedChildren.find((c) => c.type === "field_declaration_list");
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Enum specifier ──────────────────────────────────────
		if (type === ENUM_SPECIFIER) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
			}
			return;
		}

		// ── Type definition ─────────────────────────────────────
		if (type === TYPE_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === "type_identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Type, parentName));
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
			signature: this.buildSignature(node),
			docComment: this.extractDocComment(node),
			exported: true,
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	private extractDocComment(node: TSNode): string | null {
		const prev = node.previousNamedSibling;
		if (prev && prev.type === COMMENT && prev.text.startsWith("/**")) {
			return serializeDocBlock(prev.text);
		}
		return null;
	}
}
