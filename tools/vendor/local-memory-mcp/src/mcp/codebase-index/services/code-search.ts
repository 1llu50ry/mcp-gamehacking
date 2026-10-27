/**
 * code-search — CODE mode content grep for codebase-read (TASK-316).
 *
 * Satisfies US-11 ("search file contents, results enriched with surrounding
 * symbol definitions") and C3 ("grep over indexed files — symbol context
 * around matches") with a DISK GREP, not a DB content scan:
 *
 *  1. Scope is strictly the codebase_files index — only files that were
 *     discovered+indexed are read (node_modules/.git/untracked files never
 *     appear in codebase_files, so they are excluded by construction).
 *  2. File content is read from disk at `repoPath` (caller-supplied, exactly
 *     as index_repository takes it — the index stores no repo→path registry).
 *  3. A process-shared LRU cache keyed by repo+file_path, validity keyed to
 *     the codebase_files ROW checksum: re-index updates the row ⇒ checksum
 *     mismatch ⇒ content reloaded on next access (the "re-stale check on
 *     access" from TASK-316). Shared across ALL agent connections (module
 *     singleton, same pattern as parserPool / indexingRepos), bounded by
 *     file-count + byte-budget, single-flight against async reentrancy.
 *  4. Matched lines are enriched with their innermost ENCLOSING symbol span
 *     (preloaded per file from codebase_symbols — the spec's "range preload
 *     per file" option).
 *
 * No DB growth, no migration, no schema change, no new MCP tool.
 *
 * TASK-430 file-size split: the cache (CodeSearchCache + singleton), regex
 * compilation + ReDoS guard, and the grep primitives live in sibling modules
 * (`code-search-cache.ts` / `code-search-regex.ts` / `code-search-grep.ts`);
 * this module owns the orchestrator and re-exports the public API unchanged.
 */

import path from "node:path";
import type { SQLiteStore } from "../../storage/sqlite";
import type { CodebaseFile } from "../../types";
import { logger } from "../../utils/logger";
import { CODE_SEARCH_READ_CONCURRENCY } from "../../utils/constants";
import { codeSearchCache } from "./code-search-cache";
import { compileCodeSearchRegex } from "./code-search-regex";
import { EnclosingSymbol, grepContent, findEnclosingSymbol } from "./code-search-grep";

// Re-export the extracted public API for backward compatibility (the
// dashboard service, codebase.read, and tests import from this module path).
export { CodeSearchCache, codeSearchCache, clearCodeSearchCache } from "./code-search-cache";
export { InvalidCodeSearchRegexError, compileCodeSearchRegex } from "./code-search-regex";
export { LineMatch, EnclosingSymbol, grepContent, findEnclosingSymbol } from "./code-search-grep";

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** A matched line, located within a file, enriched with its enclosing symbol. */
export interface CodeSearchMatch {
	/** Relative file path (codebase_files.file_path). */
	filePath: string;
	/** codebase_files.language of the file. */
	language: string | null;
	/** 1-based line number of the match. */
	line: number;
	/** ~CODE_SEARCH_SNIPPET_CHARS chars around the match (ellipsis-padded). */
	snippet: string;
	/** Character index of the matched substring within the line. */
	matchIndex: number;
	/** Innermost symbol whose [start_line, end_line] encloses the line, if any. */
	enclosingSymbol: EnclosingSymbol | null;
}

export interface CodeSearchOptions {
	/** The substring / regex to grep for (trimmed by the handler). */
	needle: string;
	/** Treat `needle` as a regular expression (case-insensitive). */
	regex?: boolean;
	/** Only grep files whose codebase_files.language matches (case-insensitive). */
	language?: string;
	/** Max matches to return. */
	limit: number;
	/** Skip this many matches (across the whole file set) before returning. */
	offset: number;
}

