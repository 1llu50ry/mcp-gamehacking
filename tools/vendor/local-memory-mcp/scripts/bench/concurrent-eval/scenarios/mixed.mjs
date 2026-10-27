import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "url";
import { createConcurrentBenchDb } from "../schema.mjs";

export async function measureScenarioMixed(tmpDir, seedCorpus) {
	const dbPath = path.join(tmpDir, `concurrent-mixed-${randomUUID()}.db`);
	const primaryDb = createConcurrentBenchDb(dbPath);
	const readers = 2;
	const writers = 2;
	const ops = 60;
	const clients = readers + writers;
	const queryPool = ["vector", "memory", "search", "cache", "sqlite", "index", "workspace"];
	let latencies = [];
	let readLatencies = [];
	let writeLatencies = [];
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
		const readerPath = fileURLToPath(new URL("../workers/concurrent-reader.worker.mjs", import.meta.url));
		const writerPath = fileURLToPath(new URL("../workers/concurrent-writer-concurrent.worker.mjs", import.meta.url));
		const releaseBarrier = () => {
			if (Atomics.load(barrier, 1) === 0) {
				Atomics.store(barrier, 1, 1);
				Atomics.notify(barrier, 1, clients);
			}
		};
		const poll = setInterval(() => {
			if (Atomics.load(barrier, 0) >= clients) {
				releaseBarrier();
				clearInterval(poll);
			}
		}, 1);
		const readWorkers = Array.from(
			{ length: readers },
			(_, r) => new Worker(readerPath, { workerData: { dbPath, ops, queryPool, barrierBuffer, readerIndex: r } })
		);
		const writeWorkers = Array.from(
			{ length: writers },
			(_, w) =>
				new Worker(writerPath, {
					workerData: { dbPath, startOffset: 200000 + w * 100000, ops, barrierBuffer, writerIndex: w }
				})
		);
		const allWorkers = [...readWorkers, ...writeWorkers];
		const results = await Promise.all(
			allWorkers.map(
				(w) =>
					new Promise((resolve, reject) => {
						w.once("message", resolve);
						w.once("error", reject);
						w.once("exit", (code) => {
							if (code !== 0) reject(new Error(`mixed worker exited ${code}`));
						});
					})
			)
		);
		clearInterval(poll);
		releaseBarrier();
		for (let i = 0; i < results.length; i++) {
			const res = results[i];
			const isReader = i < readers;
			if (!res.ok) {
				otherErrors += ops;
				continue;
			}
			latencies.push(...res.latencies);
			if (isReader) readLatencies.push(...res.latencies);
			else writeLatencies.push(...res.latencies);
			busyErrors += res.busyErrors ?? 0;
			timeoutErrors += res.timeoutErrors ?? 0;
			otherErrors += res.otherErrors ?? 0;
			busyRetries += res.busyRetries ?? 0;
		}
		const totalAttempts = latencies.length + busyErrors + timeoutErrors + otherErrors;
		const contentionRate = totalAttempts > 0 ? busyRetries / Math.max(1, totalAttempts) : 0;
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
			readLatencies,
			writeLatencies,
			busyErrors,
			timeoutErrors,
			otherErrors,
			busyRetries,
			n: latencies.length || totalAttempts,
			elapsedMs,
			heapBytes,
			dbBytes,
			walBytes,
			contentionRate,
			concurrency: {
				readers,
				writers,
				clients,
				overlap: "worker_threads+SharedArrayBuffer barrier (reads+writes concurrent)",
				genuineOverlap: true
			},
			byRole: {
				read: {
					n: readLatencies.length,
					avgMs: readLatencies.length ? readLatencies.reduce((a, b) => a + b, 0) / readLatencies.length : 0
				},
				write: {
					n: writeLatencies.length,
					avgMs: writeLatencies.length ? writeLatencies.reduce((a, b) => a + b, 0) / writeLatencies.length : 0
				}
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
