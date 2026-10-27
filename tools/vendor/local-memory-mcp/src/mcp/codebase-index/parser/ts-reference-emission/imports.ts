/**
 * 'import' / 'reexport' reference emission for the TypeScriptVisitor
 * (extracted from ts-reference-emission during the TASK-552 split).
 *
 * Emits one reference edge per imported / re-exported binding of an
 * import_statement / export_statement, carrying the import metadata
 * (issues #83/#87 — import edges, migration v27; reexport edges, TASK-013).
 * Purely structural lookups over the AST — no symbol resolution.
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference } from "../language-visitor";
import {
	IMPORT_CLAUSE,
	IMPORT_SPECIFIER,
	NAMED_EXPORTS,
	NAMED_IMPORTS,
	NAMESPACE_IMPORT,
	STRING
} from "../ts-node-types";

/** Extract the `'./x'` module specifier of an import/export statement (null if absent). */
function moduleSpecifierOf(node: TSNode): string | null {
	const source = node.childForFieldName("source");
	if (!source) return null;
	// tree-sitter-typescript models the specifier as a `string` node whose
	// text INCLUDES the quotes — strip them for the raw specifier.
	const raw = source.type === STRING ? source.text.slice(1, -1) : source.text;
	return raw.length > 0 ? raw : null;
}

/**
 * Emit one 'import' reference per imported binding in an import_statement,
 * carrying the import metadata (issue #83, migration v27).
 *
 * Per binding the row's contract:
 *   - symbol_name   = the IMPORTED name as written in the module (the
 *     canonical name for name-based aggregation — ADR-002; the `User` of
 *     `import { User as DomainUser }`). Namespace imports index the alias
 *     (`* as ns` → 'ns' — the imported namespace has no single name).
 *   - importInfo.localName     = the LOCAL binding in the importing file
 *     (`DomainUser`; the default-import binding; the namespace alias).
 *   - importInfo.importedName  = the exported name (`User`); 'default' for
 *     default imports; '*' for namespace imports; null for side-effect.
 *   - importInfo.moduleSpecifier = the RAW specifier as written (`'@/domain/user'`).
 *   - importInfo.importKind    = 'default' | 'named' | 'namespace' |
 *     'side-effect'.
 *
 * `symbol_name` keeps its historical meaning (imported name wins over the
 * `as` alias) so existing name-based aggregation (dead-code, hotspots, KG)
 * and the existing reference-emission tests are unchanged. The local alias is
 * carried separately in importInfo for TRACE's canonical-target exposure.
 */
export function emitImports(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	const clause = node.childForFieldName("import_clause") ?? node.namedChildren.find((c) => c.type === IMPORT_CLAUSE);
	const line = node.startPosition.row + 1;
	const moduleSpecifier = moduleSpecifierOf(node);

	// `import "x";` — side-effect import: ONE row with null imported name.
	if (!clause) {
		refs.push({
			symbolName: moduleSpecifier ?? "(side-effect)",
			callerFile: "",
			callerLine: line,
			callerName: callerName,
			kind: "import",
			importInfo: {
				localName: moduleSpecifier ?? "",
				importedName: null,
				moduleSpecifier: moduleSpecifier ?? null,
				importKind: "side-effect"
			}
		});
		return;
	}

	// Default-import binding: `import Foo from "x"` → clause's first named child is an identifier.
	const defaultImport = clause.namedChildren.find((c) => c.type === "identifier");
	if (defaultImport && defaultImport.text.length > 0) {
		refs.push({
			symbolName: defaultImport.text,
			callerFile: "",
			callerLine: line,
			callerName: callerName,
			kind: "import",
			importInfo: {
				localName: defaultImport.text,
				importedName: "default",
				moduleSpecifier: moduleSpecifier ?? null,
				importKind: "default"
			}
		});
	}

	// Named imports: `import { a, b as c } from "x"`.
	const named = clause.namedChildren.find((c) => c.type === NAMED_IMPORTS);
	if (named) {
		for (const spec of named.namedChildren) {
			if (spec.type !== IMPORT_SPECIFIER) continue;
			const nameNode = spec.childForFieldName("name");
			const imported = nameNode?.text;
			if (!imported || imported === "default") continue; // skip rebindings aliased to `default`
			const aliasNode = spec.childForFieldName("alias");
			const local = aliasNode?.text ?? imported;
			refs.push({
				symbolName: imported,
				callerFile: "",
				callerLine: line,
				callerName: callerName,
				kind: "import",
				importInfo: {
					localName: local,
					importedName: imported,
					moduleSpecifier: moduleSpecifier ?? null,
					importKind: "named"
				}
			});
		}
	}

	// Namespace import `import * as ns` — the imported (namespace) binding is
	// ambiguous; index the alias so `ns` appears as the referenced symbol.
	const nsImport = clause.namedChildren.find((c) => c.type === NAMESPACE_IMPORT);
	if (nsImport) {
		const alias = (nsImport.lastNamedChild?.text ?? "").replace(/^as\s*/, "");
		if (alias) {
			refs.push({
				symbolName: alias,
				callerFile: "",
				callerLine: line,
				callerName: callerName,
				kind: "import",
				importInfo: {
					localName: alias,
					importedName: "*",
					moduleSpecifier: moduleSpecifier ?? null,
					importKind: "namespace"
				}
			});
		}
	}
}

