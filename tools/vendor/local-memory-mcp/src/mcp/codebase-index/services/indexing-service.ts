/**
 * CodebaseIndexService — slim orchestrator.
 *
 * Delegates to focused sub-modules:
 *   - indexing-repository.ts — core indexRepository pipeline
 *   - indexing-staleness.ts  — IndexStatus type (canonical)
 *   - indexing-cache.ts      — cache-level utilities (re-exported)
 *
 * Thread safety: the module-level `indexingRepos` set (from indexing-cache)
 * prevents concurrent indexing of the same repo.
 */

import type { SQLiteStore } from "../../storage/sqlite";
import type { ParserPool } from "../parser";

// Import from sub-modules
import { CodebaseIndexServiceImpl, type CodebaseIndexService } from "./indexing-repository";

import { indexingRepos, getLastIndexedAt } from "./indexing-cache";
import { TTL_MS_PER_DAY } from "../../utils/constants";
import { containIndexRepositoryFailure } from "./auto-index-guard";

// ── Re-exports (preserving existing public API) ────────────────────────

export { IndexInProgressError } from "./indexing-repository";
export type {
	CodebaseIndexService,
	IndexOptions,
	IndexProgress,
	IndexResult,
	IndexFileError
} from "./indexing-repository";

export type { StalenessResult } from "./indexing-cache";
export type { IndexStatus } from "./indexing-staleness";

export { clearIndexingRepos } from "./indexing-cache";

// ── AutoIndex types (defined here to avoid circular dep) ───────────────

export interface AutoIndexOptions {
	/** Custom TTL in ms. Overrides CODEBASE_AUTO_INDEX_TTL env var. */
	ttlMs?: number;
	/**
	 * Scope owner forwarded to the codebase→KG enqueue (FIX-OWNER-CODEBASE).
	 * The watcher passes the owner captured at registration; empty/undefined
	 * preserves the historical owner-less behavior.
	 */
	owner?: string;
}

export interface AutoIndexResult {
	status: "started" | "skipped" | "already_indexing";
	reason?: string;
}

// ── Factory ────────────────────────────────────────────────────────────

export function createCodebaseIndexService(db: SQLiteStore, parserPool: ParserPool): CodebaseIndexService {
	return new CodebaseIndexServiceImpl(db, parserPool);
}

// ── Standalone auto-index ──────────────────────────────────────────────

/**
 * Trigger indexing for a repository if the index has never been built or
 * has become stale beyond a configurable TTL.
 *
 * Env vars:
 *   CODEBASE_AUTO_INDEX — set to 'false' to disable auto-indexing
 *   CODEBASE_AUTO_INDEX_TTL — override default 24h TTL in milliseconds
 *
 * @returns 'started' when indexing was triggered, 'skipped' when index is fresh
 *   or auto-index is disabled, 'already_indexing' when indexing is in-flight.
 */
export async function autoIndexIfStale(
	repo: string,
	repoPath: string,
	db: SQLiteStore,
	parserPool: ParserPool,
	options?: AutoIndexOptions
): Promise<AutoIndexResult> {
	// ── Respect CODEBASE_AUTO_INDEX env var ──────────────────────────
	if (process.env.CODEBASE_AUTO_INDEX === "false") {
		return {
			status: "skipped",
			reason: "Auto-index disabled via CODEBASE_AUTO_INDEX env var"
		};
	}

	// ── Thread-safety: prevent duplicate triggers ────────────────────
	if (indexingRepos.has(repo)) {
		return {
			status: "already_indexing",
			reason: `Index already in progress for repo: ${repo}`
		};
	}

	// ── Compute TTL ──────────────────────────────────────────────────
	const defaultTtlMs = TTL_MS_PER_DAY; // 24 hours
	const envTtl = process.env.CODEBASE_AUTO_INDEX_TTL ? parseInt(process.env.CODEBASE_AUTO_INDEX_TTL, 10) : undefined;
	const ttlMs = options?.ttlMs ?? (envTtl && !isNaN(envTtl) ? envTtl : defaultTtlMs);

	// ── Check freshness via a single scalar MAX query ────────────────
	// Avoids loading every file row just to find the newest last_indexed_at —
	// memory O(1). Identical staleness decision to the former per-file scan.
	const lastIndexedAt = getLastIndexedAt(db, repo);
	if (lastIndexedAt !== null) {
		const elapsedMs = Date.now() - new Date(lastIndexedAt).getTime();
		if (elapsedMs < ttlMs) {
			const remainingHrs = Math.round((ttlMs - elapsedMs) / 3600000);
			return {
				status: "skipped",
				reason: `Index is fresh (last indexed ${remainingHrs}h ago, TTL: ${Math.round(ttlMs / 3600000)}h)`
			};
		}
	}

	// ── Trigger background indexing ──────────────────────────────────
	// Fire and forget — don't await the full index (it may take minutes).
	// The module-level `indexingRepos` set prevents concurrent indexing of the same repo.
	//
	// FIX-034: the background run is CONTAINED — a throw (async rejection or a
	// synchronous one from service construction) is logged once per repo and
	// counted, and can never escape into the caller's startup path. See
	// auto-index-guard.ts.
	try {
		const service = createCodebaseIndexService(db, parserPool);
		void containIndexRepositoryFailure(repo, service.indexRepository(repo, repoPath, { owner: options?.owner }));
	} catch (err) {
		containIndexRepositoryFailure(repo, Promise.reject(err));
	}

	return {
		status: "started",
		reason: lastIndexedAt ? "Index TTL expired — re-indexing" : "No existing index — building fresh"
	};
}
