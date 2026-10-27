/**
 * VueVisitor — extracts symbols from Vue Single File Component (.vue) files.
 *
 * Strategy:
 * 1. Use tree-sitter to parse the SFC structure (template, script, style blocks).
 * 2. For <script> blocks, extract the raw_text (JS/TS content) and apply the
 *    regex-based symbol scanner in vue-script-scanner.ts (TASK-557 split) —
 *    functions, classes, variables, etc.
 * 3. For <template> and <style> blocks, emit structural markers.
 * 4. Falls back to GenericTextVisitor-style regex scanning if tree-sitter
 *    parse fails.
 *
 * Reference edges (TASK-312 / Phase 1.1): delegated to the
 * vue-reference-emission.ts helper module — 'import' edges per binding of
 * every ES import statement in a <script>/<script setup> raw_text (the vue
 * grammar never TS-parses the script body), and 'instantiation' edges per
 * template component tag (PascalCase or kebab-case; native lowercase single
 * words emit nothing). See that module for the full semantics + documented
 * regex limitations.
 *
 * tree-sitter-vue grammar nodes of interest:
 *   component        → top-level wrapper, repeats (element|template_element|script_element|style_element)
 *   script_element   → start_tag + optional(raw_text) + end_tag
 *   template_element → start_tag + repeat(_node) + end_tag
 *   style_element    → start_tag + optional(raw_text) + end_tag
 *   raw_text         → the inner content of a script/style block
 *   element          → start_tag | self_closing_tag (+ nested element children)
 *   tag_name         → the tag text inside start_tag / self_closing_tag
 */
import type { Tree, Node } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { parseScriptContent } from "./vue-script-scanner";
import {
	collectScriptImports,
	walkTemplate,
	SCRIPT_ELEMENT,
	TEMPLATE_ELEMENT,
	ELEMENT
} from "./vue-reference-emission";

/** SFC block constants (grammar-verified in vue-reference-emission). */
const STYLE_ELEMENT = "style_element";

export class VueVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree | null, sourceCode: string): ParsedSymbol[] {
		// If tree is null (grammar failed to load), fallback to regex
		if (!tree) {
			return this.extractViaRegexFallback(sourceCode);
		}

		const symbols: ParsedSymbol[] = [];
		const root = tree.rootNode;

		// Check if the parse had errors that indicate the tree is unreliable
		if (root.hasError) {
			// Still try tree-first, then fallback if no symbols found
			this.extractViaTree(root, symbols);
			if (symbols.length === 0) {
				return this.extractViaRegexFallback(sourceCode);
			}
			return symbols;
		}

