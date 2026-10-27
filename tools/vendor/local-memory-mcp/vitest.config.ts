import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
	plugins: [svelte()],
	resolve: {
		// Ensure Svelte resolves to its client entry (mount, etc.) instead of server entry
		conditions: ["browser"]
	},
	test: {
		// Use forks pool for better-sqlite3 compatibility with ESM
		pool: "forks",
		// Support ESM
		environment: "node",
		exclude: ["dist/**", "node_modules/**", "src/dashboard/ui/node_modules/**"],
		testTimeout: 30_000,
		hookTimeout: 30_000,

		// Vitest 5 flipped the default of `clearMocks` from false -> true, so
		// `vi.clearAllMocks()` now runs before every test and would wipe mock
		// call history produced at MODULE IMPORT time (e.g. the
		// `RealVectorStore.initialize` call recorded while
		// `src/dashboard/lib/context.ts` is evaluated). Keep the pre-vitest-5
		// behavior so import-time call assertions stay observable.
		clearMocks: false,

		// ------------------------------------------------------------------
		// @testing-library/svelte — inline required so vite-node transforms
		// svelte-core's runtime `import('./wrapper-scaffold.svelte')` (the
		// wrapper setup path) instead of handing the .svelte file to Node
		// directly ("Unknown file extension .svelte"). Required by the
		// RepoSidebar navigation tests (TASK-435); documented in the Svelte
		// Testing Library setup guide.
		// ------------------------------------------------------------------
		server: {
			deps: {
				inline: ["@testing-library/svelte", "@testing-library/svelte-core"]
			}
		},

		// ------------------------------------------------------------------
		// Coverage (ROOT level only — `coverage` is NOT allowed inside a
		// project config; vitest.dev/guide/projects "Unsupported Options").
		//
		// Provider: `v8` (native, recommended). FIX-381: EMPTY coverage
		// reports (empty coverage-final.json + degenerate totals) were
		// caused by `!`-negated patterns inside each project's
		// `test.include` — with ANY negation present (even a harmless one),
		// coverage collection in this repo produced NOTHING. Root cause is
		// config-level, NOT node/vitest-version: reproduced on vitest
		// 4.1.7 AND 4.1.10 × node v24.18.0, both v8 and istanbul providers
		// (verified via minimal-config bisection; scratch projects without
		// negations collected fine). Fix: partition each project with
		// positive-only `test.include` + `test.exclude` (identical disjoint
		// split, no `!` inside include). `npm run test -- --coverage` now
		// reports real totals (see .agents/documents/testing.md §7).
		//
		// Thresholds are configured but NOT blocking: the provider fails
		// the run (exit 1) on missed thresholds with no warn-only mode, and
		// the suite does not reach the floor yet (.agents/documents/testing.md §7 — the
		// green gate is REFACTOR-TST-012). Coverage is therefore flag-gated
		// (`--coverage`); REFACTOR-TST-013 flips `enabled: true` for the CI
		// gate once the floor is met.
		// ------------------------------------------------------------------
		coverage: {
			provider: "v8",
			// enabled: true, // TODO(REFACTOR-TST-013): flip when CI gate lands
			reporter: ["text", "text-summary", "json", "html"],
			// All-of-src semantics: including the pattern pulls untested files
			// into the report (Vitest's equivalent of jest/nyc `thresholds.all`).
			include: ["src/**/*.{ts,tsx}"],
			exclude: ["dist/**", "node_modules/**", "src/dashboard/ui/node_modules/**", ".tmp/**"],
			thresholds: {
				// Global floors across ALL files matched by `coverage.include`
				// (.agents/documents/testing.md §7). NOTE: `thresholds.all` is a jest/nyc
				// option with NO Vitest equivalent — Vitest would parse `all`
				// as a file-glob key (silent no-op). `coverage.include` + these
				// global floors is the correct all-files encoding.
				lines: 70,
				statements: 70,
				functions: 70,
				branches: 60
			}
		},

		// ------------------------------------------------------------------
		// Suite groups (Vitest 4: `workspace` was deprecated since 3.2 and
		// replaced by `projects`). The root config is NOT a project itself —
		// only global options (reporters/coverage) apply at root. Each project
		// uses `extends: true` to inherit pool `forks`, env `node`, excludes
		// and timeouts. `include` patterns PARTITION the taxonomy so no test
		// file runs in two projects. FIX-381: the old unit `include` used
		// `!`-negations (e.g. "!**/*.integration.test.ts") which broke
		// coverage collection entirely; the split is now positive-only
		// `include` + `exclude` with identical partition semantics.
		//
		// ------------------------------------------------------------------
		// `onnx` project — ISOLATED + SERIALIZED real-ONNX tests (REL-051).
		//
		// WHY: the GitHub Release gate failed at `npm run test` because a
		// vitest fork worker aborted with SIGABRT (a native ONNX/ORT abort)
		// while running `vectors.worker-parity.test.ts` — the embedding
		// worker-parity suite, which loads REAL ONNX BOTH in-process AND in a
		// worker thread. The identical suite passed on a parallel CI run, so
		// it is a memory/native flake: several forks each holding a live ORT
		// session (plus tree-sitter WASM, better-sqlite3, sharp) can exhaust
		// the runner and abort. The fix is to stop ANY real-ONNX file from
		// running concurrently with other test processes.
		//
		// Files that load REAL ONNX (verified by source inspection):
		//   - vectors.worker-parity.test.ts  (createFeatureExtractor +
		//     runFeatureExtraction in-process, RealVectorStore.embed worker)
		//   - embedding-smoke.test.ts        (RealVectorStore.initialize/upsert)
		//   - lightness.perf.test.ts         (RealVectorStore.initialize/embed)
		//   - daemon-init-latency.perf.test.ts (boots a daemon whose embedding
		//     worker backfills with real ONNX)
		// NOT moved (they MOCK `@xenova/transformers` or inject a fake
		// extractor, so no real ONNX loads): vectors.threads.test.ts,
		// embedding-model.version.test.ts, vectors.blob-format.test.ts.
		//
		// CONCURRENCY MODEL (Vitest 5.0.1 — verified in the installed source,
		// `vitest/dist/chunks/index.DzobfTyw.js`):
		//   * `test.poolOptions` (and therefore `forks.singleFork`) was
		//     REMOVED in Vitest 4 — it now logs a deprecation and is ignored.
		//     The supported way to run a project's files one-at-a-time is the
		//     TOP-LEVEL `fileParallelism: false`, which resolves to
		//     `maxWorkers: 1` (see `resolveTestConfig`).
		//   * By default ALL projects run in PARALLEL with each other, so
		//     `fileParallelism: false` alone would only serialize the files
		//     WITHIN this project — it would NOT stop this project's single
		//     worker from overlapping the unit/perf workers.
		//   * `sequence.groupOrder` (supported at project level) buckets
		//     projects into groups that run lowest→highest; each group's
		//     `Promise.allSettled` fully settles before the next group starts
		//     (`executeTests` → `for (const { tasks } of taskGroups)`).
		//
		// GUARANTEE ACHIEVED: with the default groupOrder (0) on
		// unit/integration/e2e/perf and `groupOrder: 1` here, the `onnx`
		// project's single serial worker starts only AFTER every other
		// project has finished — no ONNX fork ever overlaps another test
		// process. Empirically verified: the last non-ONNX file's END
		// precedes the first ONNX file's START. This is a single
		// `npm run test` solution — no workflow edit and no separate gate
		// step is required. `--project onnx` still works standalone.
		// ------------------------------------------------------------------
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["**/*.test.ts"],
					exclude: [
						"**/*.integration.test.ts",
						"**/*.e2e.test.ts",
						"**/*.perf.test.ts",
						// Real-ONNX files are partitioned into the `onnx` project
						// (below) so each file runs in exactly ONE project.
						"**/vectors.worker-parity.test.ts",
						"**/embedding-smoke.test.ts"
					]
				}
			},
			{
				extends: true,
				test: {
					name: "integration",
					include: ["**/*.integration.test.ts"]
				}
			},
			{
				extends: true,
				test: {
					name: "e2e",
					include: ["**/*.e2e.test.ts"]
				}
			},
			{
				extends: true,
				test: {
					name: "perf",
					include: ["**/*.perf.test.ts"],
					// Real-ONNX perf files are partitioned into the `onnx`
					// project (below) so each file runs in exactly ONE project.
					exclude: ["**/lightness.perf.test.ts", "**/daemon-init-latency.perf.test.ts"]
				}
			},
			{
				extends: true,
				test: {
					name: "onnx",
					// POSITIVE-ONLY includes (FIX-381: no `!` negations).
					include: [
						"**/vectors.worker-parity.test.ts",
						"**/embedding-smoke.test.ts",
						"**/lightness.perf.test.ts",
						"**/daemon-init-latency.perf.test.ts"
					],
					// One file at a time (Vitest 5: replaces the removed
					// `poolOptions.forks.singleFork`).
					fileParallelism: false,
					// Run AFTER every default-group (0) project so no ONNX fork
					// overlaps any other test process. See the header comment.
					sequence: { groupOrder: 1 }
				}
			}
		]
	}
});
