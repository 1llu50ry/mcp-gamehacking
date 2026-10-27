/**
 * PhpVisitor signature-builders (TASK-431 refactor).
 *
 * Pure helpers that render a structured `signature` for a function_definition or
 * method_declaration node. Extracted from php-visitor.ts so the visitor file
 * stays focused on AST traversal. Mirrors the `*-reference-emission.ts`
 * precedent (no visitor state — each function takes its nodes explicitly).
 *
 * Signature shape (read off the formal_parameters / return_type / modifier nodes
 * of the php_only grammar, verified empirically against the shipped WASM):
 *   `[#attrs ]visibility? static?/abstract?/final?/readonly? name(params): returnType`
 * Functions/methods without an explicit return type omit the `: type` suffix.
 * Whitespace is collapsed to a single space so the result is a clean one-liner.
 */

import type { Node as TSNode } from "web-tree-sitter";

const ATTRIBUTE_GROUP = "attribute_group";
const VISIBILITY_MODIFIER = "visibility_modifier";
const STATIC_MODIFIER = "static_modifier";
const ABSTRACT_MODIFIER = "abstract_modifier";
const FINAL_MODIFIER = "final_modifier";
const READONLY_MODIFIER = "readonly_modifier";
const SIMPLE_PARAMETER = "simple_parameter";
const VARIADIC_PARAMETER = "variadic_parameter";
const PROPERTY_PROMOTION_PARAMETER = "property_promotion_parameter";

/**
 * Build a structured signature for a function_definition or
 * method_declaration node: `visibility? static? name(params): returnType`.
 *
 * Parameters are rendered per formal_parameters child preserving each param's
 * type, by-ref/variadic marker, default value and (for promoted constructor
 * params) visibility/readonly modifiers. The return type is read from the
 * `return_type` field; functions without an explicit return type omit the
 * `: type` suffix. Whitespace is collapsed to a single space so the result is a
 * clean one-liner.
 */
export function buildFunctionSignature(funcNode: TSNode, name: string): string {
	const attributes = extractAttributesPrefix(funcNode);
	const prefix = extractMethodModifiers(funcNode);
	const params = extractParameters(funcNode.childForFieldName("parameters"));
	const returnType = extractReturnType(funcNode);
	let signature = `${attributes}${prefix}${name}(${params})`;
	if (returnType) {
		signature += `: ${returnType}`;
	}
	return signature;
}

/**
 * Collect PHP 8 attributes (`#[Route('/api')]`, `#[Attribute]`) that precede
 * a declaration as a space-separated prefix (e.g. `#[Route('/api')] `).
 *
 * The `attributes` field of a method/function/class/property declaration
 * holds a single attribute_list node whose named children are the
 * attribute_group nodes — each rendered verbatim as `#[Attr(arg)]`. Multiple
 * groups (`#[A] #[B]`) are joined with a single space. Declarations without
 * attributes return an empty string, so no prefix is prepended.
 */
function extractAttributesPrefix(node: TSNode): string {
	const attrList = node.childForFieldName("attributes");
	if (!attrList) return "";
	const groups = attrList.namedChildren.filter((c) => c.type === ATTRIBUTE_GROUP);
	if (groups.length === 0) return "";
	const rendered = groups.map((g) => g.text.replace(/\s+/g, " ").trim()).join(" ");
	return `${rendered} `;
}

/**
 * Collect visibility (public/protected/private) and static/abstract/final/
 * readonly modifiers from a method_declaration property_declaration node as
 * a space-separated prefix (e.g. `protected static `). Modifier nodes are
 * named children, not fields; their source order is preserved. Functions have
 * no modifiers, so the prefix is empty.
 */
function extractMethodModifiers(node: TSNode): string {
	const parts: string[] = [];
	for (const child of node.namedChildren) {
		if (
			child.type === VISIBILITY_MODIFIER ||
			child.type === STATIC_MODIFIER ||
			child.type === ABSTRACT_MODIFIER ||
			child.type === FINAL_MODIFIER ||
			child.type === READONLY_MODIFIER
		) {
			parts.push(child.text);
		}
	}
	return parts.length > 0 ? `${parts.join(" ")} ` : "";
}

/**
 * Format the parameters of a formal_parameters node as `Type $a, Type &$b,
 * Type ...$c`.
 *
 * Each named child is one of simple_parameter, variadic_parameter or
 * property_promotion_parameter. A param's optional type lives in the
 * `type` field (named_type, primitive_type, optional_type, union_type,
 * intersection_type, ...), its name in the `name` field (variable_name,
 * or by_ref for promoted by-reference params), its optional default in the
 * `default_value` field, and an optional `reference_modifier` field marks
 * by-ref params. Promoted params may carry visibility/readonly modifiers
 * which are preserved in the rendered output. Empty params return an empty
 * string so the caller wraps it in `()`.
 */
function extractParameters(formalParamsNode: TSNode | null): string {
	if (!formalParamsNode) return "";
	const parts: string[] = [];
	for (const param of formalParamsNode.namedChildren) {
		if (
			param.type !== SIMPLE_PARAMETER &&
			param.type !== VARIADIC_PARAMETER &&
			param.type !== PROPERTY_PROMOTION_PARAMETER
		) {
			continue;
		}
		const typeNode = param.childForFieldName("type");
		const nameNode = param.childForFieldName("name");
		const referenceNode = param.childForFieldName("reference_modifier");
		const defaultNode = param.childForFieldName("default_value");

		let rendered = "";
		// Promoted constructor params: `private readonly string $title`
		if (param.type === PROPERTY_PROMOTION_PARAMETER) {
			const promotions: string[] = [];
			for (const child of param.namedChildren) {
				if (child.type === VISIBILITY_MODIFIER || child.type === READONLY_MODIFIER) {
					promotions.push(child.text);
				}
			}
			if (promotions.length > 0) rendered += `${promotions.join(" ")} `;
		}
		if (typeNode) rendered += `${typeNode.text} `;
		// By-ref `&` and variadic `...` are unnamed children of the parameter;
		// prefix them directly onto the name so output is `&$y` / `...$parts`.
		if (referenceNode) rendered += `${referenceNode.text}`;
		if (param.type === VARIADIC_PARAMETER) rendered += "...";
		if (nameNode) rendered += nameNode.text;
		if (defaultNode) rendered += ` = ${defaultNode.text.replace(/\s+/g, " ").trim()}`;
		parts.push(rendered.trim());
	}
	return parts.join(", ");
}

/**
 * Extract the return type of a function_definition or method_declaration
 * node, or null when no return type is declared.
 *
 * The `return_type` field covers every type shape the grammar emits
 * (named_type, primitive_type, optional_type, union_type, intersection_type,
 * bottom_type, ...), so its text is used as-is with whitespace collapsed.
 */
function extractReturnType(funcNode: TSNode): string | null {
	const returnTypeNode = funcNode.childForFieldName("return_type");
	if (!returnTypeNode) return null;
	const type = returnTypeNode.text.replace(/\s+/g, " ").trim();
	return type.length > 0 ? type : null;
}
