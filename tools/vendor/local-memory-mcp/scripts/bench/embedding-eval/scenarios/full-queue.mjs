import { performance } from "node:perf_hooks";
import { BENCH_EPOCH_MS } from "../../memory-eval/corpus.mjs";
import { makeMemoryEntry } from "../fixtures.mjs";
import { createBenchClock } from "../clock.mjs";
import { withBenchDbAsync, writeWithEnqueue, drainAll } from "../lifecycle.mjs";

export async function measureScenarioFullQueue(tmpDir) {
	return withBenchDbAsync(tmpDir, "eq-full", async ({ db }) => {
		const clock = createBenchClock();
		const prefill = 600;
		for (let i = 0; i < prefill; i++) {
			const id = `10000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`;
			const mem = makeMemoryEntry(id, new Date(BENCH_EPOCH_MS).toISOString(), 1000 + i);
			writeWithEnqueue(db, mem);
		}
		const pendingBefore = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='pending'").get().c;
		const N = 20;
		const writeLatencies = [];
		const enqueueAt = new Map();
		for (let i = 0; i < N; i++) {
			const id = `20000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`;
			const mem = makeMemoryEntry(id, new Date(BENCH_EPOCH_MS + 5000 + i * 100).toISOString(), 5000 + i);
			const t0 = performance.now();
			const tWall0 = Date.now();
			enqueueAt.set(id, tWall0);
			writeWithEnqueue(db, mem);
			writeLatencies.push(performance.now() - t0);
		}
		const visibilityAt = new Map();
		const tDrain0 = Date.now();
		const drain = await drainAll(db, {
			embedDelayMs: 1,
			batchSize: 32,
			clock,
			onVisible: (id) => visibilityAt.set(id, Date.now())
		});
		const aggregateDrainMs = Date.now() - tDrain0;
		const queueDelays = [];
		let failures = 0;
		let visibilityFailures = 0;
		for (let i = 0; i < N; i++) {
			const id = `20000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`;
			const hasVector = !!db.prepare("SELECT 1 FROM memory_vectors WHERE memory_id=?").get(id);
			if (!hasVector) failures++;
			else {
				const vis = visibilityAt.get(id);
				const enq = enqueueAt.get(id);
				if (vis != null && enq != null) queueDelays.push(vis - enq);
				else visibilityFailures++;
			}
		}
		return {
			writeLatencies,
			queueDelays,
			failures: failures + visibilityFailures,
			visibilityFailures,
			pendingBefore,
			n: N,
			aggregateDrainMs,
			visibilityAt: Object.fromEntries(visibilityAt),
			vectorFailures: drain.vectorFailures
		};
	});
}
