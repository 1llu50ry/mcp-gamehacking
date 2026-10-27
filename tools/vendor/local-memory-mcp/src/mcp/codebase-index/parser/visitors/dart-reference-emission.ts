/**
 * DartVisitor reference-emission helpers (TASK-557 split).
 *
 * Pure-helper module extracted from dart-visitor.ts mirroring the
 * ts-reference-emission / cpp-reference-emission precedents: functions take
 * (Node, refs, callerName) with NO visitor dependencies — DartVisitor only
 * locates the AST root and delegates the reference walk here via
 * `walkDartReferences`.
 *
 * Node types verified EMPIRICALLY against the SHIPPED tree-sitter-dart WASM
 * (dist/grammars/tree-sitter-dart; NOT guessed — live AST probes):
 * - `import` directives are `import_or_export` → `library_import` →
 *   `import_specification` → `configurable_uri` → `uri` (exports use
 *   `library_export` — skipped; `part_directive` / `part_of_directive` are
 *   separate productions). One 'import' edge per directive, symbolName = the
 *   FULL URI path with quotes stripped (`'package:foo/bar.dart'` →
 *   'package:foo/bar.dart') — mirrors the C/C++ include-path (TASK-308) and
 *   Ruby require-path (TASK-310) decisions: a library URI IS a single
 *   identifier; mapping path→symbol is query-time. The `as` prefix alias and
 *   show/hide combinators are import-selection granularity, NOT separate
 *   edges. NOTE: `deferred` imports use the alternate `import_specification`
 *   production without a `configurable_uri` → no edge either way.
 * - Heritage via DIRECT class_definition FIELDS (NO *_clause wrapper nodes in
 *   this grammar — verified): `superclass` field (node `superclass`) → one
 *   'extends' edge for the base `type_identifier` AND one 'extends' per
 *   direct `mixins` child (the `with` clause); `interfaces` field (node
 *   `interfaces`) → one 'implements' per DIRECT `type_identifier` child
 *   (type arguments of `Comparable<Animal>` are nested in `type_arguments`
 *   → never an edge). Qualified (library-prefixed) types (`extends pkg.Base`)
 *   resolve to the LAST `type_identifier` of each comma-separated segment
 *   (LAST-segment convention — see emitTypeList). Applies uniformly to the
 *   superclass base, the with-mixins list, the interfaces list, the generic
 *   `type_bound` and the mixin `on` constraint. `type_parameters` →
 *   `type_parameter` → `type_bound` → 'extends' for the class-level generic
 *   bound (mirrors TS TASK-301); method-level type parameters excluded.
 *   `mixin_declaration` exposes its `on` applicability constraint as a DIRECT
 *   `type_identifier` child (`mixin Jumper on Animal`) → 'extends'.
 * - call sites: Dart has NO call_expression node — a call is an
 *   identifier/`this` followed by `selector` nodes; a `selector` whose FIRST
 *   named child is `argument_part` (`print('woof')`, `Dog()`, `d.bark()`) is
 *   a call → callee = the previous named sibling (LAST segment convention).
 *   `cascade_section` (`list..add(1)`) → one 'call' per `cascade_selector`
 *   immediately followed by an `argument_part` — bare property cascades emit
 *   nothing. callerName = the enclosing method/constructor/function name.
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference, ReferenceKind } from "../language-visitor";

const CLASS_DEFINITION = "class_definition";
const METHOD_SIGNATURE = "method_signature";
const FUNCTION_SIGNATURE = "function_signature";
const CONSTRUCTOR_SIGNATURE = "constructor_signature";
const GETTER_SIGNATURE = "getter_signature";
const SETTER_SIGNATURE = "setter_signature";
const IMPORT_OR_EXPORT = "import_or_export";
const LIBRARY_IMPORT = "library_import";
const IMPORT_SPECIFICATION = "import_specification";
const CONFIGURABLE_URI = "configurable_uri";
const URI = "uri";
const TYPE_IDENTIFIER = "type_identifier";
const IDENTIFIER = "identifier";
const MIXIN_DECLARATION = "mixin_declaration";
const MIXINS = "mixins";
const TYPE_PARAMETER = "type_parameter";
const TYPE_BOUND = "type_bound";
const SELECTOR = "selector";
const ARGUMENT_PART = "argument_part";
const UNCONDITIONAL_ASSIGNABLE_SELECTOR = "unconditional_assignable_selector";
const CASCADE_SECTION = "cascade_section";
const CASCADE_SELECTOR = "cascade_selector";
const FUNCTION_BODY = "function_body";

/**
 * Canonical pushRef (TASK-347): explicit null targets so strict toBeNull
 * assertions hold — edges are name-based; ADR-002 resolution happens
 * downstream (the parser pool fills callerFile).
 */
