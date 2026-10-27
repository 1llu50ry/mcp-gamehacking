import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { Worker } from "node:worker_threads";
import { createBenchDb } from "../schema.mjs";
import { createBenchClock } from "../clock.mjs";
import { drainAll } from "../lifecycle.mjs";

export async function measureScenarioConcurrentWrites(tmpDir) {
	const dbPath = path.join(tmpDir, `eq-concurrent-${randomUUID()}.db`);
	const primaryDb = createBenchDb(dbPath);
	const N = 200;
	const writers = 4;
	const attempts = [];
	let busyRetries = 0;
	try {
		const perWriter = Math.ceil(N / writers);
		const enqueueAt = new Map();
		const writeLatencies = [];
		let writeErrors = 0;
		const writerTasks = Array.from({ length: writers }, (_, w) => ({
			w,
			start: w * perWriter,
			end: Math.min(N, (w + 1) * perWriter)
		}));
		const barrierBuffer = new SharedArrayBuffer(8);
		const barrier = new Int32Array(barrierBuffer);
		barrier[0] = 0;
		barrier[1] = 0;
		const workerPath = fileURLToPath(new URL("../workers/concurrent-writer.worker.mjs", import.meta.url));
		const releaseBarrier = () => {
			if (Atomics.load(barrier, 1) === 0) {
				Atomics.store(barrier, 1, 1);
				Atomics.notify(barrier, 1, writers);
			}
		};
		const poll = setInterval(() => {
			if (Atomics.load(barrier, 0) >= writers) {
				releaseBarrier();
				clearInterval(poll);
			}
		}, 1);
		const workers = writerTasks.map(
			({ start, end, w }) =>
				new Worker(workerPath, {
					workerData: { dbPath, start, end, barrierBuffer, writerIndex: w }
				})
		);
		const results = await Promise.all(
			workers.map(
				(w) =>
					new Promise((resolve, reject) => {
						w.once("message", resolve);
						w.once("error", reject);
						w.once("exit", (code) => {
							if (code !== 0) reject(new Error(`worker exited ${code}`));
						});
					})
			)
		);
		clearInterval(poll);
		releaseBarrier();
		for (const res of results) {
			if (!res.ok) {
				writeErrors++;
				continue;
			}
			writeLatencies.push(...res.writeLatencies);
			for (const e of res.enqueues) enqueueAt.set(e.id, e.t0);
			attempts.push(...res.attempts);
			writeErrors += res.writeErrors;
			busyRetries += res.busyRetries;
		}
		const pendingAfterWrites = primaryDb.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='pending'").get().c;
		const uniqueAttempts = new Set(attempts.map((a) => a.id)).size;
		const contentionRate = attempts.filter((a) => a.contended).length / Math.max(1, attempts.length);
		const clock = createBenchClock();
		const tDrain0 = Date.now();
		const visibilityAt = new Map();
		const drain = await drainAll(primaryDb, {
			embedDelayMs: 0.5,
			batchSize: 32,
			clock,
			onVisible: (id) => visibilityAt.set(id, Date.now())
		});
		const aggregateDrainMs = Date.now() - tDrain0;
		const queueDelays = [];
		let visibilityFailures = 0;
		const sampleIds = Array.from({ length: N }, (_, i) => `30000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`);
		for (const id of sampleIds) {
			const hasVector = !!primaryDb.prepare("SELECT 1 FROM memory_vectors WHERE memory_id=?").get(id);
			if (!hasVector) visibilityFailures++;
			else {
				const enq = enqueueAt.get(id);
				const vis = visibilityAt.get(id);
				if (enq != null && vis != null) queueDelays.push(vis - enq);
				else visibilityFailures++;
			}
		}
		return {
			writeLatencies,
			writeErrors,
			queueDelays,
			visibilityFailures,
			pendingAfterWrites,
			n: N,
			sampled: sampleIds.length,
			aggregateDrainMs,
			vectorFailures: drain.vectorFailures,
			visibilityAt: Object.fromEntries(visibilityAt),
			concurrency: {
				writers,
				attempts: attempts.length,
				uniqueAttempts,
				busyRetries,
				contentionRate,
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
