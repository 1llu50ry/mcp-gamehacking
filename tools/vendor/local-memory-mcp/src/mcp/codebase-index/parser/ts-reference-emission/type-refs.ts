/**
 * 'type' reference-edge emission for the TypeScriptVisitor
 * (extracted from ts-reference-emission during the TASK-552 split).
 *
 * Emits 'type' dependency edges (issue #82, migration v26) for a declaration's
 * OWN type surface: parameters + return types, class/interface property types,
 * type-alias values, and generic constraint/type-argument bindings. Purely
 * structural lookups over the AST — name-based resolution per ADR-002.
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference, ReferenceRole } from "../language-visitor";
import {
	ARRAY_TYPE,
	CONSTRAINT,
	FORMAL_PARAMETERS,
	GENERIC_TYPE,
	INTERSECTION_TYPE,
	NESTED_TYPE_IDENTIFIER,
	OPTIONAL_PARAMETER,
	PAREN_TYPE,
	REQUIRED_PARAMETER,
	TYPE_ALIAS_DECLARATION,
	TYPE_ANNOTATION,
	TYPE_IDENTIFIER,
	TYPE_PARAMETER,
	TYPE_PARAMETERS,
	UNION_TYPE
} from "../ts-node-types";

/**
 * The set of node types that NAME a type reference (the leaf types we emit
 * edges for). A `type` supertype in the grammar covers these plus structural
 * shapes (object/tuple/function/conditional/template-literal types) that
 * carry no single resolvable name — those are skipped by {@link typeRefName}.
 *
 * Verified against tree-sitter-typescript node-types.json (STD-001): the
 * primary_type supertype includes `type_identifier`, `nested_type_identifier`,
 * `generic_type`, `predefined_type`, `literal_type`, `array_type`,
 * `object_type`, `tuple_type`, `parenthesized_type`, `union_type`,
 * `intersection_type`, `conditional_type`, `function_type`, `constructor_type`,
 * `template_literal_type`, `lookup_type`, `index_type_query`, `this_type`,
 * `type_query`, `existential_type`, `const`, `flow_maybe_type`.
 */
const NAMED_TYPE_NODES = new Set([TYPE_IDENTIFIER, NESTED_TYPE_IDENTIFIER, GENERIC_TYPE]);

/**
 * Resolve the name-based target of a TYPE reference (not heritage).
 *
 * Per ADR-002 (name-based resolution, no LSP / type resolution) the edge
 * references the LAST name segment of the type as written:
 *
 *   - `type_identifier`               → `Foo`        (dto: Foo)
 *   - `nested_type_identifier`        → `Iface`      (x: UI.Iface)
 *   - `generic_type`                  → `Foo`        (x: Foo<T>)
 *   - `union_type` / `intersection_type` → the FIRST named child's target —
 *     callers walk each member; returning the first child keeps nested
 *     recursion working (e.g. `A | (B & C)` → A then (B & C) → B, C).
 *   - `array_type` / `parenthesized_type` → unwrap to the inner type.
 *   - `predefined_type` / `literal_type` / `object_type` / `tuple_type` /
 *     `function_type` / `conditional_type` / structural shapes → null (no
 *     resolvable name).
 *
 * Returns null when the type carries no resolvable name so no edge is emitted
 * for anonymous / structural types.
 */
export function typeRefName(node: TSNode): string | null {
	if (node.type === GENERIC_TYPE) {
		// `Foo<T>` — the generic type name is the `name` field (type_identifier
		// or nested_type_identifier).
		const base = node.childForFieldName("name") ?? node.namedChildren[0];
		return base ? typeRefName(base) : null;
	}
	if (node.type === TYPE_IDENTIFIER || node.type === NESTED_TYPE_IDENTIFIER || node.type === "identifier") {
		return node.type === NESTED_TYPE_IDENTIFIER ? (node.lastNamedChild?.text ?? null) : node.text;
	}
	if (node.type === ARRAY_TYPE || node.type === PAREN_TYPE) {
		const inner = node.namedChildren[0];
		return inner ? typeRefName(inner) : null;
	}
	if (node.type === UNION_TYPE || node.type === INTERSECTION_TYPE) {
		// Members are walked individually by the emitter; this arm keeps
		// recursion sane for nested composite types (e.g. `(A | B)[]`).
		const first = node.namedChildren[0];
		return first ? typeRefName(first) : null;
	}
	return null;
}

