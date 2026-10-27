/**
 * JavaVisitor — extracts symbols from Java source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - class_declaration      → Class
 * - interface_declaration  → Interface
 * - enum_declaration       → Enum
 * - method_declaration     → Method
 * - constructor_declaration → Method
 *
 * Export detection: checks for `public` modifier in access modifiers.
 *
 * Reference emission (TASK-303 / Phase 1.1) — node types verified empirically
 * against the shipped tree-sitter-java v0.23.5 WASM (NOT guessed):
 * - `import_declaration` → `import` edges per binding: the LAST name segment
 *   (`import foo.bar.Baz` → 'Baz'; `import static java.util.Collections.sort`
 *   → 'sort', the member name); wildcard imports (`import java.util.*`) emit
 *   nothing (no binding).
 * - `class_declaration` → `superclass` field (single `extends` edge) +
 *   `super_interfaces` field (per-target `implements` edges).
 * - `interface_declaration` → `extends_interfaces` (NOT a grammar field —
 *   located as a named child) → per-target `extends` edges.
 * - `enum_declaration` / `record_declaration` → `interfaces` field
 *   (super_interfaces) → per-target `implements` edges (enums/records can only
 *   implement in Java).
 * - `type_parameters` → `type_parameter` → `type_bound` → per-bound `extends`
 *   edges (declaration-level generics constraints only, mirrors TASK-301 TS).
 * - `method_invocation` → `call` edges (enclosing method as callerName).
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";

const CLASS_DECLARATION = "class_declaration";
const INTERFACE_DECLARATION = "interface_declaration";
const ENUM_DECLARATION = "enum_declaration";
const METHOD_DECLARATION = "method_declaration";
const CONSTRUCTOR_DECLARATION = "constructor_declaration";
const CLASS_BODY = "class_body";
const ENUM_BODY = "enum_body";
const MODIFIERS = "modifiers";
const BLOCK_COMMENT = "block_comment";
const LINE_COMMENT = "line_comment";

// Reference-emission node types (TASK-303 / Phase 1.1).
const RECORD_DECLARATION = "record_declaration";
const IMPORT_DECLARATION = "import_declaration";
const SUPERCLASS = "superclass";
/** Field name of the implements clause — `field('interfaces', super_interfaces)` in the grammar (the FIELD name is `interfaces`, the NODE type is `super_interfaces`). */
const INTERFACES_FIELD = "interfaces";
const EXTENDS_INTERFACES = "extends_interfaces";
const TYPE_LIST = "type_list";
const TYPE_IDENTIFIER = "type_identifier";
const SCOPED_TYPE_IDENTIFIER = "scoped_type_identifier";
const GENERIC_TYPE = "generic_type";
const TYPE_PARAMETERS = "type_parameters";
const TYPE_PARAMETER = "type_parameter";
const TYPE_BOUND = "type_bound";
const SCOPED_IDENTIFIER = "scoped_identifier";
const IDENTIFIER = "identifier";
const ASTERISK = "asterisk";
const METHOD_INVOCATION = "method_invocation";

