/**
 * Reporting for the mid-word fallback benchmark (TASK-483). Renders the
 * console summary and writes the JSON + Markdown artifacts. Pure formatting —
 * no database side effects.
 */
import fs from "fs";
import path from "path";

const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const lat = (v) => (v ? `${v.p50.toFixed(3)}/${v.p95.toFixed(3)}/${v.p99.toFixed(3)}` : "—");

export function printReport(result) {
	const line = (s = "") => console.log(s);
	const M = result.meta;
	const cfg = result.config;
	line("======================================================================");
	line(`MID-WORD FALLBACK BENCH — TASK-483 (unicode61 baseline vs bounded fallback)`);
	line(`sqlite ${M.sqliteVersion} · corpus ${M.corpusRows} rows · node ${M.node} · page ${M.pageSize}B`);
	line(
		`bounds: maxRows=${cfg.maxRows} timeout=${cfg.timeoutMs}ms maxResults=${cfg.maxResults} minQueryLen=${cfg.minQueryLen} gate(<${cfg.fallbackMinResults} baseline hits)`
	);
	line("----------------------------------------------------------------------");
	line(`RECALL BY CLASS (baseline FTS vs baseline+fallback)`);
	line(`  class     queries  oracleRows  base@50   comb@50   improve   recoveryFull`);
	for (const c of result.summary.recallByClass) {
		line(
			`  ${c.cls.padEnd(9)}  ${String(c.queries).padStart(7)}  ${String(c.oracleRows).padStart(10)}  ${pct(c.baselineRecall50).padStart(7)}  ${pct(c.combinedRecall50).padStart(7)}  ${pct(c.improvement50).padStart(8)}  ${pct(c.recoveryFull)}`
		);
	}
	const o = result.summary.overall;
	line(
		`  ${"OVERALL".padEnd(9)}  ${String(o.queries).padStart(7)}  ${String(o.oracleRows).padStart(10)}  ${pct(o.baselineRecall50).padStart(7)}  ${pct(o.combinedRecall50).padStart(7)}  ${pct(o.improvement50).padStart(8)}  ${pct(o.recoveryFull)}`
	);
	line("----------------------------------------------------------------------");
	line(`ADDED LATENCY (fallback, only on triggered queries) ms p50/p95/p99`);
	line(
		`  ${lat(result.summary.addedLatency)}  (n=${result.summary.addedLatency?.n ?? 0}, triggeredQueries=${result.summary.triggeredQueries})`
	);
	line("----------------------------------------------------------------------");
	line(`SAFETY BOUNDS`);
	const b = result.summary.bounds;
	line(
		`  maxRowsScanned=${b.maxRowsScanned}/${cfg.maxRows}  maxElapsedMs=${b.maxElapsedMs.toFixed(3)}/${cfg.timeoutMs}  maxResultCount=${b.maxResultCount}/${cfg.maxResults}`
	);
	line(
		`  violations=${b.violations}  allHeld=${b.allHeld}  rowCapExercised=${b.rowCapExercised}  resultCapExercised=${b.resultCapExercised}  timeoutExercised=${b.timeoutExercised}`
	);
	if (result.summary.errors && result.summary.errors.length) {
		line("----------------------------------------------------------------------");
		line(`ERRORS (propagated, no silent empty): ${result.summary.errors.length}`);
		for (const e of result.summary.errors) line(`  [${e.cls}] "${e.q}": ${e.error}`);
	}
	const rev = M.benchRevision || {};
	line("----------------------------------------------------------------------");
	line(`REVISION MANIFEST sha256: ${rev.manifestHash || "n/a"}`);
	line(`commit ${M.commitSha || "n/a"} · branch ${M.branch || "n/a"} · dirty=${M.dirty}`);
	line("======================================================================");
}

function formatPercent(v) {
	return v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;
}

