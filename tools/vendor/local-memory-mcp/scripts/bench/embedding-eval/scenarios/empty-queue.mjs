import { performance } from "node:perf_hooks";
import { BENCH_EPOCH_MS } from "../../memory-eval/corpus.mjs";
import { makeMemoryEntry } from "../fixtures.mjs";
import { createBenchClock } from "../clock.mjs";
import { withBenchDbAsync, writeWithEnqueue, drainAll, countByStatus } from "../lifecycle.mjs";

export async function measureScenarioEmptyQueue(tmpDir) {
	return withBenchDbAsync(tmpDir, "eq-empty", async ({ db }) => {
		const clock = createBenchClock();
		const N = 20;
		const enqueueAt = new Map();
		const visibilityAt = new Map();
		const writeLatencies = [];
		const queueDelays = [];
		let failures = 0;
		let vectorFailures = 0;
		let aggregateDrainMs = 0;
		for (let i = 0; i < N; i++) {
			const id = `00000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`;
			const nowIso = new Date(BENCH_EPOCH_MS + i * 1000).toISOString();
			const mem = makeMemoryEntry(id, nowIso, i);
			const tW0 = performance.now();
			const tWall0 = Date.now();
			enqueueAt.set(id, tWall0);
			writeWithEnqueue(db, mem);
			writeLatencies.push(performance.now() - tW0);
			const tD0 = Date.now();
			const perItemVisibleAt = new Map();
			const drain = await drainAll(db, {
				embedDelayMs: 1,
				batchSize: 32,
				clock,
				onVisible: (visId) => perItemVisibleAt.set(visId, Date.now())
			});
			aggregateDrainMs += Date.now() - tD0;
			vectorFailures += drain.vectorFailures;
			const hasVector = !!db.prepare("SELECT 1 FROM memory_vectors WHERE memory_id=?").get(id);
			if (!hasVector) failures++;
			else {
				const visAt = perItemVisibleAt.get(id);
				if (visAt == null) failures++;
				else {
					visibilityAt.set(id, visAt);
					queueDelays.push(visAt - enqueueAt.get(id));
				}
			}
		}
		const counts = countByStatus(db);
		return {
			writeLatencies,
			queueDelays,
			failures,
			vectorFailures,
			counts,
			n: N,
			aggregateDrainMs,
			enqueueAt: Object.fromEntries(enqueueAt),
			visibilityAt: Object.fromEntries(visibilityAt)
		};
	});
}
