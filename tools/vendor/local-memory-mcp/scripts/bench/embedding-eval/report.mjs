import { percentiles } from "../memory-eval/metrics.mjs";

export function toLatencyStats(samples) {
	if (!samples || samples.length === 0) return { p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0, n: 0 };
	return percentiles(samples);
}

export function buildMarkdown(result) {
	const { meta, summary, scenarios } = result;
	const revisionLine = meta.benchRevision?.manifestHash
		? `bench manifest ${meta.benchRevision.manifestHash.slice(0, 12)} (${Object.entries(meta.benchRevision.perFile)
				.map(([k, v]) => `${k.split("/").pop()}:${String(v || "?").slice(0, 8)}`)
				.join(", ")})`
		: meta.benchRevision
			? String(meta.benchRevision).slice(0, 24)
			: "—";
	const lines = [
		`# Embedding Queue Availability Benchmark — TASK-479`,
		``,
		`- Task: ${meta.task}`,
		`- Seed: 0x${meta.seed.toString(16)}`,
		`- Commit: ${meta.commitSha ?? "unknown"} · ${revisionLine}${meta.branch ? ` · branch ${meta.branch}${meta.dirty ? " (dirty)" : ""}` : ""}`,
		`- Node: ${meta.node} · better-sqlite3 ${meta.betterSqlite3 ?? "—"} · sqlite ${meta.sqliteVersion ?? "—"} · page ${meta.pageSize ?? "—"}B`,
		`- Owner/Repo: ${meta.owner} / ${meta.repo} · batch ${meta.batchSize} · lease ${meta.leaseMs}ms · poison ${meta.poisonThreshold}`,
		`- Vector backend: ${meta.vectorBackend}`,
		`- Isolated temp DB: yes · deterministic fixtures: yes`,
		`- Date: ${meta.date} · epoch ${meta.benchEpoch}`,
		...(meta.errors ? [`- Errors: ${meta.errors.length}`] : []),
		...(meta.benchRevision?.manifest ? [`- Bench manifest:\n\`\`\`\n${meta.benchRevision.manifest}\`\`\``] : []),
		``,
		`## Summary`,
		``,
		`| Metric | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | n |`,
		`| --- | ---: | ---: | ---: | ---: | ---: |`,
		`| Write latency (enqueue) | ${summary.writeLatency.p50.toFixed(3)} | ${summary.writeLatency.p95.toFixed(3)} | ${summary.writeLatency.p99.toFixed(3)} | ${summary.writeLatency.mean.toFixed(3)} | ${summary.writeLatency.n} |`,
		`| Queue delay (write → visibility) | ${summary.queueDelay.p50.toFixed(3)} | ${summary.queueDelay.p95.toFixed(3)} | ${summary.queueDelay.p99.toFixed(3)} | ${summary.queueDelay.mean.toFixed(3)} | ${summary.queueDelay.n} |`,
		``,
		`- Total failures: ${summary.totalFailures}`,
		`- Total write errors: ${summary.totalWriteErrors ?? 0}`,
		`- Total visibility failures: ${summary.totalVisibilityFailures ?? 0}`,
		`- Total backoff failures: ${summary.totalBackoffFailures ?? 0}`,
		`- Total vector failures: ${summary.totalVectorFailures ?? 0}`,
		`- Write throughput: ${summary.writeThroughput.toFixed(1)} ops/s`,
		``,
		`## Per-Scenario Breakdown`,
		``,
		`| Scenario | Write p50/p95/p99 (ms) | Queue delay p50/p95/p99 (ms) | Failures | WriteErr | VisFail | BackoffFail | n |`,
		`| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |`,
		...Object.entries(scenarios).map(([k, v]) => {
			if (v.error) return `| ${k} | ERROR | ERROR | — | — | — | — | — |`;
			const w = v.writeLatency
				? `${v.writeLatency.p50.toFixed(3)}/${v.writeLatency.p95.toFixed(3)}/${v.writeLatency.p99.toFixed(3)}`
				: "—";
			const q = v.queueDelay
				? `${v.queueDelay.p50.toFixed(3)}/${v.queueDelay.p95.toFixed(3)}/${v.queueDelay.p99.toFixed(3)}`
				: "—";
			return `| ${k} | ${w} | ${q} | ${v.failures ?? 0} | ${v.writeErrors ?? 0} | ${v.visibilityFailures ?? 0} | ${v.backoffFailures ?? 0} | ${v.n ?? "—"} |`;
		}),
		``,
		`## Scenario Details`,
		``,
		...Object.entries(scenarios).flatMap(([k, v]) => {
			if (v.error) return [`### ${k}`, ``, `ERROR: ${v.error}`, ``];
			const extra = v.extra ? JSON.stringify(v.extra, null, 2) : "{}";
			return [
				`### ${k}`,
				``,
				`- Write latency: p50 ${v.writeLatency?.p50?.toFixed(3) ?? "—"} ms · p95 ${v.writeLatency?.p95?.toFixed(3) ?? "—"} ms · p99 ${v.writeLatency?.p99?.toFixed(3) ?? "—"} ms · mean ${v.writeLatency?.mean?.toFixed(3) ?? "—"} ms · n ${v.writeLatency?.n ?? "—"}`,
				`- Queue delay: p50 ${v.queueDelay?.p50?.toFixed(3) ?? "—"} ms · p95 ${v.queueDelay?.p95?.toFixed(3) ?? "—"} ms · p99 ${v.queueDelay?.p99?.toFixed(3) ?? "—"} ms · mean ${v.queueDelay?.mean?.toFixed(3) ?? "—"} ms · n ${v.queueDelay?.n ?? "—"}`,
				`- Failures: ${v.failures ?? 0} · writeErrors ${v.writeErrors ?? 0} · visibilityFailures ${v.visibilityFailures ?? 0} · backoffFailures ${v.backoffFailures ?? 0} · n ${v.n ?? "—"}`,
				`- Extra: \`${extra.slice(0, 800)}\``,
				``
			];
		}),
		``,
		`## Environment`,
		``,
		`| Key | Value |`,
		`| --- | --- |`,
		`| commitSha | ${meta.commitSha ?? "unknown"} |`,
		`| benchRevision.manifestHash | ${meta.benchRevision?.manifestHash ?? meta.benchRevision ?? "—"} |`,
		`| benchRevision.perFile | ${meta.benchRevision?.perFile ? JSON.stringify(meta.benchRevision.perFile) : "—"} |`,
		`| node | ${meta.node} |`,
		`| betterSqlite3 | ${meta.betterSqlite3 ?? "—"} |`,
		`| sqliteVersion | ${meta.sqliteVersion ?? "—"} |`,
		`| pageSize | ${meta.pageSize ?? "—"} |`,
		`| batchSize | ${meta.batchSize} |`,
		`| leaseMs | ${meta.leaseMs} |`,
		`| poisonThreshold | ${meta.poisonThreshold} |`,
		``
	];
	return lines.join("\n");
}
