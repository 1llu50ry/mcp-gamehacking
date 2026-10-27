/**
 * parse-pipeline orchestrator — assembles the incremental 3-phase parse loop
 * from the stage modules (read-phase → decide-phase → batch-persist).
 *
 * Split of the former parse-pipeline.ts monolith (TASK-553). Public contract is
 * unchanged: {@link runParsePipeline} mutates `renameMap` (new path → old
 * path) and `stalePaths` (paths no longer on disk) as renames are detected;
 * the caller applies renames and stale cleanup AFTER the pipeline returns so
 * transferred records are never overwritten by a later parse batch.
 *
 * Phase 1: concurrent immutable reads + checksums (NO parse)
 * Phase 2: sequential decision — checksum skip (touch-only), rename detection
 * Phase 3: parse ONLY changed/new candidates, bounded by the parser semaphore
 *
 * Per-batch DB flush and progress emission happen inside the batch loop so
 * memory stays bounded (Fix #3) and the orchestrator stays a thin coordinator.
 */

import type { ParserPool } from "../../parser";
import { ImportResolver, buildImportResolver } from "../../parser/import-resolution";
import { ReexportResolver, buildReexportResolverContext } from "../../parser/reexport-resolution";
import { resolveConcurrency } from "../../parser/worker-pool";
import type { SQLiteStore } from "../../../storage/sqlite";
import { type FilePlan } from "../indexing-cache";
import { readBatchFiles } from "./read-phase";
import { decideBatchCandidates } from "./decide-phase";
import { emptyInsertBatch, persistParseBatch } from "./batch-persist";
import type {
	PipelineContext,
	PipelineRun,
	ExistingFileEntry,
	IndexProgress,
	ParsePipelineOptions,
	ParsePipelineResult
} from "./types";

/** A parse-candidate plan (plans that passed the mtime pre-filter). */
type ParseTask = Extract<FilePlan, { action: "parse" }>;

export type {
	ExistingFileEntry,
	IndexFileError,
	IndexProgress,
	ParsePipelineOptions,
	ParsePipelineResult
} from "./types";

/**
 * Run the 3-phase parse loop over the given parse tasks.
 *
 * @returns Aggregate counters + per-file errors for the orchestrator's report.
 */
export async function runParsePipeline(
	db: SQLiteStore,
	parserPool: ParserPool,
	repo: string,
	parseTasks: ParseTask[],
	existingMap: Map<string, ExistingFileEntry>,
	checksumToOldPaths: Map<string, string[]>,
	renameMap: Map<string, string>,
	stalePaths: Set<string>,
	options: ParsePipelineOptions = {}
): Promise<ParsePipelineResult> {
	const resolvers = buildResolvers(db, repo, options);
	const context: PipelineContext = {
		db,
		parserPool,
		repo,
		owner: options.owner,
		existingMap,
		checksumToOldPaths,
		renameMap,
		stalePaths,
		options,
		reexportResolver: resolvers.reexportResolver,
		importResolver: resolvers.importResolver
	};
	const run = createRun();

	emitProgress(options, {
		stage: "parsing",
		current: 0,
		total: parseTasks.length,
		message: `Parsing ${parseTasks.length} files concurrently...`
	});

	// Parse batch = parser semaphore concurrency (Fix #3b): at most this
	// many up-to-10MB file buffers can be in flight at once, so queued
	// buffers can't pile up and blow the heap.
	const CONCURRENT_PARSE_BATCH = Math.max(1, resolveConcurrency());
	const batch = emptyInsertBatch();

	for (let i = 0; i < parseTasks.length; i += CONCURRENT_PARSE_BATCH) {
		const plans = parseTasks.slice(i, i + CONCURRENT_PARSE_BATCH);

		// ── Phase 1: concurrent immutable reads + checksums (NO parse) ──
		// The checksum skip must happen BEFORE parseFile so unchanged files
		// are never handed to tree-sitter (root cause of reindex slowness).
		const reads = await readBatchFiles(plans);

		// ── Phase 2: sequential decision (shared state) ──
		// Skip unchanged by checksum (touch-only), detect renames, and
		// collect only the files that genuinely need parsing.
		const decision = decideBatchCandidates(context, reads);
		run.failedFiles += decision.failedFiles;
		run.skippedFiles += decision.skippedFiles;
		run.skippedByChecksum += decision.skippedByChecksum;
		run.renamedFiles += decision.renamedFiles;
		run.permissionErrors += decision.permissionErrors;
		run.timeoutErrors += decision.timeoutErrors;
		run.errors.push(...decision.errors);
		run.processedSoFar += decision.failedFiles + decision.skippedFiles;

		// ── Phase 3: parse + persist ONLY candidates, bounded by concurrency ──
		await persistParseBatch(context, decision.candidates, run, batch);

		emitProgress(options, {
			stage: "parsing",
			current: run.processedSoFar,
			total: parseTasks.length,
			message: `Parsed ${run.processedSoFar}/${parseTasks.length} files...`
		});
	}

	return {
		parsedFiles: run.parsedFiles,
		skippedFiles: run.skippedFiles,
		failedFiles: run.failedFiles,
		skippedByChecksum: run.skippedByChecksum,
		renamedFiles: run.renamedFiles,
		totalSymbols: run.totalSymbols,
		timeoutErrors: run.timeoutErrors,
		permissionErrors: run.permissionErrors,
		dbWriteErrors: run.dbWriteErrors,
		expectedParseErrors: run.expectedParseErrors,
		semanticEnriched: run.semanticEnriched,
		errors: run.errors
	};
}

