/**
 * CppVisitor reference-emission helpers (TASK-431 refactor).
 *
 * Pure-helper module mirroring the go-reference-emission.ts precedent: functions
 * take (Node, refs) with NO visitor dependencies — CppVisitor only locates the
 * AST root and delegates the reference walk here via `extractCppReferences`.
 *
 * Node types verified EMPIRICALLY against the shipped tree-sitter-cpp WASM:
 * - `preproc_include` → one 'import' edge per include (header path, delimiters
 *   stripped: `"base.h"` → 'base.h', `<sys/stat.h>` → 'sys/stat.h').
 * - `class_specifier` / `struct_specifier` `base_class_clause` → heritage edges:
 *   FIRST base = 'extends', each SUBSEQUENT base = 'implements'
 *   (position-based heuristic — C++ has no interface keyword).
 * - `call_expression` → 'call' edges (LAST segment for member/qualified calls).
 *
 * `callerName` is the enclosing function/method name (resolved by PIERCING
 * declarator wrappers), null for heritage edges and includes. targetFile /
 * targetSymbolId stay null (name-based resolution per ADR-002 at query time).
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference } from "../language-visitor";

const FUNCTION_DEFINITION = "function_definition";
const CLASS_SPECIFIER = "class_specifier";
const STRUCT_SPECIFIER = "struct_specifier";
const PREPROC_INCLUDE = "preproc_include";
const STRING_LITERAL = "string_literal";
const STRING_CONTENT = "string_content";
const SYSTEM_LIB_STRING = "system_lib_string";
const BASE_CLASS_CLAUSE = "base_class_clause";
const ACCESS_SPECIFIER = "access_specifier";
const TYPE_IDENTIFIER = "type_identifier";
const TEMPLATE_TYPE = "template_type";
const CALL_EXPRESSION = "call_expression";
const FIELD_EXPRESSION = "field_expression";
const QUALIFIED_IDENTIFIER = "qualified_identifier";
const IDENTIFIER = "identifier";
const FIELD_IDENTIFIER = "field_identifier";
const FUNCTION_DECLARATOR = "function_declarator";
const ATTRIBUTE_DECLARATION = "attribute_declaration";
const POINTER_DECLARATOR = "pointer_declarator";
const REFERENCE_DECLARATOR = "reference_declarator";
const PARENTHESIZED_DECLARATOR = "parenthesized_declarator";
const PARAMETER_LIST = "parameter_list";
const DESTRUCTOR_NAME = "destructor_name";

/**
 * Emit reference edges (TASK-308 / Phase 1.1), mirroring the GoVisitor /
 * JavaVisitor / PythonVisitor structure. Cheap single AST pass over the
 * reference surfaces of the tree-sitter-cpp grammar — see the module JSDoc for
 * the node-type → edge-kind mapping. `callerName` is the enclosing
 * function/method name (tracked by descending into function_definition bodies)
 * and null for heritage edges and includes. targetFile / targetSymbolId are left
 * null — name-based resolution per ADR-002 happens at query time, not parse time.
 */
export function extractCppReferences(root: TSNode): ParsedReference[] {
	const refs: ParsedReference[] = [];
	walkReferences(root, null, refs);
	return refs;
}

function walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	switch (node.type) {
		// Track the enclosing function/method name for call-site edges,
		// then recurse into the body (identical to the default branch).
		case FUNCTION_DEFINITION: {
			const fnName = functionName(node);
			for (const child of node.namedChildren) {
				walkReferences(child, fnName ?? callerName, refs);
			}
			return;
		}
		// Include edges (TASK-308): one 'import' reference per
		// preproc_include. Do NOT recurse — the path child
		// (string_literal / system_lib_string) is pure name, never a
		// call site.
		case PREPROC_INCLUDE: {
			emitIncludeEdge(node, refs);
			return;
		}
		// Heritage edges (TASK-308): emit 'extends'/'implements' per base
		// class, then recurse (class bodies may hold call sites).
		case CLASS_SPECIFIER:
		case STRUCT_SPECIFIER: {
			emitHeritage(node, refs);
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
		}
		// Call sites (TASK-308, optional — cheap): `helper()`,
		// `obj.method()`, `ns::func()`, `this->update()`.
		case CALL_EXPRESSION: {
			const target = callTargetName(node);
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
				walkReferences(child, callerName, refs);
			}
			return;
		}
		default:
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
	}
}

