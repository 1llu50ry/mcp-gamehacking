/**
 * WAL write-contention load test (TASK-424).
 *
 * Opens N concurrent SQLiteStore instances (worker threads, separate
 * connections) on ONE temp file-backed DB and measures write contention:
 * locked/SQLITE_BUSY error count, wall time, and p50/p95 latency.
 *
 * Why workers + a bundle: worker threads do not inherit vitest's TS
 * transform, so the real store source is bundled once with esbuild into the
 * temp dir and each worker imports that bundle. The store's own
 * busy_timeout + BEGIN IMMEDIATE + bounded retry wrapper are the code under
 * test, not a reimplementation.
 *
 * Never touches the real storage/ DB (mkdtemp only). Default runtime < 20s;
 * the N=50 run is opt-in via WAL_CONTENTION_LARGE=1.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";
import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const REPO_ROOT = process.cwd();
const DEFAULT_WRITERS = 10;
const LARGE_WRITERS = 50;
const OPS_PER_WRITER = 10;

interface WorkerDone {
	type: "done";
	i: number;
	latencies: number[];
	busy: number;
	other: number;
}

const WORKER_SOURCE = `
import { parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";

const { SQLiteStore } = await import(workerData.bundlePath);
const store = await SQLiteStore.create(workerData.dbPath);
parentPort.postMessage({ type: "opened", i: workerData.i });
await new Promise((resolve) => {
	parentPort.once("message", (msg) => {
		if (msg.type === "go") resolve();
	});
});

const latencies = [];
let busy = 0;
let other = 0;
const now = new Date().toISOString();

for (let k = 0; k < workerData.ops; k++) {
	const entry = {
		id: String(workerData.i).padStart(4, "0") + "-" + String(k).padStart(4, "0") + "-4000-8000-000000000000",
		type: "code_fact",
		title: "wal contention probe",
		content: "concurrent writer benchmark content",
		importance: 3,
		agent: "bench",
		role: "bench",
		model: "bench",
		scope: { owner: "bench", repo: "wal-contention" },
		created_at: now,
		updated_at: now,
		completed_at: null,
		hit_count: 0,
		recall_count: 0,
		last_used_at: null,
		expires_at: null,
		supersedes: null,
		status: "active",
		tags: [],
		metadata: {},
		is_global: false
	};
	const started = performance.now();
	try {
		await store.withWrite(() => store.memories.bulkInsertMemories([entry]));
		latencies.push(performance.now() - started);
	} catch (error) {
		const text = String(error && error.code ? error.code : "") + String(error && error.message ? error.message : error);
		if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked|database is busy/i.test(text)) busy++;
		else other++;
	}
}

store.close();
parentPort.postMessage({ type: "done", i: workerData.i, latencies, busy, other });
`;

interface Harness {
	dir: string;
	dbPath: string;
	bundlePath: string;
	cleanup: () => void;
}

async function createHarness(): Promise<Harness> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-contention-"));
	// better-sqlite3 is native; the worker resolves it through a node_modules
	// link so the temp dir needs no install.
	fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
	const bundlePath = path.join(dir, "store.mjs");
	await esbuild.build({
		entryPoints: [path.join(REPO_ROOT, "src/mcp/storage/sqlite.ts")],
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node22",
		outfile: bundlePath,
		external: ["better-sqlite3", "proper-lockfile"],
		logLevel: "error"
	});
	const dbPath = path.join(dir, "wal-contention.db");
	const { SQLiteStore } = await import(bundlePath);
	const init = await SQLiteStore.create(dbPath);
	init.close();
	return {
		dir,
		dbPath,
		bundlePath,
		cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
	};
}

async function runWriters(harness: Harness, writers: number): Promise<WorkerDone[]> {
	const workers: Worker[] = [];
	// Open stores SERIALLY: concurrent first-opens race the non-atomic
	// DROP+CREATE of derived FTS triggers (derived-db.ts createDerivedTriggers)
	// — a schema-init concern, not the write contention this test measures.
	for (let i = 0; i < writers; i++) {
		const worker = new Worker(WORKER_SOURCE, {
			eval: true,
			workerData: { bundlePath: harness.bundlePath, dbPath: harness.dbPath, i, ops: OPS_PER_WRITER }
		});
		await new Promise<void>((resolve, reject) => {
			worker.once("message", (msg: { type?: string }) => {
				if (msg.type === "opened") resolve();
				else reject(new Error(`unexpected worker message: ${JSON.stringify(msg)}`));
			});
			worker.once("error", reject);
		});
		workers.push(worker);
	}

	const done = workers.map(
		(worker) =>
			new Promise<WorkerDone>((resolve, reject) => {
				worker.on("message", (msg: WorkerDone & { type: string }) => {
					if (msg.type === "done") resolve(msg);
				});
				worker.on("error", reject);
			})
	);

	// Release every writer at once so their transactions genuinely overlap.
	for (const worker of workers) worker.postMessage({ type: "go" });

	try {
		return await Promise.all(done);
	} finally {
		for (const worker of workers) await worker.terminate();
	}
}

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
	return sorted[index];
}

let harness: Harness | null = null;
afterAll(() => {
	harness?.cleanup();
});

describe("SQLite WAL write contention (TASK-424)", () => {
	it("surfaces zero busy/locked errors under N concurrent writers", async (ctx) => {
		let created: Harness;
		try {
			created = await createHarness();
		} catch (error) {
			console.warn(`[wal-contention] skipped: temp harness unavailable (${String(error)})`);
			ctx.skip();
			return;
		}
		harness = created;

		const writers = process.env.WAL_CONTENTION_LARGE === "1" ? LARGE_WRITERS : DEFAULT_WRITERS;
		const started = performance.now();
		const results = await runWriters(created, writers);
		const wallMs = performance.now() - started;

		const latencies = results.flatMap((r) => r.latencies).sort((a, b) => a - b);
		const busy = results.reduce((sum, r) => sum + r.busy, 0);
		const other = results.reduce((sum, r) => sum + r.other, 0);
		const expectedOps = writers * OPS_PER_WRITER;

		console.log(
			`[wal-contention] writers=${writers} ops=${latencies.length}/${expectedOps} busy=${busy} other=${other} ` +
				`wall=${wallMs.toFixed(0)}ms p50=${percentile(latencies, 50).toFixed(3)}ms ` +
				`p95=${percentile(latencies, 95).toFixed(3)}ms max=${(latencies[latencies.length - 1] ?? 0).toFixed(1)}ms`
		);

		expect(busy, "SQLITE_BUSY/locked errors must be zero").toBe(0);
		expect(other, "unexpected write errors").toBe(0);
		expect(latencies.length, "every writer op must succeed").toBe(expectedOps);
	});
});
