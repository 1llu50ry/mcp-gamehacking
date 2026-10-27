import fs from "fs";
import path from "path";

function formatLatency(v) {
	if (!v) return "—";
	return `${v.p50.toFixed(3)} / ${v.p95.toFixed(3)} / ${v.p99.toFixed(3)}`;
}

function formatThroughput(v) {
	if (v == null) return "—";
	return `${v.toFixed(1)} ops/s`;
}

export function printReport(result) {
	const line = (s = "") => console.log(s);
	const { meta, scales } = result;
	line("======================================================================");
	line(`MEMORY WRITE+SEARCH BENCH — TASK-478`);
	line(
		`commit ${meta.commitSha ?? "unknown"}${meta.benchRevision ? ` · bench ${String(meta.benchRevision).slice(0, 12)}` : ""} · node ${meta.node} · sqlite ${meta.sqliteVersion} · page ${meta.pageSize}B`
	);
	line(`seed 0x${meta.seed.toString(16)} · owner ${meta.owner} · repo ${meta.repo} · epoch ${meta.benchEpoch ?? "—"}`);
	line(
		`scales: ${meta.scales.join(", ")} · iterations: ${meta.iterations} · ${meta.vectorBackend ?? "stub vectors (no ONNX)"}${meta.vectorCandidateCap ? ` · cap ${meta.vectorCandidateCap}` : ""}${meta.dirty ? " · DIRTY" : ""}`
	);
	if (meta.hardwareLimit) line(`hardware limit: ${meta.hardwareLimit}`);
	line("----------------------------------------------------------------------");
	for (const s of scales) {
		line(
			`SCALE ${s.rows} rows — db ${(s.dbBytes / 1024).toFixed(0)} KiB · heap ${(s.heapBytes / 1024).toFixed(0)} KiB${s.vectorMeta ? ` · vecCap ${s.vectorMeta.candidateCap}` : ""}${s.foreignPartition ? ` · foreign ${s.foreignPartition.rows}` : ""}`
		);
		if (s.write) {
			const w = s.write;
			line(
				`  WRITE  p50/p95/p99 ${formatLatency(w.latency)} ms · mean ${w.latency.mean.toFixed(3)} ms · throughput ${formatThroughput(w.throughput)} · errors ${w.errors}/${w.total}`
			);
		}
		if (s.search) {
			for (const mode of ["fts", "semantic", "hybrid"]) {
				const m = s.search[mode];
				if (!m) continue;
				line(
					`  SEARCH ${mode.padEnd(8)} p50/p95/p99 ${formatLatency(m.latency)} ms · throughput ${formatThroughput(m.throughput)} · errors ${m.errors}/${m.total} zero ${m.zeroResults ?? 0} · avgResults ${m.avgResults.toFixed(1)}`
				);
			}
		}
		if (s.queryBreakdown && s.queryBreakdown.length) {
			line(`  query breakdown (hybrid):`);
			for (const q of s.queryBreakdown) {
				line(
					`    ${q.kind.padEnd(12)} "${q.query.slice(0, 40)}"  p50 ${q.p50.toFixed(3)} ms  p95 ${q.p95.toFixed(3)} ms  results ${q.avgResults.toFixed(1)}  err ${q.errors} zero ${q.zeroResults ?? 0}`
				);
			}
		}
		if (s.isolation) {
			line(`  isolation: ${s.isolation.isolatedOk ? "PASS" : "FAIL"} · probes ${s.isolation.probes.length}`);
			for (const p of s.isolation.probes) {
				line(
					`    probe "${p.query}" ${p.probeOwner}/${p.probeRepo} fts:${p.fts.isolated ? "ok" : "LEAK"} sem:${p.semantic.isolated ? "ok" : "LEAK"}`
				);
			}
		}
		if (s.relevance) {
			const pe = s.relevance.probeErrors ?? 0;
			const pet = s.relevance.probeErrorByType ? ` ${JSON.stringify(s.relevance.probeErrorByType)}` : "";
			line(
				`  relevance: ${s.relevance.pass ? "PASS" : "FAIL"} · noResultViolations ${s.relevance.noResultViolations} emptyPositive ${s.relevance.emptyPositive} probeErrors ${pe}${pet}`
			);
		}
		line("----------------------------------------------------------------------");
	}
	line("======================================================================");
}

