# LongMemEval-S release benchmark: 3.0.1

The 3.0.1 release benchmark runs all 470 answerable LongMemEval-S questions
through the shipped hook capture pipeline. It measures both supported default
retrieval paths: zero-LLM FTS and the in-process local embedder, with the
observation stream enabled as it is in production.

## Provenance

- code: FTS used `c75101dee19b0523c07caa6934be2ee03ede988d`; local
  embeddings used `403e9c9d4a8e09709e1437982fca9b69cdeeed7c`. The only
  intervening commit corrects a WinSW documentation example. Later release
  preparation changes are benchmark documentation, test stabilization,
  generated plugin metadata, changelog, and version metadata; none changes
  capture or retrieval behavior.
- dataset: `longmemeval_s`, sha256
  `08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894`.
- hardware: AMD Ryzen 9 7950X3D (32 threads). No build or test workload ran
  concurrently with either measurement.
- commands, after building `ai-memory` and `ai-memory-eval` in release mode:

  ```bash
  ai-memory-eval retrieval \
    --server-bin target/release/ai-memory \
    --concurrency 6 --http-timeout-secs 900 \
    --server-env AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=true

  ai-memory-eval retrieval \
    --server-bin target/release/ai-memory \
    --concurrency 6 --http-timeout-secs 900 \
    --embeddings local \
    --server-env AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=true
  ```

- run dirs: `evals/runs/2026-10-15T19-01-47-475315841Z-retrieval` (FTS)
  and `evals/runs/2026-10-15T20-09-34-781698093Z-retrieval` (local).

## Results

Overall accuracy, latency, and returned context remain stable against 3.0.0:

| mode | hit@1 | hit@5 | hit@10 | p50 | p95 | mean context tokens |
|---|---:|---:|---:|---:|---:|---:|
| FTS 3.0.0 | 0.857 | 0.951 | 0.972 | 13 ms | 112 ms | 528 |
| **FTS 3.0.1** | **0.857** | **0.951** | **0.972** | **12 ms** | **101 ms** | **528** |
| local 3.0.0 | 0.766 | 0.945 | 0.974 | 99 ms | 232 ms | 529 |
| **local 3.0.1** | **0.768** | **0.943** | **0.977** | **98 ms** | **228 ms** | **528** |

The local `hit@5` change is -0.002, inside the measured +/-0.005 run-to-run
noise band. FTS accuracy is identical at every reported overall cutoff. Query
latency is slightly lower in both modes and context size is unchanged.

Per-slice `hit@5`:

| slice | n | FTS 3.0.0 | FTS 3.0.1 | local 3.0.0 | local 3.0.1 |
|---|---:|---:|---:|---:|---:|
| knowledge-update | 72 | 1.000 | 1.000 | 1.000 | 1.000 |
| multi-session | 121 | 0.967 | 0.967 | 0.975 | 0.975 |
| temporal-reasoning | 127 | 0.921 | 0.921 | 0.913 | 0.913 |
| single-session-assistant | 56 | 1.000 | 1.000 | 0.893 | 0.893 |
| single-session-preference | 30 | 0.700 | 0.700 | 0.900 | 0.867 |
| single-session-user | 64 | 1.000 | 1.000 | 0.953 | 0.953 |

The one slice change is one miss among the 30 preference questions. A 0.033
step is normal single-question variance for that small slice and does not
indicate a broad regression: every other slice is exact, while overall
`hit@1` and `hit@10` each improved slightly.

## Ingest

| mode | items | requests | throughput | wall clock | fallback answers |
|---|---:|---:|---:|---:|---:|
| FTS | 278,946 | 1,403 | 11 items/s per question stream | 4,062.8 s | 0/470 |
| local | 278,946 | 1,403 | 9 items/s per question stream | 5,125.3 s | 0/470 |

No document exceeded the 16 KiB capture bound. The raw-observation fallback
was not needed, so the result measures indexed retrieval rather than fallback
behavior. The older stream-off local baseline remains tracked in
[#1263](https://github.com/akitaonrails/ai-memory/issues/1263); it is not a
shipped configuration and was not repeated for this patch release.
