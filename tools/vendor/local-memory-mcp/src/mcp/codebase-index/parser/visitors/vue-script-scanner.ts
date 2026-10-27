/**
 * Vue SFC script-block symbol scanner (TASK-557 split).
 *
 * Extracted from vue-visitor.ts so the visitor file keeps only the SFC
 * tree walk (top-level block dispatch + template/style markers) while this
 * module owns the regex-based JS/TS symbol extraction over a <script> /
 * <script setup> raw_text. Pure functions — the only shared piece of state
 * is the {@link ParsedSymbol} accumulation array threaded by the visitor.
 *
 * Strategy (unchanged from the pre-split visitor):
 * 1. Line-anchored declaration patterns (JS_DECLARATIONS) over the raw
 *    script body — functions, classes, interfaces, type aliases, enums,
 *    variables, arrow-function assignments, computed/ref/reactive bindings.
 * 2. Doc comments are extracted from the preceding lines (Vue SFCs are never
 *    TS-parsed, so there is no AST doc-comment node).
 * 3. A broader fallback scan (const assignments, `export default
 *    defineComponent`, `name: 'ComponentName'`) runs when no standard
 *    pattern matched — so Options-API components still surface.
 */

import type { ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";

/** One regex declaration pattern: match against a trimmed source line. */
interface RegexDeclaration {
	regex: RegExp;
	kind: SymbolKind;
	extractName: (match: RegExpMatchArray) => string;
}

const JS_DECLARATIONS: RegexDeclaration[] = [
	// Function declarations: function name() / async function name()
	{
		regex: /^\s*(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/,
		kind: SymbolKind.Function,
		extractName: (m) => m[1]
	},
	// Class declarations
	{
		regex: /^\s*class\s+([a-zA-Z_$][\w$]*)/,
		kind: SymbolKind.Class,
		extractName: (m) => m[1]
	},
	// Interface declarations
	{
		regex: /^\s*interface\s+([a-zA-Z_$][\w$]*)/,
		kind: SymbolKind.Interface,
		extractName: (m) => m[1]
	},
	// Type alias: type Name =
	{
		regex: /^\s*type\s+([a-zA-Z_$][\w$]*)\s*=/,
		kind: SymbolKind.Type,
		extractName: (m) => m[1]
	},
	// Enum declarations
	{
		regex: /^\s*enum\s+([a-zA-Z_$][\w$]*)/,
		kind: SymbolKind.Enum,
		extractName: (m) => m[1]
	},
	// const/let/var declarations (top-level): const name = ...
	{
		regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*(?::|=)/,
		kind: SymbolKind.Variable,
		extractName: (m) => m[1]
	},
	// Arrow function assigned to variable: const name = (params) => ...
	{
		regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
		kind: SymbolKind.Function,
		extractName: (m) => m[1]
	},
	// Computed/setup-style: const name = computed(() => ...) / const name = ref(...)
	{
		regex:
			/^\s*const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:computed|ref|reactive|shallowRef|shallowReactive|watch|watchEffect)\s*\(/,
		kind: SymbolKind.Variable,
		extractName: (m) => m[1]
	}
];

/** Strip the leading whitespace of a source line to find its first column. */
function trimStartColumn(line: string): number {
	return line.indexOf(line.trim()[0]) + 1;
}

/** Truncate an over-long declaration line into a symbol signature. */
function toSignature(trimmed: string): string {
	return trimmed.length > 256 ? trimmed.substring(0, 253) + "..." : trimmed;
}

/**
 * Extract a JS/TS doc comment from the lines preceding a declaration.
 *
 * Canonicalizes via serializeDocBlock after collecting raw lines so
 * @param/@return/@deprecated stay searchable and deprecated is marked
 * [DEPRECATED]. Fixes a pre-existing artifact that appended stray "/"
 * characters from the doc-block close and keeps the sibling scan local to
 * the doc block — non-doc content stops the walk instead of being folded
 * into the comment.
 */
export function extractScriptDocComment(lines: string[], lineIndex: number): string | null {
	const commentLines: string[] = [];
	let i = lineIndex - 1;
	// Tracks whether the walk has passed the JSDoc closing line (and thus
	// whether subsequent empty lines belong to the comment gap).
	let seenBlockClose = false;
	while (i >= 0) {
		const line = lines[i];
		const trimmed = line.trim();

		if (trimmed.startsWith("*/")) {
			// Closing delimiter: keep the optional suffix on the same line but
			// drop the bare closing marker (the old regex-anchored strip
			// mangled the remainder and pushed a stray "/" into the join).
			const suffix = trimmed.replace(/^\s*\*\/\s*/, "").trim();
			if (suffix) commentLines.unshift(suffix);
			seenBlockClose = true;
			i--;
			continue;
		}
		if (trimmed.startsWith("/**")) {
			const inner = trimmed.replace(/^\/\*\*?\s*/, "").trim();
			if (inner) commentLines.unshift(inner);
			// The opening line caps the comment — stop even if the loop would
			// otherwise continue past leading star lines.
			break;
		}
		if (trimmed.startsWith("*")) {
			commentLines.unshift(trimmed.replace(/^\s*\*\s?/, "").trim());
			i--;
			continue;
		}
		if (trimmed.startsWith("///") || trimmed.startsWith("//!")) {
			commentLines.unshift(trimmed.replace(/^\s*\/{2,3}[!/]?\s*/, ""));
			i--;
			continue;
		}
		// Single-line // comments (not JSDoc — only take the one immediately
		// above the declaration).
		if (trimmed.startsWith("//") && i === lineIndex - 1) {
			const raw = trimmed.replace(/^\s*\/\/\s*/, "").trim();
			return raw ? (serializeDocBlock(raw) ?? raw) : null;
		}
		// Empty line within doc comment block
		if (trimmed === "" && seenBlockClose && commentLines.length > 0) {
			// Preserve a blank gap inside the comment (currently filtered by
			// serializeDocBlock anyway — kept so future prose-preservation is
			// a doc-comment.ts tweak, not a Vue-side fix).
			i--;
			continue;
		}
		break;
	}

	if (commentLines.length === 0) return null;

	const raw = commentLines.join("\n").trim();
	if (!raw) return null;
	return serializeDocBlock(raw) ?? raw;
}

/**
 * Advance past leading import/export clause lines so the declaration scan
 * starts at the first real statement of the script body.
 */
export function skipImportExportLines(lines: string[], startIdx: number): number {
	let idx = startIdx;
	while (idx < lines.length) {
		const trimmed = lines[idx].trim();
		if (/^\s*(import|export\s+(default\s+)?\{|})\s/.test(trimmed) || /^\s*export\s+default\s/.test(trimmed)) {
			idx++;
			continue;
		}
		break;
	}
	return idx;
}

/** Resolve the export flags of a declaration line. */
function exportFlagsOf(trimmed: string): { exported: boolean; defaultExport: boolean } {
	const exported = /^\s*export\s+/.test(trimmed);
	return { exported, defaultExport: exported && /export\s+default\s/.test(trimmed) };
}

/** Parse the JS/TS content of a <script> block using regex patterns. */
export function parseScriptContent(code: string, baseLine: number, _lang: string, symbols: ParsedSymbol[]): void {
	const lines = code.split("\n");
	let i = skipImportExportLines(lines, 0);

	for (; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		const globalLine = baseLine + i;

		// Skip empty lines, comments, and import/export lines
		if (trimmed === "") continue;
		// Single-line // comments are skipped; multi-line /** */ doc blocks
		// are intentionally NOT skipped here — they are consumed by
		// extractScriptDocComment when it walks preceding lines.
		if (trimmed.startsWith("//")) continue;
		if (trimmed.startsWith("/*") && !trimmed.startsWith("/**")) {
			// Skip non-doc block comments
			while (i < lines.length && !lines[i].includes("*/")) i++;
			continue;
		}
		if (/^(import|export\s+(default\s+)?\{|export\s+default)\s/.test(trimmed)) continue;
		if (trimmed === "}" || trimmed === ");" || trimmed === "});") continue;

		// Try each declaration pattern
		for (const decl of JS_DECLARATIONS) {
			const match = trimmed.match(decl.regex);
			if (match) {
				symbols.push(buildScriptSymbol(decl, match, trimmed, globalLine, line, lines, i));
				break;
			}
		}
	}

	// If we found no symbols with the standard patterns, try broader patterns
	if (symbols.length === 0) {
		extractGenericScriptSymbols(lines, baseLine, symbols);
	}
}

function buildScriptSymbol(
	decl: RegexDeclaration,
	match: RegExpMatchArray,
	trimmed: string,
	globalLine: number,
	line: string,
	lines: string[],
	i: number
): ParsedSymbol {
	const name = decl.extractName(match);
	const docComment = extractScriptDocComment(lines, i);
	const { exported, defaultExport } = exportFlagsOf(trimmed);

	return {
		name,
		kind: decl.kind,
		startLine: globalLine,
		startCol: trimStartColumn(line),
		endLine: globalLine,
		endCol: line.length,
		signature: toSignature(trimmed),
		docComment,
		exported,
		defaultExport,
		parentName: null
	};
}

/** Broader fallback scan for any recognizable symbols in the script. */
export function extractGenericScriptSymbols(lines: string[], baseLine: number, symbols: ParsedSymbol[]): void {
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed === "" || trimmed.startsWith("//")) continue;

		const globalLine = baseLine + i;

		// const/let/var assignment (any)
		const constMatch = trimmed.match(/^\s*const\s+([a-zA-Z_$][\w$]*)\s*=/);
		if (constMatch) {
			symbols.push(makeSymbol(constMatch[1], SymbolKind.Variable, globalLine, trimmed, lines, i));
			continue;
		}

		// export default { name: "ComponentName" } or export default defineComponent({ name: "..." })
		const exportDefaultDefine = trimmed.match(/export\s+default\s+defineComponent/);
		if (exportDefaultDefine) {
			symbols.push(makeSymbol("default", SymbolKind.Class, globalLine, trimmed, lines, i));
			continue;
		}

		// name: 'ComponentName' (Options API)
		const nameMatch = trimmed.match(/^\s*name\s*:\s*['"]([^'"]+)['"]/);
		if (nameMatch) {
			symbols.push(makeSymbol(nameMatch[1], SymbolKind.Class, globalLine, trimmed, lines, i));
			continue;
		}
	}
}

function makeSymbol(
	name: string,
	kind: SymbolKind,
	line: number,
	lineText: string,
	lines: string[],
	lineIdx: number
): ParsedSymbol {
	return {
		name,
		kind,
		startLine: line,
		startCol: trimStartColumn(lineText),
		endLine: line,
		endCol: lineText.length,
		signature: toSignature(lineText),
		docComment: extractScriptDocComment(lines, lineIdx),
		exported: /^\s*export\s+/.test(lineText),
		defaultExport: false,
		parentName: null
	};
}
