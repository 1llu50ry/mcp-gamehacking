/**
 * Vue SFC reference-emission helpers (TASK-312 split, review FIX-2).
 *
 * Pure-helper module mirroring the ts-reference-emission.ts precedent:
 * functions take (Node, refs) with NO visitor dependencies — the VueVisitor
 * only locates the top-level <script> / <template> blocks and delegates the
 * per-block work here.
 *
 * Edge families:
 * - 'import' — one edge per binding of every ES import statement inside a
 *   <script> / <script setup> raw_text (the tree-sitter-vue grammar never
 *   TS-parses the script body, so bindings come from the line-anchored
 *   SCRIPT_IMPORT_RE above). Imported name wins over an `as` alias (mirroring
 *   the TS emitImports convention); `default` rebindings, side-effect imports
 *   (`import 'x'`) and dynamic imports (`import('x')`) emit nothing.
 *   Import metadata (issue #83): each binding row carries importInfo
 *   {localName, importedName, moduleSpecifier, importKind} — localName is the
 *   LOCAL alias for `name as alias` bindings (TS parity), importedName the
 *   exported name (null for side-effect imports), moduleSpecifier the raw
 *   path as written.
 * - 'instantiation' — one edge per template component tag (PascalCase or
 *   kebab-case — Vue components can never be lowercase single words). Native
 *   elements and built-in lowercase tags (`div`, `span`, `template`,
 *   `component`, `slot`...) emit nothing.
 *
 * callerName is null for both families (imports are file-scope; a template
 * usage has no enclosing function). targetFile/targetSymbolId are EXPLICIT
 * null per the canonical TASK-347 pushRef pattern — edges are name-based,
 * ADR-002 resolution happens at query time (the parser pool fills callerFile).
 */

import type { Node } from "web-tree-sitter";
import type { ParsedReference, ReferenceKind, ImportInfo } from "../language-visitor";

// ── SFC block + template node types (verified against the shipped
//    tree-sitter-vue WASM) ────────────────────────────────────────────
// The grammar's `_node` (grammar.js:36-41) includes `template_element`, so
// `<template #header>`, `<template v-if>` and plain `<template>` wrappers
// inside the template block ALL parse as template_element nodes — never as
// `element`. walkTemplate must recurse into them (FIX-1) or components nested
// inside slot/#/v-if wrappers stay unindexed.

export const SCRIPT_ELEMENT = "script_element";
export const TEMPLATE_ELEMENT = "template_element";
export const ELEMENT = "element";
const RAW_TEXT = "raw_text";
const START_TAG = "start_tag";
const SELF_CLOSING_TAG = "self_closing_tag";
const TAG_NAME = "tag_name";

// ── ES import-statement matcher over a <script> raw_text block ────────
//
// Group 1 captures the specifier list of `import <specifier> from 'path'`;
// group 2 captures the QUOTED module specifier path ('path' — without the
// quotes); the ALTERNATIVE branch matches side-effect imports (`import 'path'`)
// which have no specifier (group 1 undefined → no binding, but group 2 still
// captures the path so a single side-effect row with importKind
// 'side-effect' can be emitted). The lookahead stops the specifier group
// from crossing into a following import/export statement, so a side-effect
// import cannot swallow the next statement's specifier.
//
// KNOWN LIMITATION (review FIX-3): the regex is line-anchored and
// context-blind over the raw_text — a line that BEGINS with import-looking
// text inside a template literal (`\`\nimport x from './y'\n\``) ALSO matches
// and emits a spurious edge. That string-context blind spot is accepted: the
// script body is raw_text (the vue grammar never TS-parses it), and a full
// TS-grammar re-parse is out of scope per the TASK-312 constraints. Mid-line
// occurrences (`prefix … import x from '../../y'`) do NOT match — `^` rows
// require the import at a line start. Garbage is additionally contained by
// importBindings, which only pushes names matching /^[A-Za-z_$][\w$]*$/.
export const SCRIPT_IMPORT_RE =
	/^\s*import\s+(?:type\s+)?(?:(?:((?:(?!\n\s*(?:import|export))[\s\S])*?)\s+from\s+)?(['"][^'"]+['"]))\s*;?/gm;

