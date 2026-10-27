import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/context";
import { ServiceError } from "../lib/jsonApi";
import { handleCodebaseIndexStatus, handleCodebaseIndexRepository } from "../../mcp/tools/codebase-index";
import { handleCodebaseRead } from "../../mcp/tools/codebase.read";
import { autoIndexIfStale } from "../../mcp/codebase-index/services/indexing-service";
import type { ParserPool } from "../../mcp/codebase-index/parser/language-visitor";
import { TreeSitterParserPool } from "../../mcp/codebase-index/parser/parser-pool";
import type { VectorStore } from "../../mcp/types";
import { parseRepoInput } from "../../mcp/utils/normalize";
import { withInjectedOwner } from "../../mcp/utils/owner";
import { buildCodeGraph, getSymbolCallers, readFileContent as readCodebaseFileContent } from "./codebase-graph.service";

// ── Parser pool singleton (lazy, shared across endpoints) ─────────────

let parserPool: ParserPool | null = null;

function getParserPool(): ParserPool {
	if (!parserPool) {
		parserPool = new TreeSitterParserPool();
	}
	return parserPool;
}

// ── No-op vector store (codebase tools don't use vectors) ─────────────

const noopVectors: VectorStore = {
	async upsert(_id: string, _text: string, _kind?: "memory" | "standard") {},
	async remove(_id: string, _kind?: "memory" | "standard") {},
	async search(_query: string, _limit: number, _repo?: string, _kind?: "memory" | "standard") {
		return [];
	}
};

// ── Owner injection ──────────────────────────────────────────────────

/**
 * Injects `owner` into tool handler params when not explicitly provided.
 *
 * The dashboard REST API receives `repo` in `owner/repo` format from the UI,
 * but the MCP tool handler schemas require `owner` as a separate field.
 *
 * Delegates to the shared `withInjectedOwner` helper (single source of truth
 * with the MCP session's owner inference — FIX-OWNER-INFER). Precedence:
 * explicit non-empty `params.owner` → owner segment of an `owner/repo`
 * `params.repo` → git remote origin of the dashboard CWD → params unchanged.
 */
