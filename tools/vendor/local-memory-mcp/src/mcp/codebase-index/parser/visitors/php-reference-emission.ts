/**
 * PhpVisitor reference-emission helpers (TASK-431 refactor).
 *
 * Pure-helper module mirroring the go-reference-emission.ts precedent: functions
 * take (Node, refs) with NO visitor dependencies — PhpVisitor only locates the
 * AST root and delegates the reference walk here via `extractPhpReferences`.
 *
 * Edge families (verified empirically against the shipped php_only WASM):
 * - `function_call_expression`  → kind 'call'
 * - `member_call_expression`    → kind 'call'
 * - `scoped_call_expression`    → kind 'call'
 * - `object_creation_expression`→ kind 'instantiation'
 * - `namespace_use_declaration` → kind 'import' (one edge per binding; the `as`
 *   alias when present, else the LAST segment of the qualified name; group form
 *   `use NS\{A, B as C};` covered), trait `use` statements stay unindexed.
 * - class/interface/enum declarations → kind 'extends'/'implements' per heritage
 *   target.
 *
 * `callerName` is the enclosing function/method name, tracked by descending into
 * function_definition / method_declaration bodies, and null for heritage edges
 * and top-level imports. targetFile/targetSymbolId stay null — name-based
 * resolution per ADR-002 happens at query time, not parse time.
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference } from "../language-visitor";

// Call-site node types (reference emission, TASK-236 / issue #64).
const FUNCTION_CALL_EXPRESSION = "function_call_expression";
const MEMBER_CALL_EXPRESSION = "member_call_expression";
const SCOPED_CALL_EXPRESSION = "scoped_call_expression";
const OBJECT_CREATION_EXPRESSION = "object_creation_expression";

// Heritage / import-name node types (reference emission, TASK-302 / Phase 1.1).
const BASE_CLAUSE = "base_clause";
const CLASS_INTERFACE_CLAUSE = "class_interface_clause";
const QUALIFIED_NAME = "qualified_name";
const RELATIVE_NAME = "relative_name";
const NAME = "name";
const NAMESPACE_USE_DECLARATION = "namespace_use_declaration";
const NAMESPACE_USE_CLAUSE = "namespace_use_clause";
const NAMESPACE_USE_GROUP = "namespace_use_group";

/**
 * Emit call-site references (TASK-236 / issue #64) + import and heritage edges
 * (TASK-302 / Phase 1.1) in a single cheap AST pass over the obvious reference
 * surfaces in the php_only grammar. See the module JSDoc for the node-type →
 * edge-kind mapping. `callerName` is the enclosing function/method name, tracked
 * by descending into function_definition / method_declaration bodies, and null
 * for heritage edges and top-level imports. Traversal timestamps to the tree root
 * so no symbol is required to pre-exist the caller. Trait `use` statements
 * (`use_declaration` inside classes) are NOT imports and stay unindexed, matching
 * the symbol extraction contract.
 */
export function extractPhpReferences(root: TSNode): ParsedReference[] {
	const refs: ParsedReference[] = [];
	walkReferences(root, null, refs);
	return refs;
}

function walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	let called: string | null;
	switch (node.type) {
		case FUNCTION_CALL_EXPRESSION:
		case MEMBER_CALL_EXPRESSION:
		case SCOPED_CALL_EXPRESSION:
			called = callTargetName(node);
			break;
		case OBJECT_CREATION_EXPRESSION:
			called = callTargetName(node);
			break;
		case "function_definition":
		case "method_declaration": {
			const nameNode =
				node.childForFieldName("name") ?? node.namedChildren.find((c) => c.type === "name" || c.type === "identifier");
			const fnName = nameNode ? nameNode.text : null;
			for (const child of node.namedChildren) {
				walkReferences(child, fnName ?? callerName, refs);
			}
			return;
		}
		case NAMESPACE_USE_DECLARATION: {
			// Import edges (TASK-302): one 'import' reference per binding.
			// Do NOT recurse — use-clause children are pure names, never
			// call sites (mirrors the TS emitImports surface).
			emitImportEdges(node, callerName, refs);
			return;
		}
		// Heritage edges (TASK-302): emit 'extends'/'implements' for the
		// declaration's base/interface clauses, then recurse into the body
		// so call-site refs inside members still emit (identical traversal
		// to the default branch — purely additive).
		case "class_declaration":
		case "interface_declaration":
		case "enum_declaration": {
			emitHeritage(node, refs);
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

	if (called) {
		refs.push({
			symbolName: called,
			callerFile: "",
			callerLine: node.startPosition.row + 1,
			callerName,
			kind: node.type === OBJECT_CREATION_EXPRESSION ? "instantiation" : "call"
		});
	}

	// Recurse into children so nested calls are also indexed.
	for (const child of node.namedChildren) {
		walkReferences(child, callerName, refs);
	}
}

/**
 * Read the referenced identifier from a call/creation node:
 * - function_call_expression / object_creation_expression expose the target
 *   as a `name` CHILD (not a field) — `new User()` / `helper()`.
 * - member_/scoped_call_expression expose the callee as a `name` FIELD.
 * Returns null for dynamic (variable) targets, which we can't index.
 */
function callTargetName(node: TSNode): string | null {
	const fieldName = node.childForFieldName("name");
	if (fieldName) return fieldName.text;
	const child = node.namedChildren.find((c) => c.type === "name" || c.type === NAME);
	if (!child) return null;
	const text = child.text;
	// Skip purely-dynamic targets like `$fn()` / `new $class()` — text is
	// a variable_name/placeholder, not a symbolic definition.
	return text.startsWith("$") ? null : text;
}

/**
 * Emit one 'import' reference edge per binding in a `namespace_use_declaration`
 * (top-level `use` statements), consistent with TS emitImports semantics
 * (TASK-302 / Phase 1.1).
 *
 * Both grammar shapes are covered (verified empirically against the shipped
 * php_only WASM):
 * - Plain form: `use Foo\Bar;` / `use Foo\Bar as Baz;` / `use A, B;` → one
 *   or more `namespace_use_clause` children.
 * - Group form: `use NS\Util\{Factory, Repo as Store};` → a `namespace_name`
 *   prefix + a `namespace_use_group` whose clauses hold the relative names.
 *
 * The referenced symbol is the LOCAL BINDING per PHP semantics — the `as`
 * alias when present (`use Foo\Bar as Baz;` → 'Baz'), otherwise the LAST
 * name segment of the imported name (`use Foo\Bar;` → 'Bar'), matching
 * ADR-002 last-segment, name-based resolution. `callerLine` is the `use`
 * statement line; `callerName` is the enclosing function/method (null in
 * practice — PHP requires `use` at the top level).
 */
function emitImportEdges(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;
	const children = node.namedChildren;

	// ── Group form: `use NS\Util\{Factory, Repo as Store};` ──────────────
	const groupNode = children.find((c) => c.type === NAMESPACE_USE_GROUP);
	if (groupNode) {
		for (const clause of groupNode.namedChildren) {
			if (clause.type !== NAMESPACE_USE_CLAUSE) continue;
			emitImportBinding(clause, line, callerName, refs);
		}
		return;
	}

	// ── Plain form: one or more `namespace_use_clause` children ──
	for (const clause of children) {
		if (clause.type !== NAMESPACE_USE_CLAUSE) continue;
		emitImportBinding(clause, line, callerName, refs);
	}
}

/** Emit a single 'import' edge for one namespace_use_clause binding. */
function emitImportBinding(clause: TSNode, line: number, callerName: string | null, refs: ParsedReference[]): void {
	const binding = importBindingName(clause);
	if (!binding) return;
	refs.push({
		symbolName: binding,
		callerFile: "",
		callerLine: line,
		callerName,
		kind: "import"
	});
}

/**
 * Resolve the local binding name of a namespace_use_clause: the `as` alias
 * when present (`use Foo\Bar as Baz;` → 'Baz'), otherwise the LAST name
 * segment of the imported name (`use Foo\Bar;` → 'Bar').
 */
function importBindingName(clause: TSNode): string | null {
	const alias = clause.childForFieldName("alias");
	if (alias) return alias.text;
	const nameNode = clause.namedChildren[0];
	if (!nameNode) return null;
	return heritageTargetName(nameNode);
}

/**
 * Emit 'extends' / 'implements' heritage edges for a class, interface or
 * enum declaration (TASK-302, Phase 1.1).
 *
 * Grammar (tree-sitter-php_only, verified empirically against the shipped
 * WASM): class heritage lives in DIRECT `base_clause` ('extends', single
 * target) + `class_interface_clause` ('implements', list) children of the
 * declaration — no wrapper node. `interface_declaration` heritage is a
 * `base_clause` holding MULTIPLE targets (`interface A extends B, C`).
 * `enum_declaration` heritage is a `class_interface_clause` ('implements').
 * `trait_declaration` has NO heritage clause. The declaration's own
 * backing-type `primitive_type` on enums is not a heritage target.
 *
 * `callerName` is null per the ParsedReference heritage contract
 * (language-visitor.ts) — the edge belongs to the derived type's
 * declaration, not an enclosing function. `targetFile`/`targetSymbolId`
 * are left null: name-based resolution per ADR-002 happens at query time,
 * not parse time.
 */
function emitHeritage(node: TSNode, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;
	for (const clause of node.namedChildren) {
		if (clause.type === BASE_CLAUSE) emitHeritageTargets(clause, "extends", line, refs);
		else if (clause.type === CLASS_INTERFACE_CLAUSE) emitHeritageTargets(clause, "implements", line, refs);
	}
}

/** Emit one heritage edge per target inside a base_clause/class_interface_clause. */
function emitHeritageTargets(
	clause: TSNode,
	kind: "extends" | "implements",
	line: number,
	refs: ParsedReference[]
): void {
	for (const target of clause.namedChildren) {
		const name = heritageTargetName(target);
		if (!name) continue;
		refs.push({
			symbolName: name,
			callerFile: "",
			callerLine: line,
			callerName: null,
			kind
		});
	}
}

/**
 * Resolve the name-based target of a heritage element or imported name.
 *
 * Per ADR-002 (name-based resolution, no LSP / type resolution), the edge
 * references the LAST name segment of the heritage target / import as
 * written:
 *
 *   - `name`           → `Foo`      (extends Foo / use Foo\Bar → 'Bar')
 *   - `qualified_name`  → `Base`    (extends \App\Models\Base → 'Base')
 *   - `relative_name`   → `Foo`     (namespace\Foo → 'Foo')
 *
 * Returns null for non-name elements (no edge emitted) — all children of
 * base_clause/class_interface_clause/namespace_use_clause are name-shaped
 * in the php_only grammar, so this is a defensive guard.
 */
function heritageTargetName(node: TSNode): string | null {
	if (node.type === NAME) return node.text;
	if (node.type === QUALIFIED_NAME || node.type === RELATIVE_NAME) {
		return node.lastNamedChild?.text ?? null;
	}
	return null;
}
