import { z } from "zod";
import { normalizeRepo } from "../../utils/normalize";

/**
 * Unified codebase-index schema (replaces index_repository / index_status).
 *
 * Auto-infer rules (ADR-005):
 *   `repoPath` + `repo` → INDEX (tree-sitter scan)
 *   `repo` alone        → STATUS (freshness + count)
 *
 * Single source of truth for the `codebase-index` tool contract — the tool
 * definition derives its `inputSchema` from this schema (see
 * `definitions/codebase-index.ts`), and the handler in `codebase-index-sdk.ts`
 * imports it for runtime validation.
 */
export const CodebaseIndexSchema = z.object({
	owner: z.string().min(1).optional(),
	repo: z.string().min(1).transform(normalizeRepo),
	repoPath: z.string().optional(),
	warmup: z.boolean().optional(),
	force: z.boolean().optional(),
	includeGlobs: z.array(z.string()).optional(),
	excludeGlobs: z.array(z.string()).optional()
});

export const IndexRepoSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	repoPath: z.string().min(1, "repoPath is required"),
	force: z.boolean().optional(),
	includeGlobs: z.array(z.string()).optional(),
	excludeGlobs: z.array(z.string()).optional()
});

export const IndexStatusSchema = z.object({
	owner: z.string().min(1),
	repo: z.string().min(1).transform(normalizeRepo),
	repoPath: z.string().optional()
});
