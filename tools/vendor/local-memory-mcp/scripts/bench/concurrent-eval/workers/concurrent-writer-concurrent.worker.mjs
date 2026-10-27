import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { createConcurrentBenchDb } from "../schema.mjs";
import { BENCH_EPOCH_MS, createEpochBasis, OWNER, REPO } from "../constants.mjs";

const data = workerData?.dbPath
	? workerData
	: {
			dbPath: process.env.CONCURRENT_CHILD_DB,
			ops: Number(process.env.CONCURRENT_CHILD_OPS || 20),
			startOffset: Number(process.env.CONCURRENT_CHILD_OFFSET || 0),
			writerIndex: Number(process.env.CONCURRENT_CHILD_INDEX || 0),
			barrierPath: process.env.CONCURRENT_BARRIER_PATH
		};
const isChild = !parentPort;
if (data.barrierPath) {
	const fs = await import("node:fs");
	const deadline = Date.now() + 20000;
	fs.writeFileSync(`${data.barrierPath}/ready/${process.pid}-${data.writerIndex}-${Math.random()}`, "ready");
	while (!fs.existsSync(`${data.barrierPath}/release`)) {
		if (Date.now() >= deadline) throw new Error("barrier release timeout");
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
	}
} else if (data.barrierBuffer) {
	const shared = new Int32Array(data.barrierBuffer);
	Atomics.add(shared, 0, 1);
	Atomics.notify(shared, 0, 1);
	while (Atomics.load(shared, 1) === 0) Atomics.wait(shared, 1, 0, 10);
}
const epochBasis = createEpochBasis();
const operationStart = epochBasis.toEpochMs(performance.now());
const db = createConcurrentBenchDb(data.dbPath);
const latencies = [];
let busyErrors = 0;
let timeoutErrors = 0;
let otherErrors = 0;
let busyRetries = 0;
let lockWaitMs = 0;
const insertedIds = [];
function classifyError(e) {
	const msg = String(e?.message || e);
	const code = e?.code ? String(e.code) : "";
	if (/SQLITE_BUSY/i.test(code) || /SQLITE_BUSY/i.test(msg) || /database is locked/i.test(msg)) return "busy";
	if (/timeout/i.test(msg) && /busy/i.test(msg)) return "timeout";
	return "other";
}
function post(result) {
	if (isChild) {
		if (process.send) process.send(result);
		setImmediate(() => process.exit(result.ok ? 0 : 1));
	} else parentPort.postMessage(result);
}
try {
	const insertMemory = db.prepare(
		"INSERT INTO memories (id, code, repo, owner, type, title, content, importance, created_at, updated_at, agent, role, model, tags, metadata) VALUES (?, ?, ?, ?, 'code_fact', ?, ?, 3, ?, ?, 'bench', 'benchmark', 'bench-model', ?, ?)"
	);
	const insertTag = db.prepare("INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)");
	for (let i = 0; i < data.ops; i++) {
		const seq = data.startOffset + i;
		const id = `10000000-0000-4000-a000-${String(seq + 1).padStart(12, "0")}`;
		const iso = new Date(BENCH_EPOCH_MS + seq).toISOString();
		const t0 = performance.now();
		let attempt = 0;
		while (attempt < 3) {
			try {
				const tx = db.transaction(() => {
					insertMemory.run(
						id,
						`MEM-${String(seq + 1).padStart(6, "0")}`,
						REPO,
						OWNER,
						`Concurrent memory ${seq}`,
						`workspace memory vector search sqlite WAL writer ${seq}`,
						iso,
						iso,
						JSON.stringify(["bench", "concurrent"]),
						JSON.stringify({ seed: 0x480, seq })
					);
					insertTag.run(id, "concurrent");
				});
				tx();
				latencies.push(performance.now() - t0);
				insertedIds.push(id);
				break;
			} catch (e) {
				const kind = classifyError(e);
				if (kind === "busy" && attempt < 2) {
					busyRetries++;
					attempt++;
					const wait = 2 * attempt;
					lockWaitMs += wait;
					Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
					continue;
				}
				if (kind === "busy") busyErrors++;
				else if (kind === "timeout") timeoutErrors++;
				else otherErrors++;
				break;
			}
		}
	}
	post({
		ok: true,
		latencies,
		busyErrors,
		timeoutErrors,
		otherErrors,
		busyRetries,
		lockWaitMs,
		insertedIds,
		operationStart,
		operationEnd: epochBasis.toEpochMs(performance.now())
	});
} catch (e) {
	post({ ok: false, error: String(e?.message || e), stack: String(e?.stack || "") });
} finally {
	try {
		db.close();
	} catch {
		// Best-effort benchmark cleanup.
	}
}
