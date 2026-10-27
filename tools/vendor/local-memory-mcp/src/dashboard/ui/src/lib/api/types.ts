// ─── Codebase Search types ──────────────────────────────────────────────────

export interface CodeSymbol {
	name: string;
	kind: "function" | "class" | "interface" | "type" | "enum" | "variable";
	signature?: string;
	filePath?: string;
	line?: number;
}

/**
 * Innermost symbol whose [start_line, end_line] span encloses a code match
 * (TASK-316 CODE mode enrichment).
 */
export interface EnclosingSymbol {
	name: string;
	kind: string;
	startLine: number;
	endLine: number;
}

/** A single content grep hit as served by GET /api/codebase/code-search. */
export interface CodeSearchMatch {
	filePath: string;
	language: string | null;
	line: number;
	snippet: string;
	matchIndex: number;
	enclosingSymbol: EnclosingSymbol | null;
}

/** CODE mode response shape (mirrors handleCodeSearchMode structuredContent). */
export interface CodeSearchResult {
	mode: "code";
	content: string;
	regex: boolean;
	language: string | null;
	matches: CodeSearchMatch[];
	total: number;
	hasMore: boolean;
	filesScanned: number;
	fileCount: number;
	indexedFiles: number;
	offset: number;
	limit: number;
}

// ─── Codebase Dead-Code Analysis (TASK-319/320) ─────────────────────────────
// Mirrors the ARCHITECTURE-mode `deadCode` block served by the MCP backend
// (src/mcp/codebase-index/services/dead-code.ts). Field names must match the
// wire shape EXACTLY — additive only.

/** Entry-point exclusion classifications for zero-ref candidates. */
export type EntryPointType = "bin" | "manifest" | "shebang" | "public-api";

/** Why a zero-ref candidate is excluded from the dead list (TASK-319). */
export interface EntryPointTag {
	type: EntryPointType;
	/** Human-readable why (e.g. "listed in package.json (bin)"). */
	reason: string;
}

/** A zero-reference top-level symbol in the unreferenced report. */
export interface UnreferencedSymbol {
	name: string;
	kind: string;
	file_path: string;
	/** Declaration start line (symbol.start_line), when known. */
	line: number | null;
	/** Per-kind reference breakdown — every kind is 0 for a true candidate. */
	kinds: Record<string, number>;
	/** Present ONLY when the candidate was excluded as an entry point. */
	entryPoint?: EntryPointTag;
}

/** A top in-degree symbol in the hotspots report. */
export interface HotspotSymbol {
	name: string;
	kind: string;
	file_path: string;
	refCount: number;
	/** Per-kind reference breakdown (call/instantiation/import/extends/implements). */
	topKinds: Record<string, number>;
}

/** Languages with trustworthy reference data vs declaration-only/unobserved. */
export interface LanguageCoverage {
	reliable: string[];
	unreliable: string[];
}

/** Totals for the dead-code analysis — full counts, NOT capped like the lists. */
export interface DeadCodeTotals {
	scanned: number;
	dead: number;
	entryExcluded: number;
	truncated: boolean;
}

/** The `deadCode` block appended to an ARCHITECTURE response (TASK-319). */
export interface DeadCodeBlock {
	unreferenced: UnreferencedSymbol[];
	hotspots: HotspotSymbol[];
	languageCoverage: LanguageCoverage;
	totals: DeadCodeTotals;
	/** Honesty note: which languages are trustworthy and why, plus any skipped exclusions. */
	coverageNote: string;
}

// ─── Codebase Index types ────────────────────────────────────────────────────

/**
 * A queue job as served by GET /api/queue/jobs (TASK-296/297).
 * `status` is the LITERAL `QueueJobStatus` enum value (`pending|claimed|done|
 * poison`) — the UI renders `poison` as "Failed", the enum is never renamed.
 */
export interface QueueJob {
	id: string;
	entity_kind: string;
	entity_id: string;
	entity_repo: string;
	status: "pending" | "claimed" | "done" | "poison";
	attempts: number;
	max_attempts: number;
	enqueued_at: string;
	processed_at: string;
	last_error: string | null;
}

/**
 * Worker + queue observability snapshot from GET /api/queue/status
 * (`embeddingWorker.getStats()`). `poison` rows are the failed-job count the
 * admin view surfaces as "Failed".
 */
export interface QueueStatus {
	pending: number;
	claimed: number;
	done: number;
	poison: number;
	total: number;
	processed: number;
	failed: number;
	poisoned: number;
	lastBatchSize: number;
	lastRunAt: string | null;
	running: boolean;
	started: boolean;
	modelReady: boolean;
	pollIntervalMs: number;
	batchSize: number;
	leaseMs: number;
	embedLatency: {
		count: number;
		avgMs: number;
		p50Ms: number;
		p95Ms: number;
		maxMs: number;
	};
}

