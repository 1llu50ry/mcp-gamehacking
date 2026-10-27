#!/usr/bin/env node
/**
 * Contention regression guard — TASK-429 (ADR-011 §Acceptance Criteria item 2).
 *
 * ADR-011 (`.agents/documents/design/decisions/ADR-011-split-memory-db-per-domain.md`)
 * rejected splitting memory.db per domain and re-scoped TASK-429 to verification
 * and hardening. This guard is the "contention regression guard" acceptance item:
 * a repeatable check that asserts `busy` / `timeout` / `lockWait` counters remain
 * ZERO at the currently supported concurrency, so a future regression that would
 * justify revisiting the split is detectable instead of silent.
 *
 * Two entry points:
 *
 * 1. Library — `checkContention(result)` takes the JSON emitted by
 *    `scripts/bench/concurrent-workload-bench.mjs` (see
 *    `scripts/bench/concurrent-eval/report.mjs` for the same shape) and returns
 *    `{ ok, failures, totals, perScenario }`. The benchmark entrypoint calls it
 *    inline so a live regression fails the run.
 * 2. CLI — `node scripts/bench/concurrent-eval/contention-guard.mjs [--json <path>]`
 *    re-validates a previously written results file (default:
 *    `.agents/documents/application/testing/benchmarks/concurrent-workload-bench-results.json`).
 *    Exit 0 = no contention, 1 = regression, 2 = input missing/unreadable.
 *
 * Companion evidence: `src/mcp/tests/sqlite.wal-contention.perf.test.ts`
 * (TASK-424) asserts the same busy/locked == 0 invariant across N concurrent
 * SQLiteStore connections on ONE file-backed temp DB, with the raw latency
 * numbers recorded in `sqlite-wal-contention-bench.md`.
 *
 * Keep this dependency-free: plain Node ESM, no new packages.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Default results file written by `concurrent-workload-bench.mjs`. */
export const DEFAULT_RESULTS_PATH =
	".agents/documents/application/testing/benchmarks/concurrent-workload-bench-results.json";

/** Counters that must stay at zero at supported concurrency. */
const ZERO_COUNTERS = ["busyErrors", "timeoutErrors", "otherErrors", "lockWaitMs"];

/**
 * Normalize a possibly-undefined counter to a number. A missing `lockWaitMs`
 * (readers/writers/mixed scenarios do not measure lock acquisition) is not a
 * failure — it is "not applicable" and counts as 0.
 */
function asCount(value) {
	if (value === undefined || value === null) return 0;
	const n = Number(value);
	return Number.isFinite(n) ? n : NaN;
}

/**
 * Assert the busy/timeout/lockWait invariants on a benchmark result object.
 *
 * @param {object} result - `{ meta, summary, scenarios }` from the concurrent benchmark.
 * @returns {{ ok: boolean, failures: Array<{ scope: string, counter: string, value: number, message: string }>, totals: object, perScenario: Array<object> }}
 */
export function checkContention(result) {
	const failures = [];
	const summary = result?.summary;
	if (!summary || typeof summary !== "object") {
		failures.push({
			scope: "summary",
			counter: "summary",
			value: NaN,
			message: "result.summary is missing — cannot verify contention counters"
		});
		return { ok: false, failures, totals: { totalBusy: NaN, totalTimeout: NaN, totalOther: NaN }, perScenario: [] };
	}

	const totals = {
		totalBusy: asCount(summary.totalBusy),
		totalTimeout: asCount(summary.totalTimeout),
		totalOther: asCount(summary.totalOther)
	};

	for (const [counter, value] of Object.entries(totals)) {
		if (value !== 0) {
			failures.push({
				scope: "summary",
				counter,
				value,
				message: `summary.${counter} must be 0 at supported concurrency (got ${value})`
			});
		}
	}

	const perScenario = [];
	const scenarios = result.scenarios && typeof result.scenarios === "object" ? result.scenarios : {};
	if (Object.keys(scenarios).length === 0) {
		failures.push({
			scope: "scenarios",
			counter: "scenarios",
			value: NaN,
			message: "result.scenarios is empty — nothing was measured"
		});
	}

	for (const [name, scenario] of Object.entries(scenarios)) {
		if (!scenario || typeof scenario !== "object") {
			failures.push({ scope: name, counter: "scenario", value: NaN, message: `${name}: scenario payload missing` });
			continue;
		}
		// A scenario that failed to execute means the invariant was never
		// verified — treat it as a guard failure, not a skip.
		if (scenario.error) {
			failures.push({
				scope: name,
				counter: "scenario",
				value: NaN,
				message: `${name}: scenario did not complete — ${scenario.error}`
			});
			perScenario.push({ scenario: name, ok: false, counters: null });
			continue;
		}
		const counters = {};
		let scenarioOk = true;
		for (const counter of ZERO_COUNTERS) {
			const value = asCount(scenario[counter]);
			counters[counter] = value;
			if (value !== 0) {
				scenarioOk = false;
				failures.push({
					scope: name,
					counter,
					value,
					message: `${name}.${counter} must be 0 at supported concurrency (got ${value})`
				});
			}
		}
		perScenario.push({ scenario: name, ok: scenarioOk, counters });
	}

	return { ok: failures.length === 0, failures, totals, perScenario };
}

/** Render a human-readable guard report. */
export function formatGuardReport(guard) {
	const lines = [
		`Contention guard: ${guard.ok ? "PASS" : "FAIL"}`,
		`  summary: busy ${guard.totals.totalBusy} · timeout ${guard.totals.totalTimeout} · other ${guard.totals.totalOther}`
	];
	for (const scenario of guard.perScenario) {
		if (!scenario.counters) {
			lines.push(`  ${scenario.scenario}: FAILED (scenario error)`);
			continue;
		}
		const c = scenario.counters;
		lines.push(
			`  ${scenario.scenario}: ${scenario.ok ? "ok" : "FAIL"} · busy ${c.busyErrors} · timeout ${c.timeoutErrors} · other ${c.otherErrors} · lockWait ${c.lockWaitMs}`
		);
	}
	for (const failure of guard.failures) lines.push(`  ✗ ${failure.message}`);
	return lines.join("\n");
}

function parseArgs(argv) {
	const jsonFlag = argv.indexOf("--json");
	if (jsonFlag >= 0) return argv[jsonFlag + 1];
	const positional = argv.find((arg) => !arg.startsWith("--"));
	return positional;
}

function main() {
	const argv = process.argv.slice(2);
	const target = parseArgs(argv) || DEFAULT_RESULTS_PATH;
	const resolved = path.resolve(target);
	if (!fs.existsSync(resolved)) {
		console.error(`contention-guard: results file not found: ${resolved}`);
		console.error("Run `node scripts/bench/concurrent-workload-bench.mjs` first, or pass --json <path>.");
		process.exitCode = 2;
		return;
	}

	let result;
	try {
		result = JSON.parse(fs.readFileSync(resolved, "utf8"));
	} catch (err) {
		console.error(`contention-guard: failed to parse ${resolved}: ${String(err?.message || err)}`);
		process.exitCode = 2;
		return;
	}

	const guard = checkContention(result);
	console.log(formatGuardReport(guard));
	if (!guard.ok) {
		console.error(`contention-guard: ${guard.failures.length} regression(s) detected in ${resolved}`);
		process.exitCode = 1;
	}
}

// Only run the CLI when invoked directly (not when imported by the benchmark).
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