function pushRef(
	refs: ParsedReference[],
	symbolName: string,
	callerLine: number,
	callerName: string | null,
	kind: ReferenceKind
): void {
	refs.push({ symbolName, callerFile: "", callerLine, callerName, kind, targetFile: null, targetSymbolId: null });
}

/**
 * Resolve the declared name of a signature node. `method_signature` WRAPS the
 * real signature (constructor/getter/setter/function — verified: the `name`
 * field lives on the inner node), while a bare `function_signature` carries it
 * directly.
 */
export function dartSignatureName(sigNode: TSNode): string | null {
	const inner =
		sigNode.type === METHOD_SIGNATURE
			? sigNode.namedChildren.find(
					(c) =>
						c.type === CONSTRUCTOR_SIGNATURE ||
						c.type === GETTER_SIGNATURE ||
						c.type === SETTER_SIGNATURE ||
						c.type === FUNCTION_SIGNATURE
				)
			: sigNode;
	return inner?.childForFieldName("name")?.text ?? null;
}

/** Emit one 'import' edge per `import 'uri';` directive. */
function emitImportEdge(node: TSNode, refs: ParsedReference[]): void {
	const libraryImport = node.namedChildren.find((c) => c.type === LIBRARY_IMPORT);
	if (!libraryImport) return; // export / part — not an import
	const spec = libraryImport.namedChildren.find((c) => c.type === IMPORT_SPECIFICATION);
	const configurable = spec?.namedChildren.find((c) => c.type === CONFIGURABLE_URI);
	const uri = configurable?.namedChildren.find((c) => c.type === URI);
	if (!uri) return;
	const raw = uri.text;
	const name = raw.length >= 2 && (raw.startsWith("'") || raw.startsWith('"')) ? raw.slice(1, -1) : raw;
	if (!name) return;
	pushRef(refs, name, node.startPosition.row + 1, null, "import");
}

/**
 * Emit heritage edges for a class_definition / mixin_declaration. See the
 * header JSDoc for the per-field grammar mapping. callerLine = the declaration
 * line; callerName null per the heritage contract (language-visitor.ts).
 */
function emitDartHeritage(node: TSNode, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;

	if (node.type === CLASS_DEFINITION) {
		const superclass = node.childForFieldName("superclass");
		if (superclass) {
			// Base type (LAST segment — `extends pkg.Base` → 'Base'). The
			// `with` mixins node is a separate NAMED child: its internal
			// type_identifiers are not direct children of `superclass`, so
			// emitTypeList can never pick them up as base segments.
			emitTypeList(superclass, refs, line, "extends");
			const mixins = superclass.namedChildren.find((c) => c.type === MIXINS);
			if (mixins) {
				emitTypeList(mixins, refs, line, "extends");
			}
		}
		const interfaces = node.childForFieldName("interfaces");
		if (interfaces) {
			emitTypeList(interfaces, refs, line, "implements");
		}
		const typeParams = node.childForFieldName("type_parameters");
		if (typeParams) {
			for (const tp of typeParams.namedChildren) {
				if (tp.type !== TYPE_PARAMETER) continue;
				const bound = tp.namedChildren.find((c) => c.type === TYPE_BOUND);
				if (bound) emitTypeList(bound, refs, line, "extends");
			}
		}
	} else {
		// mixin_declaration: the `on` applicability constraint is a DIRECT
		// `_type_not_void_list` of the declaration node itself (`mixin Jumper
		// on Animal`) — the hoisted type_identifiers plus anonymous ','/'.'
		// tokens are raw children, while the mixin NAME is an `identifier`
		// node and type_parameters/interfaces nest their tids, so only the
		// on-targets can match. One 'extends' per on-target (LAST segment).
		emitTypeList(node, refs, line, "extends");
	}
}

/**
 * Emit one edge per comma-separated type segment of a container node, using
 * the LAST `type_identifier` of each segment. tree-sitter-dart's hidden
 * `_type_name` / `_type_dot_identifier` rules (grammar.js:2216-2249, verified
 * against the shipped WASM) hoist EVERY component of a qualified
 * (library-prefixed) type as a DIRECT `type_identifier` child (`extends
 * pkg.Base` → 'pkg' AND 'Base'), while the anonymous ',' and '.' tokens ARE
 * visible in raw children — so ',' marks a segment boundary and the final
 * identifier of each segment is the actual type name. The library prefix is a
 * path component, never a heritage target (LAST-segment convention — mirrors
 * call sites here and the C/C++ + Ruby qualified-heritage decisions). Nested
 * nodes (`type_arguments` for `Comparable<Animal>`, the `mixins` with-clause)
 * are not type_identifiers and are ignored, so generic targets still emit only
 * the outer type.
 */