export function writeResult(jsonOut, result, markdownOut) {
	fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
	fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
	console.log(`\nJSON → ${jsonOut}`);
	if (markdownOut) {
		fs.mkdirSync(path.dirname(markdownOut), { recursive: true });
		const { meta, scales } = result;
		const lines = [
			`# Memory Write+Search Benchmark — TASK-478`,
			``,
			`- Task: ${meta.task}`,
			`- Seed: 0x${meta.seed.toString(16)}`,
			`- Commit: ${meta.commitSha ?? "unknown"}`,
			...(meta.benchRevision ? [`- Bench revision: ${meta.benchRevision}`] : []),
			...(meta.branch ? [`- Branch: ${meta.branch}${meta.dirty ? " (dirty)" : ""}`] : []),
			`- Node: ${meta.node}`,
			`- better-sqlite3: ${meta.betterSqlite3}`,
			`- SQLite: ${meta.sqliteVersion}`,
			`- Page size: ${meta.pageSize}`,
			`- Owner/Repo: ${meta.owner} / ${meta.repo}`,
			`- Bench epoch: ${meta.benchEpoch ?? "—"}`,
			`- Scales: ${meta.scales.join(", ")}`,
			`- Iterations: ${meta.iterations}`,
			`- Vector backend: ${meta.vectorBackend ?? "stub (TF cosine, no ONNX)"}`,
			...(meta.vectorCandidateCap
				? [`- Vector candidate cap: ${meta.vectorCandidateCap} (min ${meta.vectorMinCandidates ?? "—"})`]
				: []),
			...(meta.hardwareLimit ? [`- Hardware limit: ${meta.hardwareLimit}`] : []),
			`- Date: ${meta.date}`,
			``,
			`## Write Latency (per insert)`,
			``,
			`| Scale | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Throughput | Errors |`,
			`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
			...scales.map((s) => {
				const w = s.write;
				if (!w) return `| ${s.rows} | — | — | — | — | — | — |`;
				return `| ${s.rows} | ${w.latency.p50.toFixed(3)} | ${w.latency.p95.toFixed(3)} | ${w.latency.p99.toFixed(3)} | ${w.latency.mean.toFixed(3)} | ${w.throughput.toFixed(1)} ops/s | ${w.errors}/${w.total} |`;
			}),
			``,
			`## Search Latency (per query)`,
			``,
			`| Scale | Mode | p50 (ms) | p95 (ms) | p99 (ms) | Throughput | Errors | Zero | Avg results |`,
			`| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
			...scales.flatMap((s) =>
				["fts", "semantic", "hybrid"].map((mode) => {
					const m = s.search?.[mode];
					if (!m) return `| ${s.rows} | ${mode} | — | — | — | — | — | — | — |`;
					return `| ${s.rows} | ${mode} | ${m.latency.p50.toFixed(3)} | ${m.latency.p95.toFixed(3)} | ${m.latency.p99.toFixed(3)} | ${m.throughput.toFixed(1)} ops/s | ${m.errors}/${m.total} | ${m.zeroResults ?? 0} | ${m.avgResults.toFixed(1)} |`;
				})
			),
			``,
			`## Query Breakdown (hybrid, per-kind)`,
			``,
			`| Scale | Kind | Query | p50 (ms) | p95 (ms) | Avg results | Errors | Zero |`,
			`| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |`,
			...scales.flatMap((s) =>
				(s.queryBreakdown ?? []).map(
					(q) =>
						`| ${s.rows} | ${q.kind} | \`${q.query.replace(/`/g, "'").slice(0, 48)}\` | ${q.p50.toFixed(3)} | ${q.p95.toFixed(3)} | ${q.avgResults.toFixed(1)} | ${q.errors} | ${q.zeroResults ?? 0} |`
				)
			),
			``,
			`## Isolation & Relevance`,
			``,
			`| Scale | Isolation | No-result violations | Empty positive | Probe errors | PASS |`,
			`| --- | --- | ---: | ---: | ---: | --- |`,
			...scales.map(
				(s) =>
					`| ${s.rows} | ${s.isolation ? (s.isolation.isolatedOk ? "PASS" : "FAIL") : "—"} | ${s.relevance ? s.relevance.noResultViolations : "—"} | ${s.relevance ? s.relevance.emptyPositive : "—"} | ${s.relevance?.probeErrors ?? "—"} | ${s.relevance ? (s.relevance.pass ? "PASS" : "FAIL") : "—"} |`
			),
			``,
			`### Isolation probes`,
			``,
			`| Scale | Query | Probe tenant | FTS isolated | Semantic isolated |`,
			`| --- | --- | --- | --- | --- |`,
			...scales.flatMap((s) =>
				(s.isolation?.probes ?? []).map(
					(p) =>
						`| ${s.rows} | \`${p.query}\` | ${p.probeOwner}/${p.probeRepo} | ${p.fts.isolated ? "yes" : "LEAK"} | ${p.semantic.isolated ? "yes" : "LEAK"} |`
				)
			),
			``,
			`### Vector / determinism metadata`,
			``,
			`| Scale | Candidate cap | Persisted | Zero fallback | Hybrid threshold | Epoch |`,
			`| --- | ---: | --- | --- | ---: | --- |`,
			...scales.map(
				(s) =>
					`| ${s.rows} | ${s.vectorMeta ? s.vectorMeta.candidateCap : "—"} | ${s.vectorMeta ? (s.vectorMeta.persistedVectors ? "yes" : "no") : "—"} | ${s.vectorMeta ? (s.vectorMeta.zeroFallback ?? "null") : "—"} | ${s.vectorMeta ? s.vectorMeta.hybridThreshold : "—"} | ${s.benchEpoch ?? "—"} |`
			),
			``,
			`## Environment`,
			``,
			`| Key | Value |`,
			`| --- | --- |`,
			`| commitSha | ${meta.commitSha ?? "unknown"} |`,
			`| node | ${meta.node} |`,
			`| better-sqlite3 | ${meta.betterSqlite3} |`,
			`| sqliteVersion | ${meta.sqliteVersion} |`,
			`| pageSize | ${meta.pageSize} |`,
			`| heapUsed (last scale) | ${scales[scales.length - 1]?.heapBytes ?? "—"} |`,
			`| dbBytes (last scale) | ${scales[scales.length - 1]?.dbBytes ?? "—"} |`,
			``
		].join("\n");
		fs.writeFileSync(markdownOut, `${lines}\n`);
		console.log(`Markdown → ${markdownOut}`);
	}
}
