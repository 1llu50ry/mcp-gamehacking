/**
 * Indexing cache — progress tracking, staleness checking, and utility helpers.
 *
 * Manages the module-level indexing guard Set, provides standalone staleness
 * checking and cache utilities, and holds shared helper utilities
 * (SHA-256 checksums, error classification, retry logic).
 *
 * This module has no dependency on the indexing orchestrator, making it
 * safe to import from indexing-service.ts without circular deps.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SQLiteStore } from "../../storage/sqlite";
import type { CodebaseFile } from "../../types";
import { logger } from "../../utils/logger";
import { INDEX_STALENESS_TTL_MS } from "../../utils/constants";

// ── Module-level indexing guard ───────────────────────────────────────

/**
 * Tracks repos currently being indexed.
 * Shared across auto-index and manual `indexRepository` calls so they
 * can detect each other and prevent concurrent indexing of the same repo.
 */
export const indexingRepos = new Set<string>();

/**
 * Clear the module-level indexing guard.
 * Primarily used in test teardown to release locks between test runs.
 */
export function clearIndexingRepos(): void {
	indexingRepos.clear();
}

// ── SHA-256 helpers ───────────────────────────────────────────────────

export function computeChecksum(content: string): string {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Count lines in a string (LF-normalized, non-empty final line counts).
 *
 * Uses a single character scan counting `\n` occurrences instead of
 * `String.split("\n")`, which allocated a full array just to measure length.
 * Empty content → 0; non-empty content → 1 + number of `\n` characters.
 */
export function countLines(content: string): number {
	if (!content) return 0;
	let count = 1;
	for (let i = 0; i < content.length; i++) {
		if (content.charCodeAt(i) === 10 /* \n */) count++;
	}
	return count;
}

// ── Error classification helpers ───────────────────────────────────────

/**
 * Detect permission-denied errors from Node.js `ErrnoException` codes
 * or message patterns. Matches EACCES, EPERM, and their Windows equivalents.
 */
export function isPermissionError(err: unknown): boolean {
	if (typeof err === "object" && err !== null && "code" in err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "EACCES" || code === "EPERM") return true;
	}
	const message = err instanceof Error ? err.message : String(err);
	return /permission denied|access denied|EACCES|EPERM/i.test(message);
}

/**
 * Detect parser timeout errors. Tree-sitter timeouts are raised via
 * Promise.race in ParserPool with a "Parse timeout after" message.
 */
export function isTimeoutError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /timeout/i.test(message);
}

/**
 * Retry a database write operation with lock-aware backoff.
 *
 * - Lock-related errors (file already held by another process):
 *   3 retries with exponential backoff (1s, 2s, 4s). proper-lockfile already
 *   retries internally for ~50s before surfacing, so these additional retries
 *   act as a safety net for edge cases.
 * - Other errors (e.g. SQL constraints): single retry at 100ms (current behavior).
 */
