# LongMemEval-S release benchmark: 3.1.0

The 3.1 release benchmark runs all 470 answerable LongMemEval-S questions
through the shipped hook capture pipeline. It measures both supported default
retrieval paths: zero-LLM FTS and the in-process local embedder, with the
observation stream enabled as it is in production.

## Provenance

- code: both modes used `a288a1093550b096075087665319054c3ef598ba`.
  Changes added after measurement are IBM Bob lifecycle integration,
  documentation, benchmark publication, and an immutable source pin for the
  same `zip` 8.6.0 code already in the lockfile. None changes retrieval,
  existing-agent capture, model weights, or ranking. The benchmark was not
  repeated for those post-measurement changes.
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

- run dirs: `evals/runs/2026-10-16T01-10-11-488161722Z-retrieval` (FTS)
  and `evals/runs/2026-10-16T02-15-24-986694723Z-retrieval` (local).

## Results

Overall accuracy, latency, and returned context remain within the
pre-registered stability bounds against 3.0.1:

| mode | hit@1 | hit@5 | hit@10 | p50 | p95 | mean context tokens |
|---|---:|---:|---:|---:|---:|---:|
| FTS 3.0.1 | 0.857 | 0.951 | 0.972 | 12 ms | 101 ms | 528 |
| **FTS 3.1** | **0.857** | **0.951** | **0.972** | **12 ms** | **101 ms** | **528** |
| local 3.0.1 | 0.768 | 0.943 | 0.977 | 98 ms | 228 ms | 528 |
| **local 3.1** | **0.755** | **0.940** | **0.972** | **99 ms** | **225 ms** | **528** |

FTS is identical at every overall cutoff. Local `hit@5` changed by -0.003,
inside the pre-registered +/-0.005 run-to-run noise band. Local `hit@1` moved
-0.013 and `hit@10` -0.005, without a systematic slice regression. Latency
and returned context are unchanged in practical terms.

Per-slice `hit@5`:

| slice | n | FTS 3.0.1 | FTS 3.1 | local 3.0.1 | local 3.1 |
|---|---:|---:|---:|---:|---:|
| knowledge-update | 72 | 1.000 | 1.000 | 1.000 | 1.000 |
| multi-session | 121 | 0.967 | 0.967 | 0.975 | 0.975 |
| temporal-reasoning | 127 | 0.921 | 0.921 | 0.913 | 0.898 |
| single-session-assistant | 56 | 1.000 | 1.000 | 0.893 | 0.893 |
| single-session-preference | 30 | 0.700 | 0.700 | 0.867 | 0.900 |
| single-session-user | 64 | 1.000 | 1.000 | 0.953 | 0.953 |

All FTS slices are exact. Four of six local slices are exact;
temporal-reasoning changed by -0.015, within its pre-registered slice band,
and preference gained one question (+0.033) in the 30-question slice. The
pre-registration explicitly called out one-question steps on that smallest
slice.

## Ingest

| mode | items | requests | throughput | wall clock | fallback answers |
|---|---:|---:|---:|---:|---:|
| FTS | 278,946 | 1,403 | 12 items/s per question stream | 3,910.0 s | 0/470 |
| local | 278,946 | 1,403 | 9 items/s per question stream | 4,975.3 s | 0/470 |

No document exceeded the 16 KiB capture bound. The raw-observation fallback
was not needed, so the result measures indexed retrieval rather than fallback
behavior.
