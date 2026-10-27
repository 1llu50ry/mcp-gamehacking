import { performance } from "node:perf_hooks";
import { BENCH_EPOCH_MS } from "../../memory-eval/corpus.mjs";
import { makeMemoryEntry } from "../fixtures.mjs";
import { createBenchClock } from "../clock.mjs";
import { withBenchDbAsync, writeWithEnqueue, claimBatch, failJob, completeJob, drainAll } from "../lifecycle.mjs";
import { BATCH_SIZE, POISON_THRESHOLD, BACKOFF_BASE_MS, BACKOFF_MAX_MS } from "../constants.mjs";

export async function measureScenarioFailedJobs(tmpDir) {
	return withBenchDbAsync(tmpDir, "eq-failed", async ({ db }) => {
		const clock = createBenchClock();
		const N = 20;
		const ids = [];
		const enqueueAt = new Map();
		const writeLatencies = [];
		for (let i = 0; i < N; i++) {
			const id = `50000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`;
			ids.push(id);
			const mem = makeMemoryEntry(id, new Date(BENCH_EPOCH_MS + i * 10).toISOString(), 13000 + i);
			const tWall0 = Date.now();
			const t0 = performance.now();
			enqueueAt.set(id, tWall0);
			writeWithEnqueue(db, mem);
			writeLatencies.push(performance.now() - t0);
		}
		const half = Math.floor(N / 2);
		let attempt = 0;
		let backoffWaits = 0;
		let injectedFailures = 0;
		const backoffEvents = [];
		for (let cycle = 0; cycle < POISON_THRESHOLD + 10; cycle++) {
			const jobs = claimBatch(db, BATCH_SIZE, 60000, clock);
			if (jobs.length === 0) {
				const poisonCount = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='poison'").get().c;
				const pendingCount = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='pending'").get().c;
				if (poisonCount > 0 || pendingCount === 0) break;
				const waited = clock.waitUntilDue(db);
				if (waited > 0) backoffWaits++;
				else {
					const hasBackoff = db
						.prepare("SELECT 1 FROM queue_jobs WHERE status='pending' AND backoff_until IS NOT NULL LIMIT 1")
						.get();
					if (!hasBackoff) break;
					clock.advance(50);
					backoffWaits++;
				}
				continue;
			}
			for (const job of jobs) {
				const idx = ids.indexOf(job.entity_id);
				const shouldPoison = idx < half;
				if (shouldPoison) {
					const beforeIso = clock.nowIso();
					failJob(
						db,
						job.id,
						job.locked_by,
						"simulated embed failure",
						POISON_THRESHOLD,
						BACKOFF_BASE_MS,
						BACKOFF_MAX_MS,
						clock
					);
					injectedFailures++;
					const row = db.prepare("SELECT attempts, backoff_until, status FROM queue_jobs WHERE id=?").get(job.id);
					backoffEvents.push({
						entityId: job.entity_id,
						attempt: row.attempts,
						backoffUntil: row.backoff_until,
						status: row.status,
						failedAt: beforeIso,
						baseMs: BACKOFF_BASE_MS,
						maxMs: BACKOFF_MAX_MS
					});
				} else if (attempt < 2) {
					const beforeIso = clock.nowIso();
					failJob(
						db,
						job.id,
						job.locked_by,
						"simulated embed failure",
						POISON_THRESHOLD,
						BACKOFF_BASE_MS,
						BACKOFF_MAX_MS,
						clock
					);
					injectedFailures++;
					const row = db.prepare("SELECT attempts, backoff_until, status FROM queue_jobs WHERE id=?").get(job.id);
					backoffEvents.push({
						entityId: job.entity_id,
						attempt: row.attempts,
						backoffUntil: row.backoff_until,
						status: row.status,
						failedAt: beforeIso,
						baseMs: BACKOFF_BASE_MS,
						maxMs: BACKOFF_MAX_MS
					});
				} else {
					db.prepare(
						"INSERT INTO memory_vectors (memory_id, vector, updated_at) VALUES (?, ?, ?) ON CONFLICT(memory_id) DO UPDATE SET vector=excluded.vector, updated_at=excluded.updated_at"
					).run(job.entity_id, JSON.stringify({ dim: 8 }), clock.nowIso());
					completeJob(db, job.id, job.locked_by, clock);
				}
			}
			attempt++;
			const waited = clock.waitUntilDue(db);
			if (waited > 0) backoffWaits++;
			if (attempt > POISON_THRESHOLD + 5) break;
		}
		const poisoned = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='poison'").get().c;
		const pendingAfter = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='pending'").get().c;
		const doneAfter = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='done'").get().c;
		let retryDone = doneAfter;
		let retryMs = 0;
		let retryVisibilityFailures = 0;
		const queueDelays = [];
		let retryVisibilityAt = null;
		if (poisoned > 0) {
			const tRetryStart = Date.now();
			db.prepare(
				"UPDATE queue_jobs SET status='pending', attempts=0, backoff_until=NULL, last_error=NULL, lease_until=NULL, locked_by=NULL WHERE status='poison'"
			).run();
			const retryVisMap = new Map();
			await drainAll(db, {
				embedDelayMs: 1,
				batchSize: 32,
				clock,
				onVisible: (id) => retryVisMap.set(id, Date.now())
			});
			retryMs = Date.now() - tRetryStart;
			retryDone = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='done'").get().c;
			retryVisibilityAt = Object.fromEntries(retryVisMap);
			for (let i = 0; i < half; i++) {
				const id = ids[i];
				const hasVector = !!db.prepare("SELECT 1 FROM memory_vectors WHERE memory_id=?").get(id);
				if (hasVector) {
					const enq = enqueueAt.get(id);
					const vis = retryVisMap.get(id);
					if (vis != null && enq != null) queueDelays.push(vis - enq);
					else retryVisibilityFailures++;
				}
			}
		}
		const backoffAssertions = backoffEvents.map((ev) => {
			const attemptForDelay = ev.attempt;
			const expectedDelay = Math.min(BACKOFF_BASE_MS * 2 ** (attemptForDelay - 1), BACKOFF_MAX_MS);
			const failedAtMs = new Date(ev.failedAt).getTime();
			const backoffUntilMs = ev.backoffUntil ? new Date(ev.backoffUntil).getTime() : null;
			const observedDelay = backoffUntilMs != null ? backoffUntilMs - failedAtMs : null;
			const withinTolerance =
				observedDelay == null ? ev.status === "poison" : Math.abs(observedDelay - expectedDelay) <= 5;
			const poisonCorrect = ev.status === "poison" ? ev.attempt >= POISON_THRESHOLD : ev.attempt < POISON_THRESHOLD;
			return { ...ev, expectedDelay, observedDelay, withinTolerance, poisonCorrect };
		});
		const allBackoffOk = backoffAssertions.every((a) => a.withinTolerance && a.poisonCorrect);
		const backoffRespected = backoffEvents.length > 0 ? allBackoffOk : true;
		const backoffFailures = backoffRespected ? 0 : 1;
		return {
			writeLatencies,
			queueDelays,
			failures: poisoned + (retryVisibilityFailures ?? 0) + backoffFailures,
			visibilityFailures: retryVisibilityFailures ?? 0,
			backoffFailures,
			poisoned,
			pendingAfter,
			doneAfter,
			retryDone,
			n: N,
			attemptCycles: attempt,
			halfPoisoned: half,
			retryMs,
			backoffWaits,
			injectedFailures,
			backoffEvents,
			backoffAssertions,
			backoffRespected,
			retryVisibilityAt
		};
	});
}