// ── Helper ────────────────────────────────────────────────────────────────

/** Fresh per-run aggregate counters + error list. */
function createRun(): PipelineRun {
	return {
		processedSoFar: 0,
		parsedFiles: 0,
		skippedFiles: 0,
		failedFiles: 0,
		skippedByChecksum: 0,
		renamedFiles: 0,
		totalSymbols: 0,
		timeoutErrors: 0,
		permissionErrors: 0,
		dbWriteErrors: 0,
		expectedParseErrors: 0,
		semanticEnriched: 0,
		errors: []
	};
}

/**
 * Build the re-export + import resolvers ONCE from the repo's already-indexed
 * surface (issue #87 re-export chains; issue #83 / FIX-83 import targets). The
 * lookup inputs (indexed files + symbols grouped by file) are shared, so both
 * resolvers load the DB surface a single time per pipeline run.
 *
 * Re-indexes resolve canonical targets correctly; a first-time index (empty
 * DB) yields null targets (graceful, matching the #83 stance). Import
 * resolution is ON by default (acceptance: new indexes populate import
 * targets) — pass `resolveImports: false` to persist raw import rows.
 * Re-export resolution stays opt-in via `resolveReexports`.
 */
function buildResolvers(
	db: SQLiteStore,
	repo: string,
	options: ParsePipelineOptions
): { reexportResolver: ReexportResolver | null; importResolver: ImportResolver | null } {
	const resolveReexports = options.resolveReexports === true;
	const resolveImports = options.resolveImports !== false;
	let reexportResolver: ReexportResolver | null = null;
	let importResolver: ImportResolver | null = null;
	if (resolveReexports || resolveImports) {
		const indexedFiles = new Set(db.codebaseFiles.getFilesByRepo(repo).map((f) => f.file_path));
		const symbols = db.codebaseSymbols.getSymbolsByRepo(repo);
		if (resolveImports) importResolver = buildImportResolver(symbols, indexedFiles);
		if (resolveReexports) {
			const reexportRefs = db.codebaseReferences.getReferencesByRepo(repo, ["reexport"]);
			reexportResolver = new ReexportResolver(buildReexportResolverContext(reexportRefs, symbols, indexedFiles));
		}
	}
	return { reexportResolver, importResolver };
}

/** Emit a progress event — the callback must never kill the pipeline. */
export function emitProgress(options: ParsePipelineOptions, progress: IndexProgress): void {
	if (options.onProgress) {
		try {
			options.onProgress(progress);
		} catch {
			// Progress callback must never kill the indexing pipeline
		}
	}
}
