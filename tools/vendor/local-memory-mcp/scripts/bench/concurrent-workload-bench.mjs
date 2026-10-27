#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import Database from "better-sqlite3";
import { buildMemoryCorpus, BENCH_EPOCH_MS, BENCH_EPOCH_ISO } from "./memory-eval/corpus.mjs";
import { percentiles, throughput } from "./memory-eval/metrics.mjs";
import { collectBenchRevision } from "./concurrent-eval/lifecycle.mjs";
import { buildMarkdown } from "./concurrent-eval/report.mjs";
import { checkContention, formatGuardReport } from "./concurrent-eval/contention-guard.mjs";
import { measureScenarioReadersOnly } from "./concurrent-eval/scenarios/readers-only.mjs";
import { measureScenarioWritersOnly } from "./concurrent-eval/scenarios/writers-only.mjs";
import { measureScenarioMixed } from "./concurrent-eval/scenarios/mixed.mjs";
import { measureScenarioMultiClient } from "./concurrent-eval/scenarios/multi-client.mjs";
import { BENCH_ROWS, BUSY_TIMEOUT_MS, OWNER, REPO, SCENARIOS, SEED } from "./concurrent-eval/constants.mjs";

const require = createRequire(import.meta.url);

function argVal(argv, name, dflt) {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : dflt;
}

function resourceSnapshot(dbPath) {
	let heapBytes = null;
	try {
		heapBytes = process.memoryUsage().heapUsed;
	} catch {
		// Best-effort benchmark cleanup.
	}
	let dbBytes = null;
	let walBytes = null;
	try {
		dbBytes = fs.statSync(dbPath).size;
		try {
			walBytes = fs.statSync(`${dbPath}-wal`).size;
		} catch {
			walBytes = 0;
		}
		dbBytes += walBytes;
	} catch {
		// Best-effort benchmark cleanup.
	}
	return { heapBytes, dbBytes, walBytes };
}

