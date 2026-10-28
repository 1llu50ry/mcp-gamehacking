# LongMemEval-S release benchmark: 3.2.1

The 3.2.1 release benchmark runs all 470 answerable LongMemEval-S questions
through the shipped hook capture pipeline, measuring the supported default
retrieval paths: zero-LLM FTS and the in-process local embedder, both with the
production-default observation stream enabled. It is the first release run on
the fast procedure (wiki git checkpoints skipped in the eval server; see
[Running it fast](README.md#running-it-fast)): accuracy, latency and
context-token numbers stay comparable with earlier releases, and only ingest
wall clock differs, because runs before October 2026 paid for the commits.

## Provenance

- code: both modes used `7566d039fe902341ffc885325a31b836ceedcedc`, the
  release candidate that became `v3.2.1`. It contains the #1580 fix
  (embedding capacity sized from the CPU, bounded query wait) and no other
  retrieval-relevant change since 3.2.0.
- dataset: `longmemeval_s`, sha256
  `08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894`.
- hardware: AMD Ryzen 9 7950X3D (32 threads). Unlike the 3.1.2 and 3.2.0
  runs, this one ran while several agent sessions shared the machine. The
  accuracy numbers are load-insensitive; the query latencies below are not,
  and the load context is stated with them.
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

- run dirs: `evals/runs/2026-10-22T17-11-44-812925488Z-retrieval` (FTS)
  and `evals/runs/2026-10-22T17-12-55-885591885Z-retrieval` (local).

## Results

FTS matches 3.2.0 (and 3.1.2) on every question at every cutoff, which also
re-confirms that skipping the eval server's wiki checkpoints changes no
published number. Local embeddings recovered the accuracy 3.2.0 lost: overall
`hit@5` is 0.949, above both 3.2.0's 0.938 and 3.1.2's 0.947.

| mode | hit@1 | hit@5 | hit@10 | p50 | p95 | mean context tokens |
|---|---:|---:|---:|---:|---:|---:|
| FTS 3.2.0 | 0.857 | 0.951 | 0.972 | 12 ms | 97 ms | 528 |
| **FTS 3.2.1** | **0.857** | **0.951** | **0.972** | **12 ms** | **84 ms** | **528** |
| local 3.1.2 | 0.768 | 0.947 | 0.977 | 98 ms | 225 ms | 528 |
| local 3.2.0 | 0.757 | 0.938 | 0.974 | 118 ms | 295 ms | 528 |
| **local 3.2.1** | **0.760** | **0.949** | **0.968** | **171 ms** | **389 ms** | **528** |

Local `recall@5` is 0.882 (3.1.2: 0.879, 3.2.0: 0.873) and `recall@10` 0.936
(0.947, 0.945). `hit@1` sits between the two earlier releases and `hit@10`
half a point under both: the same boundary questions that 3.2.0 pushed past
rank 5 came back, some landing inside the top 5 and others between 6 and 10.

Per-slice `hit@5`:

| slice | n | local 3.1.2 | local 3.2.0 | local 3.2.1 |
|---|---:|---:|---:|---:|
| knowledge-update | 72 | 1.000 | 1.000 | 1.000 |
| multi-session | 121 | 0.975 | 0.975 | 0.975 |
| single-session-assistant | 56 | 0.893 | 0.875 | **0.893** |
| single-session-preference | 30 | 0.900 | 0.900 | 0.900 |
| single-session-user | 64 | 0.953 | 0.969 | **0.953** |
| temporal-reasoning | 127 | 0.921 | 0.890 | **0.929** |

The two slices 3.2.0 moved both came back: temporal-reasoning recovered the
four lost questions and gained a fifth (0.929, its best value across the
three releases), and single-session-assistant returned its lost question
exactly. single-session-user gave back the one question 3.2.0 had gained.
That is the run-to-run picture #1580 documented: these particular questions
sit at the rank-5 boundary and flip between identical builds, so single-
question deltas in this band carry no signal, and the slice-to-slice
round trip is what recovery looks like.

## Latency and ingest

The local p50/p95 above (171/389 ms) are not comparable to the earlier rows:
this run shared the machine with other agent workloads, and query latency is
CPU-sensitive. Two comparisons that are:

- A controlled subset run (the five lost plus one gained question and ten
  temporal controls, 16 questions, quiet machine, same build) measured
  **66/87 ms** p50/p95 against 3.2.0's full-run 118/295: the capacity fix
  removed the contention 3.2.0 added, and the reserved query slot keeps
  latency under 3.1.2's 98/225 as well.
- FTS latency, which the embedding scheduler cannot touch, measured 12/84 ms
  on the same loaded machine — further evidence the local numbers above are
  load, not regression.

Ingest wall clock is no longer comparable across releases: the fast procedure
skips wiki git commits the earlier runs paid for. FTS ingested 278,946 items
in 61 s; local finished in 1,841 s with embedding 87% of server-side ingest
time, the known remaining ceiling. Run-to-run wall-clock spread under ambient
load is roughly ±15%.

## Verdict for #1580

The 3.2.0 accuracy loss was boundary-question noise, not a ranking change:
with the capacity fix landed, the same questions flip between identical
builds, and this release run recovered both moved slices. The real 3.2.0
regressions — serialized document embedding, silently degraded queries,
higher latency under load — are fixed and measured. No follow-up retrieval
work is required from #1580.
