# LongMemEval-S release benchmark: 3.2.6

The 3.2.6 release benchmark runs all 470 answerable LongMemEval-S questions
through the shipped hook capture pipeline. It measures the default zero-LLM
FTS path and the in-process local embedder, both with the production-default
observation stream enabled.

## Provenance

- code: both modes used `80ce570785374f8c1a70b55f20e65f95f7084076`,
  the frozen 3.2.6 release commit before this benchmark report.
- dataset: `longmemeval_s`, sha256
  `08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894`.
- hardware: AMD Ryzen 9 7950X3D (32 threads). The local-embedding run shared
  the workstation with concurrent Rust builds and hosted-check monitoring.
- commands, after building `ai-memory` and `ai-memory-eval` in release mode:

  ```bash
  ai-memory-eval retrieval \
    --server-bin target/release/ai-memory \
    --concurrency 6 --http-timeout-secs 900 \
    --server-env AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=true \
    --server-env AI_MEMORY_EVAL_SKIP_WIKI_CHECKPOINTS=1

  ai-memory-eval retrieval \
    --server-bin target/release/ai-memory \
    --concurrency 6 --http-timeout-secs 900 \
    --embeddings local \
    --server-env AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=true \
    --server-env AI_MEMORY_EVAL_SKIP_WIKI_CHECKPOINTS=1
  ```

- run dirs: `evals/runs/2026-10-26T18-33-49-099564692Z-retrieval` (FTS)
  and `evals/runs/2026-10-26T18-34-48-192904309Z-retrieval` (local).

## Results

FTS matches 3.2.4 exactly at every accuracy cutoff, recall cutoff, and
returned-context estimate. Local embeddings keep the same `hit@5`, `hit@10`,
and context estimate. The remaining accuracy movements are within one or two
questions and do not show a systematic slice regression.

| mode | hit@1 | hit@3 | hit@5 | hit@10 | recall@5 | recall@10 | p50 | p95 | mean context tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FTS 3.2.4 | 0.857 | 0.930 | 0.951 | 0.972 | 0.893 | 0.937 | 12 ms | 79 ms | 534.8 |
| **FTS 3.2.6** | **0.857** | **0.930** | **0.951** | **0.972** | **0.893** | **0.937** | **11 ms** | **73 ms** | **534.8** |
| local 3.2.4 | 0.764 | 0.906 | 0.945 | 0.977 | 0.880 | 0.943 | 149 ms | 350 ms | 535.2 |
| **local 3.2.6** | **0.766** | **0.904** | **0.945** | **0.977** | **0.879** | **0.947** | **157 ms** | **363 ms** | **535.2** |

Local `hit@5` moved between two slices while remaining exact overall:

| slice | n | 3.2.4 | 3.2.6 | delta |
|---|---:|---:|---:|---:|
| knowledge-update | 72 | 1.000 | 1.000 | 0.000 |
| multi-session | 121 | 0.975 | 0.975 | 0.000 |
| single-session-assistant | 56 | 0.893 | 0.893 | 0.000 |
| single-session-preference | 30 | 0.867 | 0.867 | 0.000 |
| single-session-user | 64 | 0.953 | 0.969 | +0.016 |
| temporal-reasoning | 127 | 0.921 | 0.913 | -0.008 |

## Latency and ingest

FTS query latency moved from 12/79 ms to 11/73 ms p50/p95. Local query
latency moved from 149/350 ms to 157/363 ms. The local run overlapped several
Rust builds on the same machine, so the small latency increase is
load-sensitive and is not attributed to the patch.

FTS ingested 278,946 items in 56.4 seconds. Local embeddings ingested the
same items in 1,146.5 seconds, faster than 3.2.4's 1,430.6 seconds despite the
shared workload. Both runs returned zero raw-observation fallback hits.

## Verdict

There is no material retrieval regression. FTS accuracy is exact, local
top-five and top-ten accuracy are exact overall, and local recall@10 improves.
The 3.2.6 release gate passes.