/**
 * Name of a function/method definition, PIERCING declarator wrappers (verified
 * empirically against the shipped tree-sitter-cpp WASM — the name is not always
 * a direct identifier/field_identifier child of a direct function_declarator):
 *   - plain `void top()`            → function_declarator → 'top';
 *   - out-of-line `void Widget::outline()` → function_declarator →
 *     qualified_identifier → LAST segment 'outline';
 *   - pointer/ref-returning `int *getPtr()` / `int& getRef()` →
 *     pointer_declarator / reference_declarator wrapping the
 *     function_declarator → 'getPtr' / 'getRef';
 *   - destructor `~W()`             → function_declarator →
 *     destructor_name → inner identifier 'W'.
 * Returns null only when no name node is found (e.g. operator definitions).
 */
function functionName(node: TSNode): string | null {
	const declarator = findFunctionDeclarator(node);
	if (!declarator) return null;
	const nameNode = findDeclaratorName(declarator);
	return nameNode ? lastSegmentName(nameNode) : null;
}

/**
 * Locate the function_declarator of a function_definition, descending ONLY
 * through declarator wrappers (`pointer_declarator`, `reference_declarator`,
 * `parenthesized_declarator`). The wrappers are never descended into for names —
 * just pierced to reach the function_declarator. Returns null if none is found.
 */
function findFunctionDeclarator(node: TSNode): TSNode | null {
	for (const child of node.namedChildren) {
		if (child.type === FUNCTION_DECLARATOR) return child;
		if (
			child.type === POINTER_DECLARATOR ||
			child.type === REFERENCE_DECLARATOR ||
			child.type === PARENTHESIZED_DECLARATOR
		) {
			const nested = findFunctionDeclarator(child);
			if (nested) return nested;
		}
	}
	return null;
}

/**
 * Name-bearing node inside a function_declarator: an identifier /
 * field_identifier, a qualified_identifier (out-of-line definitions), or a
 * destructor_name. Pierces nested declarators (parenthesized_declarator /
 * pointer_declarator around the name, e.g. function-pointer shapes) but NEVER
 * descends into the parameter_list — parameter names are identifiers too and
 * must not be mistaken for the function name.
 */
function findDeclaratorName(node: TSNode): TSNode | null {
	if (
		node.type === IDENTIFIER ||
		node.type === FIELD_IDENTIFIER ||
		node.type === QUALIFIED_IDENTIFIER ||
		node.type === DESTRUCTOR_NAME
	) {
		return node;
	}
	for (const child of node.namedChildren) {
		if (child.type === PARAMETER_LIST) continue;
		const name = findDeclaratorName(child);
		if (name) return name;
	}
	return null;
}

/**
 * Emit one 'import' reference edge per preproc_include (TASK-308).
 *
 * Grammar (verified empirically against the shipped tree-sitter-cpp WASM):
 * preproc_include has a `path` field holding a `string_literal`
 * (`#include "base.h"` — a `string_content` child carries the inner text) or a
 * `system_lib_string` (`#include <vector>` — raw text with angle brackets). The
 * referenced symbol is the header path with delimiters stripped — the FULL path
 * (`"utils/math.h"` → 'utils/math.h', `<sys/stat.h>` → 'sys/stat.h'), NOT the
 * last segment: mapping a header to a symbol is out of scope and the include
 * path string is the natural name unit (per the TASK-308 spec; last-segment
 * would mangle 'sys/stat.h' → 'stat.h'). `callerLine` = the include line;
 * `callerName` null (includes are not inside functions).
 */
