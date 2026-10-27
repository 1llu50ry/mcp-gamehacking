/**
 * PERF-008 — the four lightness scenarios.
 *
 * Each scenario returns the same {@link ScenarioMetrics} shape so the report can
 * compare builds line by line. Scenarios are sequential (never concurrent): a
 * second daemon on the box would contaminate the CPU/RSS samples.
 *
 * Never touches the live DB — every boot gets a fresh temp dir.
 */

import fs from "node:fs";
import path from "node:path";
import {
	buildDaemonBundle,
	createHarnessDir,
	delay,
	getJson,
	parseDaemonLogs,
	postJson,
	readCapabilities,
	readDbAccounting,
	seedTempCorpus,
	startDaemon,
	summarizeBoot,
	type HarnessOptions,
	type ScenarioMetrics
} from "./daemon-harness";

/** Mutable accumulator while a scenario runs. */
interface MetricsDraft {
	scenario: ScenarioMetrics["scenario"];
	boots: number;
	backfilledRows: number;
	backfilledPerBoot: number[];
	lazyWarmup: boolean;
	writesCompleted?: number;
	readsCompleted?: number;
	burstWallMs?: number;
	capabilities?: Record<string, string> | null;
	note?: string;
}

/** Fold a boot's samples + log facts into the draft. */
function absorbBoot(
	draft: MetricsDraft,
	samples: Parameters<typeof summarizeBoot>[0],
	logs: readonly string[]
): ReturnType<typeof summarizeBoot> {
	const facts = parseDaemonLogs(logs);
	draft.backfilledRows += facts.backfilledRows;
	draft.backfilledPerBoot.push(facts.backfilledRows);
	if (facts.lazyWarmup !== null) draft.lazyWarmup = facts.lazyWarmup;
	return summarizeBoot(samples);
}

/**
 * Run the clean-startup scenario: one cold boot, observed until settled.
 *
 * Records the boot's CPU burst, thread count, RSS/VmHWM and the startup
 * backfill row count (PERF-003: 0 on a fresh DB with no corpus).
 */
async function runCleanStartup(bundlePath: string, options: HarnessOptions): Promise<ScenarioMetrics> {
	const dir = createHarnessDir("perf008-clean-");
	const draft: MetricsDraft = {
		scenario: "clean-startup",
		boots: 1,
		backfilledRows: 0,
		backfilledPerBoot: [],
		lazyWarmup: options.lazyWarmup
	};
	const started = Date.now();
	const daemon = await startDaemon(bundlePath, dir, options.lazyWarmup, options);
	try {
		await delay(options.settleMs);
		draft.capabilities = await readCapabilities(daemon.url);
	} finally {
		await daemon.stop();
	}
	const summary = absorbBoot(draft, daemon.samples, daemon.logs);
	const accounting = await readDbAccounting(dir);
	return {
		...draft,
		durationMs: Date.now() - started,
		peakCpuPercent: summary.peakCpuPercent,
		averageCpuPercent: summary.averageCpuPercent,
		peakThreadCount: summary.peakThreadCount,
		finalThreadCount: summary.finalThreadCount,
		peakVmRssBytes: summary.peakVmRssBytes,
		finalVmRssBytes: summary.finalVmRssBytes,
		peakVmHwmBytes: summary.peakVmHwmBytes,
		peakVmSizeBytes: summary.peakVmSizeBytes,
		...accounting
	};
}

/**
 * Run the repeated-restart scenario: N sequential boots on the SAME DB.
 *
 * The DB is pre-seeded with a deterministic corpus so this is a real PERF-003
 * measurement: the FIRST boot must backfill the unembedded memories, and every
 * later boot on the same DB must enqueue 0. Idle RSS must not grow boot over
 * boot (a leak would show as a rising `finalVmRssBytes` on the later boots).
 */
