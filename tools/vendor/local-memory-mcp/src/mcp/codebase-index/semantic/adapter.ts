/**
 * semantic/adapter — language-agnostic SemanticAdapter contract (issue #90, TASK-016).
 *
 * Tree-sitter remains the PRIMARY, always-on structural indexer. A `SemanticAdapter`
 * is an OPTIONAL, independently-loadable secondary pass that attaches inferred
 * semantic metadata (signatures, canonical targets, diagnostics) onto already
 * structurally-indexed symbols. It must NEVER mutate the structural parser output
 * and must never fail repo indexing — callers run it through an isolated wrapper
 * (see `registry.ts`).
 *
 * The TypeScript adapter (#89) is the first implementation; the PHPStan adapter
 * is the non-TS proof-of-concept.
 */

import type { ParsedSymbol } from "../parser/language-visitor";

/** Diagnostics metadata an adapter may attach (e.g. phpstan error count). */
export interface SemanticDiagnostics {
	/** Severity of the diagnostics (adapter-specific). */
	level?: "ok" | "warning" | "error";
	/** Human-readable summary. */
	message?: string;
	/** Arbitrary adapter-specific details. */
	details?: Record<string, unknown>;
}

/**
 * Per-symbol semantic enrichment produced by an adapter. Reuses the `semantic_*`
 * column family from #89 (semantic_signature / semantic_source) and adds optional
 * confidence, canonical-target, and diagnostics metadata without touching the
 * structural `signature`.
 */
export interface SemanticSymbolEnrichment {
	/** Inferred signature (return/param/property types, phpdoc types, …). */
	semanticSignature: string;
	/** Provenance tag persisted to `semantic_source` (e.g. "typescript-compiler"). */
	semanticSource: string;
	/** Adapter-reported confidence in [0,1] (optional). */
	confidence?: number;
	/**
	 * Canonical target for graph linking (e.g. resolved type/declaration path,
	 * fully-qualified class). Optional; null/absent when not inferable.
	 */
	canonicalTarget?: string | null;
	/** Diagnostics metadata (optional). */
	diagnostics?: SemanticDiagnostics;
}

/** Input handed to an adapter — the already-structurally-parsed file + symbols. */
export interface SemanticEnrichmentInput {
	/** Repo-relative file path. */
	filePath: string;
	/** Absolute filesystem path of the repo root (used for monorepo resolution). */
	repoPath: string;
	/** Detected language id (e.g. "typescript", "php"). */
	language: string;
	/** Full file content. */
	content: string;
	/** Structural symbols (NEVER mutated by the adapter). */
	symbols: ParsedSymbol[];
}

/**
 * Result of running one adapter over a file. `bySymbolKey` maps the stable
 * `name#startLine` key → enrichment. A `degraded` result means the adapter could
 * not run (config/deps/timeout/throw) and the caller should skip persistence —
 * NOT fail indexing.
 */
export interface SemanticEnrichmentResult {
	/** Map of `symbolKey(name, startLine)` → enrichment. */
	bySymbolKey: Map<string, SemanticSymbolEnrichment>;
	/** Provenance tag (mirrors `semanticSource` on the map entries). */
	source: string;
	/** Adapter name recorded as the provider (issue #90 requirement 7). */
	provider: string;
	/** True when the pass could not complete — indexing continues regardless. */
	degraded: boolean;
	/** Why the pass degraded (timeout / not configured / error message). */
	reason?: string;
	/** ISO timestamp recorded on a successful (non-degraded) pass for freshness. */
	refreshedAt?: string;
}

/**
 * Language-agnostic semantic adapter. Implementations are independently loadable
 * and registered by language. They must be safe: the registry wraps every call in
 * timeout + try/catch isolation so a slow or throwing adapter never fails repo
 * indexing.
 */
export interface SemanticAdapter {
	/** Stable adapter name; recorded as the `semantic_source` provider. */
	readonly name: string;
	/** Whether this adapter can enrich the given language within `repoPath`. */
	supports(language: string, repoPath: string): boolean;
	/** Enrich the file's symbols. Must not throw and must not mutate `input`. */
	enrich(input: SemanticEnrichmentInput): Promise<SemanticEnrichmentResult>;
}
