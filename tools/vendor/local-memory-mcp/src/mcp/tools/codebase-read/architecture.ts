import fs from "node:fs";
import path from "node:path";
import type { CodebaseReadInput } from "../schemas/codebase-read";
import { SQLiteStore } from "../../storage/sqlite";
import { createMcpResponse, type McpResponse } from "../../utils/mcp-response";
import { createMcpErrorResponse } from "../../utils/mcp-error";
import {
	buildArchitectureFromData,
	renderDirTree,
	type ArchitectureSymbolData
} from "../../codebase-index/services/architecture-service";
import { analyzeDeadCode, renderDeadCodeText } from "../../codebase-index/services/dead-code";
import { ARCHITECTURE_TOP_LEVEL_EXPORTS_LIMIT } from "../../utils/constants";
import { formatDocComment } from "../../utils/doc-comment-format";

// ── ARCHITECTURE ─────────────────────────────────────────────────────────

/**
 * Resolve an OPTIONAL repoPath for ARCHITECTURE's entry-point exclusion.
 *
 * Unlike CODE mode (where repoPath is REQUIRED and a bad path is a hard
 * error), architecture treats it as an enhancement: an absent path, or one
 * that does not resolve to a directory, degrades to null — entry-point
 * exclusion then falls back to the exported=1 public-API anchor and the
 * coverage note documents the skip. Keeps existing no-repoPath ARCHITECTURE
 * requests 100% non-breaking.
 */
function resolveOptionalRepoPath(raw: string | undefined): string | null {
	const trimmed = raw?.trim();
	if (!trimmed) return null;
	try {
		const resolved = path.resolve(trimmed);
		return fs.statSync(resolved).isDirectory() ? resolved : null;
	} catch {
		return null;
	}
}

async function handleArchitectureMode(validated: CodebaseReadInput, db: SQLiteStore): Promise<McpResponse> {
	const repo = validated.repo;
	if (!repo) {
		return createMcpErrorResponse({
			code: "REPO_REQUIRED",
			message: "Mode 'architecture' requires a concrete 'repo'.",
			retryable: false
		});
	}
	const depth = validated.depth ?? 2;

	const files = db.codebaseFiles.getFilesByRepo(repo);

	// ── Aggregated symbol data (OPT-PERF-08) ─────────────────────────────
	// Symbol data is fully aggregated in SQL — no full-repo symbol hydration.
	// totalSymbols is a cheap COUNT; per-file kind counts come from a GROUP BY
	// (bounded by distinct file×kind pairs); top-level exports are LIMIT-capped.
	const symbolData: ArchitectureSymbolData = {
		totalSymbols: db.codebaseSymbols.getSymbolCountByRepo(repo),
		symbolCountsByFile: new Map<string, Record<string, number>>(),
		topLevelExports: []
	};

	if (validated.includeSymbolCounts) {
		for (const row of db.codebaseSymbols.getSymbolCountsByRepoGrouped(repo)) {
			let kinds = symbolData.symbolCountsByFile.get(row.file_path);
			if (!kinds) {
				kinds = {};
				symbolData.symbolCountsByFile.set(row.file_path, kinds);
			}
			kinds[row.kind] = row.count;
		}
		symbolData.topLevelExports = db.codebaseSymbols.getTopLevelExportsByRepo(
			repo,
			ARCHITECTURE_TOP_LEVEL_EXPORTS_LIMIT
		);
	}

	// ── Dead-code candidates + hotspots (TASK-319) ───────────────────────
	// Bounded compute layer over codebase_references (no schema change).
	// gated on includeSymbolCounts like the other symbol-level blocks.
	const repoPath = resolveOptionalRepoPath(validated.repoPath);
	let deadCode = null;
	if (validated.includeSymbolCounts) {
		deadCode = analyzeDeadCode(db, repo, repoPath, files);
	}

	const result = buildArchitectureFromData(files, symbolData, depth, deadCode ?? undefined);

	const langEntries = Object.entries(result.summary.languageBreakdown);
	let archSummary = `Architecture: ${result.summary.totalFiles} files, ${result.summary.totalSymbols} symbols across ${langEntries.length} languages`;

	if (langEntries.length > 0) {
		archSummary += `\n\n### Languages\n\n`;
		archSummary += langEntries.map(([lang, count]) => `- ${lang}: ${count} files`).join("\n");
	}

	const dirTreeOutput = renderDirTree(result.root, depth);
	archSummary += `\n\n### Project Structure\n\n\`\`\`\n${dirTreeOutput}\n\`\`\``;

	// Surface doc_comment for exported top-level symbols (compact, ~120 chars
	// per the task spec for tree mode). Existing behavior preserved when no doc.
	if (validated.includeSymbolCounts && result.summary.topLevelExports.length > 0) {
		const lines: string[] = [];
		for (const sym of result.summary.topLevelExports) {
			const doc = formatDocComment(sym.doc_comment, 120);
			if (doc) lines.push(`- \`${sym.kind}\` ${sym.name} — ${doc}`);
		}
		if (lines.length > 0) {
			archSummary += `\n\n### Top Exports\n\n${lines.join("\n")}`;
		}
	}

	if (deadCode) {
		archSummary += renderDeadCodeText(deadCode);
	}

	return createMcpResponse(
		{ ...result, schema: "codebase-read", mode: "architecture" },
		`Architecture: ${result.summary.totalFiles} files, ${result.summary.totalSymbols} symbols across ${Object.keys(result.summary.languageBreakdown).length} languages`,
		{ includeJson: validated.json, contentSummary: archSummary }
	);
}

export { handleArchitectureMode };