async function runRepeatedRestart(bundlePath: string, options: HarnessOptions): Promise<ScenarioMetrics> {
	const dir = createHarnessDir("perf008-restart-");
	const seeded = await seedTempCorpus(dir, options.corpusSize);
	const draft: MetricsDraft = {
		scenario: "repeated-restart",
		boots: 0,
		backfilledRows: 0,
		backfilledPerBoot: [],
		lazyWarmup: options.lazyWarmup,
		note: `pre-seeded corpus: ${seeded} memories (first boot backfills, later boots must enqueue 0)`
	};
	const started = Date.now();
	let peakCpuPercent = 0;
	let averageCpuPercent = 0;
	let peakThreadCount = 0;
	let finalThreadCount = 0;
	let peakVmRssBytes = 0;
	let finalVmRssBytes = 0;
	let peakVmHwmBytes = 0;
	let peakVmSizeBytes = 0;

	for (let boot = 0; boot < options.restartCount; boot++) {
		const daemon = await startDaemon(bundlePath, dir, options.lazyWarmup, options);
		try {
			await delay(options.settleMs);
			draft.capabilities = await readCapabilities(daemon.url);
		} finally {
			await daemon.stop();
		}
		const summary = absorbBoot(draft, daemon.samples, daemon.logs);
		draft.boots += 1;
		peakCpuPercent = Math.max(peakCpuPercent, summary.peakCpuPercent);
		averageCpuPercent = Math.max(averageCpuPercent, summary.averageCpuPercent);
		peakThreadCount = Math.max(peakThreadCount, summary.peakThreadCount);
		finalThreadCount = summary.finalThreadCount;
		peakVmRssBytes = Math.max(peakVmRssBytes, summary.peakVmRssBytes);
		finalVmRssBytes = summary.finalVmRssBytes;
		peakVmHwmBytes = Math.max(peakVmHwmBytes, summary.peakVmHwmBytes);
		peakVmSizeBytes = Math.max(peakVmSizeBytes, summary.peakVmSizeBytes);
	}

	const accounting = await readDbAccounting(dir);
	return {
		...draft,
		durationMs: Date.now() - started,
		peakCpuPercent,
		averageCpuPercent,
		peakThreadCount,
		finalThreadCount,
		peakVmRssBytes,
		finalVmRssBytes,
		peakVmHwmBytes,
		peakVmSizeBytes,
		...accounting
	};
}

/**
 * Run the write/read burst scenario: boot, then hammer the dashboard API with
 * memory writes and list reads while sampling CPU/RSS.
 *
 * This is the scenario PERF-002's thread cap is meant to bound: a burst that
 * triggers embedding work would previously wake an all-core ORT pool.
 */
async function runWriteReadBurst(bundlePath: string, options: HarnessOptions): Promise<ScenarioMetrics> {
	const dir = createHarnessDir("perf008-burst-");
	const draft: MetricsDraft = {
		scenario: "write-read-burst",
		boots: 1,
		backfilledRows: 0,
		backfilledPerBoot: [],
		lazyWarmup: options.lazyWarmup
	};
	const started = Date.now();
	const daemon = await startDaemon(bundlePath, dir, options.lazyWarmup, options);
	let writes = 0;
	let reads = 0;
	try {
		// Let the boot settle so the burst is measured, not the startup.
		await delay(Math.min(options.settleMs, 5_000));
		const burstStart = Date.now();
		for (let index = 0; index < options.burstWrites; index++) {
			// `importance` is NOT NULL in the memories schema and the dashboard
			// create path does not default it — omitting it yields HTTP 500.
			const status = await postJson(`${daemon.url}/api/memories`, {
				repo: "perf008-burst",
				type: "code_fact",
				title: `Burst memory ${index}`,
				content: `Burst payload ${index} with enough text to be embedded deterministically`,
				importance: 3
			});
			if (status === 201 || status === 200) writes += 1;
			const listed = await getJson(`${daemon.url}/api/memories?repo=perf008-burst&limit=20`);
			if (listed !== null) reads += 1;
		}
		draft.burstWallMs = Date.now() - burstStart;
		// Observe the tail (embedding queue drain, checkpointing).
		await delay(Math.min(options.settleMs, 5_000));
		draft.capabilities = await readCapabilities(daemon.url);
	} finally {
		await daemon.stop();
	}
	const summary = absorbBoot(draft, daemon.samples, daemon.logs);
	const accounting = await readDbAccounting(dir);
	draft.writesCompleted = writes;
	draft.readsCompleted = reads;
	return {
		...draft,
		durationMs: Date.now() - started,
		peakCpuPercent: summary.peakCpuPercent,
		averageCpuPercent: summary.averageCpuPercent,
		peakThreadCount: summary.peakThreadCount,
		finalThreadCount: summary.finalThreadCount,
		peakVmRssBytes: summary.peakVmRssBytes,
		finalVmRssBytes: summary.finalVmRssBytes,
		peakVmHwmBytes: summary.peakVmHwmBytes,
		peakVmSizeBytes: summary.peakVmSizeBytes,
		...accounting
	};
}

