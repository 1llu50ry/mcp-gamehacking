/**
 * Report concern for the FTS5 tokenizer evaluation harness.
 *
 * Renders the human-readable report snippet (exact format preserved from the
 * original monolith) and writes the JSON summary. This module is pure
 * formatting — it receives the assembled result + raw measurement inputs and
 * produces console output + file output with no side effects on the database.
 */

import fs from "fs";
import path from "path";

export function printReport({
	sqliteVersion,
	ROWS,
	ITERS,
	pageSize,
	vocab,
	sizeRepetitive,
	sizeUnique,
	classSummary,
	shortCorner,
	cjkNotes,
	probes,
	latency,
	explain
}) {
	const line = (s = "") => console.log(s);
	const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
	line("======================================================================");
	line(`FTS5 TOKENIZER EVAL — TASK-477 (unicode61 prefix-* vs trigram)`);
	line(`sqlite ${sqliteVersion} · corpus ${ROWS} rows · ${ITERS} latency iters · page ${pageSize}B`);
	line("----------------------------------------------------------------------");
	line(
		`INDEX SIZE (FTS-only, DB-delta)  repetitive corpus ×${(sizeRepetitive.ratio ?? 0).toFixed(2)}   unique corpus ×${(sizeUnique.ratio ?? 0).toFixed(2)}`
	);
	line(
		`  repetitive: unicode61 ${(sizeRepetitive.unicodeBytes / 1024).toFixed(0)} KiB   trigram ${(sizeRepetitive.trigramBytes / 1024).toFixed(0)} KiB`
	);
	line(
		`  unique:     unicode61 ${(sizeUnique.unicodeBytes / 1024).toFixed(0)} KiB   trigram ${(sizeUnique.trigramBytes / 1024).toFixed(0)} KiB`
	);
	if (vocab.unicode && vocab.trigram) {
		line(
			`  vocab tokens (instance) unicode61: ${vocab.unicode.tokens.toLocaleString()} (${vocab.unicode.distinct_terms.toLocaleString()} terms)   trigram: ${vocab.trigram.tokens.toLocaleString()} (${vocab.trigram.distinct_terms.toLocaleString()} terms)`
		);
	}
	line("----------------------------------------------------------------------");
	line("RECALL (FTS-layer vs LIKE oracle; trRaw = trigram without `*` native shape; found@50 capped at 50)");
	line(`  class              oracle  u@10   u@50  t@10  t@50  tr@10 tr@50  found@50(u/t/tr)`);
	for (const c of classSummary) {
		line(
			`  ${c.cls.padEnd(18)}  ${String(c.oracleRows).padStart(6)}  ${pct(c.uni_recall10).padStart(6)}  ${pct(c.uni_recall50).padStart(6)}  ${pct(c.tri_recall10).padStart(6)}  ${pct(c.tri_recall50).padStart(6)}  ${pct(c.triRaw_recall10).padStart(6)}  ${pct(c.triRaw_recall50).padStart(6)}  ${String(c.uni_found).padStart(3)}/${String(c.tri_found).padStart(3)}/${String(c.triRaw_found).padStart(3)}`
		);
	}
	line("----------------------------------------------------------------------");
	line("<3-char corner (len 1/2/3): unicode61 found vs trigram found");
	for (const s of shortCorner) {
		line(
			`  "${s.q}" (${s.len})  oracle=${s.oracle}  unicode61=${s.unicode_found}  trigram=${s.trigram_found}${s.trigram_err ? `  ERR: ${s.trigram_err}` : ""}`
		);
	}
	line("----------------------------------------------------------------------");
	line("CJK probes");
	for (const c of cjkNotes) {
		line(
			`  "${c.q}" (${c.len})  oracle=${c.oracle}  uni=${c.uni_found} (${pct(c.uni_recall50)})  tri=${c.tri_found} (${pct(c.tri_recall50)})  triRaw=${c.triRaw_found} (${pct(c.triRaw_recall50)})`
		);
	}
	line("----------------------------------------------------------------------");
	line("Probes (case / diacritic)");
	for (const p of probes) {
		line(`  [${p.label}] "${p.q}"  oracle=${p.oracle}  unicode61=${p.unicode_found}  trigram=${p.trigram_found}`);
	}
	line("----------------------------------------------------------------------");
	line("LATENCY p50/p95 (ms) — unicode61 / trigram / trigramRaw / LIKE");
	for (const l of latency) {
		line(
			`  ${l.name.padEnd(16)}  ${l.unicode_ms.p50.toFixed(3)}/${l.unicode_ms.p95.toFixed(3)}   ${l.trigram_ms.p50.toFixed(3)}/${l.trigram_ms.p95.toFixed(3)}   ${l.trigramRaw_ms.p50.toFixed(3)}/${l.trigramRaw_ms.p95.toFixed(3)}   ${l.like_ms.p50.toFixed(3)}/${l.like_ms.p95.toFixed(3)}   (oracle=${l.oracle})`
		);
	}
	line("----------------------------------------------------------------------");
	line("EXPLAIN QUERY PLAN (detail lines)");
	for (const e of explain) {
		line(`  — ${e.name} "${e.q}"`);
		line(`    unicode61:  ${e.unicode_prod.join(" | ")}`);
		line(`    trigram:    ${e.trigram_prod.join(" | ")}`);
		line(`    trigramRaw: ${e.trigram_raw.join(" | ")}`);
		line(`    LIKE:       ${e.like.join(" | ")}`);
	}
	line("======================================================================");
}

export function writeResult(jsonOut, result, markdownOut) {
	fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
	fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
	console.log(`\nJSON → ${jsonOut}`);
	if (markdownOut) {
		fs.mkdirSync(path.dirname(markdownOut), { recursive: true });
		const { meta, recall, latency } = result;
		const lines = [
			`# FTS5 Tokenizer Baseline — TASK-477`,
			``,
			`- Task: ${meta.task}`,
			`- Seed: ${meta.seed}`,
			`- Node: ${meta.node}`,
			`- SQLite: ${meta.sqliteVersion}`,
			`- Corpus rows: ${meta.corpusRows}`,
			``,
			`## Recall`,
			``,
			`| Class | Queries | Oracle rows | Unicode61 @10 | Unicode61 @50 | Trigram @10 | Trigram @50 |`,
			`| --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
			...recall.classSummary.map(
				(item) =>
					`| ${item.cls} | ${item.queries} | ${item.oracleRows} | ${formatPercent(item.uni_recall10)} | ${formatPercent(item.uni_recall50)} | ${formatPercent(item.tri_recall10)} | ${formatPercent(item.tri_recall50)} |`
			),
			``,
			`## Latency`,
			``,
			`| Query | Unicode61 p50/p95 (ms) | Trigram p50/p95 (ms) | LIKE p50/p95 (ms) |`,
			`| --- | ---: | ---: | ---: |`,
			...latency.map(
				(item) =>
					`| ${item.name} | ${formatLatency(item.unicode_ms)} | ${formatLatency(item.trigram_ms)} | ${formatLatency(item.like_ms)} |`
			),
			``
		].join("\n");
		fs.writeFileSync(markdownOut, `${lines}\n`);
		console.log(`Markdown → ${markdownOut}`);
	}
}

function formatPercent(value) {
	return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value) {
	return `${value.p50.toFixed(3)} / ${value.p95.toFixed(3)}`;
}
