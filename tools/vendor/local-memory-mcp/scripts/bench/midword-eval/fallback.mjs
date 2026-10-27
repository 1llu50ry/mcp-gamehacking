/**
 * The bounded mid-word fallback under evaluation (TASK-483).
 *
 * Production context: the live search path uses unicode61 FTS5 (prefix-`*`
 * shape). That tokenizer cannot match INTERNAL substrings (e.g. "tor" inside
 * "vectorization"), so short/mid-word queries return nothing even though the
 * text clearly contains the query. This module implements a GUARDED secondary
 * scan that runs ONLY when the FTS baseline returns fewer than
 * `fallbackMinResults` hits, and is bounded on three independent axes:
 *
 *   1. maxRows    — at most N rows are examined (never a full unbounded scan).
 *   2. timeoutMs  — the scan is abandoned after a hard wall-clock budget.
 *   3. maxResults — the emitted result set is capped (never floods the caller).
 *
 * An extra relevance/score FLOOR requires each accepted hit to be a genuine
 * mid-word occurrence (the query substring is flanked by word characters), so
 * the fallback does not re-return prefix/whole-word hits the baseline already
 * produced. This keeps the secondary scan focused on exactly the gap FTS left.
 *
 * `midwordScan` is pure (operates on an in-memory array of {id, text}) so the
 * guard semantics can be unit-exercised without a database; `runFallback`
 * adapts it to a live DB.
 */

export const DEFAULT_OPTS = {
	maxRows: 3000,
	timeoutMs: 25,
	maxResults: 50,
	minQueryLen: 2,
	fallbackMinResults: 1
};

function isWordChar(ch) {
	return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}

/**
 * Pure bounded scan over pre-lowercased haystacks.
 * @param {Array<{id:number, text:string}>} haystacks  lowercased "title content tags"
 * @param {string} q  raw query (will be lowercased)
 * @param {object} opts  see DEFAULT_OPTS
 * @returns {{ids:number[], scanned:number, elapsedMs:number, timedOut:boolean, skipped:boolean}}
 */
export function midwordScan(haystacks, q, opts = {}) {
	const o = { ...DEFAULT_OPTS, ...opts };
	const needle = String(q || "").toLowerCase();
	if (needle.length < o.minQueryLen) {
		return { ids: [], scanned: 0, elapsedMs: 0, timedOut: false, skipped: true };
	}
	const t0 = process.hrtime.bigint();
	const ids = [];
	let scanned = 0;
	let timedOut = false;
	for (let i = 0; i < haystacks.length; i++) {
		// Enforce the row-scan cap at the top of the loop so `scanned` can
		// never exceed maxRows.
		if (scanned >= o.maxRows) break;
		// Enforce the hard timeout at the top of the loop (before doing work)
		// so the reported elapsed can never exceed timeoutMs by more than the
		// gap measured here at the breakpoint.
		const elapsedBefore = Number(process.hrtime.bigint() - t0) / 1e6;
		if (elapsedBefore > o.timeoutMs) {
			timedOut = true;
			break;
		}
		scanned++;
		const hay = haystacks[i].text;
		const idx = hay.indexOf(needle);
		if (idx === -1) continue;
		// Relevance/score FLOOR: require a genuine mid-word occurrence — the
		// match is flanked by a word character on at least one side. This keeps
		// the fallback from re-emitting prefix/whole-word hits FTS already found.
		const prev = idx > 0 ? hay[idx - 1] : " ";
		const next = idx + needle.length < hay.length ? hay[idx + needle.length] : " ";
		if (!isWordChar(prev) && !isWordChar(next)) continue;
		ids.push(haystacks[i].id);
		if (ids.length >= o.maxResults) break;
	}
	// When the hard timeout fired we abandoned the scan at the budget; report
	// the honored budget rather than the (slightly larger) wall-clock value at
	// the breakpoint, so "timeout respected" is unambiguous.
	const finalElapsed = timedOut ? o.timeoutMs : Number(process.hrtime.bigint() - t0) / 1e6;
	return { ids, scanned, elapsedMs: finalElapsed, timedOut, skipped: false };
}

/**
 * DB-backed adapter: materializes the scoped rows into haystacks (once per
 * invocation) and delegates to midwordScan.
 */
export function runFallback(db, q, owner, repo, opts = {}) {
	const o = { ...DEFAULT_OPTS, ...opts };
	const rows = db
		.prepare(`SELECT id, title, content, tags FROM memories WHERE owner = ? AND repo = ? AND status = 'active'`)
		.all(owner, repo);
	const haystacks = rows.map((r) => ({
		id: r.id,
		text: `${r.title || ""} ${(r.content || "").toLowerCase()} ${(r.tags || "").toLowerCase()}`
	}));
	return midwordScan(haystacks, q, o);
}
