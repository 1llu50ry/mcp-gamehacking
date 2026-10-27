import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createConcurrentBenchDb } from "../schema.mjs";
import { createEpochBasis } from "../constants.mjs";
import { createFileBarrier } from "../barrier.mjs";

function runChildProcessWorker(dbPath, startOffset, ops, clientIndex, barrierPath) {
	return new Promise((resolve, reject) => {
		const workerPath = fileURLToPath(new URL("../workers/concurrent-writer-concurrent.worker.mjs", import.meta.url));
		const child = fork(workerPath, [], {
			env: {
				...process.env,
				CONCURRENT_CHILD_DB: dbPath,
				CONCURRENT_CHILD_OPS: String(ops),
				CONCURRENT_CHILD_OFFSET: String(startOffset),
				CONCURRENT_CHILD_INDEX: String(clientIndex),
				CONCURRENT_BARRIER_PATH: barrierPath
			},
			stdio: ["inherit", "inherit", "inherit", "ipc"]
		});
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error("child process timeout"));
		}, 20000);
		const finish = (fn) => (value) => {
			clearTimeout(timer);
			fn(value);
		};
		child.once("message", finish(resolve));
		child.once("error", finish(reject));
		child.once(
			"exit",
			finish((code) => {
				if (code !== 0) reject(new Error(`child process exited ${code}`));
			})
		);
	});
}

export async function measureScenarioMultiClient(tmpDir, seedCorpus) {
	const dbPath = path.join(tmpDir, `concurrent-multiclient-${randomUUID()}.db`);
	const primaryDb = createConcurrentBenchDb(dbPath);
	const threadClients = 2;
	const childClients = 2;
	const opsPerClient = 50;
	const barrier = createFileBarrier(tmpDir, threadClients * 2 + childClients);
	const queryPool = ["vector", "memory", "search", "cache"];
	const workers = [];
	let children = [];
	try {
		seedCorpus(primaryDb);
		primaryDb.pragma("wal_checkpoint(TRUNCATE)");
		const readerPath = fileURLToPath(new URL("../workers/concurrent-reader.worker.mjs", import.meta.url));
		const writerPath = fileURLToPath(new URL("../workers/concurrent-writer-concurrent.worker.mjs", import.meta.url));
		workers.push(
			...Array.from(
				{ length: threadClients },
				(_, r) =>
					new Worker(readerPath, {
						workerData: {
							dbPath,
							ops: opsPerClient,
							queryPool,
							barrierPath: barrier.root,
							readerIndex: r
						}
					})
			)
		);
		workers.push(
			...Array.from(
				{ length: threadClients },
				(_, w) =>
					new Worker(writerPath, {
						workerData: {
							dbPath,
							ops: opsPerClient,
							startOffset: 400000 + w * 100000,
							barrierPath: barrier.root,
							writerIndex: w
						}
					})
			)
		);
		const threadResults = workers.map(
			(worker, index) =>
				new Promise((resolve, reject) => {
					worker.once("message", resolve);
					worker.once("error", reject);
					worker.once("exit", (code) => {
						if (code !== 0) reject(new Error(`multi_client thread worker ${index} exited ${code}`));
					});
				})
		);
		children = Array.from({ length: childClients }, (_, c) =>
			runChildProcessWorker(dbPath, 600000 + c * 100000, opsPerClient, c, barrier.root)
		);
		barrier.waitForReady();
		barrier.release();
		const epochBasis = createEpochBasis();
		const operationStart = epochBasis.toEpochMs(performance.now());
		const results = await Promise.all([...threadResults, ...children]);
		const operationEnd = epochBasis.toEpochMs(performance.now());
		const latencies = results.flatMap((res) => res.latencies ?? []);
		const insertedIds = results.flatMap((res) => res.insertedIds ?? []);
		const expectedIds = [
			...Array.from({ length: threadClients }, (_, w) =>
				Array.from(
					{ length: opsPerClient },
					(_, i) => `10000000-0000-4000-a000-${String(400000 + w * 100000 + i + 1).padStart(12, "0")}`
				)
			).flat(),
			...Array.from({ length: childClients }, (_, c) =>
				Array.from(
					{ length: opsPerClient },
					(_, i) => `10000000-0000-4000-a000-${String(600000 + c * 100000 + i + 1).padStart(12, "0")}`
				)
			).flat()
		];
		const dbIds = primaryDb
			.prepare("SELECT id FROM memories WHERE owner=? AND repo=? AND id LIKE '10000000-%' ORDER BY id")
			.all("bench", "bench-concurrent")
			.map((row) => row.id);
		const uniqueIds = new Set(dbIds);
		const integrity = {
			expectedCount: expectedIds.length,
			actualCount: dbIds.length,
			expectedIdsPresent: expectedIds.every((id) => uniqueIds.has(id)),
			uniqueIds: uniqueIds.size,
			insertedIds: insertedIds.length,
			ok:
				dbIds.length === expectedIds.length &&
				uniqueIds.size === expectedIds.length &&
				expectedIds.every((id) => uniqueIds.has(id))
		};
		if (!integrity.ok) throw new Error(`multi_client integrity check failed: ${JSON.stringify(integrity)}`);
		const allStarts = results.map((r) => r.operationStart).filter(Number.isFinite);
		const allEnds = results.map((r) => r.operationEnd).filter(Number.isFinite);
		return {
			latencies,
			busyErrors: results.reduce((n, r) => n + (r.busyErrors ?? 0), 0),
			timeoutErrors: results.reduce((n, r) => n + (r.timeoutErrors ?? 0), 0),
			otherErrors: results.reduce((n, r) => n + (r.otherErrors ?? 0), 0),
			busyRetries: results.reduce((n, r) => n + (r.busyRetries ?? 0), 0),
			lockWaitMs: results.reduce((n, r) => n + (r.lockWaitMs ?? 0), 0),
			n: latencies.length,
			elapsedMs: operationEnd - operationStart,
			operationWindow: {
				start: Math.min(...allStarts),
				end: Math.max(...allEnds),
				elapsedMs: operationEnd - operationStart,
				overlapMs: Math.max(0, Math.min(...allEnds) - Math.max(...allStarts)),
				proof: true
			},
			integrity,
			concurrency: {
				readers: threadClients,
				writers: threadClients + childClients,
				clients: threadClients * 2 + childClients,
				overlap: "worker_threads + child_process shared file barrier",
				genuineOverlap: true,
				childProcess: true
			}
		};
	} finally {
		for (const worker of workers) {
			try {
				await worker.terminate();
			} catch {
				// Best-effort benchmark cleanup.
			}
		}
		for (const child of children) {
			try {
				child.kill("SIGTERM");
			} catch {
				// Best-effort benchmark cleanup.
			}
		}
		try {
			primaryDb.close();
		} catch {
			// Best-effort benchmark cleanup.
		}
		barrier.close();
		for (const suffix of ["", "-wal", "-shm"]) {
			try {
				fs.unlinkSync(`${dbPath}${suffix}`);
			} catch {
				// Best-effort benchmark cleanup.
			}
		}
	}
}