		this.extractViaTree(root, symbols);
		return symbols;
	}

	// ── Tree-based extraction ──────────────────────────────────────

	private extractViaTree(root: Node, symbols: ParsedSymbol[]): void {
		// Walk all direct children of the component (or file-level) node
		for (let i = 0; i < root.namedChildCount; i++) {
			const child = root.namedChild(i);
			if (!child) continue;

			if (child.type === SCRIPT_ELEMENT) {
				this.extractScriptBlock(child, symbols);
			} else if (child.type === TEMPLATE_ELEMENT || child.type === ELEMENT) {
				// Emit a structural marker for the template
				symbols.push({
					name: "<template>",
					kind: SymbolKind.Class,
					startLine: child.startPosition.row + 1,
					startCol: child.startPosition.column + 1,
					endLine: child.endPosition.row + 1,
					endCol: child.endPosition.column + 1,
					signature: "Vue template block",
					docComment: null,
					exported: false,
					defaultExport: false,
					parentName: null
				});
			} else if (child.type === STYLE_ELEMENT) {
				// Emit a structural marker for the style block
				const attrs = this.extractStyleAttributes(child);
				symbols.push({
					name: `<style${attrs}>`,
					kind: SymbolKind.Key,
					startLine: child.startPosition.row + 1,
					startCol: child.startPosition.column + 1,
					endLine: child.endPosition.row + 1,
					endCol: child.endPosition.column + 1,
					signature: `Vue style block${attrs}`,
					docComment: null,
					exported: false,
					defaultExport: false,
					parentName: null
				});
			}
		}
	}

	/** Extract attributes from a style element's start tag for display. */
	private extractStyleAttributes(node: Node): string {
		const startTag = node.namedChild(0);
		if (!startTag || startTag.type !== "start_tag") return "";

		const lang: string[] = [];
		const scoped: string[] = [];
		for (let i = 0; i < startTag.namedChildCount; i++) {
			const attr = startTag.namedChild(i);
			if (attr?.type === "attribute") {
				const nameNode = attr.namedChild(0);
				const valueNode = attr.namedChild(1);
				if (nameNode?.text === "lang" && valueNode) {
					lang.push(`lang="${valueNode.text.replace(/^["']|["']$/g, "")}"`);
				}
				if (nameNode?.text === "scoped") {
					scoped.push("scoped");
				}
			}
		}
		const parts = [...lang, ...scoped];
		return parts.length > 0 ? ` ${parts.join(" ")}` : "";
	}

	/** Extract raw_text from a script_element and parse symbols via regex. */
	private extractScriptBlock(node: Node, symbols: ParsedSymbol[]): void {
		let rawTextContent = "";
		let rawTextStartLine = node.startPosition.row + 1;

		for (let i = 0; i < node.namedChildCount; i++) {
			const child = node.namedChild(i);
			if (child?.type === "raw_text") {
				rawTextContent = child.text;
				rawTextStartLine = child.startPosition.row + 1;
				break;
			}
		}

		if (!rawTextContent) return;

		// Determine script language from the start tag attributes
		const lang = this.extractScriptLang(node);

		// Parse the script content for JS/TS symbols
		parseScriptContent(rawTextContent, rawTextStartLine, lang, symbols);
	}

	/** Get the lang attribute from a script tag (ts, js, etc.). */
	private extractScriptLang(node: Node): string {
		const startTag = node.namedChild(0);
		if (!startTag || startTag.type !== "start_tag") return "js";
		for (let i = 0; i < startTag.namedChildCount; i++) {
			const attr = startTag.namedChild(i);
			if (attr?.type === "attribute") {
				const nameNode = attr.namedChild(0);
				const valueNode = attr.namedChild(1);
				if (nameNode?.text === "lang" && valueNode) {
					return valueNode.text.replace(/^["']|["']$/g, "").toLowerCase();
				}
			}
		}
		return "js";
	}

	// ── Regex fallback (no tree-sitter grammar available) ──────────

	private extractViaRegexFallback(sourceCode: string): ParsedSymbol[] {
		const symbols: ParsedSymbol[] = [];
		const lines = sourceCode.split("\n");

		// Extract the <script> block manually via regex
		const scriptMatch = sourceCode.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i);

		if (scriptMatch) {
			const scriptContent = scriptMatch[1];
			const scriptStartLine = sourceCode.substring(0, scriptMatch.index).split("\n").length;

			parseScriptContent(scriptContent, scriptStartLine, "js", symbols);
		}

		// Emit template marker if present
		if (/<template[\s>]/i.test(sourceCode)) {
			const tplLine = sourceCode.split("\n").findIndex((l) => /<template[\s>]/i.test(l)) + 1;
			if (tplLine > 0) {
				symbols.push({
					name: "<template>",
					kind: SymbolKind.Class,
					startLine: tplLine,
					startCol: 1,
					endLine: tplLine,
					endCol: lines[tplLine - 1]?.length ?? 1,
					signature: "Vue template block",
					docComment: null,
					exported: false,
					defaultExport: false,
					parentName: null
				});
			}
		}

		return symbols;
	}

	// ── Reference emission (TASK-312 / Phase 1.1) ─────────────────────

	/**
	 * Emit reference edges for a Vue SFC (TASK-312 / Phase 1.1). Locates the
	 * top-level <script> / <template> blocks and delegates the per-block work
	 * to vue-reference-emission.ts (extracted in review FIX-2):
	 * - 'import' per ES import binding in every <script> / <script setup>
	 *   block;
	 * - 'instantiation' per template component tag in the template body.
	 *
	 * callerName is null for both families (imports are file-scope; a template
	 * usage has no enclosing function). targetFile/targetSymbolId are explicit
	 * null per the canonical TASK-347 pushRef pattern — edges are name-based,
	 * ADR-002 resolution happens at query time.
	 */
	extractReferences(tree: Tree | null, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		if (!tree) return refs;

		const root = tree.rootNode;
		for (let i = 0; i < root.namedChildCount; i++) {
			const child = root.namedChild(i);
			if (!child) continue;
			if (child.type === SCRIPT_ELEMENT) {
				collectScriptImports(child, refs);
			} else if (child.type === TEMPLATE_ELEMENT || child.type === ELEMENT) {
				// Element children may sit directly under the root when the SFC
				// has no <template> wrapper; both routes share the same walk.
				walkTemplate(child, refs);
			}
		}
		return refs;
	}
}
