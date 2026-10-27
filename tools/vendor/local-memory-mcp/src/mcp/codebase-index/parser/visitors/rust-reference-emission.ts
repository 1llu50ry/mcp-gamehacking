/**
 * Rust reference-emission helpers (TASK-307 split, review debt TASK-348).
 *
 * Pure-helper module mirroring the ts-reference-emission.ts precedent:
 * functions take (Node, refs) with NO visitor dependencies — RustVisitor only
 * locates the AST root and delegates the reference walk here.
 *
 * Edge families:
 * - 'import' — one edge per binding of a `use_declaration`: for a simple
 *   path the binding is the LAST path segment (`use crate::a::b::Thing` →
 *   'Thing'); an `as` alias wins (`use foo::Bar as Baz` → 'Baz'); grouped
 *   `use foo::{x, y as z, nested::w}` emits one edge per group member.
 *   Glob `use foo::*` and `self` members bind no introducible name → nothing.
 * - 'implements' — one edge per trait of a `impl Trait for Type` block
 *   (LAST segment; inherent impls have no `trait` field → no edge), plus one
 *   edge per trait in a `#[derive(...)]` attribute (implicit compiler-
 *   generated impls). callerName null per the heritage contract.
 * - 'extends' — one edge per supertrait of `trait T: Super + Other`
 *   (lifetimes like `'static` skip).
 * - 'call' — `helper()` → 'helper', `obj.save()` → 'save', `std::io::read()`
 *   → 'read' LAST segment, `self::f()` → 'f'. macro_invocations
 *   (`println!`) are NOT call_expressions → skipped.
 *
 * targetFile/targetSymbolId are EXPLICIT null per the canonical TASK-347
 * pushRef pattern — edges are name-based, ADR-002 resolution happens at
 * query time (the parser pool fills callerFile).
 */

import type { Node as TSNode } from "web-tree-sitter";
import type { ParsedReference, ReferenceKind } from "../language-visitor";

// Reference-emission node types (TASK-307 / Phase 1.1) — verified against the
// shipped tree-sitter-rust WASM, NOT guessed (see header comment).
const USE_LIST = "use_list";
const SCOPED_USE_LIST = "scoped_use_list";
const USE_WILDCARD = "use_wildcard";
const TYPE_IDENTIFIER = "type_identifier";
const SCOPED_TYPE_IDENTIFIER = "scoped_type_identifier";
const GENERIC_TYPE = "generic_type";
const TRAIT_BOUNDS = "trait_bounds";
const ATTRIBUTE_ITEM = "attribute_item";
const ATTRIBUTE = "attribute";
const TOKEN_TREE = "token_tree";
const CALL_EXPRESSION = "call_expression";
const FIELD_EXPRESSION = "field_expression";
const LIFETIME = "lifetime";
const DERIVE = "derive";

// Node types shared with RustVisitor's symbol extraction — declared locally so
// this module stays dependency-free (one-directional import from the visitor).
const FUNCTION_ITEM = "function_item";
const STRUCT_ITEM = "struct_item";
const ENUM_ITEM = "enum_item";
const TRAIT_ITEM = "trait_item";
const IMPL_ITEM = "impl_item";
const USE_DECLARATION = "use_declaration";
const USE_AS_CLAUSE = "use_as_clause";
const SCOPED_IDENTIFIER = "scoped_identifier";
const IDENTIFIER = "identifier";
const SELF = "self";
const SUPER = "super";
const CRATE = "crate";
const COMMENT = "comment";
const LINE_COMMENT = "line_comment";
const BLOCK_COMMENT = "block_comment";

/**
 * Reference walker — mirrors walkNode's traversal shape (same child
 * recursion + caller threading) so symbol extraction and reference
 * emission stay independent. The heritage/use/call cases emit edges and
 * then recurse exactly like the default branch (or return for use
 * declarations, whose members are pure names), so no node is visited
 * twice and call sites nested in bodies are still reached.
 */