/**
 * Emit one 'reexport' reference per re-exported binding in an export_statement
 * that carries a `source` (issue #87, TASK-013).
 *
 * Per binding the row's contract (mirrors the 'import' edge from #83):
 *   - kind                 = 'reexport'
 *   - symbol_name          = the exported name as written in THIS module
 *     (`User` of `export { User as DomainUser }`). For wildcard `export *`
 *     the name is unknown at parse time, so symbol_name carries the raw
 *     module specifier as a placeholder (resolved transitively at query time).
 *   - importInfo.localName       = the LOCAL alias (`DomainUser`; for named
 *     re-exports without alias this equals the exported name; for wildcard '*').
 *   - importInfo.importedName    = the canonical exported name (`User`); null
 *     for wildcard `export *`.
 *   - importInfo.moduleSpecifier  = the RAW specifier as written (`'./user'`).
 *   - importInfo.importKind       = 'named' | 'wildcard'.
 *
 * These edges are structurally emitted only — canonical-target resolution
 * (barrel-chain chasing) is performed by the reexport resolver at query time
 * (TRACE) or in the parse pipeline (when `resolveReexports` is enabled), and
 * written to target_file/target_symbol_id.
 */
export function emitReexports(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;
	const moduleSpecifier = moduleSpecifierOf(node);
	if (!moduleSpecifier) return;

	// `export * from './types'` — wildcard re-export: NO export_clause node.
	// For named re-exports the export_clause is an UNNAMED child of
	// export_statement (the grammar exposes only `source` as a field), so fall
	// back to scanning named children.
	const clause = node.childForFieldName("export_clause") ?? node.namedChildren.find((c) => c.type === NAMED_EXPORTS);
	if (!clause) {
		refs.push({
			symbolName: moduleSpecifier,
			callerFile: "",
			callerLine: line,
			callerName,
			kind: "reexport",
			importInfo: {
				localName: "*",
				importedName: null,
				moduleSpecifier,
				importKind: "wildcard"
			}
		});
		return;
	}

	// `export { A, B as C } from './mod'` — one edge per export_specifier.
	for (const spec of clause.namedChildren) {
		if (spec.type !== "export_specifier") continue;
		const nameNode = spec.childForFieldName("name");
		const exported = nameNode?.text;
		if (!exported) continue;
		const aliasNode = spec.childForFieldName("alias");
		const alias = aliasNode?.text ?? null;
		refs.push({
			symbolName: exported,
			callerFile: "",
			callerLine: line,
			callerName,
			kind: "reexport",
			importInfo: {
				localName: alias ?? exported,
				importedName: exported,
				moduleSpecifier,
				importKind: "named"
			}
		});
	}
}
