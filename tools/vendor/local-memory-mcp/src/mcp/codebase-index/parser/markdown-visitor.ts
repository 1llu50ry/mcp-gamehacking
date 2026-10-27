/**
 * MarkdownVisitor — extracts headings and fenced code blocks from .md/.mdx files
 * as lightweight indexable symbols. This enables searching documentation
 * by section title and finding code examples by language.
 *
 * This visitor does NOT use tree-sitter — it parses markdown via regex line scanning.
 * It implements LanguageVisitor so it plugs into the existing ParserPool infrastructure
 * (the pool skips tree-sitter for configs with empty grammarWasms).
 */
import type { Tree } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "./language-visitor";
import { SymbolKind } from "./language-visitor";

export class MarkdownVisitor implements LanguageVisitor {
	extractSymbols(_tree: Tree | null, sourceCode: string): ParsedSymbol[] {
		const symbols: ParsedSymbol[] = [];
		const lines = sourceCode.split("\n");
		let i = 0;

		while (i < lines.length) {
			const line = lines[i];
			const lineNum = i + 1;

			// ATX headings: # Title, ## Title, etc.
			const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
			if (headingMatch) {
				const level = headingMatch[1].length;
				const title = headingMatch[2].trim();

				// Collect subsequent paragraph lines as doc_comment until next heading or blank line
				let docEndLine = lineNum;
				let j = i + 1;
				while (j < lines.length) {
					const nextLine = lines[j].trim();
					if (nextLine === "" || /^#{1,6}\s/.test(nextLine)) break;
					docEndLine = j + 1;
					j++;
				}

				const kind = level === 1 ? SymbolKind.Heading1 : level === 2 ? SymbolKind.Heading2 : SymbolKind.Heading;

				symbols.push({
					name: title,
					kind,
					startLine: lineNum,
					startCol: 1,
					endLine: docEndLine,
					endCol: lines[docEndLine - 1].length,
					signature: "#".repeat(level) + " " + title,
					docComment: null,
					exported: false,
					defaultExport: false,
					parentName: null
				});

				i = j;
				continue;
			}

			// Fenced code blocks: ```lang ... ``` or ~~~lang ... ~~~
			const fenceMatch = line.match(/^(```|~~~)\s*(.*)$/);
			if (fenceMatch) {
				const fence = fenceMatch[1];
				const lang = fenceMatch[2].trim() || "unknown";
				const startLine = lineNum;
				let j = i + 1;
				while (j < lines.length && !lines[j].trimStart().startsWith(fence)) {
					j++;
				}
				const endLine = j < lines.length ? j + 1 : lines.length; // include closing fence if found

				symbols.push({
					name: `code-block:${lang}`,
					kind: SymbolKind.CodeBlock,
					startLine,
					startCol: 1,
					endLine,
					endCol: endLine <= lines.length ? lines[endLine - 1].length : 0,
					signature: "```" + lang,
					docComment: null,
					exported: false,
					defaultExport: false,
					parentName: null
				});

				i = j + 1;
				continue;
			}

			i++;
		}

		return symbols;
	}
}
