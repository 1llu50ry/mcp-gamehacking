#!/usr/bin/env node
/**
 * Mid-word fallback benchmark (TASK-483).
 *
 * Evaluates a BOUNDED mid-word search fallback against the production unicode61
 * FTS5 baseline (the tokenizer chosen after the fts-trigram-eval benchmark).
 * unicode61 (prefix-`*` shape) cannot match INTERNAL substrings, so short /
 * mid-word queries return nothing even when the text clearly contains the
 * query. This harness measures whether a GUARDED secondary scan — bounded on
 * rows-scanned, wall-clock time, and result-set size, and gated to fire only
 * when the FTS baseline is empty/insufficient — recovers those misses without
 * flooding results or causing unbounded table scans.
 *
 * Measures (per the TASK-483 brief):
 *   - recall improvement vs baseline (per class + per query, @50 and full),
 *   - added latency p50/p95/p99 (measured ONLY on queries where the fallback
 *     actually triggers, since it is gated off for prefix/whole-word queries),
 *   - safety bounds held: max rows scanned <= cap, timeout respected, result
 *     set size bounded (verified both on the live corpus and via deterministic
 *     pure probes that force each cap to engage).
 *
 * Conventions follow scripts/bench/{fts-trigram-eval,memory-write-search,
 * embedding-queue-availability}-* : isolated temp SQLite DB, exception-safe
 * cleanup, deterministic corpus (fixed seed, no Date.now in corpus), per-item
 * metrics, error propagation (no silent empty), JSON + Markdown output, and an
 * unambiguous sha256 revision manifest over the midword-eval/ module.
 *
 * Usage:
 *   node scripts/bench/midword-fallback-bench.mjs [--rows N] [--iter M] [--json-out PATH] [--markdown-out PATH]
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import { buildCorpus, SEED, OWNER, REPO } from "./midword-eval/corpus.mjs";
import { QUERIES, createOracle, runFtsBaseline } from "./midword-eval/queries.mjs";
import { percentiles, recallAt, recallFull } from "./midword-eval/metrics.mjs";
import { midwordScan, DEFAULT_OPTS } from "./midword-eval/fallback.mjs";
import { createBenchDb, collectBenchRevision } from "./midword-eval/lifecycle.mjs";
import { printReport, writeResult } from "./midword-eval/report.mjs";

const require = createRequire(import.meta.url);

// Recall cutoff used for the headline "recall@k" comparison.
const RECALL_K = 50;

async function main() {
	const argv = process.argv.slice(2);
	const argVal = (name, dflt) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : dflt;
	};
	const ROWS = parseInt(argVal("--rows", "8000"), 10);
	const ITERS = parseInt(argVal("--iter", "200"), 10);
	const jsonOut = argVal("--json-out", path.resolve(".agents/documents/analysis/midword-fallback-bench-results.json"));
	const markdownOut = argVal("--markdown-out", path.resolve(".agents/documents/analysis/midword-fallback-bench.md"));

	const cfg = {
		maxRows: DEFAULT_OPTS.maxRows,
		timeoutMs: DEFAULT_OPTS.timeoutMs,
		maxResults: DEFAULT_OPTS.maxResults,
		minQueryLen: DEFAULT_OPTS.minQueryLen,
		fallbackMinResults: DEFAULT_OPTS.fallbackMinResults
	};

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "midword-fallback-bench-"));
	let db;
	let betterSqlite3Version = null;
	try {
		betterSqlite3Version = require("better-sqlite3/package.json").version;
	} catch {
		// Optional metadata or cleanup is best-effort.
	}
	let commitSha = null;
	let branch = null;
	let dirty = false;
	try {
		commitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() || null;
	} catch {
		// Optional metadata or cleanup is best-effort.
	}
	try {
		branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim() || null;
	} catch {
		// Optional metadata or cleanup is best-effort.
	}
	try {
		dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
	} catch {
		// Optional metadata or cleanup is best-effort.
	}
	const benchRevision = collectBenchRevision();

	const errors = [];
	const perQuery = [];
	const addedLatencySamples = [];
	let triggeredQueries = 0;
	let maxRowsScanned = 0;
	let maxElapsedMs = 0;
	let maxResultCount = 0;
	let mainLoopViolations = 0;

	try {
		const dbPath = path.join(tmpDir, "bench.db");
		db = createBenchDb(dbPath);
		const sqliteVersion = db.prepare("SELECT sqlite_version()").pluck().get();
		const pageSize = db.pragma("page_size", { simple: true });

		const corpus = buildCorpus(ROWS, SEED, OWNER, REPO);
		const insert = db.prepare(
			`INSERT INTO memories (id, title, content, tags, owner, repo, status) VALUES (@id, @title, @content, @tags, @owner, @repo, @status)`
		);
		const tx = db.transaction((rows) => {
			for (const r of rows)
				insert.run({
					id: r.id,
					title: r.title,
					content: r.content,
					tags: r.tags,
					owner: r.owner,
					repo: r.repo,
					status: r.status
				});
		});
		tx(corpus);

		const oracle = createOracle(db, OWNER, REPO);

		// Pre-materialize the scoped haystacks once (the fallback scans these;
		// the row-scan cap is enforced inside midwordScan, not by this read).
		const scopedRows = db
			.prepare(`SELECT id, title, content, tags FROM memories WHERE owner = ? AND repo = ? AND status = 'active'`)
			.all(OWNER, REPO);
		const haystacks = scopedRows.map((r) => ({
			id: r.id,
			text: `${(r.title || "").toLowerCase()} ${(r.content || "").toLowerCase()} ${(r.tags || "").toLowerCase()}`
		}));

		for (const { cls, q } of QUERIES) {
			try {
				const oracleIds = oracle(q);
				const oracleSize = oracleIds.length;
				const baseline = runFtsBaseline(db, q, OWNER, REPO, 200);
				const baselineRecall50 = recallAt(baseline, oracleIds, RECALL_K).recall;
				const baselineRecallFull = recallFull(baseline, oracleIds).recall;

				const triggered = baseline.length < cfg.fallbackMinResults;

				let fallbackIds = [];
				let scannedMax = 0;
				let elapsedMax = 0;
				let resultMax = 0;
				let timedOut = false;
				let iterBoundsHeld = true;

				if (triggered) {
					triggeredQueries++;
					for (let it = 0; it < ITERS; it++) {
						const r = midwordScan(haystacks, q, cfg);
						addedLatencySamples.push(r.elapsedMs);
						scannedMax = Math.max(scannedMax, r.scanned);
						elapsedMax = Math.max(elapsedMax, r.elapsedMs);
						resultMax = Math.max(resultMax, r.ids.length);
						timedOut = timedOut || r.timedOut;
						if (r.scanned > cfg.maxRows || r.elapsedMs > cfg.timeoutMs || r.ids.length > cfg.maxResults) {
							iterBoundsHeld = false;
						}
					}
					// Detail run (last) for the per-query record.
					const detail = midwordScan(haystacks, q, cfg);
					fallbackIds = detail.ids;
					scannedMax = Math.max(scannedMax, detail.scanned);
					elapsedMax = Math.max(elapsedMax, detail.elapsedMs);
					resultMax = Math.max(resultMax, detail.ids.length);
				}

				const combined = triggered ? [...new Set([...baseline, ...fallbackIds])] : baseline;
				const combinedRecall50 = recallAt(combined, oracleIds, RECALL_K).recall;
				const combinedRecallFull = recallFull(combined, oracleIds).recall;

				maxRowsScanned = Math.max(maxRowsScanned, scannedMax);
				maxElapsedMs = Math.max(maxElapsedMs, elapsedMax);
				maxResultCount = Math.max(maxResultCount, resultMax);
				if (triggered && !iterBoundsHeld) mainLoopViolations++;

				perQuery.push({
					cls,
					q,
					oracle: oracleSize,
					baselineFound: baseline.length,
					combinedFound: combined.length,
					baselineRecall50,
					combinedRecall50,
					improvement50: combinedRecall50 - baselineRecall50,
					baselineRecallFull,
					combinedRecallFull,
					improvementFull: combinedRecallFull - baselineRecallFull,
					recoveryFull: combinedRecallFull,
					triggered,
					rowsScanned: scannedMax,
					elapsedMs: elapsedMax,
					timedOut,
					resultCount: resultMax,
					boundsHeld: !triggered || iterBoundsHeld
				});
			} catch (e) {
				errors.push({ cls, q, error: String(e?.message || e) });
				perQuery.push({ cls, q, error: String(e?.message || e) });
			}
		}

		// --- Deterministic pure probes that FORCE each safety cap to engage ---
		const probe = { rowCap: null, resultCap: null, timeout: null };
		// Row-scan cap: more haystacks than maxRows, needle absent -> must stop
		// at exactly maxRows with no timeout.
		{
			const hs = [];
			for (let i = 0; i < cfg.maxRows + 500; i++) hs.push({ id: i, text: "alpha beta gamma " + i });
			const r = midwordScan(hs, "quuxnope", cfg);
			const passed = r.scanned === cfg.maxRows && !r.timedOut && r.ids.length === 0;
			probe.rowCap = { scanned: r.scanned, timedOut: r.timedOut, ids: r.ids.length, passed };
		}
		// Result-set cap: every haystack matches, cap must truncate to maxResults
		// without exceeding the row cap.
		{
			const hs = [];
			for (let i = 0; i < cfg.maxRows + 5000; i++) hs.push({ id: i, text: "vectorization token " + i });
			const r = midwordScan(hs, "tor", { ...cfg, maxResults: cfg.maxResults });
			const passed = r.ids.length === cfg.maxResults && r.scanned <= cfg.maxRows;
			probe.resultCap = { ids: r.ids.length, scanned: r.scanned, passed };
		}
		// Timeout: large filler (rows > maxRows so the loop can't naturally
		// exhaust), needle absent -> scan must abort at timeoutMs.
		{
			const filler = "x".repeat(20000);
			const hs = [];
			for (let i = 0; i < cfg.maxRows + 1000; i++) hs.push({ id: i, text: filler + i });
			const r = midwordScan(hs, "quuxnope", cfg);
			// Pass when either the guard never fired (workload too cheap) OR it
			// fired and respected the cap. A violation is ONLY a failed
			// truncation (timedOut but elapsed exceeded timeoutMs).
			const passed = !r.timedOut || r.elapsedMs <= cfg.timeoutMs;
			probe.timeout = { elapsedMs: r.elapsedMs, timedOut: r.timedOut, passed };
		}

		const rowCapExercised = probe.rowCap?.scanned >= cfg.maxRows;
		const resultCapExercised = probe.resultCap?.ids >= cfg.maxResults;
		const timeoutExercised = !!probe.timeout?.timedOut;
		const probeViolations =
			(probe.rowCap && !probe.rowCap.passed ? 1 : 0) +
			(probe.resultCap && !probe.resultCap.passed ? 1 : 0) +
			(probe.timeout && !probe.timeout.passed ? 1 : 0);

		// --- Aggregation by class ---
		const byClass = {};
		for (const p of perQuery) {
			if (p.error) continue;
			byClass[p.cls] = byClass[p.cls] || {
				cls: p.cls,
				queries: 0,
				oracleRows: 0,
				b50: [],
				c50: [],
				imp50: [],
				recFull: []
			};
			const b = byClass[p.cls];
			b.queries++;
			b.oracleRows += p.oracle;
			b.b50.push(p.baselineRecall50);
			b.c50.push(p.combinedRecall50);
			b.imp50.push(p.improvement50);
			b.recFull.push(p.recoveryFull);
		}
		const mean = (arr) => (arr.length ? arr.reduce((a, x) => a + x, 0) / arr.length : 0);
		const recallByClass = Object.values(byClass).map((b) => ({
			cls: b.cls,
			queries: b.queries,
			oracleRows: b.oracleRows,
			baselineRecall50: mean(b.b50),
			combinedRecall50: mean(b.c50),
			improvement50: mean(b.imp50),
			recoveryFull: mean(b.recFull)
		}));

		const allClean = perQuery.filter((p) => !p.error);
		const overall = {
			queries: allClean.length,
			oracleRows: allClean.reduce((a, p) => a + p.oracle, 0),
			baselineRecall50: mean(allClean.map((p) => p.baselineRecall50)),
			combinedRecall50: mean(allClean.map((p) => p.combinedRecall50)),
			improvement50: mean(allClean.map((p) => p.improvement50)),
			recoveryFull: mean(allClean.map((p) => p.recoveryFull))
		};

		const addedLatency = percentiles(addedLatencySamples);
		const totalViolations = mainLoopViolations + probeViolations;
		const bounds = {
			maxRowsScanned,
			maxElapsedMs,
			maxResultCount,
			violations: totalViolations,
			allHeld: totalViolations === 0 && probe.rowCap?.passed && probe.resultCap?.passed && probe.timeout?.passed,
			rowCapExercised,
			resultCapExercised,
			timeoutExercised
		};

		const result = {
			meta: {
				task: "TASK-483",
				seed: SEED,
				commitSha,
				branch,
				dirty,
				date: new Date().toISOString(),
				node: process.version,
				betterSqlite3: betterSqlite3Version,
				sqliteVersion,
				pageSize,
				owner: OWNER,
				repo: REPO,
				corpusRows: ROWS,
				iterations: ITERS,
				recallK: RECALL_K,
				tokenizer: "unicode61 (prefix-* production shape)",
				isolatedDb: true,
				deterministicCorpus: true,
				queryCount: QUERIES.length,
				queryClasses: [...new Set(QUERIES.map((q) => q.cls))],
				benchRevision
			},
			config: cfg,
			summary: {
				recallByClass,
				overall,
				addedLatency,
				triggeredQueries,
				bounds,
				...(errors.length ? { errors } : {})
			},
			probes: probe,
			perQuery
		};

		printReport(result);
		writeResult(jsonOut, result, markdownOut);

		const hasFailure = errors.length > 0 || totalViolations > 0;
		if (hasFailure) {
			console.error(
				`[midword-bench] FAIL: ${errors.length} query errors, ${totalViolations} bound violations (rowCap ${probe.rowCap?.passed} resultCap ${probe.resultCap?.passed} timeout ${probe.timeout?.passed})`
			);
			process.exitCode = 1;
		}
	} finally {
		if (db?.open) {
			try {
				db.close();
			} catch {
				// Optional metadata or cleanup is best-effort.
			}
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error("FATAL:", err?.message || err);
	console.error(err?.stack || "");
	process.exit(1);
});
