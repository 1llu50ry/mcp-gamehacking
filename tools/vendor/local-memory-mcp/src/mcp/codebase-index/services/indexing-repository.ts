/**
 * indexing-repository — core indexRepository function.
 * Discover → Compare → Parse → Store → Clean pipeline.
 * Planning/parsing/writing extracted to indexing-planner.ts,
 * parse-pipeline.ts, and indexing-writer.ts.
 *
 * Incremental pipeline (Fix #1): read + checksum happens WITHOUT parse; files
 * unchanged by checksum (or by mtime pre-filter in the planner) are skipped,
 * and ONLY changed/new files are handed to the parser — an unchanged repo
 * re-run parses ZERO files.
 */

import path from "node:path";
import { performance } from "node:perf_hooks";
import { discoverFiles } from "./file-discovery";
import type { ParserPool } from "../parser";
import type { SQLiteStore } from "../../storage/sqlite";
import type { ErrorSummary } from "../types/errors";
import { logger } from "../../utils/logger";

// Import cache-level utilities
import {
	checkRepoStaleness,
	clearStalenessCache,
	DEFAULT_BATCH_SIZE,
	type FilePlan,
	type StalenessResult
} from "./indexing-cache";

// Import extracted sub-modules
import { createIndexPlan } from "./indexing-planner";
import { applyRenames, cleanStaleFiles, type IndexProgress, type IndexFileError } from "./indexing-writer";
import type { IndexStatus } from "./indexing-staleness";
import { emitProgress, runParsePipeline } from "./parse-pipeline";

// ── Module-level indexing guard (shared instance) ──────────────────────

import { indexingRepos as _indexingRepos } from "./indexing-cache";
const indexingRepos = _indexingRepos;

// ── Error types ────────────────────────────────────────────────────────

/** Thrown when attempting to index a repo that is already being indexed. */
export class IndexInProgressError extends Error {
	constructor(repo: string) {
		super(`Index already in progress for repo: ${repo}. Concurrent indexing is not supported.`);
		this.name = "IndexInProgressError";
	}
}

// ── Public interfaces ──────────────────────────────────────────────────

export interface CodebaseIndexService {
	indexRepository(repo: string, repoPath: string, options?: IndexOptions): Promise<IndexResult>;
	checkStaleness(repo: string, repoPath: string): Promise<StalenessResult>;
	getIndexStatus(repo: string, repoPath?: string): Promise<IndexStatus>;
}

export interface IndexOptions {
	/** If true, re-parse all files regardless of checksum match (default: false). */
	force?: boolean;
	/**
	 * Scope owner for the codebase→KG enqueue (FIX-OWNER-CODEBASE). Threaded
	 * from the tool/watcher caller so the KG rows derived from this index carry
	 * the caller's owner instead of "". Empty/undefined falls back to the
	 * historical owner-less behavior.
	 */
	owner?: string;
	/** Include-only glob patterns passed to FileDiscovery. */
	includeGlobs?: string[];
	/** Extra exclude glob patterns passed to FileDiscovery. */
	excludeGlobs?: string[];
	/** Number of files to process per transaction batch (default: 50). */
	batchSize?: number;
	/** Maximum number of files to index (passes through to FileDiscovery). */
	maxFiles?: number;
	/** Progress callback emitted at each stage. */
	onProgress?: (progress: IndexProgress) => void;
}

// Re-export for consumers
export type { IndexProgress, IndexFileError } from "./indexing-writer";

export interface IndexResult {
	success: boolean;
	totalFiles: number;
	parsedFiles: number;
	skippedFiles: number;
	failedFiles: number;
	totalSymbols: number;
	durationMs: number;
	errors: IndexFileError[];
	/** Breakdown of skip reasons for the summary. */
	skippedByChecksum: number;
	/** Files skipped by the mtime pre-filter (content unchanged since last index). */
	skippedByMtime: number;
	skippedByExtension: number;
	skippedByGitignore: number;
	/**
	 * Root-relative paths of directories skipped because they could not be
	 * read (EACCES/EPERM/ENOENT) during discovery (FIX-031). Informational —
	 * the index still completes.
	 */
	skippedDirectories: string[];
	/** Number of files detected as renames (old path → new path, same content). */
	renamedFiles: number;
	/**
	 * Count of EXPECTED partial-parse errors downgraded to debug rather than
	 * counted as failures (JSX-in-plain-JS, generated/minified artifacts —
	 * FIX-030). Included in `parsedFiles` (partial symbols persisted), NOT in
	 * `failedFiles`. Informational for the index summary.
	 */
	expectedParseErrors: number;
	/** Structured error classification summary. */
	errorSummary: ErrorSummary;
}

// Re-export types from canonical locations (TASK-114 dedup)
export type { IndexStatus } from "./indexing-staleness";
export type { StalenessResult } from "./indexing-cache";