/** A binding name must be a valid JS/TS identifier — rejects garbage and `default`. */
const BINDING_NAME_RE = /^[A-Za-z_$][\w$]*$/;

function isBindingName(name: string): boolean {
	return name !== "default" && BINDING_NAME_RE.test(name);
}

/** A structured import binding: local alias + imported (exported) name + import form. */
export interface VueImportBinding {
	localName: string;
	importedName: string | null;
	importKind: "default" | "named" | "namespace";
}

/** Emit one 'import' edge per binding of every import statement in the raw_text. */
export function collectScriptImports(scriptEl: Node, refs: ParsedReference[]): void {
	const raw = scriptEl.namedChildren.find((c) => c.type === RAW_TEXT);
	if (!raw) return;

	const content = raw.text;
	const baseLine = raw.startPosition.row + 1;
	SCRIPT_IMPORT_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = SCRIPT_IMPORT_RE.exec(content)) !== null) {
		const line = baseLine + content.slice(0, match.index).split("\n").length - 1;
		const moduleSpecifier = match[2] ? unquoteSpecifier(match[2]) : null;
		const bindings = importBindings(match[1]);
		if (bindings.length === 0) {
			// Side-effect import (`import 'x'`) or unparseable specifier group:
			// still emit ONE row with null imported name so the import stays
			// VISIBLE in the graph (issue #83 — imports are never dropped).
			if (moduleSpecifier) {
				pushRef(refs, moduleSpecifier, line, null, "import", {
					localName: moduleSpecifier,
					importedName: null,
					moduleSpecifier,
					importKind: "side-effect"
				});
			}
			if (match.index === SCRIPT_IMPORT_RE.lastIndex) SCRIPT_IMPORT_RE.lastIndex++;
			continue;
		}
		for (const binding of bindings) {
			pushRef(refs, binding.importedName ?? binding.localName, line, null, "import", {
				localName: binding.localName,
				importedName: binding.importedName,
				moduleSpecifier,
				importKind: binding.importKind
			});
		}
		if (match.index === SCRIPT_IMPORT_RE.lastIndex) SCRIPT_IMPORT_RE.lastIndex++;
	}
}

