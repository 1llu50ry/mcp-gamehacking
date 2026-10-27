/**
 * batch-persist — Phase 3 of the parse pipeline: parse one batch's candidates
 * concurrently, classify every outcome, and flush the accumulated rows through
 * the indexing writer (bounded memory — Fix #3a/#3b).
 *
 * Split of the former parse-pipeline.ts monolith (TASK-553). The orchestrator
 * bounds the candidate batch to the parser-semaphore concurrency and hands it
 * here; inserts accumulate per batch and are flushed to `writeParseBatch` so
 * the repository never accumulates inserts for the whole repo in memory. The
 * write-batch call is ALSO the codebase → KG outbox funnel (TASK-293): one
 * `codebase_symbol` queue job is enqueued per re-parsed file, atomically with
 * the symbol replace. DB-write failures are surfaced as a counter delta,
 * never thrown.
 *
 * Renames never reach this module (they are skipped at decision time — the
 * orchestrator applies the rename transfers AFTER the whole pipeline), but the
 * accumulated rename map is still forwarded to the writer flush so its
 * defensive reindexed-path exclusion and storing-progress totals see the same
 * values the monolithic pipeline passed.
 */

import { logger } from "../../../utils/logger";
import { isPermissionError, isTimeoutError } from "../indexing-cache";
import { DEFAULT_BATCH_SIZE } from "../../../utils/constants";
import { writeParseBatch } from "../indexing-writer";
import { PARSE_NO_RESULT_ERROR } from "./constants";
import { isExpectedParseError, TREE_SITTER_PARSE_ERROR } from "../../parser/parse-error-classifier";
import type { PipelineContext, ParseCandidate, PipelineRun, InsertBatch } from "./types";
import { enrichParsedOutcome } from "./enrich-parse";

/** Batch-scoped insert arrays, reset after every flush (bounded memory). */
export function emptyInsertBatch(): InsertBatch {
	return { fileInserts: [], symbolInserts: [], referenceInserts: [] };
}

/** Parse one candidate safely — parse failures are captured, never thrown. */
async function parseCandidate(ctx: PipelineContext, candidate: ParseCandidate) {
	try {
		const parseResult = await ctx.parserPool.parseFile(candidate.plan.filePath, candidate.content);
		return {
			plan: candidate.plan,
			checksum: candidate.checksum,
			lineCount: candidate.lineCount,
			content: candidate.content,
			parseResult,
			error: null as string | null
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			plan: candidate.plan,
			checksum: candidate.checksum,
			lineCount: candidate.lineCount,
			content: candidate.content,
			parseResult: null,
			error: message
		};
	}
}

/**
 * Persist ONE parse batch. Never throws: per-file parse failures are recorded
 * on `run`, and DB-write failures surface as `run.dbWriteErrors` deltas.
 */
export async function persistParseBatch(
	ctx: PipelineContext,
	candidates: ParseCandidate[],
	run: PipelineRun,
	batch: InsertBatch
): Promise<void> {
	if (candidates.length === 0) return;

	// ── Parse ONLY candidates, bounded by semaphore concurrency (Fix #3b) ──
	const outcomes = await Promise.all(candidates.map((candidate) => parseCandidate(ctx, candidate)));

	for (const outcome of outcomes) {
		// Parse threw (permission/timeout/IO) — record + classify, no persistence.
		if (outcome.error !== null) {
			run.failedFiles++;
			run.processedSoFar++;
			run.errors.push({ filePath: outcome.plan.filePath, error: outcome.error });
			if (isPermissionError(new Error(outcome.error))) {
				run.permissionErrors++;
			} else if (isTimeoutError(new Error(outcome.error))) {
				run.timeoutErrors++;
			}
			continue;
		}

		// Defensive guard: ParserPool.parseFile always resolves a ParseResult
		// (errors are captured in .error), so this is unreachable in practice —
		// but keeps invariants explicit.
		if (outcome.parseResult === null) {
			run.failedFiles++;
			run.processedSoFar++;
			run.errors.push({ filePath: outcome.plan.filePath, error: PARSE_NO_RESULT_ERROR });
			continue;
		}

		const parseError = outcome.parseResult.error;
		if (parseError) {
			// Expected partial-parse noise (JSX in a plain-JS file, generated or
			// minified artifacts) is downgraded to debug and NOT counted as a
			// failure: the visitor already extracted partial symbols and the
			// error is a deterministic extension/grammar mismatch, not a data
			// problem (FIX-030). Only the canonical tree-sitter partial-results
			// sentinel is eligible — timeouts, permission failures and
			// unsupported-extension rejections always stay real.
			if (parseError === TREE_SITTER_PARSE_ERROR && isExpectedParseError(outcome.plan.filePath, outcome.content)) {
				run.expectedParseErrors++;
				logger.debug("[IndexingService] Expected parse error — partial results indexed", {
					repo: ctx.repo,
					filePath: outcome.plan.filePath,
					error: parseError
				});
			} else {
				run.failedFiles++;
				run.errors.push({ filePath: outcome.plan.filePath, error: parseError });
				if (/timeout/i.test(parseError)) {
					run.timeoutErrors++;
					logger.warn("[IndexingService] Parse timeout — skipped", {
						repo: ctx.repo,
						filePath: outcome.plan.filePath,
						error: parseError
					});
				} else {
					logger.warn("[IndexingService] Parse error", {
						repo: ctx.repo,
						filePath: outcome.plan.filePath,
						error: parseError
					});
				}
			}
			// Fall through: the visitor may have captured partial symbols
			// before erroring — persist what was produced (matches the
			// monolith, which only incremented parsedFiles on full success).
		} else {
			run.parsedFiles++;
		}

		const { resolved, symbolRows, referenceInserts, fileInsert } = await enrichParsedOutcome(ctx, outcome);
		run.totalSymbols += symbolRows.length;
		run.semanticEnriched += resolved.semanticEnriched;
		batch.fileInserts.push(fileInsert);
		batch.symbolInserts.push(...symbolRows);
		batch.referenceInserts.push(...referenceInserts);
		run.processedSoFar++;
	}

	// ── Flush this batch's inserts (bounded memory — Fix #3a) ──
	if (batch.fileInserts.length > 0) {
		run.dbWriteErrors += await writeParseBatch(
			{
				db: ctx.db,
				repo: ctx.repo,
				owner: ctx.owner,
				batchSize: ctx.options.batchSize ?? DEFAULT_BATCH_SIZE,
				options: ctx.options
			},
			batch.fileInserts,
			batch.symbolInserts,
			ctx.renameMap,
			batch.referenceInserts
		);
		batch.fileInserts = [];
		batch.symbolInserts = [];
		batch.referenceInserts = [];
	}
}
