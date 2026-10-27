/**
 * Doc-comment extraction for the TypeScriptVisitor (TASK-267 split).
 *
 * Find the JSDoc comment immediately preceding a node and serialize it as a
 * structured, searchable summary + tags string (see doc-comment.ts).
 *
 * The comment is usually the node's previous named sibling (verified against
 * the live WASM AST for functions, class members and fields). Two cases need
 * special handling:
 * - `export function foo() {...}` wraps the declaration in an `export_statement`,
 *   so the inner declaration's previous sibling is empty — climb to the export
 *   statement to find the JSDoc that precedes it.
 * - Decorated members are preceded by a `decorator` sibling, not the comment —
 *   the loop continues past the decorator to find the JSDoc.
 */

import type { Node as TSNode } from "web-tree-sitter";
import { serializeDocBlock } from "./doc-comment";
import { COMMENT, DECORATOR } from "./ts-node-types";

export function extractDocComment(node: TSNode): string | null {
	let sibling: TSNode | null = node.previousNamedSibling;

	// Declarations wrapped in `export ...` have no preceding sibling of their
	// own; the JSDoc siblings the export_statement instead.
	if (!sibling && node.parent && node.parent.type === "export_statement") {
		sibling = node.parent.previousNamedSibling;
	}

	while (sibling) {
		if (sibling.type === COMMENT) {
			const text = sibling.text;
			if (text.startsWith("/**") || text.startsWith("///")) {
				return serializeDocBlock(text);
			}
		}
		// Only continue through comment / decorator siblings. Stopping at any
		// other node (another declaration, statement, etc.) prevents grabbing a
		// comment that actually belongs to a *previous* symbol.
		if (sibling.type !== DECORATOR) break;
		sibling = sibling.previousNamedSibling;
	}

	return null;
}
