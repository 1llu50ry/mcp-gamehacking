import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { BENCH_EPOCH_MS } from "../../memory-eval/corpus.mjs";
import { makeMemoryEntry } from "../fixtures.mjs";
import { createBenchDb } from "../schema.mjs";
import { writeWithEnqueue } from "../lifecycle.mjs";

const { dbPath, start, end, barrierBuffer, writerIndex } = workerData;
const barrier = new Int32Array(barrierBuffer);
Atomics.add(barrier, 0, 1);
Atomics.notify(barrier, 0, 1);
while (Atomics.load(barrier, 1) === 0) {
	Atomics.wait(barrier, 1, 0, 10);
}
const db = createBenchDb(dbPath);
const writeLatencies = [];
const enqueues = [];
const attemptsLog = [];
let writeErrors = 0;
let busyRetries = 0;
try {
	for (let i = start; i < end; i++) {
		const id = `30000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`;
		const mem = makeMemoryEntry(id, new Date(BENCH_EPOCH_MS + i * 10).toISOString(), 9000 + i);
		let attempt = 0;
		while (attempt < 3) {
			const tPerf0 = performance.now();
			const tWall0 = Date.now();
			try {
				writeWithEnqueue(db, mem);
				const lat = performance.now() - tPerf0;
				writeLatencies.push(lat);
				enqueues.push({ id, t0: tWall0, writer: writerIndex });
				attemptsLog.push({ id, writer: writerIndex, contended: attempt > 0 });
				break;
			} catch (e) {
				const msg = String(e?.message || e);
				const busy = msg.includes("BUSY") || msg.includes("busy") || msg.includes("locked");
				if (busy && attempt < 2) {
					busyRetries++;
					attempt++;
					Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5 * attempt);
					continue;
				}
				writeErrors++;
				attemptsLog.push({ id, writer: writerIndex, contended: false, error: msg });
				enqueues.push({ id, t0: tWall0, writer: writerIndex, error: msg });
				break;
			}
		}
	}
	parentPort.postMessage({
		ok: true,
		writeLatencies,
		enqueues,
		attempts: attemptsLog,
		writeErrors,
		busyRetries
	});
} catch (e) {
	parentPort.postMessage({ ok: false, error: String(e?.message || e), stack: String(e?.stack || "") });
} finally {
	try {
		db.close();
	} catch {
		// Best-effort benchmark cleanup.
	}
}