/**
 * Run the idle scenario: boot, then observe an idle daemon for `idleMs`.
 *
 * This is the scenario PERF-005 (lazy ONNX warmup) and PERF-003 (no repeated
 * backfill) target: an idle daemon must not hold the model resident and must
 * not burn CPU re-embedding.
 */
async function runIdle(bundlePath: string, options: HarnessOptions): Promise<ScenarioMetrics> {
	const dir = createHarnessDir("perf008-idle-");
	const draft: MetricsDraft = {
		scenario: "idle",
		boots: 1,
		backfilledRows: 0,
		backfilledPerBoot: [],
		lazyWarmup: options.lazyWarmup
	};
	const started = Date.now();
	const daemon = await startDaemon(bundlePath, dir, options.lazyWarmup, options);
	try {
		await delay(options.idleMs);
		draft.capabilities = await readCapabilities(daemon.url);
	} finally {
		await daemon.stop();
	}
	const summary = absorbBoot(draft, daemon.samples, daemon.logs);
	const accounting = await readDbAccounting(dir);
	return {
		...draft,
		durationMs: Date.now() - started,
		peakCpuPercent: summary.peakCpuPercent,
		averageCpuPercent: summary.averageCpuPercent,
		peakThreadCount: summary.peakThreadCount,
		finalThreadCount: summary.finalThreadCount,
		peakVmRssBytes: summary.peakVmRssBytes,
		finalVmRssBytes: summary.finalVmRssBytes,
		peakVmHwmBytes: summary.peakVmHwmBytes,
		peakVmSizeBytes: summary.peakVmSizeBytes,
		...accounting
	};
}

/**
 * Run the eager-warmup idle control: boot with `EMBEDDING_LAZY_WARMUP=false`.
 *
 * This is the A/B counterpart to {@link runIdle} and the ONLY scenario that
 * loads the ONNX/ORT pool. It is what makes PERF-005 (the eager model retainer)
 * and PERF-002 (the thread cap on that pool) measurable at all: the lazy
 * scenarios never touch the model, so their thread count and RSS cannot show
 * either change. Compare `idle-eager` against `idle` for the delta.
 */
async function runIdleEager(bundlePath: string, options: HarnessOptions): Promise<ScenarioMetrics> {
	const dir = createHarnessDir("perf008-idle-eager-");
	const draft: MetricsDraft = {
		scenario: "idle-eager",
		boots: 1,
		backfilledRows: 0,
		backfilledPerBoot: [],
		lazyWarmup: false
	};
	const started = Date.now();
	// Force eager regardless of the run-wide option: this scenario IS the control.
	const daemon = await startDaemon(bundlePath, dir, false, options);
	try {
		await delay(options.idleMs);
		draft.capabilities = await readCapabilities(daemon.url);
	} finally {
		await daemon.stop();
	}
	const summary = absorbBoot(draft, daemon.samples, daemon.logs);
	const accounting = await readDbAccounting(dir);
	return {
		...draft,
		durationMs: Date.now() - started,
		peakCpuPercent: summary.peakCpuPercent,
		averageCpuPercent: summary.averageCpuPercent,
		peakThreadCount: summary.peakThreadCount,
		finalThreadCount: summary.finalThreadCount,
		peakVmRssBytes: summary.peakVmRssBytes,
		finalVmRssBytes: summary.finalVmRssBytes,
		peakVmHwmBytes: summary.peakVmHwmBytes,
		peakVmSizeBytes: summary.peakVmSizeBytes,
		...accounting
	};
}

/**
 * Run the engines-active proof scenario: boot with the proactive engines
 * enabled and record the capability states.
 *
 * This is deliberately separate from the four lightness scenarios: indexing
 * injects CPU/RSS noise that would make them incomparable. Here the point is
 * only to show that `indexing` and `watcher` still reach `ready` under the full
 * profile — the "no function was lost" half of the PERF-001 promise.
 *
 * The daemon's CWD is a tiny seeded fixture project (a `package.json` plus a
 * couple of source files), not this repo: `evaluateAutoIndexTarget` only indexes
 * a directory that looks like a project, and a fixture keeps the scenario fast
 * and deterministic.
 *
 * @param bundlePath - Bundle produced by {@link buildDaemonBundle}.
 * @param options - Harness tunables.
 */
