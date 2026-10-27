import { apiFetch } from "../client";
import type {
	CodeSymbol,
	CodeSearchResult,
	DeadCodeBlock,
	TraceResult,
	FileContentResult,
	SymbolCallersResult,
	CodebaseIndexStatus
} from "../types";

/** Codebase endpoints: search, code-search, index status, architecture, trace, file content, callers. */
export const codebaseApi = {
	// ─── Codebase Search ────────────────────────────────────────────────────────

	codebaseSearch: (repo: string, query: string, limit: number = 10) => {
		const q = new URLSearchParams({
			repo,
			query,
			limit: String(limit)
		});
		return apiFetch<{ results: CodeSymbol[] }>(`/api/codebase/search?${q}`);
	},

	// GET /api/codebase/code-search — CODE mode content grep (TASK-317).
	// `content` mirrors the tool's CODE discriminator param (presence ⇒ CODE
	// mode); `query` would route to SEARCH instead, so it is intentionally
	// NOT used here.
	codebaseCodeSearch: (
		repo: string,
		content: string,
		opts?: { regex?: boolean; language?: string; limit?: number; offset?: number }
	) => {
		const q = new URLSearchParams({ repo, content });
		if (opts?.regex) q.set("regex", "true");
		if (opts?.language) q.set("language", opts.language);
		if (opts?.limit != null) q.set("limit", String(opts.limit));
		if (opts?.offset != null) q.set("offset", String(opts.offset));
		return apiFetch<CodeSearchResult>(`/api/codebase/code-search?${q}`);
	},

	// ─── Codebase Index Status ──────────────────────────────────────────────────

	codebaseIndexStatus: async (repo: string) => {
		const q = new URLSearchParams({ repo });
		const raw = await apiFetch<Record<string, unknown>>(`/api/codebase/index-status?${q}`);
		const progress = raw.progress as Record<string, unknown> | undefined;
		// Normalize backend camelCase → frontend snake_case
		return {
			indexed: (raw.isIndexed as boolean) ?? false,
			file_count: (raw.totalFiles as number) ?? 0,
			symbol_count: (raw.totalSymbols as number) ?? 0,
			last_indexed_at: (raw.lastIndexedAt as string) ?? null,
			stale: raw.stale as boolean | undefined,
			staleRatio: raw.staleRatio as number | undefined,
			indexing: {
				in_progress: (raw.isIndexing as boolean) ?? false,
				files_parsed: (progress?.current as number) ?? 0,
				total_files: (progress?.total as number) ?? 0
			}
		} as CodebaseIndexStatus;
	},

	codebaseReindex: (repo: string) => {
		return apiFetch<{ success: boolean; message: string }>("/api/codebase/index", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ repo })
		});
	},

	// ─── Codebase Architecture ─────────────────────────────────────────────────

	codebaseArchitecture: (repo: string, depth: number = 3, includeSymbolCounts: boolean = true) => {
		const q = new URLSearchParams({
			repo,
			depth: String(depth),
			includeSymbolCounts: String(includeSymbolCounts)
		});
		return apiFetch<{ root: Record<string, unknown>; summary: Record<string, unknown>; deadCode?: DeadCodeBlock }>(
			`/api/codebase/architecture?${q}`
		);
	},

	// ─── Codebase Trace ─────────────────────────────────────────────────────

	codebaseTrace: (repo: string, name: string) => {
		const q = new URLSearchParams({
			repo,
			name,
			includeReferences: "true"
		});
		return apiFetch<TraceResult>(`/api/codebase/trace?${q}`);
	},

	// ─── Codebase File Content (TASK-324 CG-B / TASK-328 FileViewer) ────────
	// GET/POST /api/codebase/file/content?repo=&path=&repoPath=
	// Raw file content read from DISK (bounded server-side to
	// FILE_CONTENT_MAX_LINES; `truncated` flags longer files). Path traversal
	// is rejected by the backend (PATH_TRAVERSAL → 400).

	codebaseFileContent: (repo: string, filePath: string, repoPath?: string) => {
		const q = new URLSearchParams({ repo, path: filePath });
		if (repoPath) q.set("repoPath", repoPath);
		return apiFetch<FileContentResult>(`/api/codebase/file/content?${q}`);
	},

	// ─── Codebase Symbol Callers (TASK-324 CG-B / TASK-328 CallGraph) ───────
	// GET /api/codebase/symbol/callers?repo=&name=&kind=&filePath=
	// Caller→callee PAIRS grouped by caller symbol — the CallGraph DAG edge
	// list. `filePath` disambiguates duplicate symbol names (TASK-373: absent
	// scoping → 409 AMBIGUOUS_SYMBOL listing candidates).

	codebaseSymbolCallers: (repo: string, name: string, kind?: string, filePath?: string) => {
		const q = new URLSearchParams({ repo, name });
		if (kind) q.set("kind", kind);
		if (filePath) q.set("filePath", filePath);
		return apiFetch<SymbolCallersResult>(`/api/codebase/symbol/callers?${q}`);
	},

	// ─── Codebase File Symbols ─────────────────────────────────────────────

	codebaseSymbols: (repo: string, filePath: string) => {
		const q = new URLSearchParams({
			repo,
			filePath
		});
		return apiFetch<{ file: Record<string, unknown>; symbols: CodeSymbol[]; total: number }>(
			`/api/codebase/symbols?${q}`
		).then((res) => res.symbols ?? []);
	}
};