export interface CodeSearchResult {
	matches: CodeSearchMatch[];
	/**
	 * Matches found within the scanned file set. When the search stopped early
	 * (cap reached), this is the count up to the stop point — `hasMore` is
	 * then true to signal more may exist in unscanned files.
	 */
	total: number;
	/** True when matches remain beyond this page (early-exit cap or pagination). */
	hasMore: boolean;
	/** Indexed files actually scanned (after language filter + readability). */
	filesScanned: number;
	/** Indexed files in scope (after language filter). */
	fileCount: number;
	/** Total indexed files for the repo (language-filter-independent; 0 ⇒ not indexed). */
	indexedFiles: number;
}

/**
 * Defense-in-depth: never read a file whose resolved path escapes repoPath
 * (index rows are trusted, but a corrupt/malicious row must not read outside
 * the repo root). Returns null when the path is not contained.
 */
function safeJoin(repoPath: string, filePath: string): string | null {
	const absolutePath = path.resolve(repoPath, filePath);
	const rel = path.relative(repoPath, absolutePath);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
	return absolutePath;
}

// ── Skip-warning dedup (FIX-CODESEARCH-STORM) ────────────────────────────
// A wrong / subdirectory `repoPath` makes EVERY indexed file resolve to a
// non-existent path, so the two skip warnings below used to fire once per
// file. One observed storm wrote 157k lines / ~50 MB through the SYNCHRONOUS
// file sink in a single minute, stalling the event loop and starving JSON-RPC
// (the -32001 client timeouts). A skip is a diagnostic about the CALL, not
// per-file data: emit at most one per (message, repo, repoPath) per interval.
const WARN_DEDUP_INTERVAL_MS = 60_000;
/** Hard cap on retained dedup keys — bounds memory under many repos. */
const WARN_DEDUP_MAX_KEYS = 256;

interface WarnDedupState {
	/** Epoch ms of the last emitted warning for this key. */
	lastEmittedAt: number;
	/** Occurrences suppressed since that emission (surfaced on the next one). */
	suppressed: number;
}

/** key → dedup state (Map preserves insertion order ⇒ oldest evicted first). */
const warnDedup = new Map<string, WarnDedupState>();

/** Clears the skip-warning dedup state (tests / long-lived ops). */
export function clearCodeSearchWarnDedup(): void {
	warnDedup.clear();
}

/**
 * Emits a skip warning at most once per `WARN_DEDUP_INTERVAL_MS` for a given
 * (message, repo, repoPath) triple, annotating the next emission with how many
 * occurrences were suppressed in between. Rate-limited so a repo-wide
 * resolution failure never floods the log sink.
 */
function warnSkipOnce(repo: string, repoPath: string, message: string, context: Record<string, unknown>): void {
	const key = `${message}\u0000${repo}\u0000${repoPath}`;
	const now = Date.now();
	const state = warnDedup.get(key);

	if (state && now - state.lastEmittedAt < WARN_DEDUP_INTERVAL_MS) {
		state.suppressed += 1;
		return;
	}

	const suppressed = state?.suppressed ?? 0;
	// Re-insert to move the key to the MRU tail (keeps eviction meaningful).
	warnDedup.delete(key);
	warnDedup.set(key, { lastEmittedAt: now, suppressed: 0 });
	if (warnDedup.size > WARN_DEDUP_MAX_KEYS) {
		const oldest = warnDedup.keys().next().value;
		if (oldest !== undefined) warnDedup.delete(oldest);
	}

	logger.warn(message, suppressed > 0 ? { ...context, suppressedSincePrevious: suppressed } : context);
}

// ═══════════════════════════════════════════════════════════════════════════
// ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Grep the INDEXED files of a repo on disk (TASK-316 CODE mode).
 *
 * - Files are taken from codebase_files only (index scope; non-indexed and
 *   node_modules/.git files are excluded by construction).
 * - Content flows through the shared LRU cache; a language filter prunes the
 *   file set BEFORE any disk read.
 * - Matched lines are enriched with their innermost enclosing symbol span.
 * - Bounded concurrency (CODE_SEARCH_READ_CONCURRENCY), early exit once
 *   offset+limit matches are collected (big repos stop scanning once the page
 *   is filled; `hasMore` stays truthful).
 *
 * `repoPath` must be a validated directory (the handler checks existence).
 */
