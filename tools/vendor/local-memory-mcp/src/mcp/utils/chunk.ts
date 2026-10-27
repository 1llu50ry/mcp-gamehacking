/**
 * Shared chunking utility (OPT-PERF-11).
 *
 * Every bulk SQL path that binds an `IN (...)` list chunks its inputs at
 * BULK_UPDATE_CHUNK_SIZE (500) — a single un-chunked statement would exceed
 * SQLite's bound-variable limit (~999 default, 32766 with
 * SQLITE_MAX_VARIABLE_NUMBER) and abort with "too many SQL variables"
 * (TASK-139). This helper is the single home of that iteration shape so the
 * 500-chunk invariant lives in one place instead of being re-implemented in
 * every entity loop.
 *
 * Precondition: `size` must be a positive finite number (>= 1; fractional
 * sizes keep today's behavior). A non-positive or non-finite size (0,
 * negative, NaN, Infinity) throws a RangeError instead of looping: with
 * `size = 0` the loop below advances by 0 and pushes empty chunks forever
 * (OOM); a negative size walks the index backwards the same way. Throwing
 * (rather than returning []) is a deliberate fail-fast decision — every
 * caller wraps a bulk SQL write, so a silent no-op on a misconfigured chunk
 * size would drop writes without a trace. The sibling numeric-input utils
 * follow the same contract (pagination.ts invalidPaginationParams).
 */
export function chunksOf<T>(items: readonly T[], size: number): T[][] {
	if (!Number.isFinite(size) || size <= 0) {
		throw new RangeError(`chunksOf: size must be a positive finite number, got ${size}`);
	}

	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
}