function emitTypeList(node: TSNode, refs: ParsedReference[], line: number, kind: ReferenceKind): void {
	let last: TSNode | null = null;
	for (const child of node.children) {
		if (child.type === TYPE_IDENTIFIER) {
			last = child;
		} else if (child.type === ",") {
			if (last) pushRef(refs, last.text, line, null, kind);
			last = null;
		}
	}
	if (last) pushRef(refs, last.text, line, null, kind);
}

/**
 * Emit a 'call' edge when a `selector` node is an argument list
 * (`print('woof')`, `Dog()`, `d.bark()`). A call iff the selector's FIRST
 * named child is `argument_part` — bare property selectors (`.greet` without
 * `()`) are never calls. Callee (LAST segment): the previous named sibling
 * when it is a plain `identifier`/`type_identifier`, or the identifier inside
 * a preceding `.x` `unconditional_assignable_selector` (`.bark` → 'bark',
 * `g.greet('a').toUpperCase()` → 'toUpperCase' — the receiver `g` is a path
 * component, never an edge). Generic calls (`foo<num>(1)`) carry the
 * type_arguments INSIDE the argument_part, so the plain-identifier branch
 * resolves them.
 */
function emitCallFromSelector(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
	const first = node.namedChildren[0];
	if (!first || first.type !== ARGUMENT_PART) return;
	const line = node.startPosition.row + 1;
	const prev = node.previousNamedSibling;
	let name: string | null = null;
	if (prev) {
		if (prev.type === IDENTIFIER || prev.type === TYPE_IDENTIFIER) {
			name = prev.text;
		} else if (prev.type === SELECTOR) {
			const inner = prev.namedChildren.find((c) => c.type === UNCONDITIONAL_ASSIGNABLE_SELECTOR);
			const innerId = inner?.namedChildren.find((c) => c.type === IDENTIFIER);
			if (innerId) name = innerId.text;
		}
	}
	if (name) pushRef(refs, name, line, callerName, "call");
}

/**
 * Emit a 'call' edge per `cascade_section` (`list..add(1)..add(2)`) — the
 * Flutter-style cascade is its own node type. A cascade is a CALL only when
 * the `cascade_selector` is IMMEDIATELY followed by an `argument_part` named
 * sibling (`..add(1)`) — mirror of emitCallFromSelector. Bare property
 * cascades (`list..length`, `..first`) carry no argument list and emit
 * nothing, matching the bare property-selector convention; null-aware cascades
 * (`list?..add(3)`) share the same shape. Callee = the `cascade_selector`
 * identifier (LAST segment — the receiver is a path component, never an edge).
 */
function emitCallFromCascade(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
	const kids = node.namedChildren;
	const selIdx = kids.findIndex((c) => c.type === CASCADE_SELECTOR);
	if (selIdx < 0) return;
	const next = kids[selIdx + 1];
	if (!next || next.type !== ARGUMENT_PART) return;
	const id = kids[selIdx].namedChildren.find((c) => c.type === IDENTIFIER);
	if (id) pushRef(refs, id.text, node.startPosition.row + 1, callerName, "call");
}

/**
 * Reference walker — mirrors the symbol walker's traversal shape (same child
 * recursion + caller threading) so symbol extraction and reference emission
 * stay independent. The import/heritage/call cases emit edges and then fall
 * through to the shared recursion, so no node is visited twice and call sites
 * nested in bodies are still reached.
 */
export function walkDartReferences(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
	const type = node.type;

	// ── Import directive → one 'import' edge ──
	if (type === IMPORT_OR_EXPORT) {
		emitImportEdge(node, refs);
	}

	// ── Class / mixin heritage → 'extends' + 'implements' edges ──
	if (type === CLASS_DEFINITION || type === MIXIN_DECLARATION) {
		emitDartHeritage(node, refs);
	}

	// ── Call sites: a selector whose first named child is an argument
	//    list is a call; cascades are their own node type ──
	if (type === SELECTOR) {
		emitCallFromSelector(node, refs, callerName);
	} else if (type === CASCADE_SECTION) {
		emitCallFromCascade(node, refs, callerName);
	}

	// ── Caller tracking: in this grammar the signature and the body are
	//    SIBLINGS (verified — method_signature/function_signature are
	//    followed by a sibling function_body), so the enclosing name is
	//    read from the body's PREVIOUS named sibling ──
	if (type === FUNCTION_BODY) {
		const prev = node.previousNamedSibling;
		const name =
			prev && (prev.type === METHOD_SIGNATURE || prev.type === FUNCTION_SIGNATURE)
				? (dartSignatureName(prev) ?? callerName)
				: callerName;
		for (const child of node.namedChildren) {
			walkDartReferences(child, refs, name);
		}
		return;
	}

	for (const child of node.namedChildren) {
		walkDartReferences(child, refs, callerName);
	}
}
