#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, execSync } from "child_process";
import { createRequire } from "module";
import Database from "better-sqlite3";

import { buildMemoryCorpus, BENCH_EPOCH_MS, BENCH_EPOCH_ISO, BENCH_MAX_AGE_MS } from "./memory-eval/corpus.mjs";
import { QUERY_SETS } from "./memory-eval/queries.mjs";
import { percentiles, throughput } from "./memory-eval/metrics.mjs";
import { printReport, writeResult } from "./memory-eval/report.mjs";

const VECTOR_CANDIDATE_CAP = (() => {
	const v = parseInt(process.env.VECTOR_CANDIDATE_CAP || "", 10);
	return Number.isFinite(v) && v > 0 ? v : 100;
})();
const MIN_CANDIDATES = (() => {
	const v = parseInt(process.env.VECTOR_MIN_CANDIDATES || "", 10);
	return Number.isFinite(v) && v > 0 ? v : 10;
})();

class SearchError extends Error {
	constructor(message, mode) {
		super(message);
		this.name = "SearchError";
		this.mode = mode;
	}
}

const require = createRequire(import.meta.url);

function computeVector(text) {
	const tokens = text
		.toLowerCase()
		.replace(/[^\w\s\u00C0-\u017F]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(/\s+/)
		.filter((w) => w.length > 2);
	const STOP = new Set([
		"the",
		"and",
		"for",
		"are",
		"with",
		"this",
		"that",
		"from",
		"have",
		"has",
		"was",
		"were",
		"been",
		"will",
		"would",
		"can",
		"could",
		"should",
		"about",
		"into",
		"through",
		"using",
		"before",
		"after",
		"yang",
		"dan",
		"untuk",
		"dari",
		"dengan",
		"adalah",
		"pada",
		"dalam",
		"akan",
		"oleh",
		"karena",
		"sebagai",
		"juga",
		"tidak",
		"telah"
	]);
	const filtered = tokens.filter((w) => !STOP.has(w));
	const vec = Object.create(null);
	for (const tok of filtered) vec[tok] = (vec[tok] || 0) + 1;
	return vec;
}

function cosineSimilarity(v1, v2) {
	const k1 = Object.keys(v1);
	const k2 = Object.keys(v2);
	if (!k1.length || !k2.length) return 0;
	let dot = 0;
	for (const k of k1) if (Object.hasOwn(v2, k)) dot += v1[k] * v2[k];
	let m1 = 0;
	for (const k of k1) m1 += v1[k] * v1[k];
	let m2 = 0;
	for (const k of k2) m2 += v2[k] * v2[k];
	const mag = Math.sqrt(m1) * Math.sqrt(m2);
	return mag === 0 ? 0 : dot / mag;
}

function buildFtsMatchQuery(raw) {
	if (!raw) return "";
	const trimmed = raw.trim();
	if (!trimmed) return "";
	const phrases = [];
	const phraseRanges = [];
	const re = /"([^"]+)"/g;
	let m;
	while ((m = re.exec(trimmed)) !== null) {
		const sanitized = (m[1] || "")
			.replace(/[^\p{L}\p{N}_\s]/gu, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (sanitized.length > 0) phrases.push(`"${sanitized}"`);
		phraseRanges.push({ start: m.index, end: m.index + m[0].length });
	}
	let remaining = "";
	let cursor = 0;
	for (const r of phraseRanges) {
		remaining += trimmed.slice(cursor, r.start) + " ";
		cursor = r.end;
	}
	remaining += trimmed.slice(cursor);
	const cleaned = remaining
		.replace(/["()*:~^+-]/g, " ")
		.replace(/[^\p{L}\p{N}_\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
	const terms = cleaned
		.split(" ")
		.filter(Boolean)
		.map((t) => `${t}*`);
	const all = [...phrases, ...terms];
	if (all.length === 0) return "";
	return all.slice(0, 8).join(" AND ");
}

function createBenchDb(dbPath) {
	if (dbPath !== ":memory:") {
		const dir = path.dirname(dbPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	}
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("busy_timeout = 5000");
	db.pragma("wal_autocheckpoint = 1000");
	db.exec(`
		CREATE TABLE IF NOT EXISTS memories (
			id TEXT PRIMARY KEY, code TEXT, repo TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '',
			type TEXT NOT NULL, title TEXT, content TEXT NOT NULL, importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
			folder TEXT, language TEXT, branch TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
			hit_count INTEGER NOT NULL DEFAULT 0, recall_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT,
			agent TEXT NOT NULL DEFAULT 'unknown', role TEXT NOT NULL DEFAULT 'unknown', model TEXT NOT NULL DEFAULT 'unknown',
			completed_at TEXT, expires_at TEXT, supersedes TEXT, status TEXT NOT NULL DEFAULT 'active',
			is_global INTEGER NOT NULL DEFAULT 0, tags TEXT, metadata TEXT
		);
		CREATE TABLE IF NOT EXISTS memory_vectors (memory_id TEXT PRIMARY KEY, vector TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE);
		CREATE TABLE IF NOT EXISTS memory_tags (memory_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (memory_id, tag), FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE);
		CREATE INDEX IF NOT EXISTS idx_memory_tags_tag ON memory_tags(tag COLLATE NOCASE);
		CREATE INDEX IF NOT EXISTS idx_memories_repo ON memories(repo);
		CREATE INDEX IF NOT EXISTS idx_memories_owner_repo ON memories(owner, repo);
	`);
	const ftsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'").get();
	if (!ftsExists) {
		db.exec(`
			CREATE VIRTUAL TABLE memories_fts USING fts5(title, content, tags, content='memories', content_rowid='rowid', tokenize='unicode61');
			CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags); END;
			CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags); END;
			CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags); INSERT INTO memories_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags); END;
		`);
	}
	return db;
}

function searchFts(db, query, owner, repo, limit = 10) {
	const safeQuery = buildFtsMatchQuery(query);
	if (!safeQuery) return [];
	try {
		const rows = db
			.prepare(
				`SELECT m.* FROM memories_fts fts JOIN memories m ON m.rowid = fts.rowid WHERE memories_fts MATCH ? AND m.owner = ? AND m.repo = ? AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY bm25(memories_fts), m.importance DESC, m.created_at DESC LIMIT ?`
			)
			.all(safeQuery, owner, repo, new Date(BENCH_EPOCH_MS).toISOString(), limit);
		return rows;
	} catch (cause) {
		throw new SearchError(`FTS search failed for ${JSON.stringify(query)}: ${cause?.message || cause}`, "fts");
	}
}

function getPersistedVector(db, memoryId) {
	let row;
	try {
		row = db.prepare(`SELECT vector FROM memory_vectors WHERE memory_id = ?`).get(memoryId);
	} catch (cause) {
		throw new SearchError(`persisted vector read failed for ${memoryId}: ${cause?.message || cause}`, "vector");
	}
	if (!row?.vector) return null;
	try {
		const parsed = JSON.parse(row.vector);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
		throw new SearchError(`persisted vector for ${memoryId} is not an object`, "vector");
	} catch (cause) {
		if (cause instanceof SearchError) throw cause;
		throw new SearchError(`persisted vector parse failed for ${memoryId}: ${cause?.message || cause}`, "vector");
	}
}

function searchSemantic(db, query, owner, repo, limit = 10, tfCache = new Map()) {
	const queryVector = computeVector(query);
	const candidateLimit = Math.max(limit, MIN_CANDIDATES);
	const capLimited = Math.min(candidateLimit, VECTOR_CANDIDATE_CAP);
	const nowIso = new Date(BENCH_EPOCH_MS).toISOString();
	const candidates = db
		.prepare(
			`SELECT * FROM memories WHERE owner = ? AND repo = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?) ORDER BY importance DESC, created_at DESC LIMIT ?`
		)
		.all(owner, repo, nowIso, capLimited);
	const scored = candidates
		.map((row) => {
			let vec = getPersistedVector(db, row.id);
			if (!vec) {
				vec = tfCache.get(row.id);
				if (!vec || tfCache.get(row.id + ":updated") !== row.updated_at) {
					vec = computeVector(row.content);
					tfCache.set(row.id, vec);
					tfCache.set(row.id + ":updated", row.updated_at);
					if (tfCache.size > 2048) {
						const keys = [...tfCache.keys()].slice(0, 1024);
						for (const k of keys) tfCache.delete(k);
					}
				}
			}
			const sim = cosineSimilarity(queryVector, vec);
			return { row, sim };
		})
		.filter((r) => r.sim > 0)
		.sort((a, b) => b.sim - a.sim)
		.slice(0, limit);
	return scored.map((s) => s.row);
}

function hybridSearch(db, query, owner, repo, limit = 10, tfCache) {
	const ftsRows = searchFts(db, query, owner, repo, 100);
	const ftsScoreMap = new Map();
	if (ftsRows.length > 0) {
		let bm25Rows;
		try {
			const safeQuery = buildFtsMatchQuery(query);
			if (!safeQuery) bm25Rows = [];
			else
				bm25Rows = db
					.prepare(
						`SELECT m.*, bm25(memories_fts) AS bm25_score FROM memories_fts fts JOIN memories m ON m.rowid = fts.rowid WHERE memories_fts MATCH ? AND ((m.owner = ? AND m.repo = ?) OR m.is_global = 1) AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY bm25_score LIMIT ?`
					)
					.all(safeQuery, owner, repo, new Date(BENCH_EPOCH_MS).toISOString(), 100);
		} catch (cause) {
			throw new SearchError(
				`hybrid bm25 segment failed for ${JSON.stringify(query)}: ${cause?.message || cause}`,
				"hybrid"
			);
		}
		if (bm25Rows.length > 0) {
			let minB = Infinity,
				maxB = -Infinity;
			for (const r of bm25Rows) {
				if (r.bm25_score < minB) minB = r.bm25_score;
				if (r.bm25_score > maxB) maxB = r.bm25_score;
			}
			const range = maxB - minB;
			for (const r of bm25Rows) {
				const norm = range === 0 ? 1.0 : 1 - (r.bm25_score - minB) / range;
				ftsScoreMap.set(r.id, norm);
			}
		}
	}
	const semRows = searchSemantic(db, query, owner, repo, 100, tfCache);
	const candidates = new Map();
	for (const r of semRows) {
		const persisted = getPersistedVector(db, r.id);
		const vec = persisted || computeVector(r.content);
		candidates.set(r.id, { row: r, sim: cosineSimilarity(computeVector(query), vec) });
	}
	for (const r of ftsRows) if (!candidates.has(r.id)) candidates.set(r.id, { row: r, sim: 0 });
	const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
	const scored = [...candidates.values()]
		.map(({ row, sim }) => {
			const keyword = ftsScoreMap.get(row.id) ?? 0;
			const recency = Math.pow(2, -(BENCH_EPOCH_MS - new Date(row.created_at).getTime()) / (30 * 24 * 60 * 60 * 1000));
			const domain = row.tags
				? (() => {
						try {
							const tags = JSON.parse(row.tags);
							const qSet = new Set(queryTerms);
							return tags.filter((t) => qSet.has(String(t).toLowerCase())).length / Math.max(tags.length, 1);
						} catch {
							return 0;
						}
					})()
				: 0;
			const final = sim * 0.4 + keyword * 0.3 + recency * 0.15 + domain * 0.15;
			return { row, final };
		})
		.sort((a, b) => b.final - a.final);
	const threshold = 0.4;
	const eligible = scored.filter((s) => s.final >= threshold);
	return eligible.slice(0, limit).map((s) => s.row);
}

async function main() {
	const argv = process.argv.slice(2);
	const argVal = (name, dflt) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : dflt;
	};
	const scalesArg = argVal("--scales", "1000,10000,100000");
	const scales = scalesArg
		.split(",")
		.map((s) => parseInt(s.trim(), 10))
		.filter((n) => Number.isFinite(n) && n > 0);
	const ITERS = parseInt(argVal("--iter", "100"), 10);
	const jsonOut = argVal(
		"--json-out",
		path.resolve(".agents/documents/analysis/memory-write-search-bench-results.json")
	);
	const markdownOut = argVal("--markdown-out", path.resolve(".agents/documents/analysis/memory-write-search-bench.md"));
	const seed = 0x478;
	const owner = "bench";
	const repo = "bench-repo";
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-write-search-bench-"));
	let hardwareLimit = null;
	const scaleResults = [];

	try {
		for (const rows of scales) {
			const scaleTmpDir = path.join(tmpDir, `scale-${rows}`);
			fs.mkdirSync(scaleTmpDir, { recursive: true });
			const dbPath = path.join(scaleTmpDir, "bench.db");
			let db = null;
			try {
				db = createBenchDb(dbPath);
				const sqliteVersion = db.prepare("SELECT sqlite_version()").pluck().get();
				const pageSize = db.pragma("page_size", { simple: true });
				const corpus = buildMemoryCorpus(rows, seed + rows, owner, repo, {
					benchEpochMs: BENCH_EPOCH_MS,
					maxAgeMs: BENCH_MAX_AGE_MS
				});

				const insertStmt = db.prepare(
					`INSERT INTO memories (id, code, repo, owner, type, title, content, importance, folder, language, branch, created_at, updated_at, hit_count, recall_count, last_used_at, agent, role, model, completed_at, expires_at, supersedes, status, is_global, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				);
				const vectorStmt = db.prepare(
					`INSERT INTO memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET vector = excluded.vector, updated_at = excluded.updated_at`
				);
				const tagStmt = db.prepare(`INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)`);

				function insertEntries(entries, epochIso) {
					for (const entry of entries) {
						insertStmt.run(
							entry.id,
							entry.code || null,
							entry.scope.repo,
							entry.scope.owner,
							entry.type,
							entry.title || null,
							entry.content,
							entry.importance,
							entry.scope.folder || null,
							entry.scope.language || null,
							entry.scope.branch || null,
							entry.created_at,
							entry.updated_at,
							entry.agent || "unknown",
							entry.role || "unknown",
							entry.model || "unknown",
							entry.completed_at || null,
							entry.expires_at ?? null,
							entry.supersedes ?? null,
							entry.status || "active",
							entry.is_global ? 1 : 0,
							entry.tags ? JSON.stringify(entry.tags) : null,
							entry.metadata ? JSON.stringify(entry.metadata) : null
						);
						const text = entry.content;
						const freq = computeVector(text);
						vectorStmt.run(entry.id, JSON.stringify(freq), epochIso || new Date(BENCH_EPOCH_MS).toISOString());
						for (const tag of entry.tags) tagStmt.run(entry.id, tag);
					}
				}

				const writeSamples = [];
				let writeErrors = 0;
				const writeStart = process.hrtime.bigint();
				const writeEpochIso = new Date(BENCH_EPOCH_MS).toISOString();
				const tx = db.transaction((entries) => {
					for (const entry of entries) {
						const t0 = process.hrtime.bigint();
						try {
							insertEntries([entry], writeEpochIso);
						} catch {
							writeErrors++;
						}
						writeSamples.push(Number(process.hrtime.bigint() - t0) / 1e6);
					}
				});
				tx(corpus);
				const foreignOwner = "bench-foreign";
				const foreignRepo = "bench-foreign-repo";
				const foreignCount = Math.min(200, Math.max(50, Math.floor(rows * 0.05)));
				const rawForeign = buildMemoryCorpus(foreignCount, seed + rows + 99991, foreignOwner, foreignRepo, {
					benchEpochMs: BENCH_EPOCH_MS,
					maxAgeMs: BENCH_MAX_AGE_MS
				});
				const foreignCorpus = rawForeign.map((e, idx) => ({
					...e,
					id: `00000000-0000-4000-b000-${String(700000 + idx).padStart(12, "0")}`,
					code: `MEM-FGN-${String(idx).padStart(6, "0")}`
				}));
				const corpusIds = new Set(corpus.map((e) => e.id));
				for (const fe of foreignCorpus) corpusIds.add(fe.id);
				const foreignTx = db.transaction((entries) => insertEntries(entries, writeEpochIso));
				foreignTx(foreignCorpus);
				const globalId = corpusIds.has("00000000-0000-4000-a000-999999999999")
					? "00000000-0000-4000-c000-999999999999"
					: "00000000-0000-4000-a000-999999999999";
				const globalEntry = {
					id: globalId,
					code: "MEM-GLOBAL-000001",
					type: "code_fact",
					title: "Global memory anchor",
					content: "Global shared context visible across tenants via is_global flag for bench isolation checks.",
					importance: 5,
					scope: { owner, repo },
					created_at: new Date(BENCH_EPOCH_MS - 1000).toISOString(),
					updated_at: new Date(BENCH_EPOCH_MS - 500).toISOString(),
					completed_at: null,
					hit_count: 0,
					recall_count: 0,
					last_used_at: null,
					expires_at: null,
					supersedes: null,
					status: "active",
					agent: "bench",
					role: "benchmark",
					model: "bench-model",
					tags: ["global", "shared"],
					metadata: {},
					is_global: true
				};
				const globalTx = db.transaction(() => insertEntries([globalEntry], writeEpochIso));
				globalTx();
				const writeElapsedMs = Number(process.hrtime.bigint() - writeStart) / 1e6;
				const writeLatency = percentiles(writeSamples);
				const writeThroughput = throughput(corpus.length, writeElapsedMs);

				let dbBytes = null;
				try {
					db.pragma("wal_checkpoint(TRUNCATE)");
					let bytes = fs.statSync(dbPath).size;
					const wal = `${dbPath}-wal`;
					if (fs.existsSync(wal)) bytes += fs.statSync(wal).size;
					dbBytes = bytes;
				} catch {
					dbBytes = null;
				}
				let heapBytes = null;
				try {
					heapBytes = process.memoryUsage().heapUsed;
				} catch {
					heapBytes = null;
				}

				const tfCache = new Map();
				const searchModes = ["fts", "semantic", "hybrid"];
				const searchResults = {};

				for (const mode of searchModes) {
					const samples = [];
					let searchErrors = 0;
					let zeroResults = 0;
					let totalResults = 0;
					let totalOps = 0;
					const errorByType = { SearchError: 0, other: 0 };
					const modeStart = process.hrtime.bigint();
					for (let iter = 0; iter < ITERS; iter++) {
						for (const { query } of QUERY_SETS) {
							const t0 = process.hrtime.bigint();
							try {
								let results = [];
								if (mode === "fts") results = searchFts(db, query, owner, repo, 10);
								else if (mode === "semantic") results = searchSemantic(db, query, owner, repo, 10, tfCache);
								else results = hybridSearch(db, query, owner, repo, 10, tfCache);
								const len = Array.isArray(results) ? results.length : 0;
								totalResults += len;
								if (len === 0) zeroResults++;
							} catch (err) {
								searchErrors++;
								if (err?.name === "SearchError") errorByType.SearchError++;
								else errorByType.other++;
							}
							samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
							totalOps++;
						}
					}
					const elapsedMs = Number(process.hrtime.bigint() - modeStart) / 1e6;
					const latency = percentiles(samples);
					const tp = throughput(totalOps, elapsedMs);
					const avgResults = totalOps > 0 ? totalResults / totalOps : 0;
					searchResults[mode] = {
						latency,
						throughput: tp,
						errors: searchErrors,
						zeroResults,
						errorByType,
						total: totalOps,
						avgResults,
						elapsedMs
					};
				}

				const perQueryBreakdown = [];
				for (const { kind, query } of QUERY_SETS) {
					const qSamples = [];
					let qSearchErrors = 0;
					let qZeroResults = 0;
					let qTotalResults = 0;
					const iters = Math.min(ITERS, 20);
					for (let iter = 0; iter < iters; iter++) {
						const t0 = process.hrtime.bigint();
						try {
							const results = hybridSearch(db, query, owner, repo, 10, tfCache);
							const len = Array.isArray(results) ? results.length : 0;
							qTotalResults += len;
							if (len === 0) qZeroResults++;
						} catch {
							qSearchErrors++;
						}
						qSamples.push(Number(process.hrtime.bigint() - t0) / 1e6);
					}
					const lat = percentiles(qSamples);
					perQueryBreakdown.push({
						kind,
						query: query || "(empty)",
						p50: lat.p50,
						p95: lat.p95,
						p99: lat.p99,
						mean: lat.mean,
						avgResults: qSamples.length ? qTotalResults / qSamples.length : 0,
						errors: qSearchErrors,
						zeroResults: qZeroResults
					});
				}

				const isolationProbes = [];
				const isolationQueries = [
					{ corpusQuery: "vector", probeTenant: { owner: foreignOwner, repo: foreignRepo }, expectLeak: false },
					{ corpusQuery: "memory", probeTenant: { owner: foreignOwner, repo: foreignRepo }, expectLeak: false },
					{ corpusQuery: "cache", probeTenant: { owner: foreignOwner, repo: foreignRepo }, expectLeak: false }
				];
				for (const { corpusQuery, probeTenant, expectLeak } of isolationQueries) {
					const ftsLeak = searchFts(db, corpusQuery, probeTenant.owner, probeTenant.repo, 10);
					const semLeak = searchSemantic(db, corpusQuery, probeTenant.owner, probeTenant.repo, 10, tfCache);
					const leakedFts = ftsLeak.filter((r) => r.owner === owner && r.repo === repo && !r.is_global).length;
					const leakedSem = semLeak.filter((r) => r.owner === owner && r.repo === repo && !r.is_global).length;
					isolationProbes.push({
						query: corpusQuery,
						probeOwner: probeTenant.owner,
						probeRepo: probeTenant.repo,
						expectLeak,
						fts: { returned: ftsLeak.length, leaked: leakedFts, isolated: leakedFts === 0 },
						semantic: { returned: semLeak.length, leaked: leakedSem, isolated: leakedSem === 0 }
					});
				}
				const isolatedOk = isolationProbes.every((p) => p.fts.isolated && p.semantic.isolated);
				const relevance = (() => {
					const noResultKinds = QUERY_SETS.filter((q) => q.kind === "no-result");
					let noResultViolations = 0;
					let probeErrors = 0;
					const probeErrorByType = { SearchError: 0, other: 0 };
					for (const { query } of noResultKinds) {
						try {
							const ftsRes = searchFts(db, query, owner, repo, 10);
							if (ftsRes.length > 0) noResultViolations++;
						} catch (err) {
							probeErrors++;
							if (err?.name === "SearchError") probeErrorByType.SearchError++;
							else probeErrorByType.other++;
							noResultViolations++;
						}
						try {
							const hyRes = hybridSearch(db, query, owner, repo, 10, tfCache);
							if (hyRes.length > 0) noResultViolations++;
						} catch (err) {
							probeErrors++;
							if (err?.name === "SearchError") probeErrorByType.SearchError++;
							else probeErrorByType.other++;
							noResultViolations++;
						}
					}
					const positiveKinds = QUERY_SETS.filter((q) => ["normal", "high-result", "phrase"].includes(q.kind));
					let emptyPositive = 0;
					for (const { query } of positiveKinds.slice(0, 6)) {
						try {
							const hyRes = hybridSearch(db, query, owner, repo, 10, tfCache);
							if (hyRes.length === 0) emptyPositive++;
						} catch (err) {
							probeErrors++;
							if (err?.name === "SearchError") probeErrorByType.SearchError++;
							else probeErrorByType.other++;
							emptyPositive++;
						}
					}
					return {
						noResultViolations,
						emptyPositive,
						probeErrors,
						probeErrorByType,
						pass: noResultViolations === 0 && emptyPositive === 0 && probeErrors === 0
					};
				})();

				scaleResults.push({
					rows,
					dbBytes,
					heapBytes,
					pageSize,
					sqliteVersion,
					write: {
						latency: writeLatency,
						throughput: writeThroughput,
						errors: writeErrors,
						total: corpus.length,
						elapsedMs: writeElapsedMs
					},
					search: searchResults,
					queryBreakdown: perQueryBreakdown,
					isolation: { probes: isolationProbes, isolatedOk },
					relevance: { ...relevance, noResultKind: "no-result" },
					vectorMeta: {
						candidateCap: VECTOR_CANDIDATE_CAP,
						minCandidates: MIN_CANDIDATES,
						persistedVectors: true,
						zeroFallback: null,
						hybridThreshold: 0.4
					},
					benchEpoch: BENCH_EPOCH_ISO,
					foreignPartition: { owner: foreignOwner, repo: foreignRepo, rows: foreignCorpus.length }
				});
				db.close();
				db = null;
			} catch (err) {
				if (db?.open) {
					try {
						db.close();
					} catch {
						// Best-effort benchmark cleanup or metadata collection.
					}
					db = null;
				}
				const msg = String(err?.message || err);
				if (/ENOMEM|heap|memory|allocation/i.test(msg) || rows >= 100000) {
					hardwareLimit = `scale ${rows} failed: ${msg.slice(0, 200)}`;
					break;
				}
				throw err;
			} finally {
				if (db?.open) {
					try {
						db.close();
					} catch {
						// Best-effort benchmark cleanup or metadata collection.
					}
				}
			}
		}

		let commitShaFinal = null;
		try {
			commitShaFinal = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() || null;
		} catch {
			commitShaFinal = null;
		}
		let referencePageSize = null;
		let referenceSqliteVersion = null;
		if (scaleResults.length > 0) {
			referencePageSize = scaleResults[0].pageSize;
			referenceSqliteVersion = scaleResults[0].sqliteVersion;
		} else {
			try {
				const probe = createBenchDb(path.join(tmpDir, "probe.db"));
				referenceSqliteVersion = probe.prepare("SELECT sqlite_version()").pluck().get();
				referencePageSize = probe.pragma("page_size", { simple: true });
				probe.close();
			} catch {
				// Best-effort benchmark cleanup or metadata collection.
			}
		}

		const lastScale = scaleResults[scaleResults.length - 1];
		const revisionMeta = (() => {
			let branch = null;
			let dirty = false;
			try {
				branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim() || null;
			} catch {
				// Best-effort benchmark cleanup or metadata collection.
			}
			try {
				const porcel = execSync("git status --porcelain", { encoding: "utf8" }).trim();
				dirty = porcel.length > 0;
			} catch {
				// Best-effort benchmark cleanup or metadata collection.
			}
			return { branch, dirty };
		})();
		const benchRevision = (() => {
			try {
				const files = [
					"scripts/bench/memory-write-search-bench.mjs",
					"scripts/bench/memory-eval/corpus.mjs",
					"scripts/bench/memory-eval/queries.mjs",
					"scripts/bench/memory-eval/metrics.mjs",
					"scripts/bench/memory-eval/report.mjs"
				];
				const h = execFileSync("git", ["hash-object", ...files], { encoding: "utf8" }).trim();
				return h || null;
			} catch {
				return null;
			}
		})();
		const result = {
			meta: {
				task: "TASK-478",
				seed,
				commitSha: commitShaFinal,
				benchRevision,
				branch: revisionMeta.branch,
				dirty: revisionMeta.dirty,
				date: new Date().toISOString(),
				benchEpoch: BENCH_EPOCH_ISO,
				node: process.version,
				betterSqlite3: require("better-sqlite3/package.json").version,
				sqliteVersion: referenceSqliteVersion,
				pageSize: referencePageSize,
				owner,
				repo,
				scales: scales.slice(0, scaleResults.length),
				requestedScales: scales,
				iterations: ITERS,
				vectorBackend: "persisted TF cosine (memory_vectors, no ONNX)",
				vectorCandidateCap: VECTOR_CANDIDATE_CAP,
				vectorMinCandidates: MIN_CANDIDATES,
				queryKinds: [...new Set(QUERY_SETS.map((q) => q.kind))],
				queryCount: QUERY_SETS.length,
				...(hardwareLimit ? { hardwareLimit } : {}),
				...(lastScale ? { memory: { heapUsed: lastScale.heapBytes, dbBytes: lastScale.dbBytes } } : {})
			},
			scales: scaleResults
		};
		printReport(result);
		writeResult(jsonOut, result, markdownOut);
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error("FATAL:", JSON.stringify(err && err.message));
	console.error("CODE:", JSON.stringify(err && err.code));
	process.exit(1);
});