function seedCorpus(db) {
	const corpus = buildMemoryCorpus(BENCH_ROWS, SEED, OWNER, REPO, { benchEpochMs: BENCH_EPOCH_MS });
	const insert = db.prepare(
		`INSERT OR IGNORE INTO memories (id, code, repo, owner, type, title, content, importance, folder, language, branch, created_at, updated_at, agent, role, model, status, tags, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const tag = db.prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)");
	const tx = db.transaction(() => {
		for (const entry of corpus) {
			insert.run(
				entry.id,
				entry.code,
				REPO,
				OWNER,
				entry.type,
				entry.title,
				entry.content,
				entry.importance,
				null,
				null,
				null,
				entry.created_at,
				entry.updated_at,
				"bench",
				"benchmark",
				"bench-model",
				"active",
				JSON.stringify(entry.tags),
				JSON.stringify(entry.metadata)
			);
			for (const t of entry.tags) tag.run(entry.id, t);
		}
	});
	tx();
	return corpus.length;
}

function summarizeScenario(raw, dbPath) {
	const samples = raw.latencies || [];
	const latency = percentiles(samples);
	const errors = (raw.busyErrors || 0) + (raw.timeoutErrors || 0) + (raw.otherErrors || 0);
	const elapsedMs = raw.elapsedMs > 0 ? raw.elapsedMs : samples.reduce((a, b) => a + b, 0);
	return {
		...raw,
		latency,
		throughput: throughput(raw.operationCount ?? samples.length, elapsedMs),
		lockWaitMs: raw.lockWaitMs ?? 0,
		walBeforeCheckpoint: raw.walBeforeCheckpoint ?? null,
		errors,
		resource:
			raw.heapBytes != null
				? {
						heapBytes: raw.heapBytes,
						dbBytes: raw.dbBytes ?? resourceSnapshot(dbPath).dbBytes,
						walBytes: raw.walBytes ?? resourceSnapshot(dbPath).walBytes
					}
				: null
	};
}

async function main() {
	const argv = process.argv.slice(2);
	const jsonOut = argVal(
		argv,
		"--json-out",
		path.resolve(".agents/documents/analysis/concurrent-workload-bench-results.json")
	);
	const markdownOut = argVal(
		argv,
		"--markdown-out",
		path.resolve(".agents/documents/analysis/concurrent-workload-bench.md")
	);
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "concurrent-workload-bench-"));
	const scenarios = {};
	const errors = [];
	let referenceSqliteVersion = null;
	let referencePageSize = null;
	try {
		const probe = new Database(":memory:");
		referenceSqliteVersion = probe.prepare("SELECT sqlite_version()").pluck().get();
		referencePageSize = probe.pragma("page_size", { simple: true });
		probe.close();
	} catch {
		// Best-effort benchmark cleanup.
	}
	const seedForScenario = (db) => seedCorpus(db);
	const scenarioFns = {
		readers_only: measureScenarioReadersOnly,
		writers_only: measureScenarioWritersOnly,
		mixed: measureScenarioMixed,
		multi_client: measureScenarioMultiClient
	};
	try {
		for (const name of SCENARIOS) {
			console.log(`[concurrent-bench] scenario: ${name}`);
			try {
				const raw = await scenarioFns[name](tmpDir, seedForScenario);
				const dummyPath = path.join(tmpDir, `${name}.db`);
				scenarios[name] = summarizeScenario(raw, dummyPath);
				if (raw.integrity && !raw.integrity.ok) throw new Error(`${name} integrity check failed`);
				if (raw.operationWindow && raw.operationWindow.overlapMs <= 0)
					throw new Error(`${name} operation windows did not overlap`);
			} catch (err) {
				errors.push({ scenario: name, error: String(err?.message || err) });
				scenarios[name] = { error: String(err?.message || err), stack: String(err?.stack || "") };
			}
		}
		const allRead = [];
		const allWrite = [];
		const allMixed = [];
		let totalOps = 0;
		let totalErrors = 0;
		let totalBusy = 0;
		let totalTimeout = 0;
		let totalOther = 0;
		let maxHeapBytes = 0;
		let maxDbBytes = 0;
		for (const [name, v] of Object.entries(scenarios)) {
			if (v.error) continue;
			totalOps += v.n ?? 0;
			totalErrors += v.errors ?? 0;
			totalBusy += v.busyErrors ?? 0;
			totalTimeout += v.timeoutErrors ?? 0;
			totalOther += v.otherErrors ?? 0;
			maxHeapBytes = Math.max(maxHeapBytes, v.resource?.heapBytes ?? 0);
			maxDbBytes = Math.max(maxDbBytes, v.resource?.dbBytes ?? 0);
			if (name === "readers_only") allRead.push(...(v.latencies || []));
			if (name === "writers_only") allWrite.push(...(v.latencies || []));
			if (name === "mixed" || name === "multi_client") allMixed.push(...(v.latencies || []));
		}
		let commitSha = null;
		try {
			commitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() || null;
		} catch {
			// Best-effort benchmark cleanup.
		}
		let branch = null;
		try {
			branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim() || null;
		} catch {
			// Best-effort benchmark cleanup.
		}
		let dirty = false;
		try {
			dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
		} catch {
			// Best-effort benchmark cleanup.
		}
		const result = {
			meta: {
				task: "TASK-480",
				seed: SEED,
				commitSha,
				benchRevision: collectBenchRevision(),
				branch,
				dirty,
				date: new Date().toISOString(),
				benchEpoch: BENCH_EPOCH_ISO,
				node: process.version,
				betterSqlite3: require("better-sqlite3/package.json").version,
				sqliteVersion: referenceSqliteVersion,
				pageSize: referencePageSize,
				owner: OWNER,
				repo: REPO,
				benchRows: BENCH_ROWS,
				busyTimeoutMs: BUSY_TIMEOUT_MS,
				journalMode: "WAL",
				synchronous: "NORMAL",
				walAutocheckpoint: 1000,
				isolatedDb: true,
				deterministicFixtures: true,
				scenarios: SCENARIOS,
				...(errors.length ? { errors } : {})
			},
			summary: {
				readLatency: percentiles(allRead),
				writeLatency: percentiles(allWrite),
				mixedLatency: percentiles(allMixed),
				readThroughput: throughput(
					allRead.length,
					allRead.reduce((a, b) => a + b, 0)
				),
				writeThroughput: throughput(
					allWrite.length,
					allWrite.reduce((a, b) => a + b, 0)
				),
				mixedThroughput: throughput(
					allMixed.length,
					allMixed.reduce((a, b) => a + b, 0)
				),
				totalOps,
				totalErrors,
				totalBusy,
				totalTimeout,
				totalOther,
				maxHeapBytes,
				maxDbBytes
			},
			scenarios
		};
		// TASK-429 / ADR-011 acceptance item 2: contention regression guard.
		// Asserts busy/timeout/lockWait stay 0 at supported concurrency and
		// fails the run on a regression. Recorded in meta.errors BEFORE the
		// artifacts are written, so the JSON/Markdown carry the verdict. The
		// guard also re-reads the written JSON as a standalone CLI
		// (contention-guard.mjs).
		const guard = checkContention(result);
		if (!guard.ok)
			errors.push({ scenario: "contention-guard", error: `${guard.failures.length} contention regression(s)` });
		if (errors.length > 0) result.meta.errors = errors;

		fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
		fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
		console.log(`JSON → ${jsonOut}`);
		fs.mkdirSync(path.dirname(markdownOut), { recursive: true });
		fs.writeFileSync(markdownOut, `${buildMarkdown(result)}\n`);
		console.log(`Markdown → ${markdownOut}`);
		console.log(`Errors: ${totalErrors} (busy ${totalBusy}, timeout ${totalTimeout}, other ${totalOther})`);
		console.log(formatGuardReport(guard));

		if (errors.length > 0 || totalErrors > 0) process.exitCode = 1;
	} finally {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error("FATAL:", JSON.stringify(err?.message || err));
	console.error("CODE:", JSON.stringify(err?.code));
	process.exit(1);
});
