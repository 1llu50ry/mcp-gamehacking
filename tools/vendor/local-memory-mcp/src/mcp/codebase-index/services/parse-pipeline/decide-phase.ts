/**
 * decide-phase — Phase 2 of the incremental parse loop: the SEQUENTIAL decision
 * over one read batch (shared mutable state — never parallelized).
 *
 * Split of the former parse-pipeline.ts monolith (TASK-553). For each file the
 * decision is: fail the read → classify + record the error; checksum matches
 * the existing file (touch-only) → skip; new file whose checksum matches a
 * stale path → rename (mutates `renameMap` + `stalePaths`); otherwise → parse
 * candidate. Only the genuine parse candidates advance to Phase 3, and the
 * checksum skip happens BEFORE parseFile so unchanged files are never handed
 * to tree-sitter (root cause of reindex slowness).
 */

import { logger } from "../../../utils/logger";
import { isPermissionError, isTimeoutError } from "../indexing-cache";
import type { ParseCandidate, PipelineContext, ReadBatchResult } from "./types";

/** Aggregate error counters + candidates produced by one Phase 2 decision. */
export interface BatchDecision {
	candidates: ParseCandidate[];
	failedFiles: number;
	skippedFiles: number;
	skippedByChecksum: number;
	renamedFiles: number;
	permissionErrors: number;
	timeoutErrors: number;
	errors: { filePath: string; error: string }[];
}

/** Build an empty decision accumulator for one batch. */
function emptyDecision(): BatchDecision {
	return {
		candidates: [],
		failedFiles: 0,
		skippedFiles: 0,
		skippedByChecksum: 0,
		renamedFiles: 0,
		permissionErrors: 0,
		timeoutErrors: 0,
		errors: []
	};
}

/**
 * Decide the fate of one read row. Side effects on `ctx` are limited to the
 * rename contract: `renameMap` (new path → old path) and `stalePaths` are
 * mutated here and applied by the orchestrator AFTER the whole pipeline
 * returns, so transferred records are never overwritten by a later parse
 * batch. Returns the row's contribution to the batch decision.
 */
function decideRow(ctx: PipelineContext, row: ReadBatchResult, out: BatchDecision): ParseCandidate | null {
	const { plan, checksum, lineCount, content, error } = row;
	const { repo, existingMap, checksumToOldPaths, stalePaths, renameMap, options } = ctx;

	const recordError = (message: string): void => {
		out.failedFiles++;
		out.errors.push({ filePath: plan.filePath, error: message });
	};

	if (error) {
		recordError(error);
		if (isPermissionError(new Error(error))) {
			out.permissionErrors++;
		} else if (isTimeoutError(new Error(error))) {
			out.timeoutErrors++;
		}
		return null;
	}

	if (checksum === null || content === null) {
		recordError("File read produced no result");
		return null;
	}

	const existing = existingMap.get(plan.filePath);
	const isNewFile = !existing;

	// ── Checksum skip: unchanged (touch-only) — NO parse ──
	if (!options.force && existing && existing.checksum === checksum) {
		out.skippedFiles++;
		out.skippedByChecksum++;
		return null;
	}

	// ── Rename detection ──────────────────────────
	if (isNewFile && checksum) {
		const candidateOldPaths = checksumToOldPaths.get(checksum);
		if (candidateOldPaths) {
			const matchingStalePaths = candidateOldPaths.filter((oldPath) => stalePaths.has(oldPath));
			if (matchingStalePaths.length > 0) {
				const oldPath = matchingStalePaths[0];
				renameMap.set(plan.filePath, oldPath);
				out.renamedFiles++;
				out.skippedFiles++;
				out.skippedByChecksum++;
				stalePaths.delete(oldPath);
				const idx = candidateOldPaths.indexOf(oldPath);
				if (idx >= 0) candidateOldPaths.splice(idx, 1);
				logger.info("[IndexingService] Detected file rename", {
					repo,
					oldPath,
					newPath: plan.filePath,
					checksum: checksum.substring(0, 12)
				});
				return null;
			}
		}
	}

	return { plan, checksum, lineCount, content };
}

/**
 * Phase 2 — decide a whole read batch sequentially. Shared mutable state
 * (rename maps, stale set, counter aggregates) stays in ONE synchronous
 * function so no two batches can interleave decisions on the same maps.
 */
export function decideBatchCandidates(ctx: PipelineContext, rows: ReadBatchResult[]): BatchDecision {
	const out = emptyDecision();
	for (const row of rows) {
		const candidate = decideRow(ctx, row, out);
		if (candidate) out.candidates.push(candidate);
	}
	return out;
}
