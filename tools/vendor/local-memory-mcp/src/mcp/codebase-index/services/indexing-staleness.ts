/**
 * indexing-staleness — canonical IndexStatus type + StalenessResult re-export.
 *
 * checkStaleness() and getIndexStatus() were removed (TASK-114) — superseded
 * by the CodebaseIndexServiceImpl methods in indexing-repository.ts
 * (indexRepository/checkStaleness/getIndexStatus).
 *
 * IndexProgress is imported from indexing-writer.ts (canonical location) to
 * keep the IndexStatus interface in sync — the local duplicate copy was
 * removed (zero consumers).
 *
 * Does NOT import from indexing-service.ts (no circular dependency).
 */

import type { IndexProgress } from "./indexing-writer";

// Re-export for consumers (also re-exported by indexing-service)
export type { StalenessResult } from "./indexing-cache";

// ── IndexStatus interface ──────────────────────────────────────────────

export interface IndexStatus {
	repo: string;
	isIndexed: boolean;
	isIndexing: boolean;
	lastIndexedAt: string | null;
	totalFiles: number;
	totalSymbols: number;
	progress: IndexProgress | null;
	/** Whether the index has become stale (>= 5% of files changed since last index). Only set when repoPath is provided. */
	stale?: boolean;
	/** Ratio of stale files to total indexed files (0-1). Only set when repoPath is provided. */
	staleRatio?: number;
}
