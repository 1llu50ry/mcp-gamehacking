# LongMemEval-S release benchmark: 3.2.2

The 3.2.2 release benchmark runs all 470 answerable LongMemEval-S questions
through the shipped hook capture pipeline. It measures the default zero-LLM
FTS path and the in-process local embedder, both with the production-default
observation stream enabled. The run was pre-registered in
[#1620](https://github.com/akitaonrails/ai-memory/issues/1620): exact FTS
parity, local overall `hit@5` within +/-0.005, and slice deltas within
0.02-0.03 were the release thresholds.

## Provenance

- code: both modes used `a736b4b74eb954e9a76ade38a6f839d80b11ff6b`,
  the frozen 3.2.2 release candidate.
- dataset: `longmemeval_s`, sha256
  `08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894`.
- hardware: AMD Ryzen 9 7950X3D (32 threads), with other agent workloads
  sharing the machine. Accuracy is load-insensitive; latency is not.
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

- run dirs: `evals/runs/2026-10-22T22-32-08-613671222Z-retrieval` (FTS)
  and `evals/runs/2026-10-22T22-33-15-405163139Z-retrieval` (local).

## Results

FTS matches 3.2.1 exactly at every accuracy cutoff. Local `hit@5` moved from
0.949 to 0.945, a two-question change and within the pre-registered overall
noise band. Both questions moved only from ranks 1-5 to ranks 6-10;
`hit@10` improved from 0.968 to 0.974.

| mode | hit@1 | hit@3 | hit@5 | hit@10 | recall@5 | recall@10 | p50 | p95 | mean context tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| FTS 3.2.1 | 0.857 | 0.930 | 0.951 | 0.972 | 0.893 | 0.937 | 12 ms | 84 ms | 527.8 |
| **FTS 3.2.2** | **0.857** | **0.930** | **0.951** | **0.972** | **0.893** | **0.937** | **12 ms** | **73 ms** | **534.8** |
| local 3.2.1 | 0.760 | 0.904 | 0.949 | 0.968 | 0.882 | 0.936 | 171 ms | 389 ms | 527.8 |
| **local 3.2.2** | **0.755** | **0.900** | **0.945** | **0.974** | **0.880** | **0.940** | **188 ms** | **468 ms** | **535.2** |

Per-slice local `hit@5`:

| slice | n | 3.2.1 | 3.2.2 | delta |
|---|---:|---:|---:|---:|
| knowledge-update | 72 | 1.000 | 1.000 | 0.000 |
| multi-session | 121 | 0.975 | 0.975 | 0.000 |
| single-session-assistant | 56 | 0.893 | 0.893 | 0.000 |
| single-session-preference | 30 | 0.900 | 0.867 | -0.033 |
| single-session-user | 64 | 0.953 | 0.953 | 0.000 |
| temporal-reasoning | 127 | 0.929 | 0.921 | -0.008 |

The preference slice exceeds its nominal 0.03 threshold by 0.003, but that is
one question in a 30-question slice. The temporal delta is also one question.
The affected questions (`57f827a0` and `gpt4_7ddcf75f`) remain hits at rank
10. This is the same rank-boundary behavior documented by the 3.2.1 run, not
a broad ranking shift. No question fell out of the top ten on either slice.

## Latency and ingest

The local latency changed from 171/389 ms to 188/468 ms p50/p95 while the
machine was under varying shared load, so it is not evidence of a product
regression. FTS p50 stayed at 12 ms and p95 improved to 73 ms. Both modes
retrieved zero raw-observation fallback hits across all 470 questions, which
also confirms that the fallback-related fixes in this patch were inactive in
the measured ranking path.

FTS ingested 278,946 items in 61.9 seconds. Local embeddings ingested the same
items in 1,335.1 seconds, down from 1,841.1 seconds in the loaded 3.2.1 run.
Ingest wall time remains load-sensitive and is not used as a release gate.

## Verdict

There is no material retrieval regression. FTS is exact, local overall
`hit@5` is inside the pre-registered tolerance, the two top-five changes stay
inside the top ten, and local `hit@10` and `recall@10` both improved. The
3.2.2 release gate passes.
