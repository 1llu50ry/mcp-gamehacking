/**
 * Shared helpers for tree-sitter language visitors.
 *
 * Pure functions (no visitor state) reused across language-specific visitors to
 * avoid duplicating identical logic (TASK-431 refactor). Behavior is
 * byte-for-byte equivalent to the inline `buildSignature` that previously lived
 * in every visitor, so symbol output is unchanged.
 */

import type { Node as TSNode } from "web-tree-sitter";

/**
 * Build a symbol `signature` from the first source line of a node, with all runs
 * of whitespace collapsed to a single space and trimmed (leading/trailing).
 *
 * Identical to the inline `buildSignature` previously duplicated in every
 * language visitor (php/cpp/kotlin/swift/java/rust/dart/c/ruby/go/c-visitor).
 */
export function buildFirstLineSignature(node: TSNode): string {
	const firstLine = node.text.split("\n")[0] ?? "";
	return firstLine.replace(/\s+/g, " ").trim();
}
