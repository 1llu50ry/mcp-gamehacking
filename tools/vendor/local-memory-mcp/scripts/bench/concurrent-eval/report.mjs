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
		`# Concurrent Workload Benchmark — TASK-480`,
		``,
		`- Task: ${meta.task}`,
		`- Seed: 0x${meta.seed.toString(16)}`,
		`- Commit: ${meta.commitSha ?? "unknown"} · ${revisionLine}${meta.branch ? ` · branch ${meta.branch}${meta.dirty ? " (dirty)" : ""}` : ""}`,
		`- Node: ${meta.node} · better-sqlite3 ${meta.betterSqlite3 ?? "—"} · sqlite ${meta.sqliteVersion ?? "—"} · page ${meta.pageSize ?? "—"}B`,
		`- Owner/Repo: ${meta.owner} / ${meta.repo} · epoch ${meta.benchEpoch} · rows ${meta.benchRows}`,
		`- WAL: journal_mode WAL · synchronous NORMAL · busy_timeout ${meta.busyTimeoutMs}ms · wal_autocheckpoint 1000`,
		`- Isolated temp DB: yes · deterministic corpus: yes (seed 0x${meta.seed.toString(16)})`,
		`- Scenarios: ${meta.scenarios.join(", ")}`,
		`- Date: ${meta.date}`,
		...(meta.errors ? [`- Errors: ${meta.errors.length}`] : []),
		...(meta.benchRevision?.manifest ? [`- Bench manifest:\n\`\`\`\n${meta.benchRevision.manifest}\`\`\``] : []),
		``,
		`## Summary`,
		``,
		`| Metric | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | n | Throughput |`,
		`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
		`| Read latency | ${summary.readLatency.p50.toFixed(3)} | ${summary.readLatency.p95.toFixed(3)} | ${summary.readLatency.p99.toFixed(3)} | ${summary.readLatency.mean.toFixed(3)} | ${summary.readLatency.n} | ${summary.readThroughput.toFixed(1)} ops/s |`,
		`| Write latency | ${summary.writeLatency.p50.toFixed(3)} | ${summary.writeLatency.p95.toFixed(3)} | ${summary.writeLatency.p99.toFixed(3)} | ${summary.writeLatency.mean.toFixed(3)} | ${summary.writeLatency.n} | ${summary.writeThroughput.toFixed(1)} ops/s |`,
		`| Mixed latency | ${summary.mixedLatency.p50.toFixed(3)} | ${summary.mixedLatency.p95.toFixed(3)} | ${summary.mixedLatency.p99.toFixed(3)} | ${summary.mixedLatency.mean.toFixed(3)} | ${summary.mixedLatency.n} | ${summary.mixedThroughput.toFixed(1)} ops/s |`,
		``,
		`- Total ops: ${summary.totalOps} · total errors: ${summary.totalErrors} (busy ${summary.totalBusy} timeout ${summary.totalTimeout} other ${summary.totalOther})`,
		`- Max heapUsed: ${summary.maxHeapBytes ? (summary.maxHeapBytes / 1024).toFixed(0) + " KiB" : "—"} · max dbBytes: ${summary.maxDbBytes ? (summary.maxDbBytes / 1024).toFixed(0) + " KiB" : "—"}`,
		``,
		`## Per-Scenario Breakdown`,
		``,
		`| Scenario | Ops | p50/p95/p99 (ms) | Throughput | Errors (busy/timeout/other) | Contention | Concurrency |`,
		`| --- | ---: | --- | ---: | --- | --- | --- |`,
		...Object.entries(scenarios).map(([k, v]) => {
			if (v.error) return `| ${k} | — | ERROR | — | — | — | — |`;
			const p = v.latency ? `${v.latency.p50.toFixed(3)}/${v.latency.p95.toFixed(3)}/${v.latency.p99.toFixed(3)}` : "—";
			const tp = v.throughput != null ? `${v.throughput.toFixed(1)} ops/s` : "—";
			const err = `${v.errors ?? 0} (${v.busyErrors ?? 0}/${v.timeoutErrors ?? 0}/${v.otherErrors ?? 0})`;
			const cont = v.contentionRate != null ? `${(v.contentionRate * 100).toFixed(1)}%` : "—";
			const conc = v.concurrency
				? `${v.concurrency.readers ?? 0}R/${v.concurrency.writers ?? 0}W` +
					(v.concurrency.clients ? ` · ${v.concurrency.clients} clients` : "")
				: "—";
			return `| ${k} | ${v.n ?? "—"} | ${p} | ${tp} | ${err} | ${cont} | ${conc} |`;
		}),
		``,
		`## Scenario Details`,
		``,
		...Object.entries(scenarios).flatMap(([k, v]) => {
			if (v.error) return [`### ${k}`, ``, `ERROR: ${v.error}`, ``];
			const extra = v.extra ? JSON.stringify(v.extra, null, 2) : "{}";
			const rsrc = v.resource
				? `heap ${(v.resource.heapBytes / 1024).toFixed(0)} KiB · db ${(v.resource.dbBytes / 1024).toFixed(0)} KiB${v.resource.walBytes != null ? ` · wal ${(v.resource.walBytes / 1024).toFixed(0)} KiB` : ""} · elapsed ${v.elapsedMs?.toFixed(1) ?? "—"} ms`
				: "—";
			return [
				`### ${k}`,
				``,
				`- Latency: p50 ${v.latency?.p50?.toFixed(3) ?? "—"} ms · p95 ${v.latency?.p95?.toFixed(3) ?? "—"} ms · p99 ${v.latency?.p99?.toFixed(3) ?? "—"} ms · mean ${v.latency?.mean?.toFixed(3) ?? "—"} ms · n ${v.latency?.n ?? v.n ?? "—"} · throughput ${v.throughput?.toFixed(1) ?? "—"} ops/s`,
				`- Errors: total ${v.errors ?? 0} · busy ${v.busyErrors ?? 0} · timeout ${v.timeoutErrors ?? 0} · other ${v.otherErrors ?? 0} · errorRate ${(((v.errors ?? 0) / Math.max(1, v.n ?? 1)) * 100).toFixed(2)}%`,
				`- Resource: ${rsrc}`,
				`- Contention: rate ${v.contentionRate != null ? (v.contentionRate * 100).toFixed(1) + "%" : "—"} · busyRetries ${v.busyRetries ?? 0} · lockWait ${v.lockWaitMs ?? 0} ms`,
				`- WAL before checkpoint: ${v.walBeforeCheckpoint != null ? `${v.walBeforeCheckpoint} bytes` : "—"}`,
				`- Operation overlap: ${v.operationWindow ? `${v.operationWindow.overlapMs.toFixed(3)} ms (proof ${v.operationWindow.proof ? "yes" : "no"})` : "—"}`,
				`- Integrity: ${v.integrity ? JSON.stringify(v.integrity) : "—"}`,
				`- Concurrency: ${v.concurrency ? JSON.stringify(v.concurrency) : "—"}`,
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
		`| busyTimeoutMs | ${meta.busyTimeoutMs} |`,
		`| benchRows | ${meta.benchRows} |`,
		`| seed | 0x${meta.seed.toString(16)} |`,
		``
	];
	return lines.join("\n");
}
