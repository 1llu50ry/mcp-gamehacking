import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { createConcurrentBenchDb, buildFtsMatchQuery } from "../schema.mjs";
import { createEpochBasis, OWNER, REPO } from "../constants.mjs";

const { dbPath, ops, queryPool, barrierBuffer, barrierPath } = workerData;
if (barrierPath) {
	const fs = await import("node:fs");
	fs.writeFileSync(`${barrierPath}/ready/${process.pid}-${Math.random()}`, "ready");
	const deadline = Date.now() + 20000;
	while (!fs.existsSync(`${barrierPath}/release`)) {
		if (Date.now() >= deadline) throw new Error("barrier release timeout");
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
	}
} else {
	const barrier = new Int32Array(barrierBuffer);
	Atomics.add(barrier, 0, 1);
	Atomics.notify(barrier, 0, 1);
	while (Atomics.load(barrier, 1) === 0) Atomics.wait(barrier, 1, 0, 10);
}

const epochBasis = createEpochBasis();
const operationStart = epochBasis.toEpochMs(performance.now());
const db = createConcurrentBenchDb(dbPath);
const latencies = [];
let busyErrors = 0;
let timeoutErrors = 0;
let otherErrors = 0;
let busyRetries = 0;

function classifyError(e) {
	const msg = String(e?.message || e);
	const code = e?.code ? String(e.code) : "";
	if (/SQLITE_BUSY/i.test(code) || /SQLITE_BUSY/i.test(msg) || /database is locked/i.test(msg)) return "busy";
	if (/timeout/i.test(msg) && /busy/i.test(msg)) return "timeout";
	return "other";
}

try {
	for (let i = 0; i < ops; i++) {
		const q = queryPool[i % queryPool.length];
		const match = buildFtsMatchQuery(q);
		const t0 = performance.now();
		try {
			if (i % 3 === 0) {
				db.prepare(
					"SELECT m.* FROM memories_fts fts JOIN memories m ON m.rowid=fts.rowid WHERE memories_fts MATCH ? AND m.owner=? AND m.repo=? LIMIT 10"
				).all(match, OWNER, REPO);
			} else if (i % 3 === 1) {
				db.prepare("SELECT * FROM memories WHERE owner=? AND repo=? ORDER BY importance DESC LIMIT 10").all(
					OWNER,
					REPO
				);
			} else {
				db.prepare("SELECT * FROM memories WHERE owner=? AND repo=? AND id=? LIMIT 1").get(
					OWNER,
					REPO,
					`00000000-0000-4000-a000-${String((i % 100) + 1).padStart(12, "0")}`
				);
			}
			latencies.push(performance.now() - t0);
		} catch (e) {
			const kind = classifyError(e);
			if (kind === "busy") busyErrors++;
			else if (kind === "timeout") timeoutErrors++;
			else otherErrors++;
		}
	}
	parentPort.postMessage({
		ok: true,
		latencies,
		busyErrors,
		timeoutErrors,
		otherErrors,
		busyRetries,
		lockWaitMs: 0,
		operationStart,
		operationEnd: epochBasis.toEpochMs(performance.now())
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
