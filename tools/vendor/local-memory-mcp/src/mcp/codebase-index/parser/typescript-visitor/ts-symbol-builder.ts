/**
 * ParsedSymbol construction helpers for the TypeScriptVisitor (TASK-556 split).
 *
 * Pure, tree-state-free symbol construction: turns a declaration / member /
 * declarator node into a {@link ParsedSymbol}. Extracted from the visitor so
 * the class body keeps only the AST walkers (symbol walk + reference walk).
 *
 * Export resolution is name-set based (`exportedNames` / `defaultExportNames`
 * come from the ts-export-scanner pre-scan), decorators ride on the signature
 * via ts-signature's `collectDecorators` + `withDecorators`, and doc comments
 * come from ts-doc-comment. Behavior is byte-for-byte identical to the
 * pre-split inline code — symbol output is unchanged.
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import {
	ABSTRACT_CLASS_DECLARATION,
	CLASS_DECLARATION,
	ENUM_DECLARATION,
	FUNCTION_DECLARATION,
	GENERATOR_FUNCTION_DECLARATION,
	INTERFACE_DECLARATION,
	METHOD_DEFINITION,
	PROPERTY_IDENTIFIER,
	TYPE_ALIAS_DECLARATION
} from "../ts-node-types";
import { getNameFromDeclaration } from "../ts-export-scanner";
import { extractDocComment } from "../ts-doc-comment";
import { buildSignature, collectDecorators, symbolIdentifier, withDecorators } from "../ts-signature";

/**
 * Map a declaration node type to its {@link SymbolKind}.
 * Returns null for node types that are not themselves symbols.
 */
export function nodeTypeToKind(nodeType: string): SymbolKind | null {
	switch (nodeType) {
		case FUNCTION_DECLARATION:
		case GENERATOR_FUNCTION_DECLARATION:
			return SymbolKind.Function;
		case CLASS_DECLARATION:
		case ABSTRACT_CLASS_DECLARATION:
			return SymbolKind.Class;
		case INTERFACE_DECLARATION:
			return SymbolKind.Interface;
		case TYPE_ALIAS_DECLARATION:
			return SymbolKind.Type;
		case ENUM_DECLARATION:
			return SymbolKind.Enum;
		case METHOD_DEFINITION:
			return SymbolKind.Method;
		default:
			return null;
	}
}

/** The export-resolution context threaded through symbol construction. */
export interface SymbolExportContext {
	exportedNames: Set<string>;
	defaultExportNames: Set<string>;
}

/**
 * Build a ParsedSymbol for a class/interface/enum member (never top-level).
 * Members are never exported — `exported`/`defaultExport` are always false.
 */
export function buildMemberSymbol(
	node: TSNode,
	name: string,
	kind: SymbolKind,
	parentName: string | null
): ParsedSymbol {
	const decorators = collectDecorators(node);
	return {
		name,
		kind,
		startLine: node.startPosition.row + 1,
		startCol: node.startPosition.column + 1,
		endLine: node.endPosition.row + 1,
		endCol: node.endPosition.column + 1,
		signature: withDecorators(buildSignature(node), decorators),
		docComment: extractDocComment(node),
		exported: false,
		defaultExport: false,
		parentName
	};
}

/**
 * Build a ParsedSymbol for a top-level declaration, declarator, or member.
 * Class members (Property/Method) are named by their `property_identifier`,
 * which wins over the first named child — the latter may be an
 * `accessibility_modifier` (`private readonly apiKey` would otherwise be
 * named "private").
 */
export function buildSymbol(
	node: TSNode,
	kind: SymbolKind,
	parentName: string | null,
	exportContext: SymbolExportContext
): ParsedSymbol {
	// Resolve the name
	let name: string;
	if (node.type === "variable_declarator") {
		name = node.firstNamedChild?.text ?? "unknown";
	} else if (kind === SymbolKind.Property || kind === SymbolKind.Method) {
		// Class members are named by their `property_identifier`. Prefer it over
		// the first named child, which may be an `accessibility_modifier`
		// (`private readonly apiKey` would otherwise be named "private").
		name = symbolIdentifier(node) ?? node.descendantsOfType(PROPERTY_IDENTIFIER)[0]?.text ?? "unknown";
	} else {
		// Top-level declarations; skip decorators (bare `@Injectable() class Foo {}`).
		name = getNameFromDeclaration(node) ?? node.namedChildren[0]?.text ?? "unknown";
	}

	const exported = exportContext.exportedNames.has(name);
	const defaultExport = exportContext.defaultExportNames.has(name);

	const decorators = collectDecorators(node);

	return {
		name,
		kind,
		startLine: node.startPosition.row + 1,
		startCol: node.startPosition.column + 1,
		endLine: node.endPosition.row + 1,
		endCol: node.endPosition.column + 1,
		signature: withDecorators(buildSignature(node), decorators),
		docComment: extractDocComment(node),
		exported,
		defaultExport,
		parentName
	};
}

/**
 * Build a ParsedSymbol for a `variable_declarator` child of a
 * `variable_declaration` / `lexical_declaration`. A declarator whose value is
 * an arrow function is classified as a Function, otherwise Variable.
 */
export function buildDeclaratorSymbol(
	declarator: TSNode,
	parentName: string | null,
	exportContext: SymbolExportContext
): ParsedSymbol {
	const valueNode = declarator.namedChildren[1];
	const isFunction = valueNode?.type === "arrow_function";
	const kind = isFunction ? SymbolKind.Function : SymbolKind.Variable;

	return buildSymbol(declarator, kind, parentName, exportContext);
}