function emitIncludeEdge(node: TSNode, refs: ParsedReference[]): void {
	const pathNode = node.childForFieldName("path");
	if (!pathNode) return;
	const header = includeHeaderName(pathNode);
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
 * Resolve the include header name from the `path` child of a preproc_include:
 * `string_literal` → its `string_content` ('base.h', 'utils/math.h');
 * `system_lib_string` → inner text with angle brackets stripped ('vector',
 * 'sys/stat.h'); a bare `identifier` (macro form `#include FOO`) → its text.
 * Returns null for unrecognized shapes (no edge emitted).
 */
function includeHeaderName(pathNode: TSNode): string | null {
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
 * Emit heritage edges for a class_specifier / struct_specifier (TASK-308).
 *
 * Grammar (tree-sitter-cpp, verified empirically): the optional
 * `base_class_clause` child holds a FLAT list of base entries (`class Derived :
 * public Base, protected ILeft, virtual IRight`): anonymous `:` / `,` /
 * `virtual` tokens, named `access_specifier` nodes, named `attribute_declaration`
 * nodes (an attribute-specifier on a base-specifier is legal C++ — `class X :
 * [[deprecated]] Base {};`), and named base-type nodes — `type_identifier`
 * (`Base`), `template_type` (`Base<int>` → base is its first named child), or a
 * qualified name (`ns::Base` → LAST segment). The FIRST base (position-based
 * heuristic, Kotlin TASK-304 precedent) → kind 'extends'; each SUBSEQUENT base →
 * 'implements'. `access_specifier` and `attribute_declaration` nodes are skipped
 * and do not count toward the position. `callerLine` = the class/struct
 * declaration line; `callerName` null per the heritage contract.
 */
function emitHeritage(node: TSNode, refs: ParsedReference[]): void {
	const baseClause = node.namedChildren.find((c) => c.type === BASE_CLASS_CLAUSE);
	if (!baseClause) return;
	const line = node.startPosition.row + 1;
	let baseIndex = 0;
	for (const child of baseClause.namedChildren) {
		// Skip non-base entries so they neither emit a spurious edge nor
		// shift the first-base 'extends' position (FIX TASK-350).
		if (child.type === ACCESS_SPECIFIER || child.type === ATTRIBUTE_DECLARATION) continue;
		const target = baseTargetName(child);
		if (!target) continue;
		refs.push({
			symbolName: target,
			callerFile: "",
			callerLine: line,
			callerName: null,
			kind: baseIndex === 0 ? "extends" : "implements"
		});
		baseIndex++;
	}
}

/**
 * Resolve the name-based target of a base-class node (ADR-002 LAST name segment,
 * capped pierce):
 *   - `type_identifier` → 'Base'
 *   - `template_type`   → 'Base'  (Base<int> → first named child)
 *   - qualified name    → LAST segment (ns::Base → 'Base')
 *
 * Returns null for unrecognized shapes (no edge emitted).
 */
function baseTargetName(node: TSNode): string | null {
	let current: TSNode = node;
	for (let depth = 0; depth < 8; depth++) {
		if (current.type === TYPE_IDENTIFIER || current.type === IDENTIFIER) return current.text;
		const inner =
			current.type === TEMPLATE_TYPE
				? current.namedChildren[0]
				: current.namedChildren[current.namedChildren.length - 1];
		if (!inner) return null;
		current = inner;
	}
	return null;
}

/**
 * Read the referenced identifier from a call_expression (TASK-308):
 * - `helper()`     → `function` field identifier → 'helper'.
 * - `obj.method()` / `this->update()` / `a.b.c()` → `function` field
 *   field_expression → LAST segment (field_identifier → 'method' / 'update' /
 *   'c').
 * - `ns::func()` / `X::Y::z()` → `function` field qualified_identifier →
 *   LAST segment (identifier → 'func' / 'z').
 * Returns null for dynamic function expressions (`(*fp)()`,
 * parenthesized_expression) and C-style casts (`int(x)`, primitive_type) which
 * can't be name-indexed.
 */
function callTargetName(node: TSNode): string | null {
	const fn = node.childForFieldName("function");
	if (!fn) return null;
	if (fn.type === IDENTIFIER) return fn.text;
	if (fn.type === FIELD_EXPRESSION || fn.type === QUALIFIED_IDENTIFIER) {
		return lastSegmentName(fn);
	}
	return null;
}

/** LAST name segment of a (possibly nested) member/qualified expression. */
function lastSegmentName(node: TSNode): string | null {
	if (node.type === IDENTIFIER || node.type === FIELD_IDENTIFIER) return node.text;
	const last = node.namedChildren[node.namedChildren.length - 1];
	if (!last) return null;
	return lastSegmentName(last);
}
