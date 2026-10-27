/**
 * Symbol-extraction AST walker for the TypeScriptVisitor (TASK-556 split).
 *
 * Extracted from the visitor so the class body keeps only the two walkers.
 * This module owns the recursive symbol walk: top-level declaration dispatch,
 * `export_statement` unwrapping, class-body member extraction (stateful
 * `insideClass` descent), interface members, enum members, and variable
 * declarators. Symbol construction is delegated to ts-symbol-builder, export
 * pre-scanning to ts-export-scanner — no visitor state is shared.
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import {
	ABSTRACT_CLASS_DECLARATION,
	ABSTRACT_METHOD_SIGNATURE,
	CLASS_BODY,
	CLASS_DECLARATION,
	ENUM_ASSIGNMENT,
	ENUM_BODY,
	ENUM_DECLARATION,
	EXPORT_STATEMENT,
	FIELD_DEFINITION,
	FUNCTION_DECLARATION,
	GENERATOR_FUNCTION_DECLARATION,
	INTERFACE_BODY,
	INTERFACE_DECLARATION,
	INDEX_SIGNATURE,
	LEXICAL_DECLARATION,
	METHOD_DEFINITION,
	METHOD_SIGNATURE,
	PROPERTY_IDENTIFIER,
	PROPERTY_SIGNATURE,
	PUBLIC_FIELD_DEFINITION,
	TYPE_ALIAS_DECLARATION,
	VARIABLE_DECLARATION
} from "../ts-node-types";
import { scanExports, getNameFromDeclaration } from "../ts-export-scanner";
import { symbolIdentifier } from "../ts-signature";
import {
	buildDeclaratorSymbol,
	buildMemberSymbol,
	buildSymbol,
	nodeTypeToKind,
	type SymbolExportContext
} from "./ts-symbol-builder";

/** The set of node types that represent top-level declarations. */
const TOP_LEVEL_TYPES = new Set([
	FUNCTION_DECLARATION,
	GENERATOR_FUNCTION_DECLARATION,
	CLASS_DECLARATION,
	ABSTRACT_CLASS_DECLARATION,
	INTERFACE_DECLARATION,
	TYPE_ALIAS_DECLARATION,
	ENUM_DECLARATION,
	LEXICAL_DECLARATION,
	VARIABLE_DECLARATION
]);

/** The kinds of class members extracted inside a class body. */
const CLASS_MEMBER_KINDS = new Set([
	METHOD_DEFINITION,
	ABSTRACT_METHOD_SIGNATURE,
	PUBLIC_FIELD_DEFINITION,
	FIELD_DEFINITION
]);

/**
 * Walk a parsed tree root and extract all symbols (export pre-scan +
 * recursive descent). Mirrors the visitor's original extractSymbols flow.
 */
export function walkSymbolTree(root: TSNode, symbols: ParsedSymbol[]): void {
	const { exportedNames, defaultExportNames } = scanExports(root);
	walkSymbolNode(root, symbols, null, { exportedNames, defaultExportNames }, false);
}

function walkSymbolNode(
	node: TSNode,
	symbols: ParsedSymbol[],
	parentName: string | null,
	exportContext: SymbolExportContext,
	insideClass: boolean
): void {
	// If we're inside a class/interface, only look for members, skip nested declarations
	if (insideClass) {
		if (CLASS_MEMBER_KINDS.has(node.type)) {
			const kind =
				node.type === METHOD_DEFINITION || node.type === ABSTRACT_METHOD_SIGNATURE
					? SymbolKind.Method
					: SymbolKind.Property;
			symbols.push(buildSymbol(node, kind, parentName, exportContext));
		}
		// Recurse into children of the class body (decorators, nested getters, etc.)
		for (const child of node.namedChildren) {
			walkSymbolNode(child, symbols, parentName, exportContext, true);
		}
		return;
	}

	const type = node.type;

	if (TOP_LEVEL_TYPES.has(type)) {
		if (type === LEXICAL_DECLARATION || type === VARIABLE_DECLARATION) {
			handleVariableDeclaration(node, symbols, parentName, exportContext);
		} else {
			handleDeclaration(node, symbols, parentName, exportContext);
		}
		return;
	}

	// Handle export statements wrapping declarations
	if (node.type === EXPORT_STATEMENT) {
		// Already pre-scanned for export names; just recurse to find declarations
		for (const child of node.namedChildren) {
			if (TOP_LEVEL_TYPES.has(child.type)) {
				if (child.type === LEXICAL_DECLARATION || child.type === VARIABLE_DECLARATION) {
					handleVariableDeclaration(child, symbols, parentName, exportContext);
				} else {
					handleDeclaration(child, symbols, parentName, exportContext);
				}
			}
		}
		return;
	}

	// Recurse into children for any node we haven't explicitly handled
	for (const child of node.namedChildren) {
		walkSymbolNode(child, symbols, parentName, exportContext, false);
	}
}

