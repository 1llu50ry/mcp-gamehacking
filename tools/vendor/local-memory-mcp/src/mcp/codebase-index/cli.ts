/**
 * CLI interface for triggering codebase indexing on startup.
 *
 * Activated by passing `--index` to the MCP server entry point.
 * Before the MCP stdio server starts listening, the index pipeline
 * runs and the process exits with a status code.
 *
 * Usage:
 *   mcp-memory-server --index --repo owner/repo --path /absolute/path \
 *     --include "src/**&#47;*.ts" --exclude "**&#47;*.test.ts"
 *
 * Multiple --include/--exclude flags are accumulated.
 */

import process from "node:process";
import { performance } from "node:perf_hooks";
import { SQLiteStore } from "../storage/sqlite";
import { TreeSitterParserPool } from "./parser/parser-pool";
import { createCodebaseIndexService } from "./services/indexing-service";
import type { IndexResult } from "./services/indexing-service";

// ── Argument types ────────────────────────────────────────────────────

export interface CliIndexArgs {
	repo: string;
	path: string;
	includeGlobs: string[];
	excludeGlobs: string[];
}

type ParseResult = CliIndexArgs | { error: string };

// ── Argument parsing ──────────────────────────────────────────────────

/**
 * Parse CLI arguments for the --index mode.
 *
 * @param argv - Array of CLI arguments (typically `process.argv`).
 * @returns Either a parsed CliIndexArgs or an error message string.
 *
 * Required:
 *   --repo owner/repo   Repository identifier
 *   --path path         Absolute filesystem path to index
 *
 * Optional (repeatable):
 *   --include glob      Include glob pattern
 *   --exclude glob      Exclude glob pattern
 */
export function parseIndexArgs(argv: string[]): ParseResult {
	const repoIdx = argv.indexOf("--repo");
	const pathIdx = argv.indexOf("--path");

	if (repoIdx === -1) return { error: "Missing required argument: --repo <owner/repo>" };
	if (pathIdx === -1) return { error: "Missing required argument: --path <absolute-path>" };

	const repo = argv[repoIdx + 1];
	const repoPath = argv[pathIdx + 1];

	if (!repo || repo.startsWith("-")) return { error: "--repo requires a value (e.g. --repo owner/repo)" };
	if (!repoPath || repoPath.startsWith("-")) return { error: "--path requires a value (e.g. --path /absolute/path)" };

	const includeGlobs: string[] = [];
	const excludeGlobs: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--include" && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
			includeGlobs.push(argv[i + 1]);
			i++;
		} else if (argv[i] === "--exclude" && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
			excludeGlobs.push(argv[i + 1]);
			i++;
		}
	}

	return { repo, path: repoPath, includeGlobs, excludeGlobs };
}

// ── Logging ───────────────────────────────────────────────────────────

function log(message: string): void {
	const ts = new Date().toISOString();
	process.stderr.write(`[${ts}] ${message}\n`);
}

// ── Index runner ──────────────────────────────────────────────────────

/**
 * Run the full indexing pipeline from CLI arguments.
 *
 * Parses `process.argv`, creates storage and parser instances,
 * runs `indexRepository`, prints a summary to stderr, and exits
 * with code 0 (success) or 1 (failure).
 *
 * This function always calls `process.exit` — it never returns normally.
 */
export async function runCliIndex(): Promise<void> {
	const parseResult = parseIndexArgs(process.argv);

	if ("error" in parseResult) {
		log(`Error: ${parseResult.error}`);
		process.exit(1);
	}

	const { repo, path: repoPath, includeGlobs, excludeGlobs } = parseResult;

	log(`Indexing repo "${repo}" at "${repoPath}"`);
	if (includeGlobs.length > 0) log(`  Include globs: ${includeGlobs.join(", ")}`);
	if (excludeGlobs.length > 0) log(`  Exclude globs: ${excludeGlobs.join(", ")}`);

	let db: SQLiteStore | null = null;

	try {
		db = await SQLiteStore.create();
		log(`Database: ${db.getDbPath()}`);

		log("Initializing parser pool (tree-sitter WASM)...");
		const parserPool = new TreeSitterParserPool();
		await parserPool.initialize();
		log("Parser pool ready.");

		const indexService = createCodebaseIndexService(db, parserPool);
		const startTime = performance.now();

		const result: IndexResult = await indexService.indexRepository(repo, repoPath, {
			includeGlobs: includeGlobs.length > 0 ? includeGlobs : undefined,
			excludeGlobs: excludeGlobs.length > 0 ? excludeGlobs : undefined,
			onProgress: (progress) => {
				const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
				log(`[${progress.stage}] ${progress.message} (${progress.current}/${progress.total}) [${elapsed}s]`);
			}
		});

		const durationSec = (result.durationMs / 1000).toFixed(2);

		log("");
		log("── Indexing complete ──");
		log(`  Total files:   ${result.totalFiles}`);
		log(`  Parsed:        ${result.parsedFiles}`);
		log(`  Skipped:       ${result.skippedFiles}`);
		log(`  Failed:        ${result.failedFiles}`);
		if (result.expectedParseErrors > 0) {
			log(`  Expected parse errors (downgraded): ${result.expectedParseErrors}`);
		}
		log(`  Total symbols: ${result.totalSymbols}`);
		log(`  Duration:      ${durationSec}s`);

		if (result.errors.length > 0) {
			log(`  Errors:        ${result.errors.length}`);
			for (const err of result.errors.slice(0, 5)) {
				log(`    • ${err.filePath}: ${err.error}`);
			}
			if (result.errors.length > 5) {
				log(`    ... and ${result.errors.length - 5} more`);
			}
		}

		log(`\nIndexed ${result.totalSymbols} symbols across ${result.parsedFiles} files in ${durationSec}s`);

		if (!result.success) {
			log("Indexing failed catastrophically.");
			process.exit(1);
		}

		process.exit(0);
	} catch (err) {
		log(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
		if (err instanceof Error && err.stack) {
			log(`Stack: ${err.stack}`);
		}
		process.exit(1);
	} finally {
		db?.close();
	}
}
