// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC TYPES — codebase-graph service (TASK-430 split: shared by
// codebase-graph.service.ts, callers.ts, builder.ts)
// ═══════════════════════════════════════════════════════════════════════════

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

export interface SymbolCallersResult {
	/** The queried symbol (filePath-scoped when provided; unique name otherwise). */
	symbol: { name: string; kind: string; filePath: string; line: number | null };
	/** Flat caller→callee pairs — the CallGraph DAG edge list. */
	pairs: CallerCalleePair[];
	/** The same pairs grouped by caller symbol (aggregation for the DAG tooltip/drill). */
	groupedByCaller: Array<{
		caller: { name: string | null; filePath: string; kind: string | null };
		count: number;
		pairs: CallerCalleePair[];
	}>;
	total: number;
}

/** Graph node in KGGraphCanvas-compatible shape (LayoutNode subset). */
export interface CodeGraphNode {
	/** `sym-${codebase_symbols.id}` — unique per symbol. */
	id: string;
	name: string;
	kind: string;
	filePath: string;
	/** Degree-scaled visual weight (14 + min(degree, 30)) — importance signal. */
	size: number;
	/** Reference/edge degree used for server-side ranking. */
	degree: number;
}

/** Graph edge in KGGraphCanvas-compatible shape (LayoutEdge subset). */
export interface CodeGraphEdge {
	source: string;
	target: string;
	/** 'call' | 'instantiation' | 'import' | 'extends' | 'implements' | 'co_defined'. */
	relation_type: string;
}

export type CodeGraphKind = "call" | "import" | "co_defined";

export interface CodeGraphResult {
	/** `codebase-graph-${repo}`. */
	id: string;
	nodes: CodeGraphNode[];
	edges: CodeGraphEdge[];
	/** True when the edge list was trimmed to CODE_GRAPH_MAX_EDGES. */
	truncated: boolean;
	stats: {
		totalSymbols: number;
		totalRefs: number;
		nodeLimit: number;
		edgeCap: number;
	};
}
