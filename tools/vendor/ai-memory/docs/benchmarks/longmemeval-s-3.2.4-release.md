# LongMemEval-S release benchmark: 3.2.4

The 3.2.4 release benchmark runs all 470 answerable LongMemEval-S questions
through the shipped hook capture pipeline. It measures the default zero-LLM
FTS path and the in-process local embedder, both with the production-default
observation stream enabled.

## Provenance

- code: both modes used `f4b283de04f470f807e493e7f0779f0494188198`,
  the frozen 3.2.4 code candidate before the documentation and version commits.
- dataset: `longmemeval_s`, sha256
  `08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894`.
- hardware: AMD Ryzen 9 7950X3D (32 threads), with no other deliberate
  workload during the run.
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

- run dirs: `evals/runs/2026-10-25T15-37-36-037419279Z-retrieval` (FTS)
  and `evals/runs/2026-10-25T15-38-37-620897357Z-retrieval` (local).

## Results

FTS matches 3.2.2 exactly at every accuracy cutoff and in its returned-context
estimate. Local embeddings keep the same `hit@5`, `recall@5`, and context
estimate. Local `hit@1` improves by four questions and `hit@10` improves by one.

| mode | hit@1 | hit@3 | hit@5 | hit@10 | recall@5 | recall@10 | p50 | p95 | mean context tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FTS 3.2.2 | 0.857 | 0.930 | 0.951 | 0.972 | 0.893 | 0.937 | 12 ms | 73 ms | 534.8 |
| **FTS 3.2.4** | **0.857** | **0.930** | **0.951** | **0.972** | **0.893** | **0.937** | **12 ms** | **79 ms** | **534.8** |
| local 3.2.2 | 0.755 | 0.900 | 0.945 | 0.974 | 0.880 | 0.940 | 188 ms | 468 ms | 535.2 |
| **local 3.2.4** | **0.764** | **0.906** | **0.945** | **0.977** | **0.880** | **0.943** | **149 ms** | **350 ms** | **535.2** |

Every local-embedding slice has the same `hit@5` as 3.2.2:

| slice | n | 3.2.2 | 3.2.4 | delta |
|---|---:|---:|---:|---:|
| knowledge-update | 72 | 1.000 | 1.000 | 0.000 |
| multi-session | 121 | 0.975 | 0.975 | 0.000 |
| single-session-assistant | 56 | 0.893 | 0.893 | 0.000 |
| single-session-preference | 30 | 0.867 | 0.867 | 0.000 |
| single-session-user | 64 | 0.953 | 0.953 | 0.000 |
| temporal-reasoning | 127 | 0.921 | 0.921 | 0.000 |

## Latency and ingest

FTS query latency moved from 12/73 ms to 12/79 ms p50/p95. Local query
latency moved from 188/468 ms to 149/350 ms. These runs shared the same
hardware but not a controlled load, so the changes are not attributed to the
patch.

FTS ingested 278,946 items in 60.8 seconds, against 61.9 seconds in 3.2.2.
Local embeddings ingested the same items in 1,430.6 seconds, 7.2% slower than
3.2.2's 1,335.1 seconds. Ingest wall time is load-sensitive; the unchanged
accuracy, context size, item count, and zero raw-observation fallback hits do
not indicate a retrieval regression.

## Verdict

There is no material retrieval regression. FTS is exact on accuracy, local
`hit@5` is exact overall and on every slice, and local top-ten accuracy and
recall improve. The 3.2.4 release gate passes.
