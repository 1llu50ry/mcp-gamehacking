import fs from "fs";
import path from "path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "crypto";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "url";
import { createConcurrentBenchDb } from "../schema.mjs";

export async function measureScenarioReadersOnly(tmpDir, seedCorpus) {
	const dbPath = path.join(tmpDir, `concurrent-readers-${randomUUID()}.db`);
	const primaryDb = createConcurrentBenchDb(dbPath);
	const readers = 4;
	const opsPerReader = 100;
	const queryPool = ["vector", "memory", "search", "cache", "sqlite", "semantic", "index", "workspace"];
	let latencies = [];
	let busyErrors = 0;
	let timeoutErrors = 0;
	let otherErrors = 0;
	let busyRetries = 0;
	try {
		const scenarioStart = performance.now();
		seedCorpus(primaryDb);
		primaryDb.pragma("wal_checkpoint(TRUNCATE)");
		const barrierBuffer = new SharedArrayBuffer(8);
		const barrier = new Int32Array(barrierBuffer);
		barrier[0] = 0;
		barrier[1] = 0;
		const readerWorkerPath = fileURLToPath(new URL("../workers/concurrent-reader.worker.mjs", import.meta.url));
		const releaseBarrier = () => {
			if (Atomics.load(barrier, 1) === 0) {
				Atomics.store(barrier, 1, 1);
				Atomics.notify(barrier, 1, readers);
			}
		};
		const poll = setInterval(() => {
			if (Atomics.load(barrier, 0) >= readers) {
				releaseBarrier();
				clearInterval(poll);
			}
		}, 1);
		const workers = Array.from(
			{ length: readers },
			(_, r) =>
				new Worker(readerWorkerPath, {
					workerData: { dbPath, ops: opsPerReader, queryPool, barrierBuffer, readerIndex: r }
				})
		);
		const results = await Promise.all(
			workers.map(
				(w) =>
					new Promise((resolve, reject) => {
						w.once("message", resolve);
						w.once("error", reject);
						w.once("exit", (code) => {
							if (code !== 0) reject(new Error(`reader worker exited ${code}`));
						});
					})
			)
		);
		clearInterval(poll);
		releaseBarrier();
		for (const res of results) {
			if (!res.ok) {
				otherErrors += opsPerReader;
				continue;
			}
			latencies.push(...res.latencies);
			busyErrors += res.busyErrors ?? 0;
			timeoutErrors += res.timeoutErrors ?? 0;
			otherErrors += res.otherErrors ?? 0;
			busyRetries += res.busyRetries ?? 0;
		}
		const n = latencies.length + busyErrors + timeoutErrors + otherErrors;
		const contentionRate = latencies.length > 0 ? 0 : 0;
		let heapBytes = null;
		try {
			heapBytes = process.memoryUsage().heapUsed;
		} catch {
			// Best-effort benchmark cleanup.
		}
		let dbBytes = null;
		let walBytes = null;
		try {
			primaryDb.pragma("wal_checkpoint(PASSIVE)");
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
		const elapsedMs = performance.now() - scenarioStart;
		return {
			latencies,
			busyErrors,
			timeoutErrors,
			otherErrors,
			busyRetries,
			n: latencies.length || n,
			elapsedMs,
			heapBytes,
			dbBytes,
			walBytes,
			contentionRate,
			concurrency: {
				readers,
				writers: 0,
				clients: readers,
				overlap: "worker_threads+SharedArrayBuffer barrier",
				genuineOverlap: true
			}
		};
	} finally {
		try {
			primaryDb.close();
		} catch {
			// Best-effort benchmark cleanup.
		}
		for (const suffix of ["", "-wal", "-shm"]) {
			try {
				fs.unlinkSync(`${dbPath}${suffix}`);
			} catch {
				// Best-effort benchmark cleanup.
			}
		}
	}
}
