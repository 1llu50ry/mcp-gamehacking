export interface CodebaseSymbol {
	id: string;
	repo: string;
	file_path: string;
	name: string;
	kind: string;
	exported: boolean;
	default_export: boolean;
	start_line: number | null;
	start_col: number | null;
	end_line: number | null;
	end_col: number | null;
	signature: string | null;
	doc_comment: string | null;
	parent_symbol_id: string | null;
	/**
	 * Semantic signature (issue #89, TASK-015): type-inferred signature
	 * produced by the OPTIONAL TypeScript compiler enrichment pass. Always
	 * preserves the original structural `signature`; this field is only ever
	 * populated when the enricher ran successfully and NEVER overwrites an
	 * explicit source signature. Null/undefined when enrichment was skipped.
	 */
	semantic_signature?: string | null;
	/**
	 * Provenance of `semantic_signature` (issue #89): e.g. "typescript-compiler"
	 * or "adapter". Null/undefined when no semantic signature is present.
	 */
	semantic_source?: string | null;
	/** ISO timestamp of the last successful semantic-enrichment pass (issue #89). */
	semantic_updated_at?: string | null;
	source_fingerprint?: string | null;
	created_at: string;
	updated_at: string;
}

export interface CodebaseSymbolRow {
	id: string;
	repo: string;
	file_path: string;
	name: string;
	kind: string;
	exported: number;
	default_export: number;
	start_line: number | null;
	start_col: number | null;
	end_line: number | null;
	end_col: number | null;
	signature: string | null;
	doc_comment: string | null;
	parent_symbol_id: string | null;
	semantic_signature: string | null;
	semantic_source: string | null;
	semantic_updated_at: string | null;
	source_fingerprint: string | null;
	created_at: string;
	updated_at: string;
}

export interface CodebaseSymbolInsert {
	/**
	 * Optional pre-assigned id (TASK-300). The parse pipeline assigns ids
	 * before insert so parent_symbol_id links can reference the parent's id
	 * within the same batch; when absent the entity generates a UUID.
	 */
	id?: string;
	repo: string;
	file_path: string;
	name: string;
	kind: string;
	exported?: boolean;
	default_export?: boolean;
	start_line?: number;
	start_col?: number;
	end_line?: number;
	end_col?: number;
	signature?: string | null;
	doc_comment?: string | null;
	parent_symbol_id?: string | null;
	/**
	 * Semantic signature (issue #89, TASK-015): type-inferred signature from
	 * the optional TS compiler enrichment pass. Populated only when enrichment
	 * ran and succeeded; never overwrites an explicit source `signature`.
	 */
	semantic_signature?: string | null;
	/** Provenance of `semantic_signature` (e.g. "typescript-compiler"). */
	semantic_source?: string | null;
	/** ISO timestamp of the last semantic-enrichment pass. */
	semantic_updated_at?: string | null;
	/** SHA-256 of the indexed source range for freshness checks. */
	source_fingerprint?: string | null;
}

export interface SymbolSearchQuery {
	query: string;
	repo?: string;
	/**
	 * Cross-repo scope — when non-empty, filters `cs.repo IN (...)` and takes
	 * precedence over `repo`. When both are absent the search is unscoped
	 * (callers must guard against this: codebase_symbols has no owner column).
	 */
	repos?: string[];
	/**
	 * Symbol kind filter. A single kind filters `cs.kind = ?`; an array filters
	 * `cs.kind IN (?, ?, ...)` (OR). Multi-kind OR is honored at the DB level
	 * (TASK-445) so `kind:function,class` returns both kinds.
	 */
	kind?: string | string[];
	filePath?: string;
	exportedOnly?: boolean;
	limit?: number;
	offset?: number;
}

/**
 * Case-insensitive prefix search on symbol names (autocomplete), served by the
 * idx_symbols_name_lower expression index (migration v20, issue #63). `repo`
 * is required to scope the scan; `kind` optionally narrows it (both are
 * trailing columns of the composite index).
 */
export interface SymbolPrefixSearchQuery {
	repo: string;
	prefix: string;
	kind?: string;
	limit?: number;
	offset?: number;
}

/**
 * Row shape for the SQL-level aggregation used by ARCHITECTURE reads
 * (OPT-PERF-08): symbol counts grouped by `(file_path, kind)` via GROUP BY.
 * Hydrating these rows is O(distinct file×kind pairs) instead of O(symbols).
 */
export interface SymbolCountGroupRow {
	file_path: string;
	kind: string;
	count: number;
}

export interface SymbolSearchResult {
	symbols: CodebaseSymbol[];
	total: number;
	hasMore: boolean;
}
