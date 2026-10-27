/**
 * read-phase — Phase 1 of the incremental parse loop: concurrent immutable
 * reads + checksums (NO parse), bounded to one batch at a time.
 *
 * Split of the former parse-pipeline.ts monolith (TASK-553). A batch of parse
 * plans is read with `fs.promises.readFile`, checksummed and line-counted in
 * parallel. Files over {@link MAX_FILE_SIZE_BYTES} are rejected up front so an
 * oversized buffer is never handed to tree-sitter; per-file read errors are
 * captured (never thrown) and classified downstream.
 */

import fs from "node:fs";
import { computeChecksum, countLines } from "../indexing-cache";
import { MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_ERROR, type ParseTask } from "./constants";
import type { ReadBatchResult } from "./types";

/**
 * Read one parse plan's content from disk, returning a flat result row.
 * Never throws — read/checksum failures are captured in `error` for the
 * sequential Phase 2 decision loop to classify (permission/timeout/other).
 */
async function readOne(plan: ParseTask): Promise<ReadBatchResult> {
	if (plan.sizeBytes > MAX_FILE_SIZE_BYTES) {
		return {
			plan,
			checksum: null,
			lineCount: 0,
			content: null,
			error: MAX_FILE_SIZE_ERROR(plan.sizeBytes)
		};
	}
	try {
		const content = await fs.promises.readFile(plan.absolutePath, "utf-8");
		return {
			plan,
			checksum: computeChecksum(content),
			lineCount: countLines(content),
			content,
			error: null
		};
	} catch (err) {
		return {
			plan,
			checksum: null,
			lineCount: 0,
			content: null,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}

/**
 * Phase 1 — read a batch of parse plans concurrently. Each plan resolves to a
 * flat result row; the caller (orchestrator loop) feeds the rows to the
 * sequential Phase 2 decision. Concurrency equals the batch size, which the
 * caller bounds so queued buffers cannot pile up and blow the heap (Fix #3b).
 */
export async function readBatchFiles(plans: ParseTask[]): Promise<ReadBatchResult[]> {
	return Promise.all(plans.map((plan) => readOne(plan)));
}
