#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import Database from "better-sqlite3";
import { throughput } from "./memory-eval/metrics.mjs";
import { BENCH_EPOCH_ISO } from "./memory-eval/corpus.mjs";
import {
	SEED,
	OWNER,
	REPO,
	BATCH_SIZE,
	LEASE_MS,
	POISON_THRESHOLD,
	BACKOFF_BASE_MS,
	BACKOFF_MAX_MS
} from "./embedding-eval/constants.mjs";
import { collectBenchRevision } from "./embedding-eval/lifecycle.mjs";
import { toLatencyStats, buildMarkdown } from "./embedding-eval/report.mjs";
import { measureScenarioEmptyQueue } from "./embedding-eval/scenarios/empty-queue.mjs";
import { measureScenarioFullQueue } from "./embedding-eval/scenarios/full-queue.mjs";
import { measureScenarioConcurrentWrites } from "./embedding-eval/scenarios/concurrent-writes.mjs";
import { measureScenarioWorkerRestart } from "./embedding-eval/scenarios/worker-restart.mjs";
import { measureScenarioFailedJobs } from "./embedding-eval/scenarios/failed-jobs.mjs";
import { measureScenarioLeaseExpiry } from "./embedding-eval/scenarios/lease-expiry.mjs";

const require = createRequire(import.meta.url);