// ── Core indexRepository function ──────────────────────────────────────

export async function performIndexRepository(
	db: SQLiteStore,
	parserPool: ParserPool,
	repo: string,
	repoPath: string,
	indexingRepos: Set<string>,
	options: IndexOptions = {}
): Promise<IndexResult> {
	const startTime = performance.now();
	const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
	const errors: IndexFileError[] = [];
	let totalFiles: number;

	// Skip-reason counters. Mtime-pre-filtered plans are counted here (they
	// never reach the parse pipeline); the pipeline returns the rest.
	let skippedFiles = 0;
	let skippedByChecksum = 0;
	let skippedByMtime = 0;

	// ── Thread safety check ──────────────────────────────────
	if (indexingRepos.has(repo)) {
		throw new IndexInProgressError(repo);
	}
	indexingRepos.add(repo);

	// ═══════════════════════════════════════════════════════════════
	// try/finally (TASK-018): the lock MUST be released on EVERY exit
	// path — success, thrown error, or (crucially) a test runner killing
	// this promise via its per-test timeout. A timed-out index call leaves
	// the promise pending forever, so without the finally the repo stays
	// locked and every subsequent index of the same repo fails with
	// IndexInProgressError (the observed perf-test cascade).
	// ═══════════════════════════════════════════════════════════════
	try {
		// ═══ 1. DISCOVER ═══
		emitProgress(options, {
			stage: "discovering",
			current: 0,
			total: 0,
			message: `Discovering files in ${repoPath}...`
		});

		const resolvedPath = path.resolve(repoPath);
		const discoverResult = await discoverFiles({
			projectPath: resolvedPath,
			includeGlobs: options.includeGlobs,
			excludeGlobs: options.excludeGlobs,
			maxFiles: options.maxFiles
		});

		const discoveredFiles = discoverResult.files;
		logger.info("[IndexingService] Discovery complete", {
			repo,
			filesFound: discoveredFiles.length,
			skippedByExt: discoverResult.skippedByExtension,
			skippedByGitignore: discoverResult.skippedByGitignore,
			skippedDirs: discoverResult.skippedDirectories.length
		});

		// ═══ 2. COMPARE (delegate to planner) ═══
		const existingFiles = db.codebaseFiles.getFilesByRepo(repo, { slim: true });
		const planResult = createIndexPlan(discoveredFiles, existingFiles, options);

		totalFiles = planResult.totalFiles;
		const { plans, existingMap, checksumToOldPaths, renameMap, stalePaths } = planResult;

		emitProgress(options, {
			stage: "discovering",
			current: totalFiles,
			total: totalFiles,
			message: `Discovered ${totalFiles} files (${plans.length} to process, ${planResult.staleCount} stale).`
		});

		// ═══ 3. PARSE (delegate to parse-pipeline) ═══
		const parseTasks = plans.filter((p): p is Extract<FilePlan, { action: "parse" }> => p.action === "parse");

		// Mtime pre-filtered plans (content unchanged — mtime <= last_indexed_at)
		// were skipped by the planner WITHOUT readFile/checksum. Content
		// unchanged ⇒ checksum unchanged, so they count toward
		// skippedByChecksum too, keeping the public skip contract stable.
		for (const plan of plans) {
			if (plan.action === "skip") {
				skippedFiles++;
				skippedByChecksum++;
				skippedByMtime++;
			}
		}

		const pipeline = await runParsePipeline(
			db,
			parserPool,
			repo,
			parseTasks,
			existingMap,
			checksumToOldPaths,
			renameMap,
			stalePaths,
			options
		);
		skippedFiles += pipeline.skippedFiles;
		skippedByChecksum += pipeline.skippedByChecksum;
		errors.push(...pipeline.errors);

		// ═══════════════════════════════════════════════════════
		// 4. STORE (renames) + 5. CLEAN — incremental writer steps
		// ═══════════════════════════════════════════════════════
		// Rename transfers and stale cleanup run once, after all parse batches.
		// Renamed paths never enter fileInserts (skipped at decision time), so
		// their transferred symbols are never deleted by a later parse flush.
		await applyRenames({ db, repo, owner: options.owner, batchSize, options }, renameMap);
		const dbWriteErrors =
			pipeline.dbWriteErrors +
			(await cleanStaleFiles({ db, repo, owner: options.owner, batchSize, options }, stalePaths));

		// ── Build final report ───────────────────────────────
		const durationMs = Math.round(performance.now() - startTime);

		logger.info("[IndexingService] Index complete", {
			repo,
			totalFiles,
			parsedFiles: pipeline.parsedFiles,
			skippedFiles,
			failedFiles: pipeline.failedFiles,
			expectedParseErrors: pipeline.expectedParseErrors,
			totalSymbols: pipeline.totalSymbols,
			renamedFiles: pipeline.renamedFiles,
			skippedByChecksum,
			skippedByMtime,
			durationMs
		});

		return {
			success: pipeline.failedFiles === 0 && errors.length === 0,
			totalFiles,
			parsedFiles: pipeline.parsedFiles,
			skippedFiles,
			failedFiles: pipeline.failedFiles,
			totalSymbols: pipeline.totalSymbols,
			durationMs,
			errors,
			skippedByChecksum,
			skippedByMtime,
			skippedByExtension: discoverResult.skippedByExtension,
			skippedByGitignore: discoverResult.skippedByGitignore,
			skippedDirectories: discoverResult.skippedDirectories,
			renamedFiles: pipeline.renamedFiles,
			expectedParseErrors: pipeline.expectedParseErrors,
			errorSummary: {
				total: errors.length,
				recoverable: errors.length,
				fatal: 0,
				timeoutErrors: pipeline.timeoutErrors,
				permissionErrors: pipeline.permissionErrors,
				dbWriteErrors
			}
		};
	} finally {
		indexingRepos.delete(repo);
		// Index writes landed (or failed) — drop the cached staleness result so
		// the next index_status reflects the new last_indexed_at immediately.
		clearStalenessCache(repo);
		// Abandon any in-flight parse/enrichment work: the batch loop never
		// checks cancellation, so after a timeout/interrupt this promise would
		// otherwise keep running (busy-looping the event loop until it settles)
		// even though the caller has moved on. Thread-interrupt semantics
		// (per-spec) make this harmless: the operation is considered killed.
		process.emit("beforeExit" as unknown as NodeJS.Signals);
	}
}

