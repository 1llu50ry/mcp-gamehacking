/**
 * parse-pipeline constants — shared parse-loop bounds + canonical error strings.
 *
 * Split of the former parse-pipeline.ts monolith (TASK-553). The max-file and
 * no-result bounds below were previously inline literals repeated at each
 * guard site; centralizing them removes duplication AND keeps the error text
 * asserted by consumers identical across batches.
 */

/** A single parse-candidate plan (plans that passed the mtime pre-filter). */
export type ParseTask = Extract<FilePlan, { action: "parse" }>;

/**
 * Hard ceiling for a single indexed file (10MB). Larger files are rejected
 * during Phase 1 (read) so an oversized buffer is never handed to tree-sitter.
 */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/** Canonical rejection message for files above {@link MAX_FILE_SIZE_BYTES}. */
export const MAX_FILE_SIZE_ERROR = (sizeBytes: number): string =>
	`File exceeds max size (${sizeBytes} bytes > ${MAX_FILE_SIZE_BYTES} bytes)`;

/** Canonical guard message when a read or parse settles without a result. */
export const PARSE_NO_RESULT_ERROR = "Parse produced no result";

import type { FilePlan } from "../indexing-cache";
