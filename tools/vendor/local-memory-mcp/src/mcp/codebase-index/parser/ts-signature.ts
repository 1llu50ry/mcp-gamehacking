/**
 * Signature & name helpers for the TypeScriptVisitor (TASK-267 split).
 *
 * Builds the human-readable one-line `signature` for a declaration/member node
 * — preserving accessibility modifiers (`private readonly`), the `readonly`
 * keyword, type annotations, generic `type_parameters` and applied decorators
 * — and resolves the identifier name of a node. Shared by the symbol walker,
 * the export scanner and the reference walker.
 */

import type { Node as TSNode } from "web-tree-sitter";
import { DECORATOR, PROPERTY_IDENTIFIER } from "./ts-node-types";

/** Collapse whitespace/newlines in a source snippet to a single line. */
function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Collect decorator texts applied directly to a node.
 *
 * tree-sitter-typescript models decorators in two ways:
 * - A `decorator` node that is a NAMED CHILD of the declaration
 *   (e.g. `class_declaration` for `@Injectable() class Foo {}`).
 * - A `decorator` node that is the PRECEDING SIBLING of the declaration
 *   (e.g. a decorated method inside `class_body`, or `@Injectable() class`
 *   nested inside an `export_statement`).
 *
 * Returns the decorator texts in source order (e.g. `["@Injectable()"]`).
 */
export function collectDecorators(node: TSNode): string[] {
	const decorators: string[] = [];

	// Direct named children (bare decorated classes).
	for (const child of node.namedChildren) {
		if (child.type === DECORATOR) {
			decorators.push(normalizeText(child.text));
		}
	}

	// Preceding sibling decorators (decorated methods, exported decorated classes).
	let sibling: TSNode | null = node.previousNamedSibling;
	while (sibling && sibling.type === DECORATOR) {
		decorators.unshift(normalizeText(sibling.text));
		sibling = sibling.previousNamedSibling;
	}

	return decorators;
}

/**
 * Build a human-readable signature from the declaration.
 *
 * Returns the first meaningful source line of the declaration normalized to a
 * single line, which naturally preserves accessibility modifiers
 * (`private readonly`), the `readonly` keyword, type annotations, and generic
 * `type_parameters` (e.g. `function foo<T>(x: T): T`).
 *
 * When the node carries decorator children (decorated fields/methods/classes),
 * their exact span is stripped from the output so the base signature is the
 * declaration itself — the decorators are then re-prefixed by the caller.
 */
export function buildSignature(node: TSNode): string {
	let text = node.text;

	// Strip decorator child spans. Decorators are re-added as a prefix by
	// `withDecorators()`, so without this they would leak into (duplicate) the
	// base signature and truncate the real declaration line.
	for (const child of node.namedChildren) {
		if (child.type === DECORATOR) {
			text = text.replace(child.text, "");
		}
	}

	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	return normalizeText(lines[0] ?? "");
}

/** Whether a node represents a declarable identifier (class/type/function name or property). */
export function isNameNode(node: TSNode): boolean {
	switch (node.type) {
		case "identifier":
		case "type_identifier":
		case PROPERTY_IDENTIFIER:
		case "shorthand_property_identifier_pattern":
			return true;
		default:
			return false;
	}
}

/** Return the first yielded child that carries a declarable identifier name. */
export function symbolIdentifier(node: TSNode): string | null {
	for (const child of node.namedChildren) {
		if (isNameNode(child)) return child.text;
	}
	return null;
}

/** Prefix decorator texts to a signature, e.g. `@Injectable() class Foo {`. */
export function withDecorators(signature: string, decorators: string[]): string {
	if (decorators.length === 0) return signature;
	return decorators.concat([signature]).join(" ");
}