/**
 * Recursively emit 'type' reference edges for a type node.
 *
 * Walks the type AST depth-first emitting one edge per named type reference:
 *
 *   - `type_identifier` / `nested_type_identifier` / `generic_type` → the
 *     type's name, with the generic's `type_arguments` walked as 'generic'.
 *   - `union_type` / `intersection_type` → every member, tagged 'union' /
 *     'intersection'.
 *   - `array_type` / `parenthesized_type` → unwrapped (the array element /
 *     inner type).
 *   - structural types (object/tuple/function/conditional/template-literal)
 *     are not nameable themselves; their nested type children are still
 *     walked so `Promise<{ data: Foo }>` reaches Foo.
 *
 * @param node  the type node to walk (usually the `type_annotation`'s single
 *              named child, or a `constraint` / `type_arguments` member).
 * @param line  the 1-based declaration line of the owning symbol (caller site).
 * @param callerName  enclosing function/method name when determinable (the
 *                    declaration's own name for functions/methods; null for
 *                    class/interface/type-alias declarations).
 * @param role   the relation role for the emitted edges.
 * @param refs   reference accumulator.
 */
export function emitTypeRefs(
	node: TSNode,
	line: number,
	callerName: string | null,
	role: ReferenceRole,
	refs: ParsedReference[]
): void {
	if (NAMED_TYPE_NODES.has(node.type)) {
		const name = typeRefName(node);
		if (name) {
			refs.push({
				symbolName: name,
				callerFile: "",
				callerLine: line,
				callerName,
				kind: "type",
				role
			});
		}
		if (node.type === GENERIC_TYPE) {
			// `Foo<T, U>` — the type arguments are themselves types; emit each
			// as a 'generic' role edge (nested generics recurse naturally).
			const args = node.childForFieldName("type_arguments");
			if (args) {
				for (const arg of args.namedChildren) {
					emitTypeRefs(arg, line, callerName, "generic", refs);
				}
			}
		}
		return;
	}

	if (node.type === UNION_TYPE || node.type === INTERSECTION_TYPE) {
		const memberRole = node.type === UNION_TYPE ? "union" : "intersection";
		for (const member of node.namedChildren) {
			emitTypeRefs(member, line, callerName, memberRole, refs);
		}
		return;
	}

	if (node.type === ARRAY_TYPE || node.type === PAREN_TYPE) {
		const inner = node.namedChildren[0];
		if (inner) emitTypeRefs(inner, line, callerName, role, refs);
		return;
	}

	// Function types (e.g. `(cb: (a: Input) => Output)`): the parameters and
	// the return type are DISTINCT call sites — parameters get the 'parameter'
	// role, the return type gets 'return' (a nested function type must not
	// inherit the outer role, e.g. `Output` inside `Promise<...>` stays
	// 'return' even when the enclosing usage is a parameter). The `return_type`
	// field of `function_type` is a DIRECT type node (not a type_annotation),
	// and `parameters` is a `formal_parameters` node.
	if (node.type === "function_type" || node.type === "constructor_type") {
		const params = node.childForFieldName("parameters");
		if (params && params.type === FORMAL_PARAMETERS) {
			for (const p of params.namedChildren) {
				const ann = p.childForFieldName("type");
				if (!ann || ann.type !== TYPE_ANNOTATION) continue;
				for (const t of ann.namedChildren) {
					emitTypeRefs(t, line, callerName, "parameter", refs);
				}
			}
		}
		const ret = node.childForFieldName("return_type");
		if (ret) {
			emitTypeRefs(ret, line, callerName, "return", refs);
		}
		return;
	}

	// Structural / anonymous types (object_type, tuple_type, conditional_type,
	// template_literal_type, lookup_type, ...): not nameable themselves — walk
	// named children so nested named types are still found.
	for (const child of node.namedChildren) {
		emitTypeRefs(child, line, callerName, role, refs);
	}
}

