/**
 * Export pre-scan for the TypeScriptVisitor (TASK-267 split).
 *
 * Walks the whole tree once before symbol extraction to build the set of
 * exported names and default-exported names, so the `exported`/`defaultExport`
 * flags can be resolved without re-scanning per declaration. Also hosts the
 * shared declaration-name helpers (`getNameFromDeclaration`,
 * `getDeclaredNames`) used by the symbol walker and the export scan alike.
 */

import type { Node as TSNode } from "web-tree-sitter";
import { isNameNode } from "./ts-signature";
import {
	ABSTRACT_CLASS_DECLARATION,
	CLASS_DECLARATION,
	DECORATOR,
	ENUM_DECLARATION,
	EXPORT_SPECIFIER,
	EXPORT_STATEMENT,
	FUNCTION_DECLARATION,
	GENERATOR_FUNCTION_DECLARATION,
	INTERFACE_DECLARATION,
	LEXICAL_DECLARATION,
	NAMED_EXPORTS,
	TYPE_ALIAS_DECLARATION,
	VARIABLE_DECLARATION
} from "./ts-node-types";

/** Declaration node types an `export` statement can wrap or declare. */
const EXPORTABLE_DECLARATIONS = [
	FUNCTION_DECLARATION,
	GENERATOR_FUNCTION_DECLARATION,
	CLASS_DECLARATION,
	ABSTRACT_CLASS_DECLARATION,
	INTERFACE_DECLARATION,
	TYPE_ALIAS_DECLARATION,
	ENUM_DECLARATION,
	VARIABLE_DECLARATION,
	LEXICAL_DECLARATION
];

/**
 * Pre-scan export statements to build a map of exported names.
 * Returns sets of exported names and default-exported names.
 */
export function scanExports(root: TSNode): {
	exportedNames: Set<string>;
	defaultExportNames: Set<string>;
} {
	const exportedNames = new Set<string>();
	const defaultExportNames = new Set<string>();

	function walk(node: TSNode): void {
		if (node.type === EXPORT_STATEMENT) {
			// Check for default keyword
			for (const child of node.children) {
				if (child.type === "default") {
					const declaration = node.children.find(
						(c: TSNode): boolean => c.isNamed && EXPORTABLE_DECLARATIONS.includes(c.type)
					);
					if (declaration) {
						const name = getNameFromDeclaration(declaration);
						if (name) {
							defaultExportNames.add(name);
							exportedNames.add(name);
						}
					} else {
						const afterDefault = node.children
							.slice(node.children.indexOf(child) + 1)
							.find((c: TSNode): boolean => c.isNamed);
						if (afterDefault?.type === "identifier") {
							defaultExportNames.add(afterDefault.text);
							exportedNames.add(afterDefault.text);
						}
					}
					break;
				}
			}

			// Named export: export { x, y as z }
			const exportClause = node.descendantsOfType(NAMED_EXPORTS)[0];
			if (exportClause) {
				for (const spec of exportClause.children) {
					if (spec.type === EXPORT_SPECIFIER) {
						const nameNode = spec.namedChildren[0];
						if (nameNode) exportedNames.add(nameNode.text);
					}
				}
			}

			// export const/let/function/class (bare export)
			const bareDeclaration = node.children
				.slice(1)
				.find((c: TSNode): boolean => c.isNamed && EXPORTABLE_DECLARATIONS.includes(c.type));
			if (bareDeclaration) {
				for (const n of getDeclaredNames(bareDeclaration)) {
					exportedNames.add(n);
				}
			}
		}

		for (const child of node.children) {
			walk(child);
		}
	}

	walk(root);
	return { exportedNames, defaultExportNames };
}

/** Extract the identifier name from a declaration node. */
export function getNameFromDeclaration(node: TSNode): string | null {
	if (node.type === VARIABLE_DECLARATION || node.type === LEXICAL_DECLARATION) {
		const declarator = node.descendantsOfType("variable_declarator")[0];
		if (declarator) {
			return declarator.namedChildren[0]?.text ?? null;
		}
	}
	// Skip leading `decorator` children (e.g. `@Injectable() class Foo {}` has the
	// decorator as its first named child) so the declaration's real name is used.
	for (const child of node.namedChildren) {
		if (child.type === DECORATOR) continue;
		if (isNameNode(child)) return child.text;
	}
	return null;
}

/** Get all declared names from a declaration. */
export function getDeclaredNames(node: TSNode): string[] {
	if (node.type === VARIABLE_DECLARATION || node.type === LEXICAL_DECLARATION) {
		return node
			.descendantsOfType("variable_declarator")
			.map((d: TSNode) => d.firstNamedChild?.text ?? null)
			.filter((n: string | null): n is string => n !== null);
	}
	const name = getNameFromDeclaration(node);
	return name ? [name] : [];
}
