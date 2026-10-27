/**
 * PERF-008 — daemon lightness benchmark CLI.
 *
 * Thin wrapper over `src/mcp/bench/lightness-scenarios.ts` (the reusable logic
 * lives under `src/` because `tsconfig.test.json` pins `rootDir: ./src`, so the
 * perf test cannot import from `scripts/`). This file only parses argv, runs the
 * scenarios, and writes the `<name>-bench.md` + `<name>-bench-results.json`
 * pair next to the other bench reports.
 *
 * Usage:
 *   npm run bench:lightness
 *   LIGHTNESS_CI=1 npm run bench:lightness            # short pass (CI)
 *   LIGHTNESS_LAZY_WARMUP=false npm run bench:lightness  # PERF-005 A/B
 *   LIGHTNESS_SCENARIOS=clean-startup,idle npm run bench:lightness
 *
 * Never touches the live DB: every scenario boots its own temp dir DB.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAllScenarios } from "../../src/mcp/bench/lightness-scenarios";
import {
	resolveHarnessOptions,
	type HarnessReport,
	type LightnessScenarioId,
	type ScenarioMetrics
} from "../../src/mcp/bench/daemon-harness";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const REPORT_DIR = path.join(REPO_ROOT, ".agents", "documents", "application", "testing", "benchmarks");
const REPORT_BASE = "daemon-lightness-bench";

/** Render bytes as a human-readable MiB/MB string. */
function mib(bytes: number): string {
	if (!bytes) return "0";
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Render one scenario as a markdown table row. */
function scenarioRow(metrics: ScenarioMetrics): string {
	return [
		metrics.scenario,
		String(metrics.boots),
		`${metrics.peakCpuPercent.toFixed(1)}%`,
		`${metrics.averageCpuPercent.toFixed(1)}%`,
		String(metrics.peakThreadCount),
		mib(metrics.peakVmRssBytes),
		mib(metrics.peakVmHwmBytes),
		mib(metrics.peakVmSizeBytes),
		String(metrics.backfilledRows),
		mib(metrics.dbBytes),
		String(metrics.freelistCount)
	].join(" | ");
}

/** Build the markdown report. */
function renderMarkdown(report: HarnessReport): string {
	const lines: string[] = [];
	lines.push("# Daemon Lightness Benchmark: PERF-008");
	lines.push("");
	lines.push('- Task: PERF-008 "Harness benchmark & verifikasi ringan + regression recall"');
	lines.push("- Harness: `src/mcp/bench/` (launch + sampling + scenarios)");
	lines.push("- CLI: `scripts/bench/daemon-lightness-bench.ts` (`npm run bench:lightness`)");
	lines.push("- Perf test: `src/mcp/tests/lightness.perf.test.ts` (project `perf`)");
	lines.push(`- Node: ${report.node} · ${report.platform}/${report.arch}`);
	lines.push(`- Lazy warmup (PERF-005): ${report.options.lazyWarmup ? "enabled" : "disabled"}`);
	lines.push("- Isolated temp DB per boot: yes (never touches `~/.config/local-memory-mcp/memory.db`)");
	lines.push(`- Date: ${report.generatedAt.slice(0, 10)}`);
	lines.push("");
	lines.push("## Summary");
	lines.push("");
	lines.push(
		"| Scenario | Boots | Peak CPU | Avg CPU | Peak threads | Peak VmRSS | Peak VmHWM | Peak VmSize | Backfilled | DB size | Freelist |"
	);
	lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
	for (const scenario of report.scenarios) lines.push(`| ${scenarioRow(scenario)} |`);
	lines.push("");
	lines.push("## Baseline distinction (read this before quoting a number)");
	lines.push("");
	lines.push(
		'The original PERF-001 claim of "2.6 GB RSS" was a **VmSize (virtual address space) misread**. VmSize counts'
	);
	lines.push(
		"reserved-but-untouched mappings (the ONNX/ORT arena, the tree-sitter dylink linear memory) and runs an order"
	);
	lines.push(
		"of magnitude above the resident set. The harness reports **VmRSS** and **VmHWM** as separate columns for exactly"
	);
	lines.push("this reason. Quote VmRSS/VmHWM, never VmSize, when describing daemon memory.");
	lines.push("");
	lines.push("Recorded pre-optimization baseline (PERF-005, isolated temp DB, 12s settle):");
	lines.push("");
	lines.push("- eager ONNX warmup: ~316.3 MB VmRSS idle");
	lines.push("- lazy ONNX warmup: ~176.5 MB VmRSS idle (≈140 MB / 44% saved)");
	lines.push("- live daemon plateau: ~550 MB VmRSS, ~612 MB VmHWM (VmSize 2.16 → 10.97 GB)");
	lines.push("- startup backfill before PERF-003: thousands of rows re-embedded after any metadata `updated_at` bump");
	lines.push("- startup backfill after PERF-003: 0 rows on an unchanged corpus");
	lines.push("");

	// PERF-005 A/B: only the eager control loads the model, so this pair is the
	// evidence for both the RSS retainer and the PERF-002 thread cap.
	const lazyIdle = report.scenarios.find((scenario) => scenario.scenario === "idle");
	const eagerIdle = report.scenarios.find((scenario) => scenario.scenario === "idle-eager");
	if (lazyIdle && eagerIdle) {
		const rssDelta = eagerIdle.peakVmRssBytes - lazyIdle.peakVmRssBytes;
		const pct = lazyIdle.peakVmRssBytes > 0 ? (rssDelta / lazyIdle.peakVmRssBytes) * 100 : 0;
		lines.push("## PERF-005 A/B: lazy vs eager warmup (same idle window)");
		lines.push("");
		lines.push("| Metric | idle (lazy) | idle-eager | Delta |");
		lines.push("| --- | ---: | ---: | ---: |");
		lines.push(
			`| Peak VmRSS | ${mib(lazyIdle.peakVmRssBytes)} | ${mib(eagerIdle.peakVmRssBytes)} | ${rssDelta >= 0 ? "+" : ""}${mib(rssDelta)} (${pct.toFixed(0)}%) |`
		);
		lines.push(
			`| Peak VmHWM | ${mib(lazyIdle.peakVmHwmBytes)} | ${mib(eagerIdle.peakVmHwmBytes)} | ${mib(eagerIdle.peakVmHwmBytes - lazyIdle.peakVmHwmBytes)} |`
		);
		lines.push(`| Peak threads | ${lazyIdle.peakThreadCount} | ${eagerIdle.peakThreadCount} | — |`);
		lines.push(
			`| Average CPU | ${lazyIdle.averageCpuPercent.toFixed(1)}% | ${eagerIdle.averageCpuPercent.toFixed(1)}% | — |`
		);
		lines.push("");
		lines.push(
			"The eager column is the pre-PERF-005 behavior (model loaded at startup); the lazy column is the shipped default. The RSS gap is the retainer PERF-005 removed."
		);
		lines.push("");
	}
	lines.push("## Function still active (capability states)");
	lines.push("");
	lines.push(
		"`GET /api/capabilities` exposes `RuntimeCapabilityRegistry.snapshot()`. A `ready` state means the engine actually loaded; a `degraded`/`failed` state after a PERF change means a feature was silently disabled. The harness reads it while each daemon is still alive."
	);
	lines.push("");
	for (const scenario of report.scenarios) {
		if (!scenario.capabilities) continue;
		const states = Object.entries(scenario.capabilities)
			.map(([name, state]) => `${name}=${state}`)
			.join(", ");
		lines.push(`- **${scenario.scenario}**: ${states}`);
	}
	lines.push("");
	lines.push("## Scenario detail");
	lines.push("");
	for (const scenario of report.scenarios) {
		lines.push(`### ${scenario.scenario}`);
		lines.push("");
		lines.push(`- Duration: ${scenario.durationMs} ms · Boots: ${scenario.boots}`);
		lines.push(
			`- CPU: peak ${scenario.peakCpuPercent.toFixed(1)}% · average ${scenario.averageCpuPercent.toFixed(1)}% (one-core-relative)`
		);
		lines.push(
			`- Threads: peak ${scenario.peakThreadCount} · final ${scenario.finalThreadCount} (PERF-002 caps the ORT pool)`
		);
		lines.push(
			`- Memory: peak VmRSS ${mib(scenario.peakVmRssBytes)} · final VmRSS ${mib(scenario.finalVmRssBytes)} · peak VmHWM ${mib(scenario.peakVmHwmBytes)} · peak VmSize ${mib(scenario.peakVmSizeBytes)}`
		);
		lines.push(`- Backfilled rows: ${scenario.backfilledRows} (per boot: ${scenario.backfilledPerBoot.join(", ")})`);
		lines.push(
			`- DB: ${mib(scenario.dbBytes)} · pages ${scenario.pageCount} · freelist ${scenario.freelistCount} (${mib(scenario.freelistBytes)})`
		);
		if (scenario.writesCompleted !== undefined) {
			lines.push(
				`- Burst: ${scenario.writesCompleted} writes · ${scenario.readsCompleted} reads · ${scenario.burstWallMs} ms`
			);
		}
		if (scenario.capabilities) {
			const states = Object.entries(scenario.capabilities)
				.map(([name, state]) => `${name}=${state}`)
				.join(", ");
			lines.push(`- Capabilities: ${states}`);
		}
		if (scenario.note) lines.push(`- Note: ${scenario.note}`);
		lines.push("");
	}
	lines.push("## Method");
	lines.push("");
	lines.push(
		"- The combined daemon is bundled from source with esbuild (the same `createRequire` banner `tsup.config.ts` uses) and launched on an ephemeral port; `dist/` is not required."
	);
	lines.push(
		"- Each boot runs with `MEMORY_DB_PATH` + `LOCAL_MEMORY_DAEMON_DIR` pointing at a fresh `fs.mkdtemp` dir, `MCP_RUNTIME_PROFILE=full`, `CODEBASE_AUTO_INDEX=false`, `ENABLE_FILE_WATCHER=false` (the `engines-active` scenario boots them against a fixture project instead)."
	);
	lines.push(
		"- CPU is derived from `/proc/<pid>/stat` (utime+stime deltas, `USER_HZ=100`); threads from `/proc/<pid>/task`; memory from `/proc/<pid>/status`."
	);
	lines.push(
		"- Wall-clock, CPU and RSS are RECORDED, not asserted. The deterministic gates live in `src/mcp/tests/lightness.perf.test.ts`."
	);
	lines.push("");
	lines.push("## How to run");
	lines.push("");
	lines.push("```bash");
	lines.push("npm run bench:lightness                      # full pass (5-minute idle)");
	lines.push("LIGHTNESS_CI=1 npm run bench:lightness       # short CI pass");
	lines.push("LIGHTNESS_SCENARIOS=idle,idle-eager npm run bench:lightness   # PERF-005 A/B only");
	lines.push("LIGHTNESS_SCENARIOS=engines-active npm run bench:lightness   # prove indexing/watcher activate");
	lines.push("npm run test:perf                            # the deterministic perf gates");
	lines.push("```");
	lines.push("");
	return lines.join("\n");
}

/** Entry point. */
async function main(): Promise<void> {
	const options = resolveHarnessOptions();
	const selected = process.env.LIGHTNESS_SCENARIOS;
	const wanted = selected
		? new Set(selected.split(",").map((value) => value.trim()) as LightnessScenarioId[])
		: undefined;
	const report: HarnessReport = {
		generatedAt: new Date().toISOString(),
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		options,
		scenarios: []
	};

	report.scenarios = await runAllScenarios(
		REPO_ROOT,
		options,
		(scenario, message) => {
			console.log(`[lightness] ${scenario}: ${message}`);
		},
		wanted
	);

	fs.mkdirSync(REPORT_DIR, { recursive: true });
	const jsonPath = path.join(REPORT_DIR, `${REPORT_BASE}-results.json`);
	const mdPath = path.join(REPORT_DIR, `${REPORT_BASE}.md`);
	fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, "\t")}\n`, "utf8");
	fs.writeFileSync(mdPath, renderMarkdown(report), "utf8");
	console.log(`[lightness] wrote ${mdPath}`);
	console.log(`[lightness] wrote ${jsonPath}`);
	console.log(`[lightness] temp dirs left under ${os.tmpdir()}/perf008-* (remove manually if needed)`);
}

main().catch((error) => {
	console.error(`[lightness] failed: ${String(error)}`);
	process.exit(1);
});