/**
 * Emit type-reference edges for a single declaration's OWN type surface:
 * function/method parameters + return type, class/interface property types,
 * type-alias values, and generic constraint/type-argument bindings.
 *
 * Entry points (verified against tree-sitter-typescript node-types.json):
 *
 *   - `function_declaration` / `generator_function_declaration` /
 *     `arrow_function` / `function_expression` / `method_definition` /
 *     `method_signature` / `abstract_method_signature` / `call_signature` /
 *     `construct_signature` / `function_type` / `constructor_type`:
 *     `parameters` (formal_parameters → required/optional_parameter → `type`
 *     field = type_annotation) → 'parameter'; `return_type` field
 *     (type_annotation) → 'return'. `callerName` = the declared name (or null
 *     for anonymous functions).
 *   - `class_declaration` / `abstract_class_declaration`: properties
 *     (`public_field_definition` / `field_definition` → `type` field) →
 *     'property'; method definitions are handled by their own entry.
 *   - `interface_declaration`: `property_signature` members → 'property';
 *     `method_signature` members → parameters/return of the member.
 *   - `type_alias_declaration`: `value` field (type) → 'alias'.
 *   - Generic `type_parameters` (on functions/methods/classes/interfaces/
 *     aliases): each `type_parameter`'s `constraint` → 'constraint', and its
 *     `default_type` (value field) → 'generic' (a default binding is a
 *     type-level dependency).
 *
 * Type-annotation-less declarations emit nothing (existing behavior unchanged).
 */
export function emitTypeReferences(node: TSNode, declaredName: string | null, refs: ParsedReference[]): void {
	// Site lines are computed per-construct below (param/return/constraint/
	// alias/property), so the declaration's own start line is not used here.

	// ── Generic type parameters (constraints + defaults) — all declarations ──
	const ownTypeParams = node.namedChildren.find((c) => c.type === TYPE_PARAMETERS);
	if (ownTypeParams) {
		for (const param of ownTypeParams.namedChildren) {
			if (param.type !== TYPE_PARAMETER) continue;
			// The constraint/default site is the `type_parameter` itself (its
			// own line), not the declaration's start line.
			const siteLine = param.startPosition.row + 1;
			for (const child of param.namedChildren) {
				if (child.type === CONSTRAINT) {
					for (const target of child.namedChildren) {
						emitTypeRefs(target, siteLine, declaredName, "constraint", refs);
					}
				} else if (child.type === "default_type") {
					for (const target of child.namedChildren) {
						emitTypeRefs(target, siteLine, declaredName, "generic", refs);
					}
				}
			}
		}
	}

	// ── Function-like: parameters + return type ──
	const parameters = node.childForFieldName("parameters");
	if (parameters && parameters.type === FORMAL_PARAMETERS) {
		for (const p of parameters.namedChildren) {
			if (p.type !== REQUIRED_PARAMETER && p.type !== OPTIONAL_PARAMETER) continue;
			const ann = p.childForFieldName("type");
			if (!ann || ann.type !== TYPE_ANNOTATION) continue;
			// Caller site = the parameter's type annotation line.
			const siteLine = ann.startPosition.row + 1;
			for (const t of ann.namedChildren) {
				emitTypeRefs(t, siteLine, declaredName, "parameter", refs);
			}
		}
	}
	const returnType = node.childForFieldName("return_type");
	if (returnType && returnType.type === TYPE_ANNOTATION) {
		// Caller site = the return type annotation line.
		const siteLine = returnType.startPosition.row + 1;
		for (const t of returnType.namedChildren) {
			emitTypeRefs(t, siteLine, declaredName, "return", refs);
		}
	}

	// ── Class/interface properties & fields + type-alias values ──
	if (node.type === TYPE_ALIAS_DECLARATION) {
		const value = node.childForFieldName("value");
		if (value) {
			// The alias VALUE is a single type node (possibly union/intersection
			// — whose member roles are preserved by emitTypeRefs). Emitting it
			// once, rather than iterating its named children with role 'alias',
			// keeps union/intersection member roles intact.
			const siteLine = value.startPosition.row + 1;
			emitTypeRefs(value, siteLine, null, "alias", refs);
		}
	}
	if (
		node.type === "public_field_definition" ||
		node.type === "field_definition" ||
		node.type === "property_signature"
	) {
		const ann = node.childForFieldName("type");
		if (ann && ann.type === TYPE_ANNOTATION) {
			// Caller site = the property's type annotation line.
			const siteLine = ann.startPosition.row + 1;
			for (const t of ann.namedChildren) {
				emitTypeRefs(t, siteLine, declaredName, "property", refs);
			}
		}
	}
}
