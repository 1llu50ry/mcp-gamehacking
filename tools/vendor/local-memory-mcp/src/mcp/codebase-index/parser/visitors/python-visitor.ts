/**
 * PythonVisitor — extracts symbols from Python source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - function_definition       → Function (async defs detected via the `async` keyword)
 * - async_function_definition → Function (legacy grammars with a dedicated node)
 * - class_definition          → Class
 * - decorated_definition      → Function/Class (decorator texts prefixed to the signature)
 * - expression_statement      → Constant for `__all__ = [...]` export assignments
 *
 * Python doesn't have exports per se — module-level definitions are placed at top-level,
 * and `__all__` is the explicit module export list.
 *
 * Reference emission (TASK-305 / Phase 1.1) — node types verified empirically
 * against the shipped tree-sitter-python WASM (NOT guessed):
 * - `import_statement` / `import_from_statement` → one 'import' edge per
 *   binding in the `name` field (`from x import a, b as c` → a + c; alias
 *   wins, else LAST segment of the dotted name; wildcard imports emit
 *   nothing).
 * - `class_definition` `superclasses` argument_list → one 'extends' edge per
 *   base class (Python has no separate implements — protocols/ABCs are just
 *   bases, so kind stays 'extends' uniformly).
 * - `call` (`function` field identifier/attribute) → 'call' edges.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";

const FUNCTION_DEFINITION = "function_definition";
const ASYNC_FUNCTION_DEFINITION = "async_function_definition";
const CLASS_DEFINITION = "class_definition";
const DECORATED_DEFINITION = "decorated_definition";
const DECORATOR = "decorator";
const STRING = "string";
const EXPRESSION_STATEMENT = "expression_statement";
const ASSIGNMENT = "assignment";
const IDENTIFIER = "identifier";
const BLOCK = "block";
const ALL_EXPORTS_NAME = "__all__";

// Reference-emission node types (TASK-305 / Phase 1.1).
const IMPORT_STATEMENT = "import_statement";
const IMPORT_FROM_STATEMENT = "import_from_statement";
const DOTTED_NAME = "dotted_name";
const ALIASED_IMPORT = "aliased_import";
const WILDCARD_IMPORT = "wildcard_import";
const ATTRIBUTE = "attribute";
const SUBSCRIPT = "subscript";
const CALL = "call";

/** Optional context threaded through the walk (decorators, async marker). */
interface WalkContext {
	/** Decorator texts (e.g. `@app.route("/x")`) applied to the indexed definition. */
	decorators?: string[];
	/** True when the definition is async (legacy `async_function_definition` grammars). */
	async?: boolean;
}