// ── Implementation class ───────────────────────────────────────────────

/**
 * CodebaseIndexServiceImpl — delegates to standalone functions.
 *
 * Implements the CodebaseIndexService interface by routing calls to
 * the focused sub-modules.
 */
export class CodebaseIndexServiceImpl implements CodebaseIndexService {
	private db: SQLiteStore;
	private parserPool: ParserPool;

	constructor(db: SQLiteStore, parserPool: ParserPool) {
		this.db = db;
		this.parserPool = parserPool;
	}

	async indexRepository(repo: string, repoPath: string, options: IndexOptions = {}): Promise<IndexResult> {
		return performIndexRepository(this.db, this.parserPool, repo, repoPath, indexingRepos, options);
	}

	async checkStaleness(repo: string, repoPath: string): Promise<StalenessResult> {
		// Live (uncached) — the pre-index decision must never be served from
		// the 30s TTL cache after a file change (FIX-14).
		return checkRepoStaleness(this.db, repo, repoPath);
	}

	async getIndexStatus(repo: string, repoPath?: string): Promise<IndexStatus> {
		const { files: totalFiles, symbols: totalSymbols, lastIndexedAt } = getIndexStats(this.db, repo);

		const base: IndexStatus = {
			repo,
			isIndexed: totalFiles > 0,
			isIndexing: indexingRepos.has(repo),
			lastIndexedAt,
			totalFiles,
			totalSymbols,
			progress: null
		};

		// Only compute staleness if repoPath is provided AND the repo has been indexed
		if (repoPath && totalFiles > 0) {
			// User-facing index_status — TTL-cached within INDEX_STALENESS_TTL_MS
			// (TASK-018). The live path is `checkStaleness` (FIX-14).
			const staleness = await checkRepoStaleness(this.db, repo, repoPath, { useCache: true });
			base.stale = staleness.stale;
			base.staleRatio = staleness.staleRatio;
		}

		return base;
	}
}

/**
 * Aggregate a repo's index stats (file count, symbol count, and last indexed
 * timestamp) with a SINGLE statement using scalar subqueries — collapses the
 * three separate COUNT/COUNT/MAX queries getIndexStatus used to issue into one
 * round-trip (issue #70), while keeping the exact IndexStatus shape.
 */
function getIndexStats(
	db: SQLiteStore,
	repo: string
): { files: number; symbols: number; lastIndexedAt: string | null } {
	const row = db.db
		.prepare(
			`SELECT
				(SELECT COUNT(*) FROM derived.codebase_files WHERE repo = ?) AS files,
				(SELECT COUNT(*) FROM derived.codebase_symbols WHERE repo = ?) AS symbols,
				(SELECT MAX(last_indexed_at) FROM derived.codebase_files WHERE repo = ?) AS last_indexed_at`
		)
		.get(repo, repo, repo) as { files: number; symbols: number; last_indexed_at: string | null } | undefined;

	return {
		files: row?.files ?? 0,
		symbols: row?.symbols ?? 0,
		lastIndexedAt: row?.last_indexed_at ?? null
	};
}