export interface CodebaseIndexStatus {
	indexed: boolean;
	symbol_count: number;
	file_count: number;
	last_indexed_at: string | null;
	stale?: boolean;
	staleRatio?: number;
	indexing?: {
		in_progress: boolean;
		files_parsed: number;
		total_files: number;
	};
}

export interface TraceReference {
	filePath: string;
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
	context: string;
	/**
	 * Edge kind — 'call' | 'instantiation' | 'import' | 'extends' | 'implements'
	 * (table-backed references, v23 / TASK-299-301). Absent on legacy
	 * in-memory references (doc_comment scan).
	 */
	kind?: string;
	/** Enclosing function/method at the call / heritage site, when determinable. */
	callerName?: string | null;
	/** File path of the referenced symbol when resolvable (table-backed, v23). */
	targetFile?: string | null;
	/** codebase_symbols(id) of the referenced symbol when resolvable (table-backed, v23). */
	targetSymbolId?: string | null;
}

/**
 * Raw `codebase_symbols` row as served by the codebase API (snake_case —
 * mirrors src/mcp/types/codebase-symbol.ts CodebaseSymbol). TRACE surfaces
 * these verbatim for `children`.
 */
export interface CodebaseSymbolRow {
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
}

/** Enclosing container of a traced symbol, resolved from parent_symbol_id (TASK-300). */
export interface TraceParent {
	id: string;
	name: string;
	kind: string;
	filePath: string;
	line: number | null;
}

export interface TraceResult {
	symbol: CodeSymbol;
	definition: {
		file: string;
		line: number;
		column: number;
		endLine: number;
		endColumn: number;
	};
	references: TraceReference[];
	exportChain: {
		exported: boolean;
		defaultExport: boolean;
	};
	/** Enclosing container (e.g. class → method). Null for top-level symbols or when absent. */
	parent?: TraceParent | null;
	/** Direct children (e.g. a class's methods/properties), ordered by start line (TASK-300). */
	children?: CodebaseSymbolRow[];
	/** Candidates when the trace was ambiguous (camelCase projection — aligned
	 *  with codebase.read.ts TRACE structuredContent: name/kind/file/line/
	 *  exported, NOT raw rows). */
	disambiguation?: TraceDisambiguationCandidate[];
}

/** A disambiguation candidate for an ambiguous TRACE, as served by the API. */
export interface TraceDisambiguationCandidate {
	name: string;
	kind: string;
	file: string;
	line: number | null;
	exported: boolean;
}

// ─── Codebase File Content + Symbol Callers (TASK-324 CG-B / TASK-328) ──────
// Client types mirroring the dashboard codebase-graph service wire shapes
// (src/dashboard/services/codebase-graph.service.ts) EXACTLY — additive only.

/** GET/POST /api/codebase/file/content response (raw disk read, bounded). */
export interface FileContentResult {
	/** Relative file path as requested (codebase_files.file_path form). */
	file_path: string;
	/** codebase_files.language for indexed files, extension-derived otherwise. */
	language: string | null;
	/** Total lines in the file on disk (unaffected by the content cap). */
	lines: number;
	/** Total UTF-8 byte size of the file on disk (unaffected by the cap). */
	size_bytes: number;
	/** File content, bounded to FILE_CONTENT_MAX_LINES lines. */
	content: string;
	/** True when the file was longer than FILE_CONTENT_MAX_LINES. */
	truncated: boolean;
}

/** One directed call-site relationship: caller symbol → callee symbol. */
export interface CallerCalleePair {
	caller: {
		/** Enclosing function/method name at the call site (null when undeterminable). */
		name: string | null;
		/** File holding the call site (codebase_references.caller_file). */
		filePath: string;
		line: number | null;
	};
	callee: {
		/** The referenced (called/imported/…) symbol name. */
		name: string;
		/** Target file when resolvable at parse time (v23), else null. */
		filePath: string | null;
	};
	/** 'call' | 'instantiation' | 'import' | 'extends' | 'implements'. */
	kind: string;
}

/** GET /api/codebase/symbol/callers response — CallGraph DAG data. */
export interface SymbolCallersResult {
	/** The queried symbol (filePath-scoped when provided; unique name otherwise). */
	symbol: { name: string; kind: string; filePath: string; line: number | null };
	/** Flat caller→callee pairs — the CallGraph DAG edge list. */
	pairs: CallerCalleePair[];
	/** The same pairs grouped by caller symbol (aggregation for the DAG drill). */
	groupedByCaller: Array<{
		caller: { name: string | null; filePath: string; kind: string | null };
		count: number;
		pairs: CallerCalleePair[];
	}>;
	total: number;
}
