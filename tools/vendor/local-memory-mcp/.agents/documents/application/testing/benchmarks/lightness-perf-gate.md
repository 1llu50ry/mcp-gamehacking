# Lightness Perf Gate: PERF-008

- Task: PERF-008 "Harness benchmark & verifikasi ringan + regression recall"
- Test: `src/mcp/tests/lightness.perf.test.ts` (Vitest 4, project `perf`, node env)
- Harness: `src/mcp/bench/` (`proc-metrics.ts`, `recall-guard.ts`, `daemon-harness.ts`, `lightness-scenarios.ts`)
- CLI: `scripts/bench/daemon-lightness-bench.ts` → `npm run bench:lightness`
- Report: `daemon-lightness-bench.md` + `daemon-lightness-bench-results.json` (this directory)
- Date: 2026-09-21

## What this gate proves

The PERF-001 promise is "lighter without losing function". The harness measures the _lighter_ half; this test file is the _without losing function_ half. It asserts only deterministic quantities — content hashes, row counts, SQLite page accounting, ranked ids — so it cannot flake under host load. Wall-clock, CPU and RSS are recorded, never asserted.

| Gate                            | Proves                                                                | Deterministic?                |
| ------------------------------- | --------------------------------------------------------------------- | ----------------------------- |
| `/proc` parsers                 | VmRSS and VmHWM parse as distinct fields; CPU% math is correct        | yes                           |
| Backfill determinism (PERF-003) | 0 rows on an unchanged corpus; only the changed row after a real edit | yes                           |
| DB accounting (PERF-007)        | Size + freelist come from the production vacuum helpers               | yes                           |
| Recall regression               | Zero degradation against a recorded baseline                          | yes (with a negative control) |

The PERF-002 thread cap is proven separately by `src/mcp/tests/vectors.threads.test.ts` (constant default/clamp + `applyOnnxThreadConfig` wiring + `OMP_NUM_THREADS` ordering) and observed end-to-end by the harness `idle` vs `idle-eager` thread columns. This file does not restate it.

## The recall regression guard

A guard that cannot fail proves nothing, so the file ships a **negative control**: a scorer returning `[]` must be reported as fully degraded. Only then is the positive case meaningful.

The positive case runs the real ONNX pipeline (`RealVectorStore` → `Xenova/all-MiniLM-L6-v2`) over a fixed 12-record corpus with a fixed 6-query set. Each query is a **paraphrase** of its target record, deliberately avoiding the target's vocabulary, and the expected id comes from the corpus design (an independent oracle), never from what the run returns.

Measured on 2026-09-21 (Node v24.16.0, model loaded from the local cache, no network):

| Scorer                                       | Mean recall @ k=5 | Queries at rank 1 |
| -------------------------------------------- | ----------------: | ----------------: |
| ONNX semantic                                |         **1.000** |             6 / 6 |
| TF lexical (production `searchBySimilarity`) |             0.500 |             3 / 6 |

The TF baseline misses three of six paraphrases; the ONNX path finds all six. The gap is the evidence that the guard measures semantics rather than keyword overlap, and that the PERF-002..007 changes (all output-neutral for embedding values) kept that semantic recall intact.

Recorded baseline: every query is a full hit (`RECALL_BASELINE` in `src/mcp/bench/recall-guard.ts`). `compareRecall(baseline, current, 0)` must return `ok: true` with an empty `degraded` list. The tolerance is **0** — zero degradation, per the task constraint that semantic thresholds are never lowered.

## Backfill determinism (PERF-003)

On a 25-record temp DB:

1. First pass (no vectors) → 25 enqueued.
2. Vectors stamped → restart → **0 enqueued**.
3. Metadata-only `updated_at` + `importance` bump (the old decay trigger) → **0 enqueued**.
4. Real content edit → **1 enqueued**.

Step 3 is the regression that motivated PERF-003: the old predicate (`vector.updated_at < entity.updated_at`) re-embedded the whole corpus after any metadata bump. The new predicate reads `content_hash` + `model_version` and never consults `updated_at`.

## DB accounting (PERF-007)

`getVacuumState` is exercised against a real temp DB: `freelistBytes == freelistCount × pageSize`, and deleting a batch of rows never shrinks the freelist. `shouldVacuum` is asserted `false` on a freshly-created store (no spurious VACUUM recommendation at boot). No VACUUM is ever run against the live DB, and no test opens `~/.config/local-memory-mcp/memory.db`.

## Baseline distinction — VmSize is not RSS

The original claim of "2.6 GB RSS" was a **VmSize (virtual address space) misread**. VmSize counts reserved-but-untouched mappings (the ONNX/ORT arena, the tree-sitter dylink linear memory) and runs an order of magnitude above the resident set. Every `/proc` sample in this harness carries `vmRssBytes`, `vmHwmBytes` and `vmSizeBytes` as separate fields, and the parser test asserts `vmSizeBytes > vmRssBytes × 10` on a realistic dump so the two can never be conflated again.

## How to run

```bash
npx vitest run src/mcp/tests/lightness.perf.test.ts --project perf
npm run test:perf                            # all perf tests
npm run bench:lightness                      # full daemon harness (5-minute idle + eager A/B)
LIGHTNESS_CI=1 npm run bench:lightness       # short CI pass
LIGHTNESS_SCENARIOS=idle,idle-eager npm run bench:lightness   # PERF-005 A/B only
```

The perf test is part of the `perf` project, so it runs under `npm run test:perf` and in the full suite. The model is loaded from the local `node_modules/@xenova/transformers/.cache` when present; if it is unavailable the recall test skips with a warning rather than failing (a missing cache is an environment problem, not a regression).

## Harness scenarios and the function-active proof

`npm run bench:lightness` boots the real combined daemon (esbuild-bundled from source, ephemeral port, fresh temp DB per boot) and records, per scenario: peak/average CPU (`/proc/<pid>/stat`), native thread count (`/proc/<pid>/task`), VmRSS/VmHWM/VmSize (`/proc/<pid>/status`), startup backfill rows, and DB size + freelist.

| Scenario           | What it measures                                                                 |
| ------------------ | -------------------------------------------------------------------------------- |
| `clean-startup`    | Cold-boot CPU burst, RSS, thread count; backfill must be 0 on an empty DB        |
| `repeated-restart` | N boots on one pre-seeded DB; boot 1 backfills the corpus, later boots enqueue 0 |
| `write-read-burst` | N dashboard write+read pairs; CPU/thread/RSS under load                          |
| `idle`             | Lazy-warmup idle plateau (the shipped default)                                   |
| `idle-eager`       | `EMBEDDING_LAZY_WARMUP=false` control — the only scenario that loads ONNX/ORT    |
| `engines-active`   | Proactive engines on a fixture project — proves indexing/watcher reach `ready`   |

The `idle` vs `idle-eager` pair is the PERF-005 A/B: only the eager control loads the model, so the RSS delta is the retainer PERF-005 removed and the thread delta shows the PERF-002 pool cap.

Every scenario also reads `GET /api/capabilities` while the daemon is alive and records `capability → state` (the "no function was lost" evidence). The lightness scenarios boot with the proactive engines off (`CODEBASE_AUTO_INDEX=false`, `ENABLE_FILE_WATCHER=false`) so indexing cannot contaminate the numbers; the dedicated `engines-active` scenario boots them against a seeded fixture project (`package.json` + two TS files) and confirms `indexing`/`watcher` reach `ready`.
