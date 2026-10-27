/**
 * Metrics helpers for the mid-word fallback benchmark (TASK-483).
 */

export function percentile(sorted, p) {
	if (sorted.length === 0) return 0;
	const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
	return sorted[idx];
}

export function percentiles(samples) {
	const s = [...samples].sort((a, b) => a - b);
	return {
		p50: percentile(s, 0.5),
		p95: percentile(s, 0.95),
		p99: percentile(s, 0.99),
		mean: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0,
		min: s[0] ?? 0,
		max: s[s.length - 1] ?? 0,
		n: s.length
	};
}

export function intersectionSize(a, b) {
	const set = new Set(a);
	let n = 0;
	for (const x of b) if (set.has(x)) n++;
	return n;
}

/**
 * Recall of `found` against `oracle` at cutoff `k` (classic recall@k).
 *   recall = |top-k(found) ∩ oracle| / min(k, |oracle|)
 * The found set is truncated to its top-k before intersecting, which bounds the
 * numerator at k and guarantees recall ∈ [0, 1] (a result set larger than k can
 * never report >100% recall).
 * Returns { found, recall, capped } where `capped` indicates the denominator
 * was clamped by k (i.e. oracle larger than k) — used to distinguish a true
 * top-k recovery from an unbounded one.
 */
export function recallAt(found, oracle, k) {
	const denom = Math.min(k, oracle.length);
	if (denom === 0) return { found: intersectionSize(found, oracle), recall: 0, capped: false };
	const topK = found.slice(0, k);
	return {
		found: intersectionSize(topK, oracle),
		recall: intersectionSize(topK, oracle) / denom,
		capped: oracle.length > k
	};
}

/**
 * Uncapped recall (recovery fraction over the FULL oracle). Shows how much of
 * the ground-truth the bounded fallback actually recovers.
 */
export function recallFull(found, oracle) {
	if (oracle.length === 0) return { found: 0, recall: 0 };
	return { found: intersectionSize(found, oracle), recall: intersectionSize(found, oracle) / oracle.length };
}
