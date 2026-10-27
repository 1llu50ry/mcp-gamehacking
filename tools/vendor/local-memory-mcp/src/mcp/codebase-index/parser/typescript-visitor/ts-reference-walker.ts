/**
 * Reference-extraction AST walker for the TypeScriptVisitor (TASK-556 split).
 *
 * Extracted from the visitor so the class body keeps only the two walkers.
 * This module owns the recursive reference walk: call/instantiation/import/
 * reexport emission, heritage edges, type-reference edges, and the
 * `callerName` threading through function/method bodies. Reference-edge
 * emission is delegated to ts-reference-emission (name helpers, imports,
 * heritage, type-refs) — this file only decides WHICH nodes emit and how to
 * descend. No visitor state is shared.
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference } from "../language-visitor";
import {
	ABSTRACT_CLASS_DECLARATION,
	ABSTRACT_METHOD_SIGNATURE,
	CALL_EXPRESSION,
	CLASS_DECLARATION,
	EXPORT_STATEMENT,
	FIELD_DEFINITION,
	IMPORT_STATEMENT,
	INTERFACE_DECLARATION,
	METHOD_DEFINITION,
	METHOD_SIGNATURE,
	NEW_EXPRESSION,
	PROPERTY_SIGNATURE,
	PUBLIC_FIELD_DEFINITION,
	TYPE_ALIAS_DECLARATION
} from "../ts-node-types";
import { getNameFromDeclaration } from "../ts-export-scanner";
import { symbolIdentifier } from "../ts-signature";
import {
	calledExpressionName,
	constructorName,
	emitHeritage,
	emitImports,
	emitReexports,
	emitTypeReferences
} from "../ts-reference-emission";

/** Best-effort name of a declaration/function node for caller attribution. */
function declaredName(node: TSNode): string | null {
	const name = getNameFromDeclaration(node);
	if (name) return name;
	return symbolIdentifier(node);
}

/**
 * Walk the tree emitting reference edges (TASK-236 / issue #64 call-site
 * refs, TASK-301 / Phase 1.1 heritage, TASK-008 / issue #82 type edges).
 *
 * Cheap single AST pass emitting only obvious call targets:
 * - `call_expression` → kind 'call' (the called identifier / last property
 *   of a member expression — e.g. `foo()` → 'foo', `ns.helper()` → 'helper').
 * - `new_expression` → kind 'instantiation' (the constructed class).
 * - `import_statement` → kind 'import' (each imported binding; default and
 *   named imports, minus import specifiers aliased to 'default').
 * - class/abstract class/interface declarations → kind 'extends'/'implements'
 *   per heritage target (`class Foo extends Bar implements I` emits Bar as
 *   'extends' and I as 'implements'; `interface A extends B` emits B as
 *   'extends'; `class Foo<T extends Bar>` emits Bar as 'extends').
 * - function/method/field/signature/alias declarations additionally emit
 *   'type' edges for their own type surface (TASK-008 / issue #82).
 *
 * `callerName` is the enclosing function/method name, tracked while
 * descending into function/method/arrow bodies (null for heritage edges —
 * they belong to the derived type's declaration). No attempt is made to
 * resolve symbols or follow aliases — we index the textual call target.
 */
export function walkReferenceTree(root: TSNode, refs: ParsedReference[]): void {
	walkReferences(root, null, refs);
}

function walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	switch (node.type) {
		case CALL_EXPRESSION: {
			const name = calledExpressionName(node);
			if (name) {
				refs.push({
					symbolName: name,
					callerFile: "",
					callerLine: node.startPosition.row + 1,
					callerName,
					kind: "call"
				});
			}
			// Recurse into children so nested calls (`foo().bar()`) are also
			// indexed — the enclosing name for the children is still the same.
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
		}
		case NEW_EXPRESSION: {
			const ctor = node.childForFieldName("constructor") ?? node.firstNamedChild;
			const name = constructorName(ctor);
			if (name) {
				refs.push({
					symbolName: name,
					callerFile: "",
					callerLine: node.startPosition.row + 1,
					callerName,
					kind: "instantiation"
				});
			}
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
		}
		case IMPORT_STATEMENT: {
			emitImports(node, callerName, refs);
			// Do NOT recurse into import children — the import clause itself is
			// the only meaningful reference surface here.
			return;
		}
		case EXPORT_STATEMENT: {
			const source = node.childForFieldName("source");
			if (source) {
				// Re-export-from (`export { X } from './mod'` / `export * from './mod'`):
				// emit the reexport edge(s); the clause carries no nested call sites.
				emitReexports(node, callerName, refs);
				return;
			}
			// Local exports (`export { x }`, `export const y = ...`): descend so
			// any call-site / type refs inside the exported declaration emit.
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
		}
		// Heritage edges (Phase 1.1 / TASK-301): emit 'extends'/'implements'
		// for the declaration's class heritage + generics constraints, then
		// recurse into the body so call-site refs inside members still emit.
		case CLASS_DECLARATION:
		case ABSTRACT_CLASS_DECLARATION:
		case INTERFACE_DECLARATION: {
			emitHeritage(node, refs);
			// Type edges (TASK-008 / issue #82): the declaration's own
			// generic constraints + (for interfaces) property/method type
			// surfaces. Class fields/methods are reached when the walker
			// descends into the body below. callerName is null at the
			// declaration level — only functions/methods carry their name
			// (constraint edges on classes/interfaces are attributed to the
			// declaration, i.e. no caller).
			emitTypeReferences(node, null, refs);
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
		}
		// Type-alias declarations (TASK-008 / issue #82): emit the alias
		// value's type edges + generic constraints, then descend so nested
		// call sites still emit.
		case TYPE_ALIAS_DECLARATION: {
			emitTypeReferences(node, declaredName(node), refs);
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
		}
		// Descend into function-like bodies, updating the enclosing caller name
		// so call sites inside them are attributed to the right function.
		case "function_declaration":
		case "generator_function_declaration":
		case "function_expression":
		case "arrow_function": {
			const fnName = declaredName(node);
			// Type edges (TASK-008 / issue #82): parameter + return types of
			// the function's own signature.
			emitTypeReferences(node, fnName, refs);
			for (const child of node.namedChildren) {
				walkReferences(child, fnName ?? callerName, refs);
			}
			return;
		}
		case METHOD_DEFINITION: {
			const methodName = declaredName(node) ?? symbolIdentifier(node);
			// Type edges: the method's own parameter + return types.
			emitTypeReferences(node, methodName, refs);
			for (const child of node.namedChildren) {
				walkReferences(child, methodName ?? callerName, refs);
			}
			return;
		}
		case METHOD_SIGNATURE:
		case ABSTRACT_METHOD_SIGNATURE: {
			// Type edges for interface/abstract method signatures — these
			// have no body to descend into, so emit + return.
			const sigName = declaredName(node) ?? symbolIdentifier(node);
			emitTypeReferences(node, sigName, refs);
			return;
		}
		case PUBLIC_FIELD_DEFINITION:
		case FIELD_DEFINITION:
		case PROPERTY_SIGNATURE: {
			// Type edges for class fields / interface properties.
			emitTypeReferences(node, callerName, refs);
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
			return;
		}
		default:
			for (const child of node.namedChildren) {
				walkReferences(child, callerName, refs);
			}
	}
}
