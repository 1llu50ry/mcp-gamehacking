/**
 * semantic/phpstan-adapter — non-TypeScript proof-of-concept SemanticAdapter (issue #90, TASK-016).
 *
 * CONTRACT (documented per issue #90 requirement 8):
 *
 *   supports("php", repoPath) → true for PHP files; every other language → false.
 *
 *   enrich(input) returns a {@link SemanticEnrichmentResult}. Two modes:
 *
 *     1. "not configured" (default, CODEBASE_SEMANTIC_PHPSTAN_ENABLED !== "true"):
 *        returns a GRACEFUL degraded result — `{ degraded: true, reason:
 *        "phpstan semantic enrichment not configured" }` with an empty map. This
 *        proves the adapter contract without requiring a PHPStan binary, and the
 *        pipeline treats it exactly like "no enrichment" (structural indexing
 *        continues untouched).
 *
 *     2. "enabled": runs a ZERO-DEPENDENCY heuristic that scans the PHPDoc block
 *        immediately above each symbol for `@param <type> $name` and `@return <type>`
 *        annotations and builds a compact signature `(a: T1, b: T2): TReturn`.
 *        This is a real, dependency-free demonstration of a non-TS adapter producing
 *        semantic_signature / semantic_source / canonicalTarget data; it does not
 *        shell out to phpstan. A production adapter would replace the heuristic with
 *        a phpstan JSON run and map its `.errors[].type` / inferred types onto these
 *        fields — the wiring is identical.
 *
 * The adapter NEVER throws and NEVER mutates `input.symbols`.
 */

import type {
	SemanticAdapter,
	SemanticEnrichmentInput,
	SemanticEnrichmentResult,
	SemanticSymbolEnrichment
} from "./adapter";
import { symbolKey } from "./typescript-enricher";

/** Provenance tag persisted to `semantic_source` for PHP enrichment. */
export const SEMANTIC_SOURCE_PHPSTAN = "phpstan";

/** Match `@param <type> $name` (type may contain `?`, `[]`, `\|`, spaces). */
const PHPDOC_PARAM_RE = /@param\s+([^\s$]+)\s+\$(\w+)/g;
/** Match `@return <type>`. */
const PHPDOC_RETURN_RE = /@return\s+(\S+)/;

/**
 * Collect the trailing PHPDoc block (lines beginning with `*` / `/*`) that ends
 * immediately before `startLine` (1-based). Returns the joined doc text, or "".
 */
function docblockAbove(content: string, startLine: number): string {
	const lines = content.split(/\r?\n/);
	const docLines: string[] = [];
	// Walk upward from the line above the declaration.
	for (let i = startLine - 2; i >= 0; i--) {
		const trimmed = lines[i].trim();
		if (trimmed.startsWith("*")) {
			docLines.unshift(trimmed.replace(/^\*\s?/, ""));
		} else if (trimmed.endsWith("/*") || trimmed.endsWith("/**")) {
			// Opening delimiter of the docblock — stop here (inclusive).
			break;
		} else if (trimmed === "") {
			// Allow blank lines inside, but a code line ends the block.
			if (docLines.length > 0) break;
		} else {
			break;
		}
	}
	return docLines.join("\n");
}

/**
 * Proof-of-concept PHP semantic adapter.
 *
 * @see module docs for the full contract.
 */
export class PhpStanSemanticAdapter implements SemanticAdapter {
	readonly name = SEMANTIC_SOURCE_PHPSTAN;

	supports(language: string, _repoPath: string): boolean {
		return language.toLowerCase() === "php";
	}

	async enrich(input: SemanticEnrichmentInput): Promise<SemanticEnrichmentResult> {
		// Read the env var at CALL time (not module load): the module-level
		// constant is frozen when the adapter module is first imported, which
		// breaks tests that toggle the flag mid-run. "true"/"1" → enabled.
		const enabled = ["true", "1"].includes((process.env.CODEBASE_SEMANTIC_PHPSTAN_ENABLED ?? "").toLowerCase());
		if (!enabled) {
			// Graceful "not configured" — pipeline skips persistence, indexing continues.
			return {
				bySymbolKey: new Map(),
				source: SEMANTIC_SOURCE_PHPSTAN,
				provider: this.name,
				degraded: true,
				reason: "phpstan semantic enrichment not configured"
			};
		}

		const bySymbolKey = new Map<string, SemanticSymbolEnrichment>();
		for (const sym of input.symbols) {
			const doc = docblockAbove(input.content, sym.startLine);
			if (!doc) continue;

			const params: string[] = [];
			for (const m of doc.matchAll(PHPDOC_PARAM_RE)) {
				params.push(`${m[2]}: ${m[1]}`);
			}
			const retMatch = doc.match(PHPDOC_RETURN_RE);
			const returnType = retMatch ? retMatch[1] : "void";
			const signature = `(${params.join(", ")}): ${returnType}`;

			bySymbolKey.set(symbolKey(sym.name, sym.startLine), {
				semanticSignature: signature,
				semanticSource: SEMANTIC_SOURCE_PHPSTAN,
				confidence: 0.6,
				diagnostics: { level: "ok", message: "heuristic phpdoc extraction" },
				canonicalTarget: null
			});
		}

		return {
			bySymbolKey,
			source: SEMANTIC_SOURCE_PHPSTAN,
			provider: this.name,
			degraded: false,
			refreshedAt: new Date().toISOString()
		};
	}
}

/** Singleton — registered into the default {@link SemanticAdapterRegistry}. */
export const phpstanSemanticAdapter = new PhpStanSemanticAdapter();
