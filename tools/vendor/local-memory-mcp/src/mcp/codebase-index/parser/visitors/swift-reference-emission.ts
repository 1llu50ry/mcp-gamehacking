/**
 * SwiftVisitor reference-emission helpers (TASK-431 refactor).
 *
 * Pure-helper module mirroring the go-reference-emission.ts precedent: functions
 * take (Node, refs) with NO visitor dependencies — SwiftVisitor only locates the
 * AST root and delegates the reference walk here via `extractSwiftReferences`.
 *
 * Node types verified EMPIRICALLY against the shipped tree-sitter-swift WASM:
 * - `import_declaration` → one 'import' edge per statement (LAST name segment of
 *   the imported `identifier`; import-kind keyword is ANONYMOUS in the AST).
 * - `class_declaration` / `protocol_declaration` → heritage edges per direct
 *   `inheritance_specifier` child ('extends'/'implements' per declaration_kind).
 * - `call_expression` → 'call' edges (plain `simple_identifier` or LAST
 *   `simple_identifier` segment of a `navigation_expression`); dynamic targets
 *   (`(getFactory())()`) emit nothing.
 *
 * Heritage edges carry `callerName` null (the edge belongs to the derived type's
 * declaration, per the TASK-299 ParsedReference contract); targetFile /
 * targetSymbolId stay null (name-based resolution per ADR-002 at query time).
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference } from "../language-visitor";

const FUNCTION_DECLARATION = "function_declaration";
const INIT_DECLARATION = "init_declaration";
const IMPORT_DECLARATION = "import_declaration";
const PROTOCOL_DECLARATION = "protocol_declaration";
const CLASS_DECLARATION = "class_declaration";
const CALL_EXPRESSION = "call_expression";
const IDENTIFIER = "identifier";
const SIMPLE_IDENTIFIER = "simple_identifier";
const INHERITANCE_SPECIFIER = "inheritance_specifier";
const USER_TYPE = "user_type";
const NAVIGATION_EXPRESSION = "navigation_expression";
const TYPE_IDENTIFIER = "type_identifier";

// `declaration_kind` field values of class_declaration (verified field).
const DECLARATION_KIND_CLASS = "class";
const DECLARATION_KIND_STRUCT = "struct";
const DECLARATION_KIND_EXTENSION = "extension";
const DECLARATION_KIND_ACTOR = "actor";
const DECLARATION_KIND_ENUM = "enum";

/**
 * Emit reference edges (TASK-309 / Phase 1.1), mirroring the GoVisitor /
 * CppVisitor / JavaVisitor structure. Cheap single AST pass over the reference
 * surfaces of the shipped tree-sitter-swift grammar. See the module JSDoc for the
 * node-type → edge-kind mapping. `callerName` is the enclosing
 * function/method name (tracked by descending into function_declaration /
 * init_declaration bodies) and null for heritage edges and imports. targetFile /
 * targetSymbolId are left null — name-based resolution per ADR-002 happens at
 * query time, not parse time.
 */
export function extractSwiftReferences(root: TSNode): ParsedReference[] {
	const refs: ParsedReference[] = [];
	walkReferences(root, null, refs);
	return refs;
}

function walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	switch (node.type) {
		// Track the enclosing function/method name for call-site edges,
		// then recurse into the body (identical to the default branch).
		case FUNCTION_DECLARATION: {
			const nameNode = node.childForFieldName("name");
			const fnName = nameNode ? nameNode.text : null;
			for (const child of node.namedChildren) {
				walkReferences(child, fnName ?? callerName, refs);
			}
			return;
		}
		// init_declaration: the `name` field is the keyword 'init' — thread
		// it as the enclosing caller for call edges in initializer bodies.
		case INIT_DECLARATION: {
			for (const child of node.namedChildren) {
				walkReferences(child, "init", refs);
			}
			return;
		}
		// Import edges (TASK-309): one 'import' edge per statement. Do NOT
		// recurse — import children are pure names, never call sites.
		case IMPORT_DECLARATION: {
			emitImportEdge(node, refs);
			return;
		}
		// Heritage edges: emit per direct inheritance_specifier child, then
		// recurse into the body (it contains method call sites). The
		// inheritance specifier children themselves (user_type /
		// type_identifier) are never call sites, so recursion adds nothing.
		case PROTOCOL_DECLARATION:
		case CLASS_DECLARATION: {
			emitHeritageEdges(node, refs);
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
		}
		// Call sites (TASK-309, optional — cheap): `helper()`,
		// `obj.save()`, `self.update()`, `a.b.c()`.
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
 * Emit one 'import' edge per import_declaration (TASK-309 / Phase 1.1).
 *
 * Grammar (verified empirically against the shipped WASM): import_declaration has
 * exactly one `identifier` named child — `sep1(simple_identifier, '.')` (`import
 * UIKit` → [UIKit]; `import class Foundation.URLSession` → [Foundation,
 * URLSession]). The import-kind keyword is ANONYMOUS (no node in the named
 * children), so the local binding is the LAST simple segment — matching ADR-002
 * last-segment, name-based resolution. `callerLine` is the import statement line;
 * `callerName` null (Swift imports are file-scope).
 */
function emitImportEdge(node: TSNode, refs: ParsedReference[]): void {
	const binding = importBindingName(node);
	if (!binding) return;
	refs.push({
		symbolName: binding,
		callerFile: "",
		callerLine: node.startPosition.row + 1,
		callerName: null,
		kind: "import"
	});
}

function importBindingName(node: TSNode): string | null {
	const idNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
	if (!idNode) return null;
	const segments = idNode.namedChildren.filter((c) => c.type === SIMPLE_IDENTIFIER);
	const last = segments[segments.length - 1];
	return last ? last.text : null;
}

/**
 * Emit heritage edges for a class / protocol declaration (TASK-309).
 *
 * The inheritance clause is an anonymous `:` sequence — targets are DIRECT
 * `inheritance_specifier` children (NO inheritance_clause / class_restriction
 * wrapper in this grammar version; verified). Kind mapping per declaration_kind —
 * see heritageKindFor. `callerLine` = the derived type's declaration line;
 * `callerName` null per the heritage contract.
 */
function emitHeritageEdges(node: TSNode, refs: ParsedReference[]): void {
	const specifiers = node.namedChildren.filter((c) => c.type === INHERITANCE_SPECIFIER);
	if (specifiers.length === 0) return;
	const isProtocol = node.type === PROTOCOL_DECLARATION;
	const declKind = node.childForFieldName("declaration_kind")?.text ?? null;
	const line = node.startPosition.row + 1;
	specifiers.forEach((spec, index) => {
		const kind = heritageKindFor(isProtocol, declKind, index);
		if (!kind) return;
		const target = heritageTargetName(spec);
		if (!target) return;
		refs.push({
			symbolName: target,
			callerFile: "",
			callerLine: line,
			callerName: null,
			kind
		});
	});
}

/**
 * Map a declaration's inheritance specifier to the emitted edge kind:
 *   - protocol_declaration → 'extends' for EVERY specifier
 *     (`protocol P: Q, R` → P extends Q, P extends R).
 *   - class / actor → 'extends' for the FIRST specifier (superclass),
 *     'implements' for each SUBSEQUENT one (protocol conformances) —
 *     position-based heuristic (C++ TASK-308 precedent; a lone first protocol is
 *     indistinguishable from a superclass by name — ADR rule).
 *   - struct / extension → 'implements' for every specifier (no superclass; only
 *     conformances, `extension Foo: Proto`).
 *   - enum → null (SKIPPED): `enum E: Int` binds the raw-value type 'Int' with
 *     the exact same AST shape as a conformance (`CaseIterable`), and name-based
 *     resolution cannot distinguish them (documented limitation — enums are
 *     outside the TASK-309 heritage scope).
 */
function heritageKindFor(isProtocol: boolean, declKind: string | null, index: number): "extends" | "implements" | null {
	if (isProtocol) return "extends";
	switch (declKind) {
		case DECLARATION_KIND_CLASS:
		case DECLARATION_KIND_ACTOR:
			return index === 0 ? "extends" : "implements";
		case DECLARATION_KIND_STRUCT:
		case DECLARATION_KIND_EXTENSION:
			return "implements";
		case DECLARATION_KIND_ENUM:
		default:
			return null;
	}
}

/**
 * Resolve the name-based heritage target (ADR-002 LAST name segment) from an
 * inheritance_specifier: its `inherits_from` field is a `user_type` whose LAST
 * `type_identifier` child is the target (`Base` → 'Base'; `ns.Base` → 'Base';
 * `Base<T>` → 'Base' — type_arguments excluded). Returns null for unrecognized
 * shapes (no edge emitted).
 */
function heritageTargetName(spec: TSNode): string | null {
	const inheritsFrom = spec.childForFieldName("inherits_from");
	if (!inheritsFrom) return null;
	if (inheritsFrom.type === TYPE_IDENTIFIER) return inheritsFrom.text;
	if (inheritsFrom.type === USER_TYPE) {
		const segments = inheritsFrom.namedChildren.filter((c) => c.type === TYPE_IDENTIFIER);
		const last = segments[segments.length - 1];
		return last ? last.text : null;
	}
	return null;
}

/**
 * Read the referenced identifier from a call_expression (TASK-309):
 * - `helper()`     → first named child simple_identifier → 'helper'.
 * - `obj.save()`   → first named child navigation_expression → LAST
 *   `simple_identifier` descendant ('save'; covers `self.update()` → 'update',
 *   `a.b.c()` → 'c', `NSObject.init()` → 'init').
 * - `(getFactory())()` → first child is a tuple_expression (dynamic call target)
 *   → null (the INNER call_expression still emits).
 * Returns null for unrecognized shapes (no edge emitted).
 */
function callTargetName(node: TSNode): string | null {
	const fn = node.namedChildren[0];
	if (!fn) return null;
	if (fn.type === SIMPLE_IDENTIFIER) return fn.text;
	if (fn.type === NAVIGATION_EXPRESSION) {
		return lastSimpleIdentifier(fn);
	}
	return null;
}

function lastSimpleIdentifier(node: TSNode): string | null {
	let last: string | null = null;
	for (const child of node.namedChildren) {
		if (child.type === SIMPLE_IDENTIFIER) {
			last = child.text;
		} else {
			const inner = lastSimpleIdentifier(child);
			if (inner) last = inner;
		}
	}
	return last;
}
