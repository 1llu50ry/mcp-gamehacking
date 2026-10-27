/**
 * 'extends' / 'implements' heritage reference emission for the
 * TypeScriptVisitor (extracted from ts-reference-emission during the
 * TASK-552 split). TASK-301, Phase 1.1.
 *
 * Emits one heritage edge per target inside a heritage clause (class
 * `extends_clause` / `implements_clause`, interface `extends_type_clause`)
 * plus generics-constraint heritage edges. Purely structural lookups over the
 * AST — name-based resolution per ADR-002 happens at query time, not parse.
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference } from "../language-visitor";
import {
	CLASS_HERITAGE,
	CONSTRAINT,
	EXTENDS_CLAUSE,
	EXTENDS_TYPE_CLAUSE,
	GENERIC_TYPE,
	IMPLEMENTS_CLAUSE,
	INTERFACE_DECLARATION,
	MEMBER_EXPRESSION,
	NESTED_TYPE_IDENTIFIER,
	TYPE_IDENTIFIER,
	TYPE_PARAMETER,
	TYPE_PARAMETERS
} from "../ts-node-types";
import { memberPropertyName } from "./name-helpers";

/**
 * Resolve the name-based target of a single heritage element.
 *
 * Per ADR-002 (name-based resolution, no LSP / type resolution), the edge
 * references the LAST name segment of the heritage target as written:
 *
 *   - `identifier` / `type_identifier`        → `Foo`        (extends Foo / implements I)
 *   - `member_expression`                     → `Base`       (extends ns.Base)
 *   - `nested_type_identifier`                → `Iface`      (implements UI.Iface)
 *   - `generic_type`                          → `Foo`        (extends Foo<T> / implements I<U>)
 *
 * Returns null for non-name elements (parenthesized expressions, predefined
 * types, etc.) so no edge is emitted for unresolvable heritage sites.
 */
export function heritageTargetName(node: TSNode): string | null {
	if (node.type === MEMBER_EXPRESSION) return memberPropertyName(node);
	if (node.type === NESTED_TYPE_IDENTIFIER) return node.lastNamedChild?.text ?? null;
	if (node.type === GENERIC_TYPE) {
		// `Foo<T>` — the generic type identifier is the first named child.
		const base = node.namedChildren[0];
		return base ? base.text : null;
	}
	if (node.type === TYPE_IDENTIFIER || node.type === "identifier") return node.text;
	return null;
}

/**
 * Emit one heritage edge per target inside a heritage clause.
 *
 * @param clause   `extends_clause` / `implements_clause` / `extends_type_clause`
 * @param kind     'extends' or 'implements'
 * @param line     1-based declaration line of the derived type (caller site)
 * @param refs     reference accumulator
 */
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
 * Emit 'extends' / 'implements' heritage edges for a class, abstract class or
 * interface declaration (TASK-301, Phase 1.1).
 *
 * Grammar (tree-sitter-typescript, verified empirically against the shipped
 * WASM): class heritage lives in a `class_heritage` node containing
 * `extends_clause` + `implements_clause` children; interface heritage is a
 * direct `extends_type_clause` child of `interface_declaration`. Type-parameter
 * constraints (`class Foo<T extends Bar>`) emit an 'extends' edge to the
 * constraint's type reference (generics basics).
 *
 * `callerName` is null per the ParsedReference heritage contract — the edge
 * belongs to the derived type's declaration, not an enclosing function.
 * `targetFile`/`targetSymbolId` are left null: name-based resolution per
 * ADR-002 happens at query time, not parse time.
 */
export function emitHeritage(node: TSNode, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;

	// Class heritage: `class Foo extends Bar implements I1, I2`.
	const classHeritage = node.namedChildren.find((c) => c.type === CLASS_HERITAGE);
	if (classHeritage) {
		for (const clause of classHeritage.namedChildren) {
			if (clause.type === EXTENDS_CLAUSE) emitHeritageTargets(clause, "extends", line, refs);
			else if (clause.type === IMPLEMENTS_CLAUSE) emitHeritageTargets(clause, "implements", line, refs);
		}
	}

	// Interface heritage: `interface A extends B, C` (no class_heritage wrapper).
	if (node.type === INTERFACE_DECLARATION) {
		const extClause = node.namedChildren.find((c) => c.type === EXTENDS_TYPE_CLAUSE);
		if (extClause) emitHeritageTargets(extClause, "extends", line, refs);
	}

	// Generics basics: `class Foo<T extends Bar>` → 'extends' edge to Bar.
	// Only the declaration's OWN type_parameters (direct child) — method-level
	// generics (private m<T extends U>()) are out of heritage scope.
	const ownTypeParams = node.namedChildren.find((c) => c.type === TYPE_PARAMETERS);
	if (ownTypeParams) {
		for (const param of ownTypeParams.namedChildren) {
			if (param.type !== TYPE_PARAMETER) continue;
			const constraint = param.namedChildren.find((c) => c.type === CONSTRAINT);
			if (!constraint) continue;
			for (const target of constraint.namedChildren) {
				const name = heritageTargetName(target);
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
	}
}