function handleDeclaration(
	node: TSNode,
	symbols: ParsedSymbol[],
	parentName: string | null,
	exportContext: SymbolExportContext
): void {
	const kind = nodeTypeToKind(node.type);
	if (!kind) return;

	const name = getNameFromDeclaration(node);
	if (!name) return;

	symbols.push(buildSymbol(node, kind, parentName, exportContext));

	// Recurse into class body for methods/properties. All class members share
	// the class's parent context — decorators on individual members are
	// resolved via their own preceding-sibling decorator nodes.
	if (node.type === CLASS_DECLARATION || node.type === ABSTRACT_CLASS_DECLARATION) {
		const body = node.descendantsOfType(CLASS_BODY)[0];
		if (body) {
			walkSymbolNode(body, symbols, name, exportContext, true);
		}
	}

	// Emit interface members (properties, methods) parented to the interface.
	if (node.type === INTERFACE_DECLARATION) {
		handleInterfaceMembers(name, node, symbols);
	}

	// Emit enum members (constants) parented to the enum.
	if (node.type === ENUM_DECLARATION) {
		handleEnumMembers(name, node, symbols);
	}
}

/** Emit `property_signature`/`method_signature` members as Property/Method symbols. */
function handleInterfaceMembers(interfaceName: string, node: TSNode, symbols: ParsedSymbol[]): void {
	const body = node.namedChildren.find((c) => c.type === INTERFACE_BODY);
	if (!body) return;

	for (const member of body.namedChildren) {
		switch (member.type) {
			case PROPERTY_SIGNATURE:
				symbols.push(
					buildMemberSymbol(member, symbolIdentifier(member) ?? "unknown", SymbolKind.Property, interfaceName)
				);
				break;
			case METHOD_SIGNATURE:
				// In this grammar version (tree-sitter-typescript ^0.23) interface
				// getters/setters parse as `method_signature`, whose first child
				// is the anonymous `get`/`set` keyword — the same as plain methods.
				// They are intentionally emitted as Method (consistent with class
				// accessors, which parse as `method_definition` → Method).
				symbols.push(
					buildMemberSymbol(member, symbolIdentifier(member) ?? "unknown", SymbolKind.Method, interfaceName)
				);
				break;
			// `[key: string]: unknown` index signatures have no single identifier —
			// skip them rather than fabricate a misleading name.
			case INDEX_SIGNATURE:
			default:
				break;
		}
	}
}

/** Emit enum members (with or without explicit values) as Constant symbols. */
function handleEnumMembers(enumName: string, node: TSNode, symbols: ParsedSymbol[]): void {
	const body = node.namedChildren.find((c) => c.type === ENUM_BODY);
	if (!body) return;

	for (const member of body.namedChildren) {
		if (member.type === ENUM_ASSIGNMENT) {
			const memberName = member.namedChildren[0]?.text ?? "unknown";
			symbols.push(buildMemberSymbol(member, memberName, SymbolKind.Constant, enumName));
		} else if (member.type === PROPERTY_IDENTIFIER) {
			// Bare member without an explicit value: `enum { Red, Green }`.
			symbols.push(buildMemberSymbol(member, member.text, SymbolKind.Constant, enumName));
		}
	}
}

function handleVariableDeclaration(
	node: TSNode,
	symbols: ParsedSymbol[],
	parentName: string | null,
	exportContext: SymbolExportContext
): void {
	for (const declarator of node.descendantsOfType("variable_declarator")) {
		const nameNode = declarator.firstNamedChild;
		if (!nameNode) continue;

		symbols.push(buildDeclaratorSymbol(declarator, parentName, exportContext));
	}
}