async function main() {
	const argv = process.argv.slice(2);
	const argVal = (name, dflt) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : dflt;
	};
	const jsonOut = argVal(
		"--json-out",
		path.resolve(".agents/documents/analysis/embedding-queue-availability-bench-results.json")
	);
	const markdownOut = argVal(
		"--markdown-out",
		path.resolve(".agents/documents/analysis/embedding-queue-availability-bench.md")
	);
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eq-avail-bench-"));
	let betterSqlite3Version = null;
	try {
		betterSqlite3Version = require("better-sqlite3/package.json").version;
	} catch {
		// Best-effort benchmark cleanup or metadata collection.
	}
	let commitSha = null;
	try {
		commitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() || null;
	} catch {
		// Best-effort benchmark cleanup or metadata collection.
	}
	let branch = null;
	try {
		branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim() || null;
	} catch {
		// Best-effort benchmark cleanup or metadata collection.
	}
	let dirty = false;
	try {
		dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
	} catch {
		// Best-effort benchmark cleanup or metadata collection.
	}
	const benchRevision = collectBenchRevision();
	let referenceSqliteVersion = null;
	let referencePageSize = null;
	try {
		const probe = new Database(":memory:");
		referenceSqliteVersion = probe.prepare("SELECT sqlite_version()").pluck().get();
		referencePageSize = probe.pragma("page_size", { simple: true });
		probe.close();
	} catch {
		// Best-effort benchmark cleanup or metadata collection.
	}
	const scenarios = {};
	const errors = [];
	const run = async (name, fn) => {
		console.log(`[eq-bench] scenario: ${name}`);
		try {
			scenarios[name] = await fn(tmpDir);
		} catch (e) {
			errors.push({ scenario: name, error: String(e?.message || e) });
			scenarios[name] = { error: String(e?.message || e), stack: String(e?.stack || "") };
		}
	};
	try {
		await run("empty_queue", measureScenarioEmptyQueue);
		await run("full_queue", measureScenarioFullQueue);
		await run("concurrent_writes", measureScenarioConcurrentWrites);
		await run("worker_restart", measureScenarioWorkerRestart);
		await run("failed_jobs", measureScenarioFailedJobs);
		await run("lease_expiry", measureScenarioLeaseExpiry);
		const allWriteSamples = [];
		const allQueueDelays = [];
		let totalFailures = 0;
		let totalVectorFailures = 0;
		let totalWriteErrors = 0;
		let totalVisibilityFailures = 0;
		let totalBackoffFailures = 0;
		const canonicalFailures = (v) => {
			if (typeof v.failures === "number") return v.failures;
			return (
				(typeof v.visibilityFailures === "number" ? v.visibilityFailures : 0) +
				(typeof v.backoffFailures === "number" ? v.backoffFailures : 0) +
				(typeof v.writeErrors === "number" ? v.writeErrors : 0)
			);
		};
		for (const v of Object.values(scenarios)) {
			if (v.writeLatencies) allWriteSamples.push(...v.writeLatencies);
			if (v.queueDelays) allQueueDelays.push(...v.queueDelays);
			if (v.restartDelays) allQueueDelays.push(...v.restartDelays);
			totalFailures += canonicalFailures(v);
			if (typeof v.writeErrors === "number") totalWriteErrors += v.writeErrors;
			if (typeof v.visibilityFailures === "number") totalVisibilityFailures += v.visibilityFailures;
			if (typeof v.backoffFailures === "number") totalBackoffFailures += v.backoffFailures;
			if (typeof v.vectorFailures === "number") totalVectorFailures += v.vectorFailures;
		}
		const writeLatency = toLatencyStats(allWriteSamples);
		const queueDelay = toLatencyStats(allQueueDelays);
		const perScenario = {};
		for (const [k, v] of Object.entries(scenarios)) {
			if (v.error) {
				perScenario[k] = { error: v.error };
				continue;
			}
			const effectiveFailures = canonicalFailures(v);
			perScenario[k] = {
				writeLatency: v.writeLatencies ? toLatencyStats(v.writeLatencies) : null,
				queueDelay: v.queueDelays
					? toLatencyStats(v.queueDelays)
					: v.restartDelays
						? toLatencyStats(v.restartDelays)
						: v.leaseWaitMs != null
							? toLatencyStats(v.queueDelays || [])
							: null,
				failures: effectiveFailures,
				writeErrors: v.writeErrors ?? 0,
				visibilityFailures: v.visibilityFailures ?? 0,
				backoffFailures: v.backoffFailures ?? 0,
				vectorFailures: v.vectorFailures ?? 0,
				n: v.n ?? null,
				extra: Object.fromEntries(
					Object.entries(v).filter(
						([kk]) =>
							![
								"writeLatencies",
								"queueDelays",
								"restartDelays",
								"failures",
								"n",
								"writeErrors",
								"visibilityFailures",
								"backoffFailures"
							].includes(kk)
					)
				)
			};
			if (k === "worker_restart") perScenario[k].queueDelay = toLatencyStats(v.restartDelays || []);
			if (k === "lease_expiry" && v.queueDelays) perScenario[k].queueDelay = toLatencyStats(v.queueDelays);
		}
		const result = {
			meta: {
				task: "TASK-479",
				seed: SEED,
				commitSha,
				benchRevision,
				branch,
				dirty,
				date: new Date().toISOString(),
				benchEpoch: BENCH_EPOCH_ISO,
				node: process.version,
				betterSqlite3: betterSqlite3Version,
				sqliteVersion: referenceSqliteVersion,
				pageSize: referencePageSize,
				owner: OWNER,
				repo: REPO,
				batchSize: BATCH_SIZE,
				leaseMs: LEASE_MS,
				poisonThreshold: POISON_THRESHOLD,
				backoffBaseMs: BACKOFF_BASE_MS,
				backoffMaxMs: BACKOFF_MAX_MS,
				vectorBackend: "stub embed (deterministic, no ONNX)",
				isolatedDb: true,
				deterministicFixtures: true,
				scenarios: Object.keys(scenarios),
				...(errors.length ? { errors } : {})
			},
			summary: {
				writeLatency,
				queueDelay,
				totalFailures,
				totalWriteErrors,
				totalVisibilityFailures,
				totalBackoffFailures,
				totalVectorFailures,
				writeThroughput: throughput(
					allWriteSamples.length,
					allWriteSamples.reduce((a, b) => a + b, 0)
				),
				queueDelayThroughput: allQueueDelays.length
					? throughput(
							allQueueDelays.length,
							allQueueDelays.reduce((a, b) => a + b, 0)
						)
					: 0
			},
			scenarios: perScenario,
			raw: scenarios
		};
		fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
		fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
		console.log(`JSON → ${jsonOut}`);
		fs.mkdirSync(path.dirname(markdownOut), { recursive: true });
		fs.writeFileSync(markdownOut, buildMarkdown(result));
		console.log(`Markdown → ${markdownOut}`);
		console.log(
			`\nWrite latency p50/p95/p99: ${writeLatency.p50.toFixed(3)}/${writeLatency.p95.toFixed(3)}/${writeLatency.p99.toFixed(3)} ms`
		);
		console.log(
			`Queue delay p50/p95/p99: ${queueDelay.p50.toFixed(3)}/${queueDelay.p95.toFixed(3)}/${queueDelay.p99.toFixed(3)} ms`
		);
		console.log(
			`Failures: ${totalFailures} (writeErrors ${totalWriteErrors} vis ${totalVisibilityFailures} backoff ${totalBackoffFailures}) vectorFailures: ${totalVectorFailures}`
		);
		const hasFailure = errors.length > 0 || totalFailures > 0 || totalVectorFailures > 0;
		if (hasFailure) {
			console.error(
				`[eq-bench] FAIL: ${errors.length} scenario errors, ${totalFailures} failures (writeErrors ${totalWriteErrors} vis ${totalVisibilityFailures} backoff ${totalBackoffFailures}) + ${totalVectorFailures} vector failures`
			);
			process.exitCode = 1;
		}
	} finally {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// Best-effort benchmark cleanup or metadata collection.
		}
	}
}

main().catch((err) => {
	console.error("FATAL:", err?.message || err);
	console.error(err?.stack || "");
	process.exit(1);
});
