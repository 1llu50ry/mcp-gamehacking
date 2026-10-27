/**
 * codebase-graph — dashboard graph-domain service layer (TASK-324, CG-B).
 *
 * Backend for the file-content / symbol-callers / code-graph endpoints that
 * feed the dashboard FileViewer + CallGraph DAG + code-graph force panel:
 *
 *  1. `readFileContent`  — GET/POST /api/codebase/file/content. Reads a file
 *     from DISK at the resolved repo root (resolveRepoPath is owned by
 *     CodebaseService, which passes the verified root in). Indexed files flow
 *     through the PROCESS-SHARED checksum-keyed LRU cache from CODE mode
 *     (code-search.ts, TASK-316) — cache reuse, no DB content storage.
 *     Non-indexed files are read fresh from disk (the cache's validity key is
 *     the codebase_files row checksum; without a row there is nothing to key
 *     on, and the FileViewer must show current disk state). Path traversal is
 *     REJECTED: the resolved path must stay inside the repo root (lexical
 *     containment + realpath hardening — absolute and `..` inputs are
 *     refused before any read, symlinks are resolved and re-checked).
 *  2. `getSymbolCallers` — GET /api/codebase/symbol/callers. Caller/callee
 *     PAIRS from codebase_references grouped by caller symbol — the CallGraph
 *     DAG data (mirrors trace-service.ts's reference model, but exposes the
 *     ordered pair list the graph needs instead of a single flat array).
 *  3. `buildCodeGraph`   — GET /api/codebase/graph. Layout-compatible
 *     nodes/edges for KGGraphCanvas (LayoutNode{id,name,kind,filePath,size} /
 *     LayoutEdge{source,target,relation_type}): nodes = symbols (id `sym-*`),
 *     edges = resolved codebase_references (call/import/… relation types;
 *     heritage + module-scope import rows carry caller_name=null and are
 *     anchored to their caller symbol by SPAN — TASK-374) + same-file
 *     consecutive co_defined edges (mirrors unified-graph.service.ts:90-105).
 *     Server-side degree ranking selects the
 *     top-N symbols (by reference count), only edges between selected symbols
 *     are shipped, and the edge list is capped at CODE_GRAPH_MAX_EDGES with
 *     combined-degree priority — cargo bounded regardless of repo size.
 *
 * No schema change, no migrations, no DB growth — disk reads + existing
 * tables only. Controllers delegate here (CodebaseService owns owner-/
 * repo-path resolution); this module touches `db` directly like
 * UnifiedGraphService.
 *
 * TASK-430 file-size split: public types live in `./codebase-graph/types`,
 * the path-traversal guard in `./codebase-graph/path`, `getSymbolCallers` in
 * `./codebase-graph/callers`, and `buildCodeGraph` in
 * `./codebase-graph/builder`; this module owns `readFileContent` and
 * re-exports the public API unchanged.
 */

import fs from "node:fs";
import { db } from "../lib/context";
import { ServiceError } from "../lib/jsonApi";
import { codeSearchCache } from "../../mcp/codebase-index/services/code-search";
import { detectLanguage } from "../../mcp/codebase-index/services/file-discovery";
import { FILE_CONTENT_MAX_LINES } from "../../mcp/utils/constants";
import { resolveInsideRepo } from "./codebase-graph/path";
import type { FileContentResult } from "./codebase-graph/types";

// Re-export the public API for backward compatibility (CodebaseService and
// the graph tests import from this module path).
export type {
	FileContentResult,
	CallerCalleePair,
	SymbolCallersResult,
	CodeGraphNode,
	CodeGraphEdge,
	CodeGraphKind,
	CodeGraphResult
} from "./codebase-graph/types";
export { getSymbolCallers } from "./codebase-graph/callers";
export { buildCodeGraph, CODE_GRAPH_KINDS } from "./codebase-graph/builder";

// ═══════════════════════════════════════════════════════════════════════════
// 1. FILE CONTENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read a file's content from disk (bounded) for the FileViewer.
 *
 * - `repoRoot` is the VERIFIED repo root (CodebaseService resolves it via
 *   resolveRepoPath). `repo` is the short repo name (DB form) used for the
 *   codebase_files lookup + cache key.
 * - Indexed files reuse the process-shared checksum-keyed LRU (CODE mode /
 *   TASK-316) — repeated reads never touch disk again until a re-index bumps
 *   the row checksum. Language comes from the codebase_files row.
 * - Non-indexed files are read fresh on every request (no checksum validity
 *   key exists, and the viewer must reflect current disk state); language is
 *   extension-derived via detectLanguage.
 * - Traversal is rejected before any read (resolveInsideRepo).
 *
 * @throws ServiceError 400 PATH_TRAVERSAL / 404 FILE_NOT_FOUND.
 */
export async function readFileContent(repoRoot: string, repo: string, filePath: string): Promise<FileContentResult> {
	const absolutePath = resolveInsideRepo(repoRoot, filePath);
	if (absolutePath === null) {
		throw new ServiceError(400, `path "${filePath}" does not resolve inside the repo root`, "PATH_TRAVERSAL");
	}

	const indexed = db.codebaseFiles.getFile(repo, filePath);

	let content: string;
	try {
		if (indexed) {
			// Cache-reuse path (TASK-324 reuses the TASK-316 CODE-mode cache):
			// the codebase_files row checksum is the validity key.
			content = await codeSearchCache.getContent(repo, filePath, indexed.checksum ?? null, absolutePath);
		} else {
			content = await fs.promises.readFile(absolutePath, "utf-8");
		}
	} catch {
		throw new ServiceError(404, `File not found on disk: ${filePath}`, "FILE_NOT_FOUND");
	}

	const [lines, sizeBytes] = countLinesAndBytes(content);
	const truncated = lines > FILE_CONTENT_MAX_LINES;
	const boundedContent = truncated ? sliceLines(content, FILE_CONTENT_MAX_LINES) : content;

	return {
		file_path: filePath,
		// Authoritative for indexed files; extension-derived for non-indexed.
		language: indexed?.language ?? detectLanguage(filePath),
		lines,
		size_bytes: sizeBytes,
		content: boundedContent,
		truncated
	};
}

/** Total line count + UTF-8 byte size for a file's content. */
function countLinesAndBytes(content: string): [number, number] {
	const lines = content.split(/\r?\n/).length;
	return [lines, Buffer.byteLength(content, "utf-8")];
}

/** Keep only the first `maxLines` lines (CRLF preserved per line). */
function sliceLines(content: string, maxLines: number): string {
	return content.split(/\r?\n/).slice(0, maxLines).join("\n");
}