export class JavaVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit import + heritage + call reference edges (TASK-303 / Phase 1.1),
	 * mirroring the PhpVisitor / TypeScriptVisitor / KotlinVisitor structure.
	 *
	 * Cheap single AST pass over the obvious reference surfaces in the
	 * tree-sitter-java grammar:
	 * - `import_declaration` → kind 'import' — one edge per statement: the LAST
	 *   name segment (`import foo.bar.Baz` → 'Baz'; static import
	 *   `import static java.util.Collections.sort` → 'sort', the member name);
	 *   wildcard imports (`import java.util.*`) emit nothing (no binding).
	 * - `class_declaration` → kind 'extends' (single `superclass` field) +
	 *   kind 'implements' (per-target `super_interfaces` field).
	 * - `interface_declaration` → kind 'extends' (per-target
	 *   `extends_interfaces` — NOT a grammar field, located as a named child).
	 * - `enum_declaration` / `record_declaration` → kind 'implements'
	 *   (per-target `interfaces` field; enums/records can only implement).
	 * - `type_parameters` → `type_parameter` → `type_bound` → kind 'extends'
	 *   per bound (declaration-level generics constraints only — mirrors
	 *   TASK-301 TS handling; method-level type params are excluded because
	 *   they nest under method_declaration, never under a declaration's own
	 *   type_parameters).
	 * - `method_invocation` → kind 'call' (`helper()`, `obj.method()`,
	 *   `super.equals(x)` — the callee is the grammar `name` field).
	 *
	 * `callerName` is the enclosing method/constructor name, tracked by
	 * descending into method/constructor bodies, and null for heritage edges
	 * and imports (they belong to a declaration, not a function).
	 * `targetFile` / `targetSymbolId` are left null — name-based resolution
	 * per ADR-002 happens at query time, not parse time.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		this.walkReferences(tree.rootNode, null, refs);
		return refs;
	}

	private walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
		switch (node.type) {
			// Import edges (TASK-303): one 'import' reference per
			// import_declaration binding. Do NOT recurse — import children are
			// pure names, never call sites (mirrors TS/PHP/Kotlin emission).
			case IMPORT_DECLARATION: {
				this.emitImportEdges(node, refs);
				return;
			}
			// Heritage edges: emit 'extends'/'implements' for the declaration's
			// superclass / interfaces + generic bounds, then recurse into the
			// body so call-site refs inside members still emit (purely
			// additive). Interfaces, enums and records share the same surface.
			case CLASS_DECLARATION:
			case INTERFACE_DECLARATION:
			case ENUM_DECLARATION:
			case RECORD_DECLARATION: {
				this.emitHeritage(node, refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			// Track the enclosing method/constructor name for call-site edges,
			// then recurse into the body (identical to the default branch).
			case METHOD_DECLARATION:
			case CONSTRUCTOR_DECLARATION: {
				const nameNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
				const fnName = nameNode ? nameNode.text : null;
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			case METHOD_INVOCATION: {
				const called = this.callTargetName(node);
				if (called) {
					refs.push({
						symbolName: called,
						callerFile: "",
						callerLine: node.startPosition.row + 1,
						callerName,
						kind: "call"
					});
				}
				// Recurse so nested chains (`helper().go()`, `a().b()`) emit
				// every segment — the outer method_invocation wraps the inner.
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			default:
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
		}
	}

	/**
	 * Emit one 'import' reference edge per import_declaration (TASK-303 /
	 * Phase 1.1).
	 *
	 * Grammar (verified empirically against the shipped tree-sitter-java
	 * v0.23.5 WASM): `import_declaration` = `import [static] <_name> [.*] ;`
	 * where `_name` is an `identifier` or a right-nested `scoped_identifier`
	 * chain (`import foo.bar.Baz` → scoped_identifier(scoped_identifier(foo,
	 * bar), Baz)); an optional `asterisk` named child marks a wildcard import.
	 *
	 * The referenced symbol is the LAST name segment per ADR-002: `Baz` for
	 * `import foo.bar.Baz` and `sort` (the member name) for the static import
	 * `import static java.util.Collections.sort`. Wildcard imports
	 * (`import java.util.*`) emit nothing — the `*` is not a binding (mirrors
	 * the Kotlin wildcard skip). `callerLine` is the import statement line;
	 * `callerName` is null (Java imports are top-level).
	 */
	private emitImportEdges(node: TSNode, refs: ParsedReference[]): void {
		const binding = this.importBindingName(node);
		if (!binding) return;
		refs.push({
			symbolName: binding,
			callerFile: "",
			callerLine: node.startPosition.row + 1,
			callerName: null,
			kind: "import"
		});
	}

	/**
	 * Resolve the referenced binding name of an import_declaration: the LAST
	 * name segment of the imported name (`foo.bar.Baz` → 'Baz',
	 * `java.util.Collections.sort` → 'sort'). Returns null for wildcard
	 * imports (`import java.util.*` → no binding) and unparsed declarations.
	 */
	private importBindingName(node: TSNode): string | null {
		if (node.namedChildren.some((c) => c.type === ASTERISK)) return null;
		const nameNode = node.namedChildren.find((c) => c.type === SCOPED_IDENTIFIER || c.type === IDENTIFIER);
		if (!nameNode) return null;
		// Pierce the right-nested scoped_identifier chain to its leaf — the
		// LAST named child of every scoped_identifier is the innermost
		// identifier (`foo.bar.Baz` → Baz; the static member `...sort` → sort).
		let cur: TSNode | undefined = nameNode;
		while (cur && cur.type === SCOPED_IDENTIFIER) {
			cur = cur.namedChildren[cur.namedChildren.length - 1];
		}
		return cur && cur.type === IDENTIFIER ? cur.text : null;
	}

	/**
	 * Emit 'extends' / 'implements' heritage edges for a class, interface,
	 * enum or record declaration (TASK-303, Phase 1.1).
	 *
	 * Grammar (tree-sitter-java v0.23.5, verified empirically against the
	 * shipped WASM): `class_declaration` carries a `superclass` field
	 * (`extends <type>`, single) and an `interfaces` field (`super_interfaces`
	 * → `implements type_list`); `interface_declaration` carries a plain
	 * `extends_interfaces` named child (`extends type_list`) — deliberately
	 * NOT a grammar field; `enum_declaration` / `record_declaration` carry the
	 * `interfaces` field only (enums and records can only implement).
	 *
	 * Per-declaration-kind assignment (name-based per ADR-002 — no type
	 * resolution at parse time):
	 * - `class_declaration`  → superclass 'extends' + each super_interface
	 *   'implements'.
	 * - `interface_declaration` → each extends_interfaces target 'extends'.
	 * - `enum_declaration` / `record_declaration` → each super_interface
	 *   'implements'.
	 *
	 * Declaration-level generic bounds are also heritage-like: `type_parameters`
	 * → `type_parameter` → `type_bound` (`class Cache<T extends Storable>`,
	 * `class Multi<T extends A & B>`) emit 'extends' per bound (mirrors
	 * TASK-301 TS constraint edges). Method-level type params are excluded
	 * (they nest under method_declaration). `callerName` is null per the
	 * ParsedReference heritage contract.
	 */
	private emitHeritage(node: TSNode, refs: ParsedReference[]): void {
		const line = node.startPosition.row + 1;

		// Declaration-level generic bounds → 'extends' per type_bound target.
		const typeParams = node.childForFieldName(TYPE_PARAMETERS);
		if (typeParams) {
			for (const param of typeParams.namedChildren) {
				if (param.type !== TYPE_PARAMETER) continue;
				const bound = param.namedChildren.find((c) => c.type === TYPE_BOUND);
				if (!bound) continue;
				for (const target of bound.namedChildren) {
					this.emitHeritageTarget(target, "extends", line, refs);
				}
			}
		}

		// Superclass slot: `class Foo extends Base` → single 'extends' edge.
		const superclass = node.childForFieldName(SUPERCLASS);
		if (superclass) {
			const target = superclass.namedChildren[0];
			if (target) this.emitHeritageTarget(target, "extends", line, refs);
		}

		// Interface/implementation slot: `implements I1, I2` for
		// class/enum/record (the `interfaces` field → super_interfaces) or
		// `extends J1, J2` for interfaces (extends_interfaces, a plain named
		// child). Each type_list target gets its own edge.
		const isInterface = node.type === INTERFACE_DECLARATION;
		const interfaces = isInterface
			? node.namedChildren.find((c) => c.type === EXTENDS_INTERFACES)
			: node.childForFieldName(INTERFACES_FIELD);
		if (interfaces) {
			const kind: "extends" | "implements" = isInterface ? "extends" : "implements";
			const typeList = interfaces.namedChildren.find((c) => c.type === TYPE_LIST);
			if (typeList) {
				for (const target of typeList.namedChildren) {
					this.emitHeritageTarget(target, kind, line, refs);
				}
			}
		}
	}

	/** Emit a single 'extends'/'implements' edge for one heritage target type. */
	private emitHeritageTarget(
		target: TSNode,
		kind: "extends" | "implements",
		line: number,
		refs: ParsedReference[]
	): void {
		const name = this.heritageTargetName(target);
		if (!name) return;
		refs.push({
			symbolName: name,
			callerFile: "",
			callerLine: line,
			callerName: null,
			kind
		});
	}

	/**
	 * Resolve the name-based target of a heritage type reference.
	 *
	 * Per ADR-002 (name-based, no LSP) the edge references the LAST name
	 * segment of the type as written:
	 *
	 *   - `type_identifier`                     → `Foo`      (extends Foo / implements I)
	 *   - `scoped_type_identifier`              → `Base`     (extends com.acme.Base)
	 *   - `generic_type`                        → base name  (extends Base<T>, implements java.util.List<Item> → List)
	 *
	 * Returns null for non-name elements (primitive types, array types,
	 * annotated types) so no edge is emitted for unresolvable heritage sites.
	 */
	private heritageTargetName(node: TSNode): string | null {
		if (node.type === TYPE_IDENTIFIER) return node.text;
		if (node.type === SCOPED_TYPE_IDENTIFIER) {
			// The chain's type_identifier children are the segments
			// (`com.acme.Base` → com, acme, Base) — the LAST is the class name.
			const ids = node.namedChildren.filter((c) => c.type === TYPE_IDENTIFIER);
			const last = ids[ids.length - 1];
			return last?.text ?? null;
		}
		if (node.type === GENERIC_TYPE) {
			// `Base<T>` / `java.util.List<Item>` — the base type is the first
			// named child; recurse so a qualified generic base resolves to its
			// last segment.
			const base = node.namedChildren[0];
			return base ? this.heritageTargetName(base) : null;
		}
		return null;
	}

	/**
	 * Read the referenced callee name from a method_invocation: the grammar
	 * `name` field covers both forms — plain `helper()` and member
	 * `obj.method()` / `super.equals(x)` (verified against the shipped WASM;
	 * object_creation_expression `new Foo()` is a different node and is
	 * intentionally NOT indexed as a call/instantiation edge for Java).
	 */
	private callTargetName(node: TSNode): string | null {
		return node.childForFieldName("name")?.text ?? null;
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class body: extract methods ──────────────────
		if (insideClass) {
			if (type === METHOD_DECLARATION || type === CONSTRUCTOR_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
				}
				return;
			}
			// Handle nested classes inside class body
			if (type === CLASS_DECLARATION) {
				const nameNode = node.namedChildren.find((c) => c.type === "identifier");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
					const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
					if (body) {
						this.walkNode(body, symbols, nameNode.text, true);
					}
				}
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true);
			}
			return;
		}

		// ── Class declaration ───────────────────────────────────
		if (type === CLASS_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Interface declaration ───────────────────────────────
		if (type === INTERFACE_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Interface, parentName));
			}
			return;
		}

		// ── Enum declaration ────────────────────────────────────
		if (type === ENUM_DECLARATION) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Enum, parentName));
				const body = node.namedChildren.find((c) => c.type === ENUM_BODY || c.type === CLASS_BODY);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private isPublic(node: TSNode): boolean {
		const modifiers = node.namedChildren.find((c) => c.type === MODIFIERS);
		if (modifiers) {
			return modifiers.text.includes("public");
		}
		// Check for inline modifiers (some grammars put them inline)
		for (const child of node.children) {
			if (child.type === MODIFIERS && child.text.includes("public")) {
				return true;
			}
		}
		return false;
	}

	private makeSymbol(node: TSNode, name: string, kind: SymbolKind, parentName: string | null): ParsedSymbol {
		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: this.buildSignature(node),
			docComment: this.extractDocComment(node),
			exported: this.isPublic(node),
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	private extractDocComment(node: TSNode): string | null {
		const prev = node.previousNamedSibling;
		if (prev && (prev.type === BLOCK_COMMENT || prev.type === LINE_COMMENT) && prev.text.startsWith("/**")) {
			return serializeDocBlock(prev.text);
		}
		return null;
	}
}