async function runEnginesActive(bundlePath: string, options: HarnessOptions): Promise<ScenarioMetrics> {
	const dir = createHarnessDir("perf008-engines-");
	const projectDir = path.join(dir, "fixture-project");
	fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
	fs.writeFileSync(
		path.join(projectDir, "package.json"),
		JSON.stringify({ name: "perf008-fixture", version: "1.0.0", private: true }, null, 2)
	);
	fs.writeFileSync(
		path.join(projectDir, "src", "index.ts"),
		"/** Fixture entry. */\nexport function fixtureAdd(a: number, b: number): number {\n\treturn a + b;\n}\n"
	);
	fs.writeFileSync(
		path.join(projectDir, "src", "helper.ts"),
		'/** Fixture helper. */\nexport const FIXTURE_LABEL = "perf008";\n'
	);

	const draft: MetricsDraft = {
		scenario: "engines-active",
		boots: 1,
		backfilledRows: 0,
		backfilledPerBoot: [],
		lazyWarmup: options.lazyWarmup,
		note: "proactive engines enabled against a fixture project; capability states are the evidence"
	};
	const started = Date.now();
	const daemon = await startDaemon(
		bundlePath,
		dir,
		options.lazyWarmup,
		{ ...options, enableWatcher: true },
		projectDir
	);
	try {
		await delay(options.settleMs);
		draft.capabilities = await readCapabilities(daemon.url);
	} finally {
		await daemon.stop();
	}
	const summary = absorbBoot(draft, daemon.samples, daemon.logs);
	const accounting = await readDbAccounting(dir);
	return {
		...draft,
		durationMs: Date.now() - started,
		peakCpuPercent: summary.peakCpuPercent,
		averageCpuPercent: summary.averageCpuPercent,
		peakThreadCount: summary.peakThreadCount,
		finalThreadCount: summary.finalThreadCount,
		peakVmRssBytes: summary.peakVmRssBytes,
		finalVmRssBytes: summary.finalVmRssBytes,
		peakVmHwmBytes: summary.peakVmHwmBytes,
		peakVmSizeBytes: summary.peakVmSizeBytes,
		...accounting
	};
}

/**
 * Run every requested scenario sequentially and return the collected metrics.
 *
 * @param repoRoot - Absolute repo root.
 * @param options - Harness tunables.
 * @param onProgress - Optional progress callback (scenario id + message).
 * @param only - Optional subset to run (default: all five).
 */
export async function runAllScenarios(
	repoRoot: string,
	options: HarnessOptions,
	onProgress?: (scenario: string, message: string) => void,
	only?: ReadonlySet<string>
): Promise<ScenarioMetrics[]> {
	const workDir = createHarnessDir("perf008-bundle-");
	const report = (scenario: string, message: string): void => {
		if (options.verbose) onProgress?.(scenario, message);
	};
	const wants = (scenario: string): boolean => only === undefined || only.has(scenario);

	report("setup", `bundling daemon entry into ${path.join(workDir, "daemon-bench.mjs")}`);
	const bundlePath = await buildDaemonBundle(repoRoot, workDir);

	const results: ScenarioMetrics[] = [];
	if (wants("clean-startup")) {
		report("clean-startup", "booting one cold daemon");
		results.push(await runCleanStartup(bundlePath, options));
	}
	if (wants("repeated-restart")) {
		report("repeated-restart", `booting ${options.restartCount} sequential daemons on one DB`);
		results.push(await runRepeatedRestart(bundlePath, options));
	}
	if (wants("write-read-burst")) {
		report("write-read-burst", `issuing ${options.burstWrites} write/read pairs`);
		results.push(await runWriteReadBurst(bundlePath, options));
	}
	if (wants("idle")) {
		report("idle", `observing an idle daemon for ${options.idleMs} ms`);
		results.push(await runIdle(bundlePath, options));
	}
	if (wants("idle-eager")) {
		report("idle-eager", `observing an eager-warmup idle daemon for ${options.idleMs} ms`);
		results.push(await runIdleEager(bundlePath, options));
	}
	if (wants("engines-active")) {
		report("engines-active", "booting the proactive engines against a fixture project");
		results.push(await runEnginesActive(bundlePath, options));
	}
	return results;
}