export async function retryDbWrite<T>(fn: () => Promise<T>, context: string): Promise<T> {
	const MAX_LOCK_RETRIES = 3;
	const INITIAL_LOCK_BACKOFF_MS = 1000;

	try {
		return await fn();
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const isLockRelated = /lock/i.test(message) || /already being held/i.test(message) || /EBUSY/i.test(message);

		if (isLockRelated) {
			logger.warn("[IndexingService] Lock contention detected — retrying with backoff", {
				context,
				error: message
			});
			let lastError = err;
			for (let attempt = 1; attempt <= MAX_LOCK_RETRIES; attempt++) {
				const delay = INITIAL_LOCK_BACKOFF_MS * Math.pow(2, attempt - 1);
				await new Promise((resolve) => setTimeout(resolve, delay));
				try {
					return await fn();
				} catch (retryErr) {
					lastError = retryErr;
					const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
					logger.warn("[IndexingService] Lock retry attempt failed", {
						context,
						attempt,
						maxRetries: MAX_LOCK_RETRIES,
						delayMs: delay,
						error: retryMsg
					});
				}
			}
			logger.error("[IndexingService] All lock retries exhausted", {
				context,
				attempts: MAX_LOCK_RETRIES,
				error: message
			});
			throw lastError;
		}

		// Non-lock errors: single simple retry (preserves existing behavior)
		logger.warn("[IndexingService] DB write failed — retrying once", {
			context,
			error: message
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		try {
			return await fn();
		} catch (retryErr) {
			const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
			logger.error("[IndexingService] DB write retry failed", {
				context,
				error: retryMessage
			});
			throw retryErr;
		}
	}
}

// ── Constants ─────────────────────────────────────────────────────────
// Re-exported for backward compatibility with indexing-repository.ts.
export { DEFAULT_BATCH_SIZE } from "../../utils/constants";

// ── Private type for file categorization ──────────────────────────────

export type FilePlan =
	| { action: "skip"; filePath: string }
	| {
			action: "parse";
			filePath: string;
			absolutePath: string;
			language: string;
			sizeBytes: number;
	  };

// ── Staleness checking ────────────────────────────────────────────────

export interface StalenessResult {
	stale: boolean;
	staleFiles: number;
	totalFiles: number;
	staleRatio: number;
	lastIndexedAt: string | null;
}

/**
 * Per-repo staleness cache. Staleness checks cost N filesystem stats per
 * repo, so results are reused within INDEX_STALENESS_TTL_MS (30s default).
 * The resolved repoPath is stored with the result so a different repoPath
 * for the same repo always recomputes.
 */
interface StalenessCacheEntry {
	repoPath: string;
	result: StalenessResult;
	cachedAt: number;
}

const stalenessCache = new Map<string, StalenessCacheEntry>();

/**
 * Width (ms) of the mtime ambiguity window for per-file staleness checks.
 *
 * Filesystem mtime granularity is coarser than the ms-precision
 * last_indexed_at on many platforms (ext3 = 1s, FAT = 2s, tmpfs/NFS ≈ ms).
 * When a file's mtime falls inside [indexedTime − W, indexedTime + W] the
 * stat alone cannot distinguish "modified just before the index was built"
 * from "modified just after it" — a coarse fs can report an mtime ≤
 * last_indexed_at for a file actually changed AFTER the index, which the raw
 * `stat.mtimeMs > indexedTime` comparison would miss (false-negative: repo
 * reported fresh, stale symbols kept). Files inside the window are therefore
 * confirmed against the stored SHA-256 checksum (read + hash); files outside
 * keep the cheap stat-only comparison. 2000ms covers the coarsest common
 * granularity (FAT = 2s) plus small clock skew between the stat clock and
 * the DB write clock.
 */
const STALENESS_AMBIGUITY_WINDOW_MS = 2000;

/**
 * Invalidate cached staleness results — all repos, or a single repo.
 * Called after an index run completes so index_status reflects fresh data
 * immediately instead of waiting out the TTL.
 */
export function clearStalenessCache(repo?: string): void {
	if (repo === undefined) {
		stalenessCache.clear();
		return;
	}
	stalenessCache.delete(repo);
}

/**
 * Resolve the most recent last_indexed_at for a repo with a single
 * SELECT MAX — avoids loading every file row just to find the newest date.
 */
export function getLastIndexedAt(db: SQLiteStore, repo: string): string | null {
	const row = db.db
		.prepare("SELECT MAX(last_indexed_at) AS last_indexed_at FROM derived.codebase_files WHERE repo = ?")
		.get(repo) as { last_indexed_at: string | null } | undefined;
	return row?.last_indexed_at ?? null;
}

/**
 * Decide whether a single indexed file is stale on disk.
 *
 * Outside the ambiguity window (see STALENESS_AMBIGUITY_WINDOW_MS) the raw
 * stat comparison is trustworthy: mtime newer than last_indexed_at ⇒ the
 * file changed after it was indexed. Inside the window — where a coarse-
 * granularity fs could hide a post-index modification behind an mtime ≤
 * last_indexed_at — the stat is confirmed by content: the file is read and
 * hashed with the same SHA-256 used at index time, and is stale iff the
 * checksum differs from the stored one. This is bounded to the window only;
 * steady-state freshness checks never pay the read cost. A file that no
 * longer exists, or one whose content cannot be read inside the window, is
 * treated as stale (conservative — never hides a real change).
 */
async function isFileStale(f: CodebaseFile, fullPath: string): Promise<boolean> {
	const indexedTime = f.last_indexed_at ? new Date(f.last_indexed_at).getTime() : 0;

	try {
		const stat = await fs.promises.stat(fullPath);

		// No reliable indexed-time basis or no stored checksum (legacy row):
		// fall back to the raw comparison — nothing to confirm against.
		if (indexedTime === 0 || f.checksum === null) {
			return stat.mtimeMs > indexedTime;
		}

		// Ambiguous window: stat cannot distinguish pre-index vs post-index
		// modification (coarse-granularity fs) — confirm by content.
		if (Math.abs(stat.mtimeMs - indexedTime) <= STALENESS_AMBIGUITY_WINDOW_MS) {
			try {
				const content = await fs.promises.readFile(fullPath, "utf-8");
				return computeChecksum(content) !== f.checksum;
			} catch {
				// Read failed — cannot confirm; treat as stale (conservative).
				return true;
			}
		}

		// Outside the window: raw mtime comparison is trustworthy.
		return stat.mtimeMs > indexedTime;
	} catch {
		// File no longer exists on disk → stale
		return true;
	}
}

/**
 * Check whether a repo's index is stale by comparing file mtimes against
 * their last_indexed_at timestamps.
 *
 * A file is considered stale if:
 *   - Its mtime is newer than its last_indexed_at, OR
 *   - Its mtime falls inside the ambiguity window AND its content checksum
 *     differs from the stored one (coarse-granularity fs confirmation), OR
 *   - The file no longer exists on disk (was deleted)
 *
 * The repo is marked stale only if >= 5% of indexed files have changed.
 *
 * Caching is OPT-IN via `{ useCache: true }` (FIX-14): staleness results are
 * cached per repo for INDEX_STALENESS_TTL_MS only for the user-facing
 * `getIndexStatus` path, which tolerates up-to-30s staleness (TASK-018).
 * `checkStaleness` — used as the pre-index decision and documented to reflect
 * on-disk changes immediately — always runs live (uncached), so a file
 * modification is never hidden behind the TTL window. File stats run
 * asynchronously (fs.promises) with bounded concurrency so index_status
 * no longer blocks the event loop with N sync statSync calls.
 * INDEX_STALENESS_TTL_MS=0 disables the cache entirely (the TTL guard
 * `elapsed < 0` is never satisfiable), forcing a live check every call.
 */
export async function checkRepoStaleness(
	db: SQLiteStore,
	repo: string,
	repoPath: string,
	options: { useCache?: boolean } = {}
): Promise<StalenessResult> {
	const { useCache = false } = options;
	const resolvedPath = path.resolve(repoPath);

	// Serve from cache only when the caller opted in AND the result is fresh
	// AND the repo path is unchanged.
	const cached = stalenessCache.get(repo);
	if (useCache && cached && cached.repoPath === resolvedPath && Date.now() - cached.cachedAt < INDEX_STALENESS_TTL_MS) {
		return cached.result;
	}

	const existingFiles = db.codebaseFiles.getFilesByRepo(repo, { slim: true });
	const totalFiles = existingFiles.length;

	// Nothing indexed yet — no basis for staleness comparison
	if (totalFiles === 0) {
		const emptyResult: StalenessResult = {
			stale: false,
			staleFiles: 0,
			totalFiles: 0,
			staleRatio: 0,
			lastIndexedAt: null
		};
		if (useCache) {
			stalenessCache.set(repo, { repoPath: resolvedPath, result: emptyResult, cachedAt: Date.now() });
		}
		return emptyResult;
	}

	// Track max last_indexed_at across all files (cheap in-loop, no sort)
	let maxLastIndexedAt: Date | null = null;
	for (const f of existingFiles) {
		const fileTime = f.last_indexed_at ? new Date(f.last_indexed_at) : null;
		if (fileTime && (!maxLastIndexedAt || fileTime > maxLastIndexedAt)) {
			maxLastIndexedAt = fileTime;
		}
	}

	// Async stats with bounded concurrency (chunked — never N parallel stats)
	let staleCount = 0;
	const STAT_CONCURRENCY = 32;
	for (let i = 0; i < existingFiles.length; i += STAT_CONCURRENCY) {
		const chunk = existingFiles.slice(i, i + STAT_CONCURRENCY);
		const outcomes = await Promise.all(
			chunk.map(async (f) => {
				const fullPath = path.join(resolvedPath, f.file_path);
				return isFileStale(f, fullPath);
			})
		);
		for (const stale of outcomes) {
			if (stale) staleCount++;
		}
	}

	const staleRatio = Math.round((staleCount / totalFiles) * 1000) / 1000;
	const lastIndexedAt = maxLastIndexedAt?.toISOString() ?? null;

	const result: StalenessResult = {
		// Mark repo stale only if >= 5% of indexed files have changed
		stale: staleRatio >= 0.05,
		staleFiles: staleCount,
		totalFiles,
		staleRatio,
		lastIndexedAt
	};

	if (useCache) {
		stalenessCache.set(repo, { repoPath: resolvedPath, result, cachedAt: Date.now() });
	}
	return result;
}