export async function searchCodeInRepo(
	db: SQLiteStore,
	repo: string,
	repoPath: string,
	options: CodeSearchOptions
): Promise<CodeSearchResult> {
	const { needle, regex = false, language, limit, offset } = options;

	// Empty query → no-op: empty result, never a full-file dump.
	if (needle.length === 0) {
		return { matches: [], total: 0, hasMore: false, filesScanned: 0, fileCount: 0, indexedFiles: 0 };
	}

	const compiledRegex = regex ? compileCodeSearchRegex(needle) : null;

	// Language filter prunes the set before any disk read, so fileCount
	// reflects the actual scan scope; indexedFiles stays filter-independent so
	// the handler can tell "repo not indexed" from "filter matched no files".
	const allFiles = db.codebaseFiles.getFilesByRepo(repo);
	const indexedFiles = allFiles.length;
	let files = allFiles;
	if (language) {
		const lang = language.toLowerCase();
		files = files.filter((f) => f.language !== null && f.language.toLowerCase() === lang);
	}
	const fileCount = files.length;

	const matches: CodeSearchMatch[] = [];
	let filesScanned = 0;
	const wanted = offset + limit;

	for (let i = 0; i < files.length; i += CODE_SEARCH_READ_CONCURRENCY) {
		const chunk = files.slice(i, i + CODE_SEARCH_READ_CONCURRENCY);
		const chunkResults = await Promise.all(
			chunk.map((f) => grepIndexedFile(db, repo, repoPath, f, needle, compiledRegex))
		);
		for (const fileMatches of chunkResults) {
			if (fileMatches === null) continue; // unreadable / traversal-guarded
			filesScanned++;
			if (fileMatches.length > 0) matches.push(...fileMatches);
		}
		// Early exit: the page (offset+limit) is filled — stop scanning. total
		// then counts matches up to the stop point; hasMore flags the rest.
		if (matches.length >= wanted) break;
	}

	const capped = matches.length >= wanted;
	return {
		matches: matches.slice(offset, offset + limit),
		total: matches.length,
		hasMore: capped || offset + limit < matches.length,
		filesScanned,
		fileCount,
		indexedFiles
	};
}

/**
 * Grep one indexed file: cache-read content, match lines, enrich with the
 * file's enclosing symbol spans. Returns null when the file could not be read
 * or its path escapes the repo root (skipped, not an error). Symbols are only
 * loaded for files that actually have matches (the "preload per file once"
 * option from TASK-316 — one cheap query per matched file).
 */
async function grepIndexedFile(
	db: SQLiteStore,
	repo: string,
	repoPath: string,
	file: CodebaseFile,
	needle: string,
	regex: RegExp | null
): Promise<CodeSearchMatch[] | null> {
	const absolutePath = safeJoin(repoPath, file.file_path);
	if (absolutePath === null) {
		warnSkipOnce(repo, repoPath, "[CodeSearch] Skipping indexed file outside repo root", {
			repo,
			filePath: file.file_path
		});
		return null;
	}

	let content: string;
	try {
		content = await codeSearchCache.getContent(repo, file.file_path, file.checksum ?? null, absolutePath);
	} catch (err) {
		warnSkipOnce(repo, repoPath, "[CodeSearch] Skipping unreadable indexed file", {
			repo,
			filePath: file.file_path,
			error: err instanceof Error ? err.message : String(err)
		});
		return null;
	}

	const lineMatches = grepContent(content, needle, regex);
	if (lineMatches.length === 0) return [];

	const symbols = db.codebaseSymbols.getSymbolsByFile(repo, file.file_path);
	return lineMatches.map((m) => ({
		filePath: file.file_path,
		language: file.language,
		line: m.line,
		snippet: m.snippet,
		matchIndex: m.matchIndex,
		enclosingSymbol: findEnclosingSymbol(symbols, m.line)
	}));
}
