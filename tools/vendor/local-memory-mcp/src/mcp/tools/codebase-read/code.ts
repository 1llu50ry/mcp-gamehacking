import fs from "node:fs";
import path from "node:path";
import type { CodebaseReadInput } from "../schemas/codebase-read";
import { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import {
	searchCodeInRepo,
	InvalidCodeSearchRegexError,
	type CodeSearchMatch
} from "../../codebase-index/services/code-search";
import { CODE_SEARCH_DEFAULT_LIMIT } from "../../utils/constants";
import { docSuffix } from "../../utils/doc-comment-format";
import { logger } from "../../utils/logger";
import { parseTaggedQuery, CODEBASE_READ_TAG_KEYS } from "../../utils/query-tags";
import { listWatchedRepos } from "../../codebase-index/services/file-watcher";

/**
 * Best-effort path identity check: resolves symlinks when possible, otherwise
 * falls back to `path.resolve` (mirrors the watcher registry's own
 * `path.resolve(repoPath)` normalization). Used to tell a repo ROOT apart from
 * a subdirectory of it.
 */
function samePath(a: string, b: string): boolean {
	try {
		return fs.realpathSync.native(a) === fs.realpathSync.native(b);
	} catch {
		return path.resolve(a) === path.resolve(b);
	}
}

// ── CODE (content grep) ─────────────────────────────────────────────────

/**
 * Build a grouped-by-file summary of code matches.
 *
 * Format:
 *   ### Matches: N for "content" (showing M)
 *
 *   **file/path.ts**
 *   - L12 (in `function foo` L10-L20): `…snippet…`
 */
function formatCodeMatchesGrouped(matches: CodeSearchMatch[], total: number, content: string): string {
	if (matches.length === 0) return `### Matches: ${total} for "${content}"`;

	let out = `### Matches: ${total} for "${content}" (showing ${matches.length})\n`;

	const groups = new Map<string, CodeSearchMatch[]>();
	const groupOrder: string[] = [];
	for (const m of matches) {
		if (!groups.has(m.filePath)) {
			groups.set(m.filePath, []);
			groupOrder.push(m.filePath);
		}
		groups.get(m.filePath)!.push(m);
	}

	for (const filePath of groupOrder) {
		out += `\n**${filePath}**\n`;
		for (const m of groups.get(filePath)!) {
			const sym = m.enclosingSymbol
				? ` (in \`${m.enclosingSymbol.kind} ${m.enclosingSymbol.name}\` L${m.enclosingSymbol.startLine}-${m.enclosingSymbol.endLine}${docSuffix(m.enclosingSymbol.docComment)})`
				: "";
			out += `- L${m.line}${sym}: \`${m.snippet}\`\n`;
		}
	}

	return out;
}

/**
 * CODE mode handler — grep indexed file CONTENTS with symbol-context
 * enrichment (TASK-316).
 *
 * Disk grep over codebase_files scope only (never node_modules/.git — those
 * are excluded from the index by construction). `repoPath` is required
 * (caller-supplied, mirroring index_repository; the index stores no repo→path
 * registry). Content flows through the process-shared checksum-keyed LRU.
 *
 * Failure envelopes: REPO_PATH_REQUIRED / REPO_PATH_NOT_FOUND /
 * REPO_NOT_INDEXED / INVALID_REGEX. Empty `content` → no-op empty result
 * (never a full-file dump).
 */
async function handleCodeSearchMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const content = (validated.content ?? "").trim();

	// Defensive inline tag extraction (TASK-443): `language:php` in the (optional)
	// free-text query is auto-extracted into the CODE-mode language filter. The
	// owner/repo scope tags are protected and ignored here — `validated.repo` /
	// `repoPath` drive scoping. Inline `language` wins if present, else the
	// structured `validated.language` is used.
	const tagged = parseTaggedQuery(validated.query ?? "", CODEBASE_READ_TAG_KEYS);
	const language = (tagged.filters as { language?: string }).language ?? validated.language;

	// Empty query → no-op: return an empty result, never a full-file dump.
	if (content.length === 0) {
		return createMcpResponse(
			{
				schema: "codebase-read",
				mode: "code",
				content: "",
				regex: validated.regex,
				language: language ?? null,
				matches: [],
				total: 0,
				hasMore: false,
				filesScanned: 0,
				fileCount: 0,
				offset: validated.offset,
				limit: validated.limit ?? CODE_SEARCH_DEFAULT_LIMIT
			},
			"Empty content query — nothing searched (pass `content` to grep indexed file contents)",
			{ includeJson: validated.json }
		);
	}

	const repo = validated.repo;
	if (!repo) {
		return createMcpErrorResponse({
			code: "REPO_REQUIRED",
			message: "Mode 'code' requires a concrete 'repo'.",
			retryable: false
		});
	}

	const repoPath = validated.repoPath?.trim();
	if (!repoPath) {
		return createMcpErrorResponse({
			code: "REPO_PATH_REQUIRED",
			message:
				"Code search requires `repoPath`: pass the same absolute path used with index_repository, or run index_repository first.",
			retryable: false
		});
	}

	const resolvedPath = path.resolve(repoPath);
	let stat: fs.Stats;
	try {
		stat = fs.statSync(resolvedPath);
	} catch {
		return createMcpErrorResponse({
			code: "REPO_PATH_NOT_FOUND",
			message: `Repository path not found: ${resolvedPath}. Re-run index_repository or pass the correct repoPath.`,
			retryable: false
		});
	}
	if (!stat.isDirectory()) {
		return createMcpErrorResponse({
			code: "NOT_A_DIRECTORY",
			message: `Repository path is not a directory: ${resolvedPath}`,
			retryable: false
		});
	}

	// Root-path guard (FIX-CODESEARCH-STORM): `codebase_files.file_path` is
	// relative to the repo ROOT, so a subdirectory `repoPath` makes every file
	// resolve outside it → ENOENT for the whole repo. The watcher registry
	// (populated by startup auto-index + every index_repository call) knows the
	// registered root; reject a mismatch up front instead of logging one
	// warning per file. Absent registry entry (e.g. dashboard process) ⇒ skip
	// the guard — `statSync` above already confirmed the path exists.
	const registered = listWatchedRepos().get(repo);
	if (registered && !samePath(registered.repoPath, resolvedPath)) {
		return createMcpErrorResponse({
			code: "REPO_PATH_NOT_ROOT",
			message:
				`repoPath must be the repository ROOT registered for "${repo}", not a subdirectory: got ${resolvedPath}, expected ${registered.repoPath}. ` +
				`Pass the same absolute path used with index_repository.`,
			retryable: false,
			details: { repo, supplied: resolvedPath, expected: registered.repoPath }
		});
	}

	const limit = validated.limit ?? CODE_SEARCH_DEFAULT_LIMIT;
	const offset = validated.offset;

	try {
		const result = await searchCodeInRepo(db, repo, resolvedPath, {
			needle: content,
			regex: validated.regex,
			language,
			limit,
			offset
		});

		// A repo with zero indexed files is not resolvable as a grep target —
		// surface guidance instead of a misleading "0 matches".
		if (result.indexedFiles === 0) {
			return createMcpErrorResponse({
				code: "REPO_NOT_INDEXED",
				message: `Repo "${repo}" has no indexed files. Run index_repository first.`,
				retryable: false
			});
		}

		// Every in-scope indexed file failed to read ⇒ the repoPath is almost
		// certainly wrong (or the checkout moved) — surface guidance rather
		// than "0 matches". (A language filter matching no files yields
		// fileCount 0, which falls through to the normal empty response.)
		if (result.fileCount > 0 && result.filesScanned === 0) {
			return createMcpErrorResponse({
				code: "REPO_FILES_MISSING",
				message: `None of the ${result.fileCount} indexed files could be read. Re-run index_repository or pass the correct repoPath.`,
				retryable: false,
				details: { fileCount: result.fileCount }
			});
		}

		const contentSummary = formatCodeMatchesGrouped(result.matches, result.total, content);

		return createMcpResponse(
			{
				schema: "codebase-read",
				mode: "code",
				content,
				regex: validated.regex,
				language: language ?? null,
				matches: result.matches,
				total: result.total,
				hasMore: result.hasMore,
				filesScanned: result.filesScanned,
				fileCount: result.fileCount,
				indexedFiles: result.indexedFiles,
				offset,
				limit
			},
			`Found ${result.total} content matches for "${content}" (showing ${result.matches.length}) across ${result.filesScanned} indexed files.`,
			{ includeJson: validated.json, contentSummary }
		);
	} catch (err) {
		if (err instanceof InvalidCodeSearchRegexError) {
			return createMcpErrorResponse({ code: "INVALID_REGEX", message: err.message, retryable: false });
		}
		const message = err instanceof Error ? err.message : String(err);
		logger.error("[handleCodebaseRead:code] Unexpected error", { repo, content, error: message });
		return createMcpErrorResponse({
			code: "CODE_SEARCH_FAILED",
			message: "Code search failed",
			retryable: true
		});
	}
}

export { handleCodeSearchMode };