export function buildMarkdown(result) {
	const M = result.meta;
	const cfg = result.config;
	const S = result.summary;
	const rows = [
		`# Mid-Word Fallback Benchmark — TASK-483`,
		``,
		`- Task: ${M.task}`,
		`- Seed: ${M.seed}`,
		`- Commit: ${M.commitSha || "n/a"}`,
		`- Branch: ${M.branch || "n/a"} (dirty=${M.dirty})`,
		`- Date: ${M.date}`,
		`- Node: ${M.node}`,
		`- SQLite: ${M.sqliteVersion} (page ${M.pageSize}B)`,
		`- better-sqlite3: ${M.betterSqlite3}`,
		`- Corpus rows: ${M.corpusRows}`,
		`- Iterations (latency): ${M.iterations}`,
		`- Revision manifest sha256: \`${M.benchRevision?.manifestHash || "n/a"}\``,
		``,
		`## Configuration (safety bounds)`,
		``,
		`| Bound | Value |`,
		`| --- | ---: |`,
		`| maxRows (rows scanned cap) | ${cfg.maxRows} |`,
		`| timeoutMs (hard timeout) | ${cfg.timeoutMs} |`,
		`| maxResults (result set cap) | ${cfg.maxResults} |`,
		`| minQueryLen | ${cfg.minQueryLen} |`,
		`| fallbackMinResults (gate) | ${cfg.fallbackMinResults} |`,
		``,
		`## Recall by class`,
		``,
		`| Class | Queries | Oracle rows | Baseline @50 | Combined @50 | Improvement @50 | Recovery (full) |`,
		`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
		...S.recallByClass.map(
			(c) =>
				`| ${c.cls} | ${c.queries} | ${c.oracleRows} | ${formatPercent(c.baselineRecall50)} | ${formatPercent(c.combinedRecall50)} | ${formatPercent(c.improvement50)} | ${formatPercent(c.recoveryFull)} |`
		),
		`| OVERALL | ${S.overall.queries} | ${S.overall.oracleRows} | ${formatPercent(S.overall.baselineRecall50)} | ${formatPercent(S.overall.combinedRecall50)} | ${formatPercent(S.overall.improvement50)} | ${formatPercent(S.overall.recoveryFull)} |`,
		``,
		`## Added latency (fallback, triggered queries only)`,
		``,
		`- p50 / p95 / p99 (ms): ${S.addedLatency.p50.toFixed(3)} / ${S.addedLatency.p95.toFixed(3)} / ${S.addedLatency.p99.toFixed(3)}`,
		`- mean: ${S.addedLatency.mean.toFixed(3)} ms · samples: ${S.addedLatency.n} · triggeredQueries: ${S.triggeredQueries}`,
		``,
		`## Safety bounds`,
		``,
		`| Metric | Observed max | Cap | Held |`,
		`| --- | ---: | ---: | --- |`,
		`| rows scanned | ${S.bounds.maxRowsScanned} | ${cfg.maxRows} | ${S.bounds.maxRowsScanned <= cfg.maxRows} |`,
		`| elapsed (ms) | ${S.bounds.maxElapsedMs.toFixed(3)} | ${cfg.timeoutMs} | ${S.bounds.maxElapsedMs <= cfg.timeoutMs} |`,
		`| result count | ${S.bounds.maxResultCount} | ${cfg.maxResults} | ${S.bounds.maxResultCount <= cfg.maxResults} |`,
		``,
		`- Violations: ${S.bounds.violations}`,
		`- All bounds held: ${S.bounds.allHeld}`,
		`- Row cap exercised: ${S.bounds.rowCapExercised} · Result cap exercised: ${S.bounds.resultCapExercised} · Timeout exercised: ${S.bounds.timeoutExercised}`,
		``,
		...(S.errors && S.errors.length
			? [`## Errors (propagated)`, ``, ...S.errors.map((e) => `- [${e.cls}] "${e.q}": ${e.error}`), ``]
			: []),
		`## Per-query detail`,
		``,
		`| Class | Query | Oracle | Base@50 | Comb@50 | Triggered | Scanned | Elapsed(ms) | Results | Bounds |`,
		`| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |`,
		...result.perQuery.map(
			(p) =>
				`| ${p.cls} | ${p.q} | ${p.oracle} | ${formatPercent(p.baselineRecall50)} | ${formatPercent(p.combinedRecall50)} | ${p.triggered} | ${p.rowsScanned} | ${p.elapsedMs.toFixed(3)} | ${p.resultCount} | ${p.boundsHeld} |`
		),
		``,
		`## Revision manifest`,
		``,
		`\`\`\``,
		...(M.benchRevision?.manifest ? M.benchRevision.manifest.trim().split("\n") : []),
		`\`\`\``,
		``
	];
	return rows.join("\n");
}

export function writeResult(jsonOut, result, markdownOut) {
	fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
	fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
	console.log(`JSON → ${jsonOut}`);
	if (markdownOut) {
		fs.mkdirSync(path.dirname(markdownOut), { recursive: true });
		fs.writeFileSync(markdownOut, buildMarkdown(result));
		console.log(`Markdown → ${markdownOut}`);
	}
}