export function walkReferences(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
	const type = node.type;

	// ── Call edges: `helper()`, `obj.save()`, `std::io::read()`, `self::f()` ──
	if (type === CALL_EXPRESSION) {
		const name = callTargetName(node);
		if (name) pushRef(refs, name, node.startPosition.row + 1, callerName, "call");
		// Recurse: arguments may hold nested calls (`f(g())`) and closures.
		for (const child of node.namedChildren) {
			walkReferences(child, refs, callerName);
		}
		return;
	}

	// ── Use declarations → one 'import' edge per binding ──
	if (type === USE_DECLARATION) {
		emitUseImports(node, refs, callerName);
		return; // members are pure names — no nested references
	}

	// ── Heritage: trait impls / supertraits / derive attributes ──
	if (type === IMPL_ITEM) {
		emitImplHeritage(node, refs);
		for (const child of node.namedChildren) {
			walkReferences(child, refs, null);
		}
		return;
	}
	if (type === TRAIT_ITEM) {
		emitTraitBounds(node, refs);
		for (const child of node.namedChildren) {
			walkReferences(child, refs, null);
		}
		return;
	}
	if (type === STRUCT_ITEM || type === ENUM_ITEM) {
		emitDeriveEdges(node, refs);
		for (const child of node.namedChildren) {
			walkReferences(child, refs, null);
		}
		return;
	}

	// ── Caller tracking: enclosing function / method name ──
	if (type === FUNCTION_ITEM) {
		const nameNode = node.childForFieldName("name") ?? node.namedChildren.find((c) => c.type === IDENTIFIER);
		const name = nameNode?.text ?? callerName;
		for (const child of node.namedChildren) {
			walkReferences(child, refs, name);
		}
		return;
	}

	for (const child of node.namedChildren) {
		walkReferences(child, refs, callerName);
	}
}

