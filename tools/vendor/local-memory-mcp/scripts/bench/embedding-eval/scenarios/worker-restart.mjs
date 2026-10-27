import path from "path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "url";
import { BENCH_EPOCH_MS } from "../../memory-eval/corpus.mjs";
import { makeMemoryEntry } from "../fixtures.mjs";
import { createBenchDb } from "../schema.mjs";
import { writeWithEnqueue } from "../lifecycle.mjs";

function spawnWorker(dbPath, op, extraArg) {
	const workerPath = fileURLToPath(new URL("../workers/restart.worker.mjs", import.meta.url));
	const args = [workerPath, op, dbPath];
	if (extraArg != null) args.push(extraArg);
	return spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function onceJsonReadyOrClose(proc) {
	return new Promise((resolve, reject) => {
		let out = "";
		let errOut = "";
		let settled = false;
		const tryParse = (payload) => {
			const trimmed = payload.trim();
			if (!trimmed) return null;
			const lines = trimmed.split("\n").filter(Boolean);
			for (let i = lines.length - 1; i >= 0; i--) {
				try {
					const parsed = JSON.parse(lines[i]);
					if (parsed.ok) return parsed;
				} catch {
					// Best-effort benchmark cleanup or process termination.
				}
			}
			return null;
		};
		proc.stdout.on("data", (d) => {
			out += d;
			const parsed = tryParse(out + errOut, null);
			if (parsed && !settled) {
				settled = true;
				resolve(parsed);
			}
		});
		proc.stderr.on("data", (d) => (errOut += d));
		proc.on("close", (code) => {
			if (settled) return;
			const payload = (out + errOut).trim();
			const lastLine = payload.split("\n").filter(Boolean).pop() || "";
			try {
				const parsed = JSON.parse(lastLine);
				if (parsed.ok) resolve(parsed);
				else reject(new Error(parsed.error || `worker ${code}: ${payload.slice(0, 500)}`));
			} catch (e) {
				reject(new Error(`worker parse fail code=${code} out=${payload.slice(0, 800)} err=${String(e.message)}`));
			}
		});
		proc.on("error", reject);
	});
}
function onceJson(proc) {
	return onceJsonReadyOrClose(proc);
}

export async function measureScenarioWorkerRestart(tmpDir) {
	const dbPath = path.join(tmpDir, `eq-restart-${randomUUID()}.db`);
	const N = 30;
	const mems = [];
	for (let i = 0; i < N; i++) {
		const id = `40000000-0000-4000-a000-${String(i + 1).padStart(12, "0")}`;
		mems.push({ id, t0: Date.now() });
	}
	const seedDb = createBenchDb(dbPath);
	const writeLatencies = [];
	try {
		for (let i = 0; i < N; i++) {
			const id = mems[i].id;
			const mem = makeMemoryEntry(id, new Date(BENCH_EPOCH_MS + i * 50).toISOString(), 11000 + i);
			const tPerf0 = performance.now();
			const tWall0 = Date.now();
			writeWithEnqueue(seedDb, mem);
			writeLatencies.push(performance.now() - tPerf0);
			mems[i].t0 = tWall0;
		}
	} finally {
		try {
			seedDb.close();
		} catch {
			// Best-effort benchmark cleanup or process termination.
		}
	}
	const enqueueAt = mems.map((m) => ({ id: m.id, t0: m.t0 }));

	const claimProc = spawnWorker(dbPath, "claim");
	let claimRes;
	let killedLiveWorker = false;
	try {
		const dataPromise = onceJsonReadyOrClose(claimProc);
		const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("claim worker timeout")), 8000));
		claimRes = await Promise.race([dataPromise, timeout]);
		if (claimProc.exitCode == null && claimProc.signalCode == null) {
			try {
				claimProc.kill("SIGKILL");
				killedLiveWorker = true;
				await new Promise((r) => claimProc.once("close", r));
			} catch {
				// Best-effort benchmark cleanup or process termination.
			}
		}
	} catch (e) {
		try {
			claimProc.kill("SIGKILL");
		} catch {
			// Best-effort benchmark cleanup or process termination.
		}
		const pendingMid = (() => {
			try {
				const db = createBenchDb(dbPath);
				const c = db.prepare("SELECT COUNT(*) as c FROM queue_jobs WHERE status='pending'").get().c;
				db.close();
				return c;
			} catch {
				return 0;
			}
		})();
		return {
			writeLatencies,
			restartDelays: [],
			restartAggregateMs: 0,
			failures: N,
			pendingMid,
			doneMid: 0,
			claimedMid: 0,
			reconciled: 0,
			stalledClaimed: 0,
			vectorFailures: 0,
			n: N,
			error: String(e?.message || e),
			restartMethod: "child_process (failed claim phase)"
		};
	}

	const recoverProc = spawnWorker(dbPath, "recover", JSON.stringify(enqueueAt));
	const recoverRes = await onceJson(recoverProc).catch((e) => ({ ok: false, error: String(e.message) }));
	if (!recoverRes.ok) {
		return {
			writeLatencies,
			restartDelays: [],
			restartAggregateMs: 0,
			failures: N,
			pendingMid: claimRes.pendingMid,
			doneMid: claimRes.doneMid,
			claimedMid: claimRes.claimedMid,
			reconciled: 0,
			stalledClaimed: claimRes.claimedBeforeKill,
			vectorFailures: 0,
			n: N,
			error: recoverRes.error,
			restartMethod: "child_process"
		};
	}

	const restartDelays = recoverRes.restartDelays || [];
	const visibilityAt = recoverRes.visibilityAt || [];
	const pendingAfter = recoverRes.counts?.pendingAfter ?? null;
	const claimedAfter = recoverRes.counts?.claimedAfter ?? null;
	const doneAfter = recoverRes.counts?.doneAfter ?? null;

	const missingEvidence = [];
	if (!killedLiveWorker) missingEvidence.push("no live worker lease holder was killed");
	if (!claimRes.claimedBeforeKill || claimRes.claimedBeforeKill === 0)
		missingEvidence.push("no held lease evidence (claimedBeforeKill==0)");
	if (!recoverRes.reconciled || recoverRes.reconciled === 0)
		missingEvidence.push("reconciliation did not recover any expired lease (reconciled==0)");
	if (missingEvidence.length) {
		return {
			writeLatencies,
			restartDelays: [],
			restartAggregateMs: recoverRes.restartAggregateMs ?? 0,
			failures: N,
			visibilityFailures: N,
			pendingMid: claimRes.pendingMid,
			doneMid: claimRes.doneMid,
			claimedMid: claimRes.claimedMid,
			reconciled: recoverRes.reconciled ?? 0,
			stalledClaimed: claimRes.claimedBeforeKill,
			killedLiveWorker,
			vectorFailures: recoverRes.vectorFailures ?? 0,
			pendingAfter,
			claimedAfter,
			doneAfter,
			n: N,
			error: `worker_restart missing evidence: ${missingEvidence.join("; ")}`,
			restartMethod: "child_process SIGKILL (live lease holder) + reconcileExpiredLeases + drainAll"
		};
	}

	return {
		writeLatencies,
		restartDelays,
		visibilityAt: Object.fromEntries(visibilityAt.map((v) => [v.id, v.at])),
		restartAggregateMs: recoverRes.restartAggregateMs,
		failures: recoverRes.failures,
		visibilityFailures: recoverRes.visibilityFailures ?? 0,
		pendingMid: claimRes.pendingMid,
		doneMid: claimRes.doneMid,
		claimedMid: claimRes.claimedMid,
		reconciled: recoverRes.reconciled,
		stalledClaimed: claimRes.claimedBeforeKill,
		killedLiveWorker,
		vectorFailures: recoverRes.vectorFailures,
		pendingAfter,
		claimedAfter,
		doneAfter,
		n: N,
		restartMethod: "child_process SIGKILL (live lease holder) + reconcileExpiredLeases + drainAll"
	};
}
