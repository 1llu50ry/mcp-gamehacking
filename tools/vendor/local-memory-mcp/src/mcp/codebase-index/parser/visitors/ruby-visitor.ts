/**
 * RubyVisitor — extracts symbols from Ruby source code using tree-sitter's AST.
 *
 * Node type mappings:
 * - method           → Method
 * - singleton_method → Method
 * - class            → Class
 * - singleton_class  → Class
 * - module           → Class (treat module as class)
 * - attr_accessor/attr_reader/attr_writer → Method (one per symbol argument)
 * - extend/include (module mixing)        → Module
 *
 * Reference emission (TASK-310 / Phase 1.1) — node types verified EMPIRICALLY
 * against the shipped tree-sitter-ruby WASM (NOT guessed):
 * - `require` / `require_relative` / `load` calls → one 'import' edge whose
 *   symbolName is the LITERAL STRING PATH from the first argument
 *   (`require "json"` → 'json', `require_relative "./models/user"` →
 *   './models/user'; the path string is the name, mirroring the C/C++
 *   include-path decision from TASK-308 — no last-segment splitting, a path
 *   is a single identifier). Interpolated (`"#{dir}/x"`) and non-literal
 *   (`File.join(...)`) args emit nothing — no statically resolvable path.
 * - `include` / `extend` / `prepend` calls → one 'extends' edge per constant
 *   argument (the task's mixin decision: mixins are inheritance-like, so the
 *   module is a heritage target; qualified `Outer::Mix` → LAST segment 'Mix').
 * - `class` declarations with a `superclass` field (`class Foo < Bar`) →
 *   one 'extends' edge; `< Outer::Base` → LAST segment 'Base'
 *   (scope_resolution name field). `singleton_class` (`class << self`) has
 *   NO `superclass` field (verified) → no heritage edge.
 * - `call` edges (cheap, optional per task): method is the receiver-style
 *   `method` field identifier; chained receivers (`a.b.c`) emit ONLY the LAST
 *   segment 'c' — the receiver subtree is a path component, never an
 *   independent call site (matches TS/Rust/Swift last-segment convention).
 *   `callerName` = the enclosing method/singleton_method name when present.
 */

import type { Tree, Node as TSNode } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol, ReferenceKind } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";

const METHOD = "method";
const SINGLETON_METHOD = "singleton_method";
const CLASS = "class";
const SINGLETON_CLASS = "singleton_class";
const MODULE = "module";
const CALL = "call";
const BODY_STATEMENT = "body_statement";
const COMMENT = "comment";
const SIMPLE_SYMBOL = "simple_symbol";
const CONSTANT = "constant";

// Reference-emission node types (TASK-310 / Phase 1.1) — verified against the
// shipped tree-sitter-ruby WASM, NOT guessed (see header comment).
const STRING = "string";
const STRING_CONTENT = "string_content";
const INTERPOLATION = "interpolation";
const SCOPE_RESOLUTION = "scope_resolution";
const IDENTIFIER = "identifier";

/** attr_accessor / attr_reader / attr_writer — synthetic reader/writer methods. */
const ATTR_METHOD_RE = /^attr_(accessor|reader|writer)$/;
/** Module-mixing calls whose constant argument is a module reference. */
const MIXIN_METHOD = new Set(["extend", "include"]);
/** Require-style calls that introduce an import edge (TASK-310). */
const REQUIRE_METHOD = new Set(["require", "require_relative", "load"]);
/** Module-mixing calls → 'extends' edges (TASK-310: inheritance-like). */
const MIXIN_REFERENCE_METHOD = new Set(["include", "extend", "prepend"]);