/** Canonical pushRef (TASK-347): explicit null targets so strict toBeNull assertions hold. */
export function pushRef(
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
 * Emit one 'import' edge per binding of a `use_declaration`.
 *
 * Verified grammar (shipped tree-sitter-rust WASM): the `argument` field
 * is `scoped_identifier` (simple path), `use_as_clause` (alias wins),
 * `use_list` / `scoped_use_list` (grouped — one edge per member, recursing
 * into nested groups), `identifier` (`use foo;`), or `use_wildcard`
 * (`use foo::*` — glob binds no introducible name → skipped; `self` /
 * `super` / `crate` members likewise).
 */
export function emitUseImports(node: TSNode, refs: ParsedReference[], callerName: string | null): void {
	const arg = node.childForFieldName("argument");
	if (!arg) return;
	const line = node.startPosition.row + 1;
	emitUseArgument(arg, refs, line, callerName);
}

export function emitUseArgument(arg: TSNode, refs: ParsedReference[], line: number, callerName: string | null): void {
	switch (arg.type) {
		case USE_AS_CLAUSE: {
			const alias = arg.childForFieldName("alias");
			if (alias) pushRef(refs, alias.text, line, callerName, "import");
			break;
		}
		case IDENTIFIER:
			pushRef(refs, arg.text, line, callerName, "import");
			break;
		case SCOPED_IDENTIFIER: {
			const name = arg.childForFieldName("name");
			if (name) pushRef(refs, name.text, line, callerName, "import");
			break;
		}
		case USE_LIST:
		case SCOPED_USE_LIST:
			emitUseList(arg, refs, line, callerName);
			break;
		case USE_WILDCARD:
		case SELF:
		case SUPER:
		case CRATE:
		default:
			// Glob / self / super / crate imports bind no introducible name.
			break;
	}
}

export function emitUseList(listNode: TSNode, refs: ParsedReference[], line: number, callerName: string | null): void {
	const list = listNode.type === SCOPED_USE_LIST ? (listNode.childForFieldName("list") ?? listNode) : listNode;
	for (const member of list.namedChildren) {
		emitUseArgument(member, refs, line, callerName);
	}
}

/**
 * Emit one 'implements' edge for a `impl Trait for Type` block.
 *
 * Only impls WITH a `trait` field declare a heritage relationship; the
 * trait resolves to its LAST name segment (`std::fmt::Display` → 'Display',
 * `Iterator<Item = u8>` → 'Iterator', `impl<T> Trait for ...` works).
 * Inherent impls (`impl Type { ... }`, no `trait` field) emit nothing.
 * callerLine = the impl block's line (where the Type→Trait relationship
 * is declared); callerName null per the ParsedReference heritage contract.
 */
export function emitImplHeritage(node: TSNode, refs: ParsedReference[]): void {
	const traitField = node.childForFieldName("trait");
	if (!traitField) return;
	const name = pathTargetName(traitField);
	if (name) pushRef(refs, name, node.startPosition.row + 1, null, "implements");
}

/**
 * Emit one 'extends' edge per supertrait of a `trait T: Super + Other`.
 *
 * Bounds (`trait_bounds` field) may be `type_identifier`, qualified
 * `scoped_type_identifier` (LAST segment), `generic_type` (`Foo<u8>` →
 * 'Foo', `std::ops::Add<f64>` → 'Add') or `lifetime` bounds (`'static`,
 * `'a`) — lifetimes are NOT traits and are skipped. callerName null.
 */
export function emitTraitBounds(node: TSNode, refs: ParsedReference[]): void {
	const bounds = node.childForFieldName("bounds");
	if (!bounds || bounds.type !== TRAIT_BOUNDS) return;
	const line = node.startPosition.row + 1;
	for (const bound of bounds.namedChildren) {
		if (bound.type === LIFETIME) continue;
		const name = pathTargetName(bound);
		if (name) pushRef(refs, name, line, null, "extends");
	}
}

/**
 * Emit one 'implements' edge per trait in `#[derive(...)]` attributes on a
 * struct/enum (INCLUDED per TASK-307 decision — it is cheap and every
 * derive is an implicit compiler-generated trait impl).
 *
 * The `attribute_item` is the struct/enum's previous sibling (stacked
 * attributes walked back, comments skipped); only attributes whose macro
 * name is `derive` count (`#[repr(C)]` etc. emit nothing). The `token_tree`
 * argument is FLAT (verified: qualified paths inside derive args are NOT
 * `scoped_identifier` nodes — `serde::Serialize` parses as identifier
 * 'serde', '::', identifier 'Serialize' as sibling tokens), so per
 * comma-separated member the LAST identifier wins (`serde::Serialize` →
 * 'Serialize', ADR-002 last segment).
 * callerLine = the struct/enum DECLARATION line (the derived type), not
 * the attribute line — consistent with the heritage contract.
 */
export function emitDeriveEdges(node: TSNode, refs: ParsedReference[]): void {
	const line = node.startPosition.row + 1;
	let prev = node.previousNamedSibling;
	while (
		prev &&
		(prev.type === ATTRIBUTE_ITEM || prev.type === COMMENT || prev.type === LINE_COMMENT || prev.type === BLOCK_COMMENT)
	) {
		if (prev.type === ATTRIBUTE_ITEM) {
			const attr = prev.namedChildren.find((c) => c.type === ATTRIBUTE);
			const macroName = attr?.namedChildren[0]?.text;
			if (macroName === DERIVE) {
				const tokenTree = attr?.childForFieldName("arguments");
				if (tokenTree && tokenTree.type === TOKEN_TREE) {
					let lastIdentifier: string | null = null;
					for (const child of tokenTree.children) {
						if (child.type === IDENTIFIER) {
							lastIdentifier = child.text;
						} else if (child.type === ",") {
							if (lastIdentifier) pushRef(refs, lastIdentifier, line, null, "implements");
							lastIdentifier = null;
						}
					}
					if (lastIdentifier) pushRef(refs, lastIdentifier, line, null, "implements");
				}
			}
		}
		prev = prev.previousNamedSibling;
	}
}

/**
 * Resolve the called name of a `call_expression` — LAST name segment per
 * ADR-002:
 *   - `helper()`            → identifier text 'helper'
 *   - `obj.save()`          → field_expression `field` → 'save'
 *   - `std::io::read(&s)`   → scoped_identifier `name` → 'read'
 *   - `self::helper()`      → scoped_identifier `name` → 'helper'
 *   - `f()()`               → function field is a call_expression → null
 * Macro invocations (`println!`) are NOT call_expressions → no edge.
 */
export function callTargetName(node: TSNode): string | null {
	const fn = node.childForFieldName("function") ?? node.firstNamedChild;
	if (!fn) return null;
	if (fn.type === FIELD_EXPRESSION) {
		return fn.childForFieldName("field")?.text ?? fn.lastNamedChild?.text ?? null;
	}
	if (fn.type === SCOPED_IDENTIFIER) {
		return fn.childForFieldName("name")?.text ?? null;
	}
	if (fn.type === IDENTIFIER) return fn.text;
	return null;
}

/**
 * Resolve a type-path node to its LAST name segment (ADR-002):
 * `type_identifier` → text; `scoped_type_identifier` / `scoped_identifier`
 * → `name` field (std::fmt::Display → 'Display'); `generic_type` →
 * recurse into its `type` field (Iterator<Item = u8> → 'Iterator',
 * std::ops::Add<u8> → 'Add'). Other nodes (lifetimes, primitives) → null.
 */
export function pathTargetName(node: TSNode): string | null {
	const type = node.type;
	if (type === TYPE_IDENTIFIER || type === IDENTIFIER) return node.text;
	if (type === SCOPED_TYPE_IDENTIFIER || type === SCOPED_IDENTIFIER) {
		return node.childForFieldName("name")?.text ?? null;
	}
	if (type === GENERIC_TYPE) {
		const base = node.childForFieldName("type") ?? node.namedChildren[0];
		return base ? pathTargetName(base) : null;
	}
	return null;
}
