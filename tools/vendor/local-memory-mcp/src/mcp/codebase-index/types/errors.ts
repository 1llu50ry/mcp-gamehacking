/**
 * Error types for the codebase indexing pipeline.
 *
 * Classification:
 * - RecoverableError: transient/per-file non-fatal — the operation is
 *   logged and the index continues. Examples: parse timeout, per-file
 *   permission denied, individual parse failure.
 * - FatalError: unrecoverable — the entire index operation must abort.
 *   Examples: WASM init failure, database connection lost.
 */

/** Error severity for structured result reporting. */
export enum ErrorSeverity {
	Recoverable = "RECOVERABLE",
	Fatal = "FATAL"
}

/**
 * A non-fatal error encountered during indexing.
 * The pipeline continues; the error is logged and recorded in the summary.
 */
export class RecoverableError extends Error {
	public readonly type = ErrorSeverity.Recoverable;
	public readonly context: Record<string, unknown>;

	constructor(message: string, context: Record<string, unknown> = {}) {
		super(message);
		this.name = "RecoverableError";
		this.context = context;
	}
}

/**
 * A fatal error that aborts the entire indexing operation.
 * Thrown when a critical resource (WASM, database) is unavailable.
 */
export class FatalError extends Error {
	public readonly type = ErrorSeverity.Fatal;
	public readonly context: Record<string, unknown>;

	constructor(message: string, context: Record<string, unknown> = {}) {
		super(message);
		this.name = "FatalError";
		this.context = context;
	}
}

/** Summary of errors that occurred during an index run. */
export interface ErrorSummary {
	/** Total errors across all categories. */
	total: number;
	/** Errors classified as recoverable (file-level, non-blocking). */
	recoverable: number;
	/** Errors classified as fatal (infrastructure-level, aborting). */
	fatal: number;
	/** Count of timeout failures specifically. */
	timeoutErrors: number;
	/** Count of permission-denied failures specifically. */
	permissionErrors: number;
	/** Count of database write failures. */
	dbWriteErrors: number;
}
