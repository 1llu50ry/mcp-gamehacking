/**
 * KotlinVisitor reference-emission helpers (TASK-431 refactor).
 *
 * Pure-helper module mirroring the go-reference-emission.ts precedent: functions
 * take (Node, refs) with NO visitor dependencies — KotlinVisitor only locates the
 * AST root and delegates the reference walk here via `extractKotlinReferences`.
 *
 * Node types verified empirically against the shipped tree-sitter-kotlin v0.3.8
 * WASM:
 * - `import_list` → `import_header` children → 'import' edges per binding (alias
 *   wins, else LAST segment; wildcard imports emit nothing).
 * - `delegation_specifier` DIRECT children of class_declaration /
 *   object_declaration / companion_object → 'extends'/'implements' edges.
 * - `type_parameters` → `type_parameter` bounds + `type_constraints` (where
 *   clause) → 'extends' edges.
 * - `call_expression` → 'call' edges (enclosing function as callerName).
 *
 * `callerName` is the enclosing function/method name, null for heritage edges and
 * imports. targetFile / targetSymbolId stay null (name-based resolution per
 * ADR-002 at query time).
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference } from "../language-visitor";

const FUNCTION_DECLARATION = "function_declaration";
const CLASS_DECLARATION = "class_declaration";
const OBJECT_DECLARATION = "object_declaration";
const COMPANION_OBJECT = "companion_object";
const IMPORT_LIST = "import_list";
const IMPORT_HEADER = "import_header";
const IMPORT_ALIAS = "import_alias";
const WILDCARD_IMPORT = "wildcard_import";
const IDENTIFIER = "identifier";
const SIMPLE_IDENTIFIER = "simple_identifier";
const DELEGATION_SPECIFIER = "delegation_specifier";
const CONSTRUCTOR_INVOCATION = "constructor_invocation";
const EXPLICIT_DELEGATION = "explicit_delegation";
const USER_TYPE = "user_type";
const TYPE_IDENTIFIER = "type_identifier";
const TYPE_PARAMETERS = "type_parameters";
const TYPE_PARAMETER = "type_parameter";
const TYPE_CONSTRAINTS = "type_constraints";
const TYPE_CONSTRAINT = "type_constraint";
const CALL_EXPRESSION = "call_expression";
const NAVIGATION_EXPRESSION = "navigation_expression";
const NAVIGATION_SUFFIX = "navigation_suffix";

/**
 * Emit call-site references + import and heritage edges (TASK-304 / Phase 1.1),
 * mirroring the PhpVisitor / TypeScriptVisitor structure. Cheap single AST pass
 * over the obvious reference surfaces in the tree-sitter-kotlin grammar. See the
 * module JSDoc for the node-type → edge-kind mapping. `callerName` is the
 * enclosing function/method name, tracked by descending into function_declaration
 * bodies, and null for heritage edges and imports. targetFile / targetSymbolId
 * stay null — name-based resolution per ADR-002 happens at query time.
 */
export function extractKotlinReferences(root: TSNode): ParsedReference[] {
	const refs: ParsedReference[] = [];
	walkReferences(root, null, refs);
	return refs;
}

function walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	switch (node.type) {
		// Track the enclosing function/method name for call-site edges,
		// then recurse into the body (identical to the default branch).
		case FUNCTION_DECLARATION: {
			const nameNode = node.namedChildren.find((c) => c.type === SIMPLE_IDENTIFIER);
			const fnName = nameNode ? nameNode.text : null;
			for (const child of node.namedChildren) {
				walkReferences(child, fnName ?? callerName, refs);
			}
			return;
		}
		// Import edges (TASK-304): one 'import' reference per import_header
		// binding. Do NOT recurse — import children are pure names, never
		// call sites (mirrors the TS/PHP import emission surface).
		case IMPORT_LIST: {
			emitImportEdges(node, refs);
			return;
		}
		// Heritage edges: emit 'extends'/'implements' for the declaration's
		// supertypes + generic bounds, then recurse into the body so
		// call-site refs inside members still emit (purely additive).
		case CLASS_DECLARATION: {
			emitHeritage(node, refs);
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
		}
		// Objects/companions can only implement interfaces in Kotlin, so
		// every supertype is an 'implements' edge.
		case OBJECT_DECLARATION:
		case COMPANION_OBJECT: {
			emitObjectHeritage(node, refs);
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
		}
		case CALL_EXPRESSION: {
			const called = callTargetName(node);
			if (called) {
				refs.push({
					symbolName: called,
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
 * Emit one 'import' reference edge per binding in an `import_list` (TASK-304 /
 * Phase 1.1).
 *
 * Grammar (verified empirically against the shipped tree-sitter-kotlin v0.3.8
 * WASM): the import_list holds one `import_header` per import statement. Each
 * header wraps an `identifier` chain of `simple_identifier` segments (`import
 * foo.bar.Baz` → foo, bar, Baz), an optional `import_alias` (`import foo.bar.Qux
 * as Quux` → alias node wrapping a `type_identifier`), and an optional
 * `wildcard_import` (`import a.b.*`).
 *
 * The referenced symbol is the LOCAL BINDING per Kotlin semantics — the `as` alias
 * when present (`as Quux` → 'Quux'), otherwise the LAST name segment
 * (`foo.bar.Baz` → 'Baz'), matching ADR-002 last-segment, name-based
 * resolution. `callerLine` is the import statement line; `callerName` is null
 * (Kotlin imports are top-level).
 */
function emitImportEdges(node: TSNode, refs: ParsedReference[]): void {
	for (const header of node.namedChildren) {
		if (header.type !== IMPORT_HEADER) continue;
		const binding = importBindingName(header);
		if (!binding) continue;
		refs.push({
			symbolName: binding,
			callerFile: "",
			callerLine: header.startPosition.row + 1,
			callerName: null,
			kind: "import"
		});
	}
}

/**
 * Resolve the local binding name of an import_header: the `as` alias when
 * present (`import foo.Bar as Baz` → 'Baz'), otherwise the LAST name segment of
 * the imported name (`import foo.bar.Baz` → 'Baz'). Returns null for wildcard
 * imports (`import a.b.*` → no binding) and unparsed headers.
 */
function importBindingName(header: TSNode): string | null {
	if (header.namedChildren.some((c) => c.type === WILDCARD_IMPORT)) return null;
	const aliasNode = header.namedChildren.find((c) => c.type === IMPORT_ALIAS);
	if (aliasNode) {
		const aliasId = aliasNode.namedChildren.find((c) => c.type === TYPE_IDENTIFIER);
		if (aliasId) return aliasId.text;
	}
	const identNode = header.namedChildren.find((c) => c.type === IDENTIFIER);
	if (!identNode) return null;
	const segments = identNode.namedChildren.filter((c) => c.type === SIMPLE_IDENTIFIER);
	const last = segments[segments.length - 1];
	return last?.text ?? null;
}

/**
 * Emit 'extends' / 'implements' heritage edges for a class_declaration
 * (TASK-304, Phase 1.1).
 *
 * Grammar (tree-sitter-kotlin v0.3.8, verified empirically against the shipped
 * WASM): Kotlin has NO separate interface/enum declaration node — `interface`,
 * `enum` and `class` are anonymous (raw) token children of `class_declaration`
 * (TASK-131 pattern). Supertypes are `delegation_specifier` nodes that are
 * DIRECT children of the declaration (siblings of the type_identifier and
 * class_body — NOT nested inside class_body); each specifier wraps a
 * `constructor_invocation` (superclass call `Base("x")`), a `user_type`
 * (interface `IFoo`, generic `Repo<Item>`, qualified `com.acme.Nested`), or an
 * `explicit_delegation` (`Base by base`).
 *
 * Per-declaration-kind assignment (name-based per ADR-002 — no type resolution at
 * parse time):
 * - `interface`  → EVERY supertype is 'extends' (interfaces extend).
 * - `enum`       → EVERY supertype is 'implements' (enums can only implement
 *   interfaces per the Kotlin language rules).
 * - class (default, incl. data/sealed/value/annotation/inner) → the FIRST
 *   delegation_specifier is 'extends' (the primary superclass slot), subsequent
 *   specifiers are 'implements' (interface slot) — position heuristic per the
 *   TASK-304 spec; a lone `class X : SomeInterface` (interface with no
 *   superclass) is therefore tagged 'extends' since the visitor cannot
 *   distinguish class vs interface by name.
 *
 * Declaration-level generic bounds are also heritage-like: `type_parameters` →
 * `type_parameter` trailing `user_type` (`class Box<T : Storable>`) and
 * `type_constraints` → `type_constraint` (`where T : C`) emit 'extends' (mirrors
 * TASK-301 TS constraint edges). Method-level type params are excluded (out of
 * heritage scope). `callerName` is null per the ParsedReference heritage
 * contract.
 */
function emitHeritage(node: TSNode, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;
	const rawTokens = new Set(node.children.map((c) => c.type));
	const isInterface = rawTokens.has("interface");
	const isEnum = rawTokens.has("enum");

	// Declaration-level generic bounds → 'extends'.
	for (const child of node.namedChildren) {
		if (child.type === TYPE_PARAMETERS) {
			for (const tp of child.namedChildren) {
				if (tp.type === TYPE_PARAMETER) emitBoundEdges(tp, line, refs);
			}
		} else if (child.type === TYPE_CONSTRAINTS) {
			for (const tc of child.namedChildren) {
				if (tc.type === TYPE_CONSTRAINT) emitBoundEdges(tc, line, refs);
			}
		}
	}

	// Supertype delegation specifiers → 'extends'/'implements'.
	const specifiers = node.namedChildren.filter((c) => c.type === DELEGATION_SPECIFIER);
	if (isInterface) {
		for (const spec of specifiers) emitSupertypeEdge(spec, "extends", line, refs);
	} else if (isEnum) {
		for (const spec of specifiers) emitSupertypeEdge(spec, "implements", line, refs);
	} else {
		specifiers.forEach((spec, index) => emitSupertypeEdge(spec, index === 0 ? "extends" : "implements", line, refs));
	}
}

/**
 * Emit heritage edges for an object_declaration or companion_object. Kotlin
 * objects/companions can only implement interfaces (their supertype list holds no
 * superclass slot), so EVERY delegation_specifier is an 'implements' edge.
 */
function emitObjectHeritage(node: TSNode, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;
	for (const spec of node.namedChildren) {
		if (spec.type === DELEGATION_SPECIFIER) emitSupertypeEdge(spec, "implements", line, refs);
	}
}

/** Emit a single 'extends'/'implements' edge for one delegation_specifier. */
function emitSupertypeEdge(spec: TSNode, kind: "extends" | "implements", line: number, refs: ParsedReference[]): void {
	const name = delegationTargetName(spec);
	if (!name) return;
	refs.push({
		symbolName: name,
		callerFile: "",
		callerLine: line,
		callerName: null,
		kind
	});
}

/**
 * Emit 'extends' edges for the generic bounds of a type_parameter or
 * type_constraint node (`<T : Storable>` / `where T : C`). The bound parameter's
 * own type_identifier is the param NAME, not a heritage target — the trailing
 * `user_type` child(ren) are the bounds.
 */
function emitBoundEdges(holder: TSNode, line: number, refs: ParsedReference[]): void {
	for (const child of holder.namedChildren) {
		if (child.type === TYPE_IDENTIFIER) continue;
		const name = userTypeName(child);
		if (!name) continue;
		refs.push({
			symbolName: name,
			callerFile: "",
			callerLine: line,
			callerName: null,
			kind: "extends"
		});
	}
}

/**
 * Resolve the name-based target of a delegation_specifier (the referenced
 * supertype). The specifier wraps one of:
 * - `constructor_invocation` → `Base("x")` — the superclass call; inner `user_type`
 *    holds the class name.
 * - `user_type` → `IFoo` / `Repo<Item>` / `com.acme.Nested` — interface.
 * - `explicit_delegation` → `Base by base` — class delegation; inner `user_type`
 *    holds the class name.
 *
 * Per ADR-002 (name-based, no LSP) the edge references the LAST name segment of
 * the supertype as written (`com.acme.Nested` → 'Nested').
 */
function delegationTargetName(spec: TSNode): string | null {
	const inner = spec.namedChildren[0];
	if (!inner) return null;
	if (inner.type === CONSTRUCTOR_INVOCATION || inner.type === EXPLICIT_DELEGATION) {
		const ut = inner.namedChildren.find((c) => c.type === USER_TYPE);
		return ut ? userTypeName(ut) : null;
	}
	if (inner.type === USER_TYPE) return userTypeName(inner);
	return null;
}

/**
 * Resolve a user_type node to its LAST direct type_identifier child.
 *
 * `user_type` direct children are the identifier segments of a possibly qualified
 * type (`com.acme.Nested` → com, acme, deep, Nested → 'Nested') plus an optional
 * trailing `type_arguments` node (`Repo<Item>` → Repo, type_arguments — the Item
 * identifier is nested one level deeper and is NOT a direct child, so it is never
 * picked). Returns null for unparsed types.
 */
function userTypeName(node: TSNode): string | null {
	const ids = node.namedChildren.filter((c) => c.type === TYPE_IDENTIFIER);
	const last = ids[ids.length - 1];
	return last?.text ?? null;
}

/**
 * Read the referenced identifier from a call_expression:
 * - `helper()`        → direct `simple_identifier` child → 'helper'.
 * - `bar.baz()`       → `navigation_expression` → pierce to the LAST
 *   navigation suffix → 'baz' (also covers `x?.y?.z()` → 'z',
 *   `super.go()` → 'go', `this.go()` → 'go', `ns.x().y()` → 'y' — the
 *   inner `x()` call is caught by recursion into children).
 * Returns null for dynamic/indexed targets (`list[0]()`), which we can't
 * index (mirrors the PHP `$fn()` skip).
 */
function callTargetName(node: TSNode): string | null {
	const first = node.namedChildren[0];
	if (!first) return null;
	if (first.type === SIMPLE_IDENTIFIER) return first.text;
	if (first.type === NAVIGATION_EXPRESSION) return navigationTargetName(first);
	return null;
}

/** Pierce a navigation_expression chain to its last segment name. */
function navigationTargetName(node: TSNode): string | null {
	let cur = node;
	while (cur.type === NAVIGATION_EXPRESSION) {
		const last = cur.namedChildren[cur.namedChildren.length - 1];
		if (!last) break;
		cur = last;
	}
	if (cur.type === NAVIGATION_SUFFIX) {
		const ids = cur.namedChildren.filter((c) => c.type === SIMPLE_IDENTIFIER);
		const last = ids[ids.length - 1];
		return last?.text ?? null;
	}
	if (cur.type === SIMPLE_IDENTIFIER) return cur.text;
	return null;
}
