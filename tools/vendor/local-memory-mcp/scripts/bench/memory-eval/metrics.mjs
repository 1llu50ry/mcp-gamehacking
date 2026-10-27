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

export function throughput(totalOps, elapsedMs) {
	if (elapsedMs <= 0) return 0;
	return (totalOps / elapsedMs) * 1000;
}

export function errorRate(errors, total) {
	if (total === 0) return 0;
	return errors / total;
}
