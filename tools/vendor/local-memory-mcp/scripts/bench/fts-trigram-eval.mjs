#!/usr/bin/env node
/**
 * FTS5 tokenizer evaluation: unicode61 (prefix-`*`, production) vs trigram
 * for the memories_fts index (TASK-295 / design P5 of
 * .agents/documents/optimization/optimization-memories-fts5.md §9).
 *
 * Decision-gate harness — measurement only, NO production code is touched:
 * it builds an isolated temp SQLite DB (pragmas mirrored from
 * src/mcp/storage/sqlite.ts) with two identical external-content FTS5 tables
 * (unicode61 vs trigram) fed from the same synthetic + real-ish corpus
 * (EN / ID / CJK), then measures per tokenizer:
 *
 *   - recall @10 / @k on a labeled query set (oracle = LIKE `%q%`, the
 *     permanent production fallback), for both the production MATCH shape
 *     (every term gets a `*` prefix via buildFtsMatchQuery) and a raw trigram
 *     shape (no `*` — native substring matching),
 *   - index size (shadow-table bytes + fts5vocab token counts when available),
 *   - per-query latency p50/p95/p99 vs the LIKE baseline,
 *   - EXPLAIN QUERY PLAN for representative slow MATCH shapes,
 *   - the <3-char corner (queries of length 1/2/3) with explicit per-tokenizer
 *     hit counts, and CJK contiguous-run vs mid-run substring behavior.
 *
 * This file is the orchestrator. Concerns are split into scripts/bench/fts-eval/:
 *   - corpus.mjs   : deterministic PRNG, sentence pools, corpus builders
 *   - queries.mjs  : query set, MATCH-shape builder, LIKE oracle
 *   - metrics.mjs  : percentiles + recall@k
 *   - size.mjs     : index-footprint measurement (cross-DB delta)
 *   - report.mjs   : human-readable report + JSON writer
 *
 * Usage:
 *   node scripts/bench/fts-trigram-eval.mjs [--rows N] [--iter M] [--json-out PATH]
 *
 * Prints a human-readable report snippet then a JSON summary (also written to
 * --json-out, default `.agents/documents/analysis/fts5-trigram-eval-results.json`).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import Database from "better-sqlite3";

import { buildCorpus, buildUniqueCorpus } from "./fts-eval/corpus.mjs";
import {
	QUERIES,
	SLOW_SHAPES,
	EXPLAIN_SHAPES,
	buildFtsMatchQuery,
	rawShape,
	createOracle
} from "./fts-eval/queries.mjs";
import { percentiles, recallAt } from "./fts-eval/metrics.mjs";
import { measureSizes } from "./fts-eval/size.mjs";
import { printReport, writeResult } from "./fts-eval/report.mjs";

const require = createRequire(import.meta.url);

async function main() {
	const argv = process.argv.slice(2);
	const argVal = (name, dflt) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : dflt;
	};
	const ROWS = parseInt(argVal("--rows", "8000"), 10);
	const ITERS = parseInt(argVal("--iter", "300"), 10);
	const jsonOut = argVal("--json-out", path.resolve(".agents/documents/analysis/fts5-trigram-eval-results.json"));
	const markdownOut = argVal("--markdown-out", path.resolve(".agents/documents/analysis/fts5-trigram-eval-results.md"));
	const seed = 0x295;
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fts-trigram-eval-"));
	const dbPath = path.join(tmpDir, "eval.db");
	let db;
	try {
		db = new Database(dbPath);
		db.pragma("journal_mode = WAL");
		db.pragma("synchronous = NORMAL");
		db.pragma("busy_timeout = 5000");
		db.pragma("wal_autocheckpoint = 1000");
		const sqliteVersion = db.prepare("SELECT sqlite_version()").pluck().get();
		const pageSize = db.pragma("page_size", { simple: true });

		// Schema — mirrors v10-memories-fts but with TWO tokenizer variants.
		db.exec(`
		CREATE TABLE memories (id INTEGER PRIMARY KEY, title TEXT, content TEXT NOT NULL, tags TEXT);
		CREATE VIRTUAL TABLE memories_fts_unicode USING fts5(
			title, content, tags,
			content='memories', content_rowid='id', tokenize='unicode61'
		);
		CREATE VIRTUAL TABLE memories_fts_trigram USING fts5(
			title, content, tags,
			content='memories', content_rowid='id', tokenize='trigram'
		);
	`);

		// Corpus.
		const corpus = buildCorpus(ROWS);
		const uniqueCorpus = buildUniqueCorpus(ROWS);
		const insert = db.prepare("INSERT INTO memories (id, title, content, tags) VALUES (@id, @title, @content, @tags)");
		const fill = db.transaction((rows) => {
			for (const r of rows) insert.run(r);
		});
		fill(corpus);
		db.exec(`
		INSERT INTO memories_fts_unicode(rowid, title, content, tags) SELECT id, title, content, tags FROM memories;
		INSERT INTO memories_fts_trigram(rowid, title, content, tags) SELECT id, title, content, tags FROM memories;
	`);

		// fts5vocab token counts (best-effort). 'instance' = one row per token
		// occurrence (accurate token counts; 'row' undercounts to per-doc terms).
		const vocab = { unicode: null, trigram: null };
		try {
			db.exec(
				"CREATE VIRTUAL TABLE vocab_unicode USING fts5vocab(memories_fts_unicode, 'instance'); CREATE VIRTUAL TABLE vocab_trigram USING fts5vocab(memories_fts_trigram, 'instance');"
			);
			vocab.unicode = db
				.prepare("SELECT COUNT(*) AS tokens, COUNT(DISTINCT term) AS distinct_terms FROM vocab_unicode")
				.get();
			vocab.trigram = db
				.prepare("SELECT COUNT(*) AS tokens, COUNT(DISTINCT term) AS distinct_terms FROM vocab_trigram")
				.get();
		} catch {
			// fts5vocab unavailable → tokens omitted.
		}

		const { sizeRepetitive, sizeUnique, sizeUnicode, sizeTrigram } = measureSizes(
			Database,
			fs,
			tmpDir,
			corpus,
			uniqueCorpus
		);

		// Prepared statements.
		const likeStmt = db.prepare(
			`SELECT id FROM memories WHERE content LIKE ? OR title LIKE ? OR tags LIKE ? ORDER BY id LIMIT ${50}`
		);
		const stmt = {
			unicode: (k) =>
				db.prepare(
					`SELECT rowid FROM memories_fts_unicode WHERE memories_fts_unicode MATCH ? ORDER BY bm25(memories_fts_unicode) LIMIT ${k}`
				),
			trigram: (k) =>
				db.prepare(
					`SELECT rowid FROM memories_fts_trigram WHERE memories_fts_trigram MATCH ? ORDER BY bm25(memories_fts_trigram) LIMIT ${k}`
				)
		};
		const { oracleRows } = createOracle(db);

		// --- Recall sweep ---
		const recallByClass = {};
		const shortCorner = [];
		const cjkNotes = [];
		const probes = [];
		const perQuery = [];
		for (const { cls, q } of QUERIES) {
			const oracle = oracleRows(q);
			const prod = buildFtsMatchQuery(q);
			const raw = rawShape(prod);
			const k10 = recallAt(stmt, "unicode", prod, oracle, 10);
			const k50u = recallAt(stmt, "unicode", prod, oracle, 50);
			const t10 = recallAt(stmt, "trigram", prod, oracle, 10);
			const t50t = recallAt(stmt, "trigram", prod, oracle, 50);
			const tr10 = recallAt(stmt, "trigram", raw, oracle, 10);
			const tr50 = recallAt(stmt, "trigram", raw, oracle, 50);

			perQuery.push({
				cls,
				q,
				oracle: oracle.length,
				prod,
				raw,
				unicode: { r10: k10, r50: k50u },
				trigram: { r10: t10, r50: t50t },
				trigramRaw: { r10: tr10, r50: tr50 }
			});
			recallByClass[cls] = recallByClass[cls] || [];
			recallByClass[cls].push({
				q,
				oracle: oracle.length,
				uniR10: k10.recall,
				uniR50: k50u.recall,
				triR10: t10.recall,
				triR50: t50t.recall,
				triRawR10: tr10.recall,
				triRawR50: tr50.recall,
				uniFound: k50u.found,
				triFound: t50t.found,
				triRawFound: tr50.found
			});

			if (cls === "short") {
				shortCorner.push({
					q,
					len: q.length,
					oracle: oracle.length,
					unicode_found: k50u.found,
					trigram_found: t50t.found,
					trigram_err: t50t.err
				});
			}
			if (cls === "diacritic") {
				probes.push({
					label: "diacritic",
					q,
					oracle: oracle.length,
					unicode_found: k50u.found,
					trigram_found: t50t.found,
					note: "unicode61 folds diacritics (café→cafe); trigram is byte-sensitive, LIKE is byte-sensitive"
				});
			}
			if (cls === "case") {
				probes.push({
					label: "case-sensitivity",
					q,
					oracle: oracle.length,
					unicode_found: k50u.found,
					trigram_found: t50t.found,
					note: "both fold ASCII case in SQLite 3.53 (trigram is case-insensitive for ASCII; unicode61 also folds + strips diacritics)"
				});
			}
			if (cls === "cjk" || cls === "cjk-midrun" || cls === "cjk-run3" || cls === "cjk-3char") {
				cjkNotes.push({
					q,
					len: q.length,
					oracle: oracle.length,
					uni_found: k50u.found,
					uni_recall50: k50u.recall,
					tri_found: t50t.found,
					tri_recall50: t50t.recall,
					triRaw_found: tr50.found,
					triRaw_recall50: tr50.recall,
					prod,
					raw
				});
			}
		}

		const classSummary = Object.entries(recallByClass).map(([cls, items]) => {
			const agg = (key) => {
				const vals = items.map((i) => i[key]).filter((v) => v !== null && v !== undefined);
				return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
			};
			const oracleTotal = items.reduce((a, i) => a + i.oracle, 0);
			return {
				cls,
				queries: items.length,
				oracleRows: oracleTotal,
				uni_recall10: agg("uniR10"),
				uni_recall50: agg("uniR50"),
				tri_recall10: agg("triR10"),
				tri_recall50: agg("triR50"),
				triRaw_recall10: agg("triRawR10"),
				triRaw_recall50: agg("triRawR50"),
				uni_found: items.reduce((a, i) => a + i.uniFound, 0),
				tri_found: items.reduce((a, i) => a + i.triFound, 0),
				triRaw_found: items.reduce((a, i) => a + i.triRawFound, 0)
			};
		});

		// --- Latency ---
		const latency = [];
		for (const { name, q } of SLOW_SHAPES) {
			const prod = buildFtsMatchQuery(q);
			const raw = rawShape(prod);
			const uniStmt = stmt.unicode(50);
			const triStmt = stmt.trigram(50);
			const triRawStmt = stmt.trigram(50);
			const samples = { unicode: [], trigram: [], trigramRaw: [], like: [] };
			for (let i = 0; i < ITERS; i++) {
				let t = process.hrtime.bigint();
				uniStmt.all(prod);
				samples.unicode.push(Number(process.hrtime.bigint() - t) / 1e6);
				t = process.hrtime.bigint();
				try {
					triStmt.all(prod);
					samples.trigram.push(Number(process.hrtime.bigint() - t) / 1e6);
				} catch {
					// trigram shape errored — record a NaN-flagged entry
					samples.trigram.push(Number.NaN);
				}
				t = process.hrtime.bigint();
				triRawStmt.all(raw);
				samples.trigramRaw.push(Number(process.hrtime.bigint() - t) / 1e6);
				t = process.hrtime.bigint();
				likeStmt.all(`%${q}%`, `%${q}%`, `%${q}%`);
				samples.like.push(Number(process.hrtime.bigint() - t) / 1e6);
			}
			const clean = (arr) => arr.filter((v) => !Number.isNaN(v));
			latency.push({
				name,
				q,
				prod,
				unicode_ms: percentiles(clean(samples.unicode)),
				trigram_ms: percentiles(clean(samples.trigram)),
				trigramRaw_ms: percentiles(clean(samples.trigramRaw)),
				like_ms: percentiles(clean(samples.like)),
				oracle: oracleRows(q).length
			});
		}

		// --- EXPLAIN QUERY PLAN ---
		const explain = [];
		for (const { name, q } of EXPLAIN_SHAPES) {
			const prod = buildFtsMatchQuery(q);
			const raw = rawShape(prod);
			const plan = (sql, params) => {
				try {
					return db
						.prepare(`EXPLAIN QUERY PLAN ${sql}`)
						.all(...params)
						.map((r) => r.detail || JSON.stringify(r));
				} catch (e) {
					return [`ERROR: ${String(e.message || e).split("\n")[0]}`];
				}
			};
			const ftsSql = (tbl) => `SELECT rowid FROM ${tbl} WHERE ${tbl} MATCH ?`;
			explain.push({
				name,
				q,
				unicode_prod: plan(ftsSql("memories_fts_unicode"), [prod]),
				trigram_prod: plan(ftsSql("memories_fts_trigram"), [prod]),
				trigram_raw: plan(ftsSql("memories_fts_trigram"), [raw]),
				like: plan("SELECT id FROM memories WHERE content LIKE ? OR title LIKE ? OR tags LIKE ?", [
					`%${q}%`,
					`%${q}%`,
					`%${q}%`
				])
			});
		}

		let commitSha = null;
		try {
			commitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() || null;
		} catch {
			commitSha = null;
		}
		let memory = null;
		try {
			const heapUsed = process.memoryUsage().heapUsed;
			let dbBytes = null;
			try {
				const st = fs.statSync(dbPath);
				dbBytes = st.size;
			} catch {
				dbBytes = null;
			}
			memory = { heapUsed, dbBytes };
		} catch {
			memory = null;
		}

		// --- Output assembly ---
		const result = {
			meta: {
				task: "TASK-477",
				seed,
				commitSha,
				memory,
				date: new Date().toISOString(),
				node: process.version,
				betterSqlite3: require("better-sqlite3/package.json").version,
				sqliteVersion,
				pageSize,
				corpusRows: ROWS,
				iterations: ITERS,
				corpusSource:
					"EN+ID+CJK sentences, tech identifiers, prefix-family stems, mid-word probes, café/WORKSPACE-BINARY case probes",
				productionShape: "buildFtsMatchQuery (every term suffixed `*`, phrases verbatim, AND, cap 8)"
			},
			recall: { classSummary, perQuery },
			size: {
				unicode: { ...sizeUnicode, vocab: vocab.unicode },
				trigram: { ...sizeTrigram, vocab: vocab.trigram },
				repetitiveCorpus: {
					unicodeBytes: sizeRepetitive.unicodeBytes,
					trigramBytes: sizeRepetitive.trigramBytes,
					deltaBytes: sizeRepetitive.trigramBytes - sizeRepetitive.unicodeBytes,
					ratio: sizeRepetitive.ratio
				},
				uniqueCorpus: {
					unicodeBytes: sizeUnique.unicodeBytes,
					trigramBytes: sizeUnique.trigramBytes,
					deltaBytes: sizeUnique.trigramBytes - sizeUnique.unicodeBytes,
					ratio: sizeUnique.ratio
				}
			},
			shortCorner,
			cjk: cjkNotes,
			probes,
			latency,
			explain
		};

		printReport({
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
		});
		writeResult(jsonOut, result, markdownOut);
	} finally {
		if (db?.open) db.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error("FATAL:", JSON.stringify(err && err.message));
	console.error("CODE:", JSON.stringify(err && err.code));
	process.exit(1);
});
