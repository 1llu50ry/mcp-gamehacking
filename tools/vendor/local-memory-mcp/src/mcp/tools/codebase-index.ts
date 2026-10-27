import fs from "node:fs";
import path from "node:path";
import { IndexRepoSchema, IndexStatusSchema } from "./schemas/index";
import { SQLiteStore } from "../storage/sqlite";
import { VectorStore } from "../types";
import { createMcpResponse, McpResponse } from "../utils/mcp-response";
import { createMcpErrorResponse } from "../utils/mcp-error";
import { createCodebaseIndexService } from "../codebase-index/services/indexing-service";
import { getCodebaseParserPool } from "../codebase-index/parser/singleton";
import { registerRepo } from "../codebase-index/services/file-watcher";
import { logger } from "../utils/logger";
import { getRuntimeCapabilities } from "../runtime-capabilities";

// ── Handlers ────────────────────────────────────────────────────────────

export async function handleCodebaseIndexRepository(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = IndexRepoSchema.parse(params);

	const repo = validated.repo.trim();
	const resolvedPath = path.resolve(validated.repoPath.trim());

	// Validate path exists and is a directory
	let stat: fs.Stats;
	try {
		stat = fs.statSync(resolvedPath);
	} catch {
		return createMcpErrorResponse({
			code: "PATH_NOT_FOUND",
			message: `Repository path not found: ${resolvedPath}`,
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

	const pool = getCodebaseParserPool();
	const service = createCodebaseIndexService(db, pool);

	try {
		const result = await service.indexRepository(repo, resolvedPath, {
			owner: validated.owner,
			force: validated.force,
			includeGlobs: validated.includeGlobs,
			excludeGlobs: validated.excludeGlobs
		});

		// Register with the polling file watcher (TASK-322 / US-08) so the
		// repo stays fresh after this build. Idempotent; in the dashboard
		// process (which imports this handler too) the entry is a harmless
		// no-op — the watcher loop only runs in the MCP server process.
		// The owner is captured so watcher-triggered re-indexes keep the
		// codebase→KG enqueue scoped (FIX-OWNER-CODEBASE).
		registerRepo(repo, resolvedPath, validated.owner);
		const capabilities = getRuntimeCapabilities();
		capabilities.markReady("indexing");
		void capabilities.ensure("watcher");

		const errorLines =
			result.errors.length > 0
				? `\nErrors:\n${result.errors.map((err) => `- ${err.filePath}: ${err.error}`).join("\n")}`
				: "";
		const contentSummary = `Indexed ${repo}: ${result.totalSymbols} symbols across ${result.totalFiles} files in ${result.durationMs}ms\nParsed: ${result.parsedFiles} | Skipped: ${result.skippedFiles} | Errors: ${result.failedFiles}${errorLines}`;

		return createMcpResponse(
			result,
			`Indexed ${result.totalSymbols} symbols across ${result.totalFiles} files in ${result.durationMs}ms.`,
			{ includeJson: true, contentSummary }
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("[handleCodebaseIndexRepository] Index failed", { repo, error: message });
		return createMcpErrorResponse({
			code: "INDEX_FAILED",
			message: `Index failed for ${repo}`,
			retryable: true
		});
	}
}

export async function handleCodebaseIndexStatus(
	params: Record<string, unknown>,
	db: SQLiteStore,
	_vectors: VectorStore
): Promise<McpResponse> {
	const validated = IndexStatusSchema.parse(params);
	const repo = validated.repo.trim();
	const repoPath = validated.repoPath?.trim();

	const service = createCodebaseIndexService(db, getCodebaseParserPool());
	const status = await service.getIndexStatus(repo, repoPath);
	const runtime = getRuntimeCapabilities().snapshot();

	// Build key-value detail output
	const lines: string[] = [];
	lines.push(`## Index Status: ${repo}`);
	lines.push(``);
	lines.push(`Indexed: ${status.isIndexed ? "✅ Yes" : "❌ No"}`);
	lines.push(`Files: ${status.totalFiles}`);
	lines.push(`Symbols: ${status.totalSymbols}`);

	if (status.lastIndexedAt) {
		const date = new Date(status.lastIndexedAt);
		lines.push(`Last Indexed: ${date.toLocaleString()}`);
	}

	if (status.isIndexing) {
		const p = status.progress;
		if (p) {
			lines.push(`Indexing: 🔄 ${p.stage} (${p.current}/${p.total})`);
		} else {
			lines.push(`Indexing: 🔄 In progress...`);
		}
	}

	if (status.stale !== undefined && status.lastIndexedAt) {
		if (status.stale) {
			lines.push(`Staleness: ⚠️ STALE — ${Math.round((status.staleRatio ?? 0) * 100)}% of files changed`);
		} else {
			lines.push(`Staleness: ✅ Up to date`);
		}
	}

	const summary = lines.join("\n");

	return createMcpResponse({ ...status, runtime }, summary, {
		includeJson: true
	});
}