/** Strip the surrounding quotes from a captured specifier (`'./x'` → `./x`). */
function unquoteSpecifier(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

/**
 * Resolve the bindings of an import specifier group (SCRIPT_IMPORT_RE
 * group 1). `undefined` = side-effect import (`import 'x'`) → no bindings.
 * Semantics mirror TS emitImports: the IMPORTED name wins over an `as` alias
 * (`available as New` → importedName 'available', localName 'New'), `default`
 * rebindings are skipped, `type` modifiers are stripped, and namespace
 * imports resolve to their alias (`* as ns` → localName/importedName 'ns' —
 * a namespace has no single exported name, so both sides are the alias).
 * importKind attribution follows the TS import forms: a top-level braced
 * block → 'named', a bare leading identifier → 'default', a `* as x` part →
 * 'namespace'. Names that are not valid identifiers — e.g. a `{\n` fragment
 * left when a comment inside a multi-line named list truncates the specifier
 * group, or a template-literal line — are rejected, so no garbage rows reach
 * codebase_references.symbol_name.
 */
function importBindings(group: string | undefined): VueImportBinding[] {
	if (group === undefined) return [];
	let specifiers = group.trim();
	if (!specifiers) return [];
	const ns = specifiers.match(/^\*\s*as\s+([\w$]+)$/);
	if (ns) return isBindingName(ns[1]) ? [{ localName: ns[1], importedName: ns[1], importKind: "namespace" }] : [];
	// Whole-group named block: strip the outer braces first so the inner
	// commas split into per-binding parts.
	const wasBraced = specifiers.startsWith("{") && specifiers.endsWith("}");
	if (wasBraced) {
		specifiers = specifiers.slice(1, -1).trim();
	}
	if (!specifiers) return [];

	// Top-level comma split (depth-nested so `Def, { named }` splits while
	// the braced group stays intact).
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of specifiers) {
		if (ch === "{") depth++;
		else if (ch === "}") depth--;
		if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	parts.push(current);

	const bindings: VueImportBinding[] = [];
	for (const part of parts) {
		let p = part.trim();
		if (!p) continue;
		const innerBraced = p.startsWith("{") && p.endsWith("}");
		if (innerBraced) p = p.slice(1, -1).trim();
		if (!p) continue;
		p = p.replace(/^\s*type\s+/, "").trim(); // inline `type` modifier
		const nsPart = p.match(/^\*\s*as\s+([\w$]+)$/);
		if (nsPart) {
			if (isBindingName(nsPart[1])) {
				bindings.push({ localName: nsPart[1], importedName: nsPart[1], importKind: "namespace" });
			}
			continue;
		}
		if (p === "*") continue;
		const asIdx = p.search(/\s+as\s+/);
		const importedName = asIdx >= 0 ? p.slice(0, asIdx).trim() : p;
		const localName = asIdx >= 0 ? p.slice(asIdx + 3).trim() : importedName;
		// TS emitImports semantics: `default` rebindings (`default as Foo`)
		// and non-identifier names are skipped.
		if (!isBindingName(importedName) && !(importedName === "default" && isBindingName(localName))) continue;
		if (importedName === "default" && isBindingName(localName)) {
			bindings.push({ localName, importedName: "default", importKind: "named" });
			continue;
		}
		bindings.push({ localName, importedName, importKind: innerBraced || wasBraced ? "named" : "default" });
	}
	return bindings;
}

/**
 * Walk a template block, emitting one 'instantiation' per component tag.
 *
 * Children of type `element` (plain + self-closing) AND children of type
 * `template_element` are descended into — the grammar's `_node` includes
 * `template_element`, so nested components under `<template #header>`,
 * `<template v-if>` or plain `<template>` wrappers would otherwise emit
 * NOTHING (review FIX-1). emitComponentTag on the wrapper itself is harmless:
 * its tag_name is `template`, which fails isComponentTag.
 */
export function walkTemplate(node: Node, refs: ParsedReference[]): void {
	for (let i = 0; i < node.namedChildCount; i++) {
		const child = node.namedChild(i);
		if (!child) continue;
		if (child.type === ELEMENT) {
			emitComponentTag(child, refs);
			walkTemplate(child, refs); // nested elements
		} else if (child.type === TEMPLATE_ELEMENT) {
			walkTemplate(child, refs); // slot / v-if / v-for wrappers
		}
	}
}

/** Emit an 'instantiation' edge when an element's tag is a component tag. */
function emitComponentTag(element: Node, refs: ParsedReference[]): void {
	const tag = tagNameOf(element);
	if (!tag || !isComponentTag(tag)) return;
	pushRef(refs, tag, element.startPosition.row + 1, null, "instantiation");
}

/** The tag text of an element (`<MyComponent/>` → 'MyComponent'). */
function tagNameOf(element: Node): string | null {
	for (let i = 0; i < element.namedChildCount; i++) {
		const child = element.namedChild(i);
		if (!child) continue;
		if (child.type === TAG_NAME) return child.text;
		if (child.type === START_TAG || child.type === SELF_CLOSING_TAG) {
			const inner = child.namedChildren.find((c) => c.type === TAG_NAME);
			if (inner) return inner.text;
		}
	}
	return null;
}

/**
 * Vue components are written PascalCase (`<MyComponent/>`) or kebab-case
 * (`<base-button/>`) — native HTML elements are lowercase single words, so
 * an uppercase first character or a hyphen identifies a component usage.
 */
function isComponentTag(tag: string): boolean {
	return tag.length > 0 && (/[A-Z]/.test(tag.charAt(0)) || tag.includes("-"));
}

/** Canonical pushRef (TASK-347): explicit null targets so strict toBeNull assertions hold. */
function pushRef(
	refs: ParsedReference[],
	symbolName: string,
	callerLine: number,
	callerName: string | null,
	kind: ReferenceKind,
	importInfo?: ImportInfo
): void {
	refs.push({
		symbolName,
		callerFile: "",
		callerLine,
		callerName,
		kind,
		targetFile: null,
		targetSymbolId: null,
		importInfo
	});
}
