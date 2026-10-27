import { performance } from "node:perf_hooks";
import { BENCH_EPOCH_MS } from "../../memory-eval/corpus.mjs";
import { makeMemoryEntry } from "../fixtures.mjs";
import { createBenchDb } from "../schema.mjs";
import { writeWithEnqueue, claimBatch, completeJob, drainAll, reconcileExpiredLeases } from "../lifecycle.mjs";
import { LEASE_MS } from "../constants.mjs";
import { createBenchClock } from "../clock.mjs";

const op = process.argv[2];
const dbPath = process.argv[3];

if (op === "seed") {
	const N = Number(process.argv[4] || "30");
	const db = createBenchDb(dbPath);
	const enqueueAt = [];
	try {
		for (let i = 0; i < N; i++) {
			const id = `40000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`;
			const mem = makeMemoryEntry(id, new Date(BENCH_EPOCH_MS + i * 50).toISOString(), 11000 + i);
			const t0 = performance.now();
			writeWithEnqueue(db, mem);
			enqueueAt.push({ id, t0 });
		}
		console.log(JSON.stringify({ ok: true, enqueueAt }));
	} catch (e) {
		console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }));
		process.exit(1);
	} finally {
		try {
			db.close();
		} catch {
			// Best-effort benchmark cleanup.
		}
	}
} else if (op === "claim") {
	const db = createBenchDb(dbPath);
	try {
		const clock = createBenchClock();
		let jobs = claimBatch(db, 10, LEASE_MS, clock);
		for (const job of jobs) {
			db.prepare(
				"INSERT INTO memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET vector=excluded.vector, updated_at=excluded.updated_at"
			).run(job.entity_id, JSON.stringify({ dim: 8 }), new Date().toISOString());
			completeJob(db, job.id, job.locked_by, clock);
		}
		const pendingMid = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='pending'").get().c;
		const doneMid = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='done'").get().c;
		const claimedMid = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='claimed'").get().c;
		const jobsForStall = claimBatch(db, 5, 50, clock);
		const claimedBeforeKill = jobsForStall.length;
		console.log(
			JSON.stringify({
				ok: true,
				pendingMid,
				doneMid,
				claimedMid,
				claimedBeforeKill,
				stalledIds: jobsForStall.map((j) => j.entity_id)
			})
		);
		if (claimedBeforeKill > 0) {
			await new Promise((r) => setTimeout(r, 5000));
		}
	} catch (e) {
		console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }));
		process.exit(1);
	} finally {
		try {
			db.close();
		} catch {
			// Best-effort benchmark cleanup.
		}
	}
} else if (op === "recover") {
	const enqueueRaw = process.argv[4];
	const enqueueAt = JSON.parse(enqueueRaw || "[]");
	const N = enqueueAt.length;
	const ids = enqueueAt.map((e) => e.id);
	const enqueueMap = new Map(enqueueAt.map((e) => [e.id, e.t0]));
	const db2 = createBenchDb(dbPath);
	try {
		await new Promise((r) => setTimeout(r, 70));
		const reconciled = reconcileExpiredLeases(db2, null);
		const tRestartStart = Date.now();
		const clock2 = createBenchClock();
		const visibilityMap = new Map();
		const drain = await drainAll(db2, {
			embedDelayMs: 1,
			batchSize: 32,
			clock: clock2,
			onVisible: (id) => visibilityMap.set(id, Date.now())
		});
		const restartAggregateMs = Date.now() - tRestartStart;
		const restartDelays = [];
		const visibilityAt = [];
		let failures = 0;
		let visibilityFailures = 0;
		const pendingAfter = db2.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='pending'").get().c;
		const claimedAfter = db2.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='claimed'").get().c;
		const doneAfter = db2.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='done'").get().c;
		for (const id of ids) {
			const hasVector = !!db2.prepare("SELECT 1 FROM memory_vectors WHERE memory_id=?").get(id);
			if (!hasVector) failures++;
			else {
				const enq = enqueueMap.get(id);
				const visAt = visibilityMap.get(id);
				if (enq != null && visAt != null) {
					visibilityAt.push({ id, at: visAt });
					restartDelays.push(visAt - enq);
				} else {
					visibilityFailures++;
				}
			}
		}
		failures += visibilityFailures;
		console.log(
			JSON.stringify({
				ok: true,
				restartDelays,
				visibilityAt,
				restartAggregateMs,
				failures,
				visibilityFailures,
				reconciled,
				vectorFailures: drain.vectorFailures,
				n: N,
				counts: { pendingAfter, claimedAfter, doneAfter }
			})
		);
	} catch (e) {
		console.error(JSON.stringify({ ok: false, error: String(e?.message || e), stack: String(e?.stack || "") }));
		process.exit(1);
	} finally {
		try {
			db2.close();
		} catch {
			// Best-effort benchmark cleanup.
		}
	}
} else {
	console.error(JSON.stringify({ ok: false, error: `unknown op ${op}` }));
	process.exit(1);
}
