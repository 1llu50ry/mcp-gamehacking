/**
 * GenericTextVisitor — regex-based symbol extraction for any text/code file.
 *
 * Supports common declaration patterns across many programming languages.
 * Used as fallback when no tree-sitter grammar is available for a file extension.
 *
 * This visitor does NOT use tree-sitter — it parses via regex line scanning.
 * It implements LanguageVisitor so it plugs into the existing ParserPool infrastructure
 * (the pool skips tree-sitter for configs with empty grammarWasms).
 */
import type { Tree } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "./language-visitor";
import { SymbolKind } from "./language-visitor";

export class GenericTextVisitor implements LanguageVisitor {
	extractSymbols(_tree: Tree | null, sourceCode: string): ParsedSymbol[] {
		const symbols: ParsedSymbol[] = [];
		const lines = sourceCode.split("\n");
		const totalLines = lines.length;

		// Collect comment lines preceding a declaration
		let pendingComment: string[] = [];

		for (let i = 0; i < totalLines; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			const lineNum = i + 1;

			// ── Collect single-line comments ──────────────────────
			const commentMatch = trimmed.match(/^\s*(?:\/\/|#|;|%|--|')\s*(.*)/);
			if (commentMatch && !trimmed.startsWith("#!/")) {
				pendingComment.push(commentMatch[1].trim());
				continue;
			}

			// ── Collect doc comments: /// or //! style ────────────
			const docCommentMatch = trimmed.match(/^\s*(?:\/\/\/|\/\/!)\s*(.*)/);
			if (docCommentMatch) {
				pendingComment.push(docCommentMatch[1].trim());
				continue;
			}

			// ── Collect block comment opening ─────────────────────
			const blockStart = trimmed.startsWith("/*") || trimmed.startsWith("{-") || trimmed.startsWith("<!--");
			if (blockStart) {
				const commentLines: string[] = [];
				let j = i;
				const endPattern = trimmed.startsWith("/*") ? "*/" : trimmed.startsWith("{-") ? "-}" : "-->";
				while (j < totalLines && !lines[j].includes(endPattern)) {
					const cl = lines[j].trim();
					// Strip comment delimiters from content lines
					const stripped = cl.replace(/^\s*\/\*\*?\s*/, "").replace(/\s*\*\/\s*$/, "");
					if (stripped) commentLines.push(stripped);
					j++;
				}
				if (j < totalLines) {
					const cl = lines[j].trim();
					const stripped = cl.replace(/^\s*\/\*\*?\s*/, "").replace(/\s*\*\/\s*$/, "");
					if (stripped) commentLines.push(stripped);
				}
				if (commentLines.length > 0) {
					pendingComment.push(commentLines.join(" "));
				}
				i = j;
				continue;
			}

			// ── Skip empty lines (preserve comment paragraph breaks) ──
			if (trimmed === "") {
				if (pendingComment.length > 0 && pendingComment[pendingComment.length - 1] !== "") {
					pendingComment.push("");
				}
				continue;
			}

			// ── Try to match declaration patterns ────────────────
			const decl = this.matchDeclaration(trimmed, lineNum);
			if (decl) {
				const docComment = this.cleanComment(pendingComment);
				symbols.push({
					name: decl.name,
					kind: decl.kind,
					startLine: lineNum,
					startCol: line.indexOf(trimmed[0]) + 1,
					endLine: lineNum,
					endCol: line.length,
					signature: trimmed.length > 256 ? trimmed.substring(0, 253) + "..." : trimmed,
					docComment: docComment || null,
					exported: false,
					defaultExport: false,
					parentName: null
				});
				pendingComment = [];
			} else {
				// Not a declaration line — reset pending comments
				pendingComment = [];
			}
		}

		return symbols;
	}

	private matchDeclaration(trimmed: string, _lineNum: number): { name: string; kind: SymbolKind } | null {
		// Skip import/include/require/package lines
		if (/^(import|include|require|from|using|package)\s/i.test(trimmed)) return null;
		// Skip lines that are just punctuation/symbols
		if (/^[{}()[\],;:.\s]+$/.test(trimmed)) return null;
		// Skip closing braces, closing tags
		if (trimmed === "}" || trimmed === ")" || trimmed === "]" || trimmed.startsWith("</")) return null;
		// Skip shebang
		if (trimmed.startsWith("#!")) return null;

		// ── Routes: get/post/put/delete/patch/route/middleware /path ──
		const routeMatch = trimmed.match(/^(get|post|put|delete|patch|route|middleware)\s+(["'/]\S|[a-zA-Z])/i);
		if (routeMatch) {
			const afterVerb = trimmed.substring(routeMatch[0].length).trim().split(/\s+/)[0] || "";
			return { name: `${routeMatch[1].toLowerCase()} ${afterVerb}`, kind: SymbolKind.Route };
		}

		// ── Function declarations ────────────────────────────────
		const funcMatch = trimmed.match(/^(?:function|def|func|fn|sub|fun|define|async\s+function)\s+([a-zA-Z_][\w.!?]*)/);
		if (funcMatch) return { name: funcMatch[1], kind: SymbolKind.Function };

		// ── Arrow functions / method expressions ─────────────────
		const arrowMatch = trimmed.match(/^(?:let|var|const|val|mutable)?\s*([a-zA-Z_][\w]*)\s*(?:=|:)\s*(?:async\s*)?\(/);
		if (arrowMatch && trimmed.includes("=>") && !/^(if|while|for|switch|catch|with)\s*\(/.test(trimmed)) {
			return { name: arrowMatch[1], kind: SymbolKind.Function };
		}

		// ── Class-like types (class/struct/object/enum/module/etc.) ─────
		const typeMatch = trimmed.match(
			/^(?:class|struct|enum|module|namespace|object|record|component|entity)\s+([a-zA-Z_][\w.]*)/
		);
		if (typeMatch) return { name: typeMatch[1], kind: SymbolKind.Class };

		// ── Interface-like types (interface/protocol/trait) ─────────────
		// TASK-131: these were previously misclassified as Class by the shared
		// typeMatch regex. Reported separately so Kotlin `interface`, Swift
		// `protocol`, and PHP/Rust-style `trait` surfaces an `interface` kind.
		const ifaceMatch = trimmed.match(/^(?:interface|protocol|trait)\s+([a-zA-Z_][\w.]*)/);
		if (ifaceMatch) return { name: ifaceMatch[1], kind: SymbolKind.Interface };

		// ── Type aliases: type Name =  or typedef Name ───────────
		const typeAliasMatch = trimmed.match(/^type(?:def)?\s+([a-zA-Z_][\w]*)/);
		if (typeAliasMatch) return { name: typeAliasMatch[1], kind: SymbolKind.Type };

		// ── Variable/constant declarations ───────────────────────
		const varMatch = trimmed.match(/^(?:const|let|var|val|mutable)\s+([a-zA-Z_][\w]*)\s*(?::|=|$)/);
		if (varMatch) return { name: varMatch[1], kind: SymbolKind.Variable };

		// ── Go-style short declaration: name := ──────────────────
		const goVarMatch = trimmed.match(/^([a-zA-Z_][\w]*)\s*:=/);
		if (goVarMatch && !trimmed.includes("(") && !trimmed.includes(")")) {
			return { name: goVarMatch[1], kind: SymbolKind.Variable };
		}

		// ── Config key-value: name: value or name = value ────────
		const configMatch = trimmed.match(
			/^([a-zA-Z_][\w-]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|\d+|true|false|null|undefined|yes|no|on|off|\[|\{)/
		);
		if (configMatch) return { name: configMatch[1], kind: SymbolKind.Key };

		// ── CSS class selectors ───────────────────────────────────
		const cssClassMatch = trimmed.match(/^\.([a-zA-Z_][\w-]*)\s*\{/);
		if (cssClassMatch) return { name: `.${cssClassMatch[1]}`, kind: SymbolKind.Class };

		// ── CSS ID selectors ──────────────────────────────────────
		const cssIdMatch = trimmed.match(/^#([a-zA-Z_][\w-]*)\s*\{/);
		if (cssIdMatch) return { name: `#${cssIdMatch[1]}`, kind: SymbolKind.Key };

		// ── HTML/XML opening tags ────────────────────────────────
		const tagMatch = trimmed.match(/^<([a-zA-Z][\w-]*)/);
		if (tagMatch) return { name: `<${tagMatch[1]}>`, kind: SymbolKind.Class };

		return null;
	}

	private cleanComment(lines: string[]): string {
		return lines
			.filter((l) => l !== "")
			.join("\n")
			.trim();
	}
}
