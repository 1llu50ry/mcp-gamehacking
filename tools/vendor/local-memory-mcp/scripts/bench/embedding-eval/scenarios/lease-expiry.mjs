import { BENCH_EPOCH_MS } from "../../memory-eval/corpus.mjs";
import { makeMemoryEntry } from "../fixtures.mjs";
import { withBenchDbAsync, writeWithEnqueue, claimBatch, drainAll, reconcileExpiredLeases } from "../lifecycle.mjs";
import { BATCH_SIZE, SHORT_LEASE_MS } from "../constants.mjs";

export async function measureScenarioLeaseExpiry(tmpDir) {
	return withBenchDbAsync(tmpDir, "eq-lease", async ({ db }) => {
		const N = 10;
		const ids = [];
		const enqueueAt = new Map();
		for (let i = 0; i < N; i++) {
			const id = `60000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`;
			ids.push(id);
			const mem = makeMemoryEntry(id, new Date(BENCH_EPOCH_MS + i * 10).toISOString(), 15000 + i);
			const t0 = Date.now();
			enqueueAt.set(id, t0);
			writeWithEnqueue(db, mem);
		}
		const claimed = claimBatch(db, BATCH_SIZE, SHORT_LEASE_MS);
		const claimedAt = Date.now();
		await new Promise((r) => setTimeout(r, SHORT_LEASE_MS + 30));
		const reconcileStart = Date.now();
		const reconciled = reconcileExpiredLeases(db);
		const reconcileMs = Date.now() - reconcileStart;
		const leaseWaitMs = Date.now() - claimedAt;
		const visibilityAt = new Map();
		const tDrainStart = Date.now();
		const drain = await drainAll(db, {
			embedDelayMs: 1,
			batchSize: 32,
			onVisible: (id) => visibilityAt.set(id, Date.now())
		});
		const drainMs = Date.now() - tDrainStart;
		const visible = ids.filter((id) => !!db.prepare("SELECT 1 FROM memory_vectors WHERE memory_id=?").get(id)).length;
		const failures = N - visible;
		let visibilityFailures = 0;
		const queueDelays = [];
		for (const id of ids) {
			if (!db.prepare("SELECT 1 FROM memory_vectors WHERE memory_id=?").get(id)) continue;
			const enq = enqueueAt.get(id);
			const vis = visibilityAt.get(id);
			if (enq != null && vis != null) queueDelays.push(vis - enq);
			else visibilityFailures++;
		}
		return {
			leaseWaitMs,
			reconcileMs,
			drainMs,
			reconciled,
			claimed: claimed.length,
			visible,
			failures: failures + visibilityFailures,
			visibilityFailures,
			n: N,
			shortLeaseMs: SHORT_LEASE_MS,
			queueDelays,
			visibilityAt: Object.fromEntries(visibilityAt),
			aggregateDrainMs: drainMs,
			vectorFailures: drain.vectorFailures
		};
	});
}