export class PythonVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit reference edges (TASK-305 / Phase 1.1), mirroring the
	 * PhpVisitor / KotlinVisitor / TypeScriptVisitor structure.
	 *
	 * Cheap single AST pass over the obvious reference surfaces in the
	 * tree-sitter-python grammar:
	 * - `import_statement` / `import_from_statement` → kind 'import' — one edge
	 *   per binding in the statement's `name` field: the `as` alias when
	 *   present (`import x.y as z` → 'z'), else the LAST segment of the dotted
	 *   name (`import a.b.c` → 'c'; `from mod import Thing` → 'Thing');
	 *   wildcard imports (`from mod import *`) emit nothing.
	 * - `class_definition` → kind 'extends' per base class in the
	 *   `superclasses` argument_list (`class Foo(Base1, Base2)` → Base1,
	 *   Base2). Python has no separate implements — protocols/ABCs are just
	 *   bases, so the kind stays 'extends' uniformly (per the TASK-305 spec).
	 * - `call` → kind 'call' (`helper()` → 'helper', `obj.method()` → 'method').
	 *
	 * `callerName` is the enclosing function/method name, tracked by descending
	 * into function_definition bodies, and null for heritage edges and
	 * top-level imports (they belong to a declaration, not a function).
	 * `targetFile`/`targetSymbolId` are left null — name-based resolution per
	 * ADR-002 happens at query time, not parse time.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		this.walkReferences(tree.rootNode, null, refs);
		return refs;
	}

	private walkReferences(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
		switch (node.type) {
			// Track the enclosing function/method name for call-site edges,
			// then recurse into the body (identical to the default branch).
			// Python methods are function_definition nodes inside class bodies,
			// so this also covers method caller tracking.
			case FUNCTION_DEFINITION: {
				const nameNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
				const fnName = nameNode ? nameNode.text : null;
				for (const child of node.namedChildren) {
					this.walkReferences(child, fnName ?? callerName, refs);
				}
				return;
			}
			// Import edges (TASK-305): one 'import' reference per binding in
			// the `name` field. Do NOT recurse — import children are pure
			// names, never call sites (mirrors the TS/PHP/Kotlin emission
			// surface).
			case IMPORT_STATEMENT:
			case IMPORT_FROM_STATEMENT: {
				this.emitImportEdges(node, callerName, refs);
				return;
			}
			// Heritage edges: emit 'extends' per base class, then recurse into
			// the body so call-site refs inside methods still emit (identical
			// traversal to the default branch — purely additive).
			case CLASS_DEFINITION: {
				this.emitHeritage(node, refs);
				for (const child of node.namedChildren) {
					this.walkReferences(child, callerName, refs);
				}
				return;
			}
			case CALL: {
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
	 * Emit one 'import' reference edge per binding in an import_statement or
	 * import_from_statement (TASK-305 / Phase 1.1).
	 *
	 * Grammar (verified empirically against the shipped tree-sitter-python
	 * WASM): both statement types expose their imported bindings as `name`
	 * FIELD children — a `dotted_name` per plain import, an `aliased_import`
	 * (`import x.y as z` / `from mod import a as b`) and, for
	 * import_from_statement only, a `wildcard_import` (`from mod import *`).
	 * The `module_name` field (the dotted/relative path after `from`) is NOT
	 * a binding and is never emitted.
	 *
	 * The referenced symbol is the LOCAL BINDING per Python semantics — the
	 * `as` alias when present (`import numpy as np` → 'np'), otherwise the
	 * LAST name segment of the dotted name (`import a.b.c` → 'c'),
	 * matching ADR-002 last-segment, name-based resolution. `callerLine` is
	 * the import statement line; `callerName` is the enclosing function when
	 * the import is nested inside a def (legal in Python), else null.
	 */
	private emitImportEdges(node: TSNode, callerName: string | null, refs: ParsedReference[]): void {
		const line = node.startPosition.row + 1;
		for (let i = 0; i < node.childCount; i++) {
			if (node.fieldNameForChild(i) !== "name") continue;
			const child = node.child(i);
			if (!child || child.type === WILDCARD_IMPORT) continue;
			const binding = this.importBindingName(child);
			if (!binding) continue;
			refs.push({
				symbolName: binding,
				callerFile: "",
				callerLine: line,
				callerName,
				kind: "import"
			});
		}
	}

	/**
	 * Resolve the local binding name of a `name`-field child: the `as` alias
	 * when present (`import x.y as z` → 'z'), otherwise the LAST identifier
	 * segment of the dotted name (`a.b.c` → 'c'). Returns null for non-name
	 * children (wildcard imports handled by the caller).
	 */
	private importBindingName(node: TSNode): string | null {
		const dotted =
			node.type === ALIASED_IMPORT ? node.childForFieldName("name") : node.type === DOTTED_NAME ? node : null;
		if (!dotted) return null;
		const alias = node.type === ALIASED_IMPORT ? node.childForFieldName("alias") : null;
		if (alias) return alias.text;
		const ids = dotted.namedChildren.filter((c) => c.type === IDENTIFIER);
		const last = ids[ids.length - 1];
		return last?.text ?? null;
	}

	/**
	 * Emit 'extends' heritage edges for a class_definition (TASK-305, Phase 1.1).
	 *
	 * Grammar (tree-sitter-python, verified empirically against the shipped
	 * WASM): the base list lives in the `superclasses` FIELD of
	 * class_definition — an `argument_list` node that is ABSENT when the class
	 * has no bases (`class Baz:`). Each named child of the argument_list is a
	 * base expression:
	 *
	 *   - `identifier`         → `Base`      (class Foo(Base, Mixin))
	 *   - `attribute`          → `Gamma`     (class Foo(alpha.beta.Gamma) —
	 *     LAST segment via the attribute field)
	 *   - `subscript`          → `Base`      (class Foo(Base[Thing]) — the
	 *     `value` field holds the base name)
	 *   - `keyword_argument`   → (none)      (class Foo(Base, metaclass=Meta) —
	 *     keyword args are NOT base classes; skipped)
	 *
	 * Per ADR-002 (name-based, no LSP) the edge references the LAST name
	 * segment of the base as written. `callerName` is null per the
	 * ParsedReference heritage contract (language-visitor.ts) — the edge
	 * belongs to the derived class's declaration, not an enclosing function.
	 */
	private emitHeritage(node: TSNode, refs: ParsedReference[]): void {
		const line = node.startPosition.row + 1;
		const bases = node.childForFieldName("superclasses");
		if (!bases) return;
		for (const base of bases.namedChildren) {
			const name = this.heritageTargetName(base);
			if (!name) continue;
			refs.push({
				symbolName: name,
				callerFile: "",
				callerLine: line,
				callerName: null,
				kind: "extends"
			});
		}
	}

	/**
	 * Resolve the name-based target of a base-class expression inside the
	 * superclasses argument_list.
	 *
	 *   - `identifier` → `Base` (plain base)
	 *   - `attribute`  → `Gamma` (qualified base alpha.beta.Gamma → last
	 *     segment via the `attribute` field)
	 *   - `subscript`  → `Base` (generic base Base[Thing] → the `value` field)
	 *
	 * Returns null for non-base children (keyword_argument like
	 * `metaclass=Meta`, splats) so no edge is emitted for them.
	 */
	private heritageTargetName(node: TSNode): string | null {
		if (node.type === IDENTIFIER) return node.text;
		if (node.type === ATTRIBUTE) return node.childForFieldName("attribute")?.text ?? null;
		if (node.type === SUBSCRIPT) return node.childForFieldName("value")?.text ?? null;
		return null;
	}

	/**
	 * Read the referenced identifier from a call node:
	 * - `helper()`        → `function` field identifier → 'helper'.
	 * - `obj.method()`    → `function` field attribute → 'method' (LAST
	 *   segment via the attribute field; covers `a.b.c()` → 'c').
	 * Returns null for dynamic/compound function expressions (`f()()` → the
	 * function field is itself a call), which can't be name-indexed.
	 */
	private callTargetName(node: TSNode): string | null {
		const fn = node.childForFieldName("function");
		if (!fn) return null;
		if (fn.type === IDENTIFIER) return fn.text;
		if (fn.type === ATTRIBUTE) return fn.childForFieldName("attribute")?.text ?? null;
		return null;
	}

	private walkNode(
		node: TSNode,
		symbols: ParsedSymbol[],
		parentName: string | null,
		insideClass: boolean,
		ctx: WalkContext = {}
	): void {
		// ── Decorated definitions: index the inner def/class, prefix decorators ──
		if (node.type === DECORATED_DEFINITION) {
			const decorators = node.namedChildren
				.filter((c) => c.type === DECORATOR)
				.map((c) => c.text.replace(/\s+/g, " ").trim());
			const definition = node.namedChildren.find((c) => c.type === FUNCTION_DEFINITION || c.type === CLASS_DEFINITION);
			if (definition) {
				this.walkNode(definition, symbols, parentName, insideClass, { ...ctx, decorators });
				return;
			}
			// Parse-error fallback: recurse generically rather than dropping the node
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, insideClass, ctx);
			}
			return;
		}

		// ── Legacy async_function_definition: index the nested function, mark async ──
		if (node.type === ASYNC_FUNCTION_DEFINITION) {
			const definition = node.namedChildren.find((c) => c.type === FUNCTION_DEFINITION);
			if (definition) {
				this.walkNode(definition, symbols, parentName, insideClass, { ...ctx, async: true });
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, insideClass, { ...ctx, async: true });
			}
			return;
		}

		// ── Inside class body: extract methods ──────────────────
		if (insideClass) {
			if (node.type === FUNCTION_DEFINITION) {
				const nameNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName, ctx));
				}
				return;
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true, ctx);
			}
			return;
		}

		// ── Function definition ─────────────────────────────────
		if (node.type === FUNCTION_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Function, parentName, ctx));
			}
			return;
		}

		// ── Class definition ────────────────────────────────────
		if (node.type === CLASS_DEFINITION) {
			const nameNode = node.namedChildren.find((c) => c.type === IDENTIFIER);
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName, ctx));
				// Recurse into class body for methods. Decorators/async apply to the
				// class definition itself, NOT to its methods — so the context is not
				// propagated (a decorated method is handled via decorated_definition).
				const body = node.namedChildren.find((c) => c.type === BLOCK);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Module-level `__all__ = [...]` export assignment ────
		if (node.type === EXPRESSION_STATEMENT) {
			const assignment = node.namedChildren.find((c) => c.type === ASSIGNMENT);
			if (assignment) {
				const left = assignment.namedChildren.find((c) => c.type === IDENTIFIER);
				if (left?.text === ALL_EXPORTS_NAME) {
					symbols.push(this.makeSymbol(assignment, ALL_EXPORTS_NAME, SymbolKind.Constant, null));
					return; // do not recurse — avoid duplicate emission
				}
			}
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false, ctx);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	private makeSymbol(
		node: TSNode,
		name: string,
		kind: SymbolKind,
		parentName: string | null,
		ctx: WalkContext = {}
	): ParsedSymbol {
		// Python module-level definitions are always accessible
		const exported = parentName === null;

		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: this.buildSignature(node, ctx),
			docComment: this.extractDocComment(node),
			exported,
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode, ctx: WalkContext = {}): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		const normalized = firstLine.replace(/\s+/g, " ").trim();
		const parts: string[] = [];
		const decorators = ctx.decorators ?? [];
		if (decorators.length) {
			parts.push(...decorators);
		}
		if (ctx.async && !/^async\b/.test(normalized)) {
			parts.push(`async ${normalized}`);
		} else {
			parts.push(normalized);
		}
		return parts.join(" ");
	}

	private extractDocComment(node: TSNode): string | null {
		// Python docstrings are the first statement inside the function/class body block.
		// Canonicalize the raw triple-quoted string via serializeDocBlock so the
		// [DEPRECATED] + @param/@return/@deprecated surface matches PHP/TS/JS.
		const block = node.namedChildren.find((c) => c.type === BLOCK);
		if (!block) return null;
		const first = block.namedChildren[0];
		if (first?.type === EXPRESSION_STATEMENT) {
			const str = first.namedChildren[0];
			if (str?.type === STRING) {
				const raw = str.text.replace(/^['"]{3}/, "").replace(/['"]{3}$/, "");
				if (raw.trim().length === 0) return null;
				return serializeDocBlock(raw);
			}
		}
		return null;
	}
}