export function injectOwner(params: Record<string, unknown>): Record<string, unknown> {
	if (params.owner && typeof params.owner === "string" && params.owner.length > 0) {
		return params;
	}

	if (!params.repo) return params;

	return withInjectedOwner(params);
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Resolve the filesystem path for a repo when `repoPath` is not provided.
 */
export function resolveRepoPath(repo: string, repoPath?: string): string | null {
	if (repoPath) return repoPath;

	const baseDir = process.env.CODEBASE_REPOS_DIR || path.resolve("..");
	const candidates: string[] = [];

	candidates.push(path.resolve(baseDir, repo));
	const parts = repo.split("/");
	const shortName = parts[parts.length - 1];
	if (shortName !== repo) {
		candidates.push(path.resolve(baseDir, shortName));
	}
	candidates.push(path.resolve(repo));
	candidates.push(path.resolve(shortName));

	for (const candidate of candidates) {
		try {
			if (fs.statSync(candidate).isDirectory()) return candidate;
		} catch {
			// Not found at this path, continue
		}
	}
	return null;
}

/**
 * Maps the MCP codebase tool's documented error codes to HTTP statuses.
 */
export function errorCodeToHttp(code: string): number {
	switch (code) {
		case "PATH_NOT_FOUND":
		case "NOT_A_DIRECTORY":
		case "REPO_PATH_REQUIRED":
		case "REPO_PATH_NOT_FOUND":
		case "REPO_FILES_MISSING":
		case "INVALID_REGEX":
			return 400;
		case "SYMBOL_NOT_FOUND":
		case "FILE_NOT_INDEXED":
		case "REPO_NOT_INDEXED":
			return 404;
		case "AMBIGUOUS_SYMBOL":
			return 409;
		case "INDEX_FAILED":
		case "TRACE_FAILED":
		case "CODE_SEARCH_FAILED":
			return 500;
		default:
			return 500;
	}
}

// ── Service methods ────────────────────────────────────────────────

/**
 * Service layer for codebase business logic.
 *
 * Owns owner injection, path resolution, parser pool management,
 * and MCP tool delegation. Controllers delegate here instead of
 * containing orchestration logic.
 */
export const CodebaseService = {
	async readArchitecture(repo: string, depth?: string, includeSymbolCounts?: string): Promise<unknown> {
		const params: Record<string, unknown> = { repo };
		if (depth !== undefined) params.depth = depth;
		if (includeSymbolCounts !== undefined) params.includeSymbolCounts = includeSymbolCounts;

		const result = await handleCodebaseRead(injectOwner({ ...params, json: true }), db, noopVectors);

		if (!result.structuredContent) {
			throw new ServiceError(500, "Unexpected empty response");
		}
		return result.structuredContent;
	},

	async readFileSymbols(repo: string, filePath: string): Promise<unknown> {
		const result = await handleCodebaseRead(injectOwner({ repo, filePath, json: true }), db, noopVectors);

		if (!result.structuredContent) {
			throw new ServiceError(500, "Unexpected empty response");
		}
		return result.structuredContent;
	},

	async searchSymbols(query: Record<string, unknown>): Promise<unknown> {
		const result = await handleCodebaseRead(injectOwner({ ...query, json: true }), db, noopVectors);

		if (!result.structuredContent) {
			throw new ServiceError(500, "Unexpected empty response");
		}
		return result.structuredContent;
	},

	/**
	 * CODE mode content search (TASK-317). The CODE mode requires an absolute
	 * `repoPath` (the index stores no repo→path registry), which the dashboard
	 * does not know — reuse the same `resolveRepoPath` plumbing as `startIndex`.
	 * Repo path not resolvable ⇒ 400 with re-index guidance.
	 */
	async searchCode(params: Record<string, unknown>): Promise<unknown> {
		const repo = (params.repo as string)?.trim();
		const repoPath = resolveRepoPath(repo, params.repoPath as string | undefined);
		if (!repoPath) {
			throw new ServiceError(
				400,
				`repoPath is required and could not be resolved automatically for "${repo}". ` +
					"Set CODEBASE_REPOS_DIR env var or provide repoPath in the request.",
				"MISSING_REPO_PATH"
			);
		}

		const result = await handleCodebaseRead(injectOwner({ ...params, repoPath, json: true }), db, noopVectors);

		if (!result.structuredContent) {
			throw new ServiceError(500, "Unexpected empty response");
		}
		return result.structuredContent;
	},

	async traceSymbol(name: string, repo?: string, includeReferences?: string): Promise<unknown> {
		const params: Record<string, unknown> = { name };
		if (repo !== undefined) params.repo = repo.trim();
		if (includeReferences !== undefined) params.includeReferences = includeReferences;

		const result = await handleCodebaseRead(injectOwner({ ...params, json: true }), db, noopVectors);

		if (!result.structuredContent) {
			throw new ServiceError(500, "Unexpected empty response");
		}
		return result.structuredContent;
	},

	/**
	 * File-content endpoint (TASK-324 CG-B). Resolves the repo root via
	 * resolveRepoPath, then delegates the (traversal-guarded) disk read to the
	 * graph service. `repoPath` is optional — auto-resolution covers
	 * CODEBASE_REPOS_DIR and CWD-relative layouts, exactly like `startIndex`.
	 */
	async readFileContent(repo: string, filePath: string, repoPath?: string): Promise<unknown> {
		const root = resolveRepoPath(repo, repoPath);
		if (!root) {
			throw new ServiceError(
				400,
				`repoPath is required and could not be resolved automatically for "${repo}". ` +
					"Set CODEBASE_REPOS_DIR env var or provide repoPath in the request.",
				"MISSING_REPO_PATH"
			);
		}
		// DB lookups + cache keys use the short repo name (schema-normalized);
		// path resolution uses the raw `repo` (directory-name candidate).
		return readCodebaseFileContent(root, parseRepoInput(repo).repo, filePath);
	},

	/**
	 * Caller/callee pairs for a symbol (CallGraph DAG data, TASK-324).
	 * Optional `filePath` disambiguates duplicate symbol names (TASK-373).
	 */
	async symbolCallers(repo: string, name: string, kind?: string, filePath?: string): Promise<unknown> {
		return getSymbolCallers(parseRepoInput(repo).repo, name, kind, filePath);
	},

	/** Code-graph nodes/edges for KGGraphCanvas (TASK-324). */
	async codeGraph(repo: string, limit?: string, kind?: string): Promise<unknown> {
		return buildCodeGraph(parseRepoInput(repo).repo, limit, kind);
	},

	async getIndexStatus(repo: string): Promise<unknown> {
		const result = await handleCodebaseIndexStatus(injectOwner({ repo }), db, noopVectors);

		if (!result.structuredContent) {
			throw new ServiceError(500, "Unexpected empty response");
		}
		return result.structuredContent;
	},

	async startIndex(
		repo: string,
		repoPath: string,
		force?: boolean,
		includeGlobs?: string[],
		excludeGlobs?: string[]
	): Promise<unknown> {
		const resolvedPath = resolveRepoPath(repo, repoPath);
		if (!resolvedPath) {
			throw new ServiceError(
				400,
				`repoPath is required and could not be resolved automatically for "${repo}". ` +
					"Set CODEBASE_REPOS_DIR env var or provide repoPath in the request body.",
				"MISSING_REPO_PATH"
			);
		}

		const params: Record<string, unknown> = { repo, repoPath: resolvedPath };
		if (force !== undefined) params.force = force;
		if (includeGlobs !== undefined) params.includeGlobs = includeGlobs;
		if (excludeGlobs !== undefined) params.excludeGlobs = excludeGlobs;

		const result = await handleCodebaseIndexRepository(injectOwner(params), db, noopVectors);

		if (!result.structuredContent) {
			throw new ServiceError(500, "Unexpected empty response");
		}
		return result.structuredContent;
	},

	async autoIndex(repo: string, repoPath?: string): Promise<{ status: string; reason: string }> {
		const resolvedPath = resolveRepoPath(repo, repoPath);
		if (!resolvedPath) {
			throw new ServiceError(400, `repoPath is required and could not be resolved automatically for "${repo}"`);
		}

		const pool = getParserPool();
		const result = await autoIndexIfStale(repo, resolvedPath, db, pool);

		return {
			status: result.status,
			reason: result.reason ?? ""
		};
	}
};