export class RubyVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree, _sourceCode: string): ParsedSymbol[] {
		const root = tree.rootNode;
		const symbols: ParsedSymbol[] = [];
		this.walkNode(root, symbols, null, false);
		return symbols;
	}

	/**
	 * Emit reference edges (TASK-310 / Phase 1.1) — require-style imports,
	 * include/extend/prepend mixins, class-superclass heritage and call sites.
	 * See the header JSDoc for the verified grammar node mappings and
	 * edge-kind decisions.
	 */
	extractReferences(tree: Tree, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		if (!tree) return refs;
		this.walkReferences(tree.rootNode, refs, null);
		return refs;
	}

	/**
	 * Reference walker — mirrors walkNode's traversal shape (same child
	 * recursion + caller threading) so symbol extraction and reference
	 * emission stay independent. The require/mixin/class cases emit edges and
	 * then recurse exactly like the default branch, so no node is visited
	 * twice and call sites nested in bodies are still reached.
	 */
	private walkReferences(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
		const type = node.type;

		// ── Call sites: require-family → 'import'; mixins → 'extends';
		//    everything else → 'call' (LAST segment) ──
		if (type === CALL) {
			const methodNode = node.childForFieldName("method");
			if (methodNode && methodNode.type === IDENTIFIER) {
				const methodName = methodNode.text;
				if (REQUIRE_METHOD.has(methodName)) {
					this.emitRequireImports(node, refs, callerName);
				} else if (MIXIN_REFERENCE_METHOD.has(methodName)) {
					this.emitMixinEdges(node, refs);
				} else {
					// Plain call → the called name. Chained receivers (`a.b.c`)
					// are path components, NOT independent call sites — the
					// method field already holds the LAST segment ('c'), and
					// the receiver subtree is skipped below.
					this.pushRef(refs, methodName, node.startPosition.row + 1, callerName, "call");
				}
			}
			// Recurse into children EXCEPT the receiver subtree: for a chained
			// call (`a.b.c`) the receiver is itself a `call` node whose method
			// is an intermediate segment ('b') — emitting it would break the
			// LAST-segment convention. Receiver identifiers are not calls, so
			// skipping the receiver field never loses a call site. NOTE: nodes
			// are transient web-tree-sitter proxies — compare by the stable
			// numeric `id`, not object identity.
			const receiver = node.childForFieldName("receiver");
			for (const child of node.namedChildren) {
				if (receiver && child.id === receiver.id) continue;
				this.walkReferences(child, refs, callerName);
			}
			return;
		}

		// ── Class declaration: `class Foo < Bar` → 'extends' heritage ──
		if (type === CLASS) {
			this.emitClassHeritage(node, refs);
			for (const child of node.namedChildren) {
				this.walkReferences(child, refs, callerName);
			}
			return;
		}

		// ── Caller tracking: enclosing method name ──
		if (type === METHOD || type === SINGLETON_METHOD) {
			const nameNode = node.childForFieldName("name") ?? node.namedChildren.find((c) => c.type === IDENTIFIER);
			const name = nameNode?.text ?? callerName;
			for (const child of node.namedChildren) {
				this.walkReferences(child, refs, name);
			}
			return;
		}

		for (const child of node.namedChildren) {
			this.walkReferences(child, refs, callerName);
		}
	}

	// ── Reference-emission helpers (TASK-310 / Phase 1.1) ──────────────────

	private pushRef(
		refs: ParsedReference[],
		symbolName: string,
		callerLine: number,
		callerName: string | null,
		kind: ReferenceKind
	): void {
		// Targets stay null per the TASK-299 ParsedReference heritage contract —
		// edges are name-based; ADR-002 resolution happens downstream. Explicit
		// null (not undefined) so strict assertions hold.
		refs.push({ symbolName, callerFile: "", callerLine, callerName, kind, targetFile: null, targetSymbolId: null });
	}

	/**
	 * Emit one 'import' edge per require-style call (`require`,
	 * `require_relative`, `load`) whose first argument is a plain string
	 * literal. Verified grammar (shipped tree-sitter-ruby WASM): the call's
	 * `arguments` field holds an `argument_list` whose named children are the
	 * args; a literal path arg is a `string` node containing a `string_content`
	 * child with the path text (`"json"` → 'json'). The symbolName is the FULL
	 * path string (no last-segment splitting) — mirroring the C/C++ include
	 * path decision (TASK-308): the path IS the name. Interpolated
	 * (`"#{dir}/x"` — has an `interpolation` child) and non-literal
	 * (`File.join(...)` — a call, not a string) args emit nothing.
	 */
	// prettier-ignore
	private emitRequireImports(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
		const line = node.startPosition.row + 1;
		const args = node.childForFieldName("arguments");
		if (!args) return;
		for (const arg of args.namedChildren) {
			if (arg.type !== STRING) continue;
			// Interpolated strings have an `interpolation` child — dynamic
			// path, not statically resolvable.
			if (arg.namedChildren.some((c) => c.type === INTERPOLATION)) continue;
			const content = arg.namedChildren.find((c) => c.type === STRING_CONTENT);
			if (content) this.pushRef(refs, content.text, line, callerName, "import");
		}
	}

	/**
	 * Emit one 'extends' edge per module-mixing argument of an include/extend/
	 * prepend call — the TASK-310 mixin decision: mixins are inheritance-like,
	 * so the mixed-in module is a heritage target (kind 'extends', not
	 * 'import'). Qualified `Outer::Mix` resolves to its LAST segment 'Mix'
	 * (scope_resolution `name` field, per ADR-002). callerName null — the edge
	 * belongs to the mixing class body, not an enclosing function.
	 */
	private emitMixinEdges(node: TSNode, refs: ParsedReference[]): void {
		const line = node.startPosition.row + 1;
		const args = node.childForFieldName("arguments");
		if (!args) return;
		for (const arg of args.namedChildren) {
			if (arg.type === CONSTANT) {
				this.pushRef(refs, arg.text, line, null, "extends");
			} else if (arg.type === SCOPE_RESOLUTION) {
				const name = arg.childForFieldName("name");
				if (name) this.pushRef(refs, name.text, line, null, "extends");
			}
		}
	}

	/**
	 * Emit one 'extends' edge for a `class Foo < Bar` superclass clause.
	 *
	 * Grammar (verified empirically against the shipped WASM): `class` has a
	 * DIRECT `superclass` field holding a `superclass` node wrapping the
	 * target expression — a plain `constant` (`< Vehicle` → 'Vehicle') or a
	 * `scope_resolution` (`< Outer::Base` → LAST segment 'Base' via the
	 * `name` field). `singleton_class` (`class << self`) exposes NO superclass
	 * field → no edge. callerLine = the class declaration line; callerName
	 * null per the ParsedReference heritage contract (language-visitor.ts:22).
	 */
	private emitClassHeritage(node: TSNode, refs: ParsedReference[]): void {
		const superclass = node.childForFieldName("superclass");
		if (!superclass) return;
		const target = superclass.namedChildren.find((c) => c.type === CONSTANT || c.type === SCOPE_RESOLUTION);
		const name =
			target?.type === CONSTANT
				? target.text
				: target?.type === SCOPE_RESOLUTION
					? (target.childForFieldName("name")?.text ?? null)
					: null;
		if (name) this.pushRef(refs, name, node.startPosition.row + 1, null, "extends");
	}

	private walkNode(node: TSNode, symbols: ParsedSymbol[], parentName: string | null, insideClass: boolean): void {
		const type = node.type;

		// ── Inside class body: extract methods ──────────────────
		if (insideClass) {
			if (type === METHOD || type === SINGLETON_METHOD) {
				const nameNode = node.namedChildren.find((c) => c.type === "identifier" || c.type === "method_name");
				if (nameNode) {
					symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
				}
				return;
			}
			if (type === CALL) {
				this.extractCallSymbols(node, symbols, parentName);
			}
			for (const child of node.namedChildren) {
				this.walkNode(child, symbols, parentName, true);
			}
			return;
		}

		// ── Method (top-level) ──────────────────────────────────
		if (type === METHOD || type === SINGLETON_METHOD) {
			const nameNode = node.namedChildren.find((c) => c.type === "identifier" || c.type === "method_name");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Method, parentName));
			}
			return;
		}

		// ── Class declaration ───────────────────────────────────
		if (type === CLASS || type === SINGLETON_CLASS) {
			const nameNode = node.namedChildren.find((c) => c.type === "constant");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
				const body = node.namedChildren.find((c) => c.type === BODY_STATEMENT);
				if (body) {
					this.walkNode(body, symbols, nameNode.text, true);
				}
			}
			return;
		}

		// ── Module declaration ──────────────────────────────────
		if (type === MODULE) {
			const nameNode = node.namedChildren.find((c) => c.type === "constant");
			if (nameNode) {
				symbols.push(this.makeSymbol(node, nameNode.text, SymbolKind.Class, parentName));
			}
			return;
		}

		// ── Recurse into children ───────────────────────────────
		for (const child of node.namedChildren) {
			this.walkNode(child, symbols, parentName, false);
		}
	}

	// ── Helpers ─────────────────────────────────────────────────────

	/**
	 * Extract synthetic symbols from class-body `call` nodes:
	 * - attr_accessor/attr_reader/attr_writer :foo, :bar → one Method per symbol arg
	 * - extend/include SomeModule                       → one Module per constant arg
	 */
	private extractCallSymbols(node: TSNode, symbols: ParsedSymbol[], parentName: string | null): void {
		const methodNode = node.childForFieldName("method");
		if (!methodNode || methodNode.type !== "identifier") return;
		const methodName = methodNode.text;

		const isAttrMethod = ATTR_METHOD_RE.test(methodName);
		const isMixinMethod = MIXIN_METHOD.has(methodName);
		if (!isAttrMethod && !isMixinMethod) return;

		const argsNode = node.childForFieldName("arguments");
		if (!argsNode) return;

		const argType = isAttrMethod ? SIMPLE_SYMBOL : CONSTANT;
		const kind = isAttrMethod ? SymbolKind.Method : SymbolKind.Module;
		for (const arg of argsNode.namedChildren) {
			if (arg.type !== argType) continue;
			// `attr_accessor :name` → Method named "name" (strip the leading `:`);
			// `extend SomeModule` → Module named "SomeModule".
			const name = isAttrMethod ? arg.text.replace(/^:/, "") : arg.text;
			if (!name) continue;
			symbols.push(this.makeSymbol(node, name, kind, parentName, `${methodName} ${arg.text}`));
		}
	}

	private makeSymbol(
		node: TSNode,
		name: string,
		kind: SymbolKind,
		parentName: string | null,
		signatureOverride?: string
	): ParsedSymbol {
		return {
			name,
			kind,
			startLine: node.startPosition.row + 1,
			startCol: node.startPosition.column + 1,
			endLine: node.endPosition.row + 1,
			endCol: node.endPosition.column + 1,
			signature: signatureOverride ?? this.buildSignature(node),
			docComment: this.extractDocComment(node),
			exported: false,
			defaultExport: false,
			parentName
		};
	}

	private buildSignature(node: TSNode): string {
		const firstLine = node.text.split("\n")[0] ?? "";
		return firstLine.replace(/\s+/g, " ").trim();
	}

	private extractDocComment(node: TSNode): string | null {
		// Ruby uses # line comments (tree-sitter: one COMMENT per line, even
		// for a contiguous block). Aggregate the contiguous preceding # comments
		// and canonicalize so [DEPRECATED] + @tags work like PHP/TS/JS.
		const raw = this.collectDocCommentRaw(node);
		if (raw === null) return null;
		return serializeDocBlock(raw);
	}

	/** Gather contiguous # line-COMMENT siblings immediately preceding `node`
	 *  in source order. Returns null when none found.
	 *
	 *  Tree-sitter-ruby places docs for the *first* member of a class body as
	 *  siblings of the enclosing `class` node (before `body_statement`), not as
	 *  siblings of the member itself — see the shipped WASM dumps in TASK-465
	 *  (class Cart children: [constant, comment, comment, body_statement{method}]).
	 *  So when a member has no direct previousNamedSibling and it is the first
	 *  child of its `body_statement`, walk the `body_statement`'s own preceding
	 *  siblings for the contiguous # run. Later members' docs sit inside the
	 *  same body_statement as direct previous siblings and are handled by the
	 *  primary walk.
	 */
	private collectDocCommentRaw(node: TSNode): string | null {
		let lines = this.collectContiguousComments(node.previousNamedSibling);
		if (lines.length > 0) return lines.join("\n");

		// Fallback: first member inside a class body_statement — docs are on
		// the class node before the body_statement.
		const parent = node.parent;
		if (parent && parent.type === BODY_STATEMENT && parent.namedChildren[0]?.id === node.id) {
			lines = this.collectContiguousComments(parent.previousNamedSibling);
			if (lines.length > 0) return lines.join("\n");
		}
		return null;
	}

	private collectContiguousComments(start: TSNode | null): string[] {
		const lines: string[] = [];
		let cur: TSNode | null = start;
		while (cur && cur.type === COMMENT && cur.text.startsWith("#")) {
			lines.unshift(cur.text);
			cur = cur.previousNamedSibling;
		}
		return lines;
	}
}
