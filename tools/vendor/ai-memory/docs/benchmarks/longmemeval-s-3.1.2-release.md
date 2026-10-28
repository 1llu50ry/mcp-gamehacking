# LongMemEval-S release benchmark: 3.1.2

The 3.1.2 release benchmark runs all 470 answerable LongMemEval-S questions
through the shipped hook capture pipeline. It measures the supported default
retrieval paths: zero-LLM FTS and the in-process local embedder, both with the
production-default observation stream enabled.

## Provenance

- code: both modes used `80133202cf7298d1b7ebf6c7248072cf2f702ba4`.
  The only changes allowed after measurement are this benchmark report and
  release metadata. Neither changes retrieval, capture, model weights, or
  ranking.
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

- run dirs: `evals/runs/2026-10-20T16-31-20-838890843Z-retrieval` (FTS)
  and `evals/runs/2026-10-20T17-35-22-137201437Z-retrieval` (local).

## Results

FTS accuracy is identical to 3.1 at every overall cutoff. Local embeddings
improved by three questions at `hit@5`, from 0.940 to 0.947. Query latency and
returned context remained stable.

| mode | hit@1 | hit@5 | hit@10 | p50 | p95 | mean context tokens |
|---|---:|---:|---:|---:|---:|---:|
| FTS 3.1 | 0.857 | 0.951 | 0.972 | 12 ms | 101 ms | 528 |
| **FTS 3.1.2** | **0.857** | **0.951** | **0.972** | **12 ms** | **103 ms** | **528** |
| local 3.1 | 0.755 | 0.940 | 0.972 | 99 ms | 225 ms | 528 |
| **local 3.1.2** | **0.768** | **0.947** | **0.977** | **98 ms** | **225 ms** | **528** |

The local `hit@5` gain is +0.007, just beyond the pre-registered +/-0.005
run-to-run band and in the favorable direction. Its `hit@1` returned to the
3.0.1 value of 0.768. FTS p95 changed by 2 ms. These measurements do not show
a quality, latency, or context-size regression.

Per-slice `hit@5`:

| slice | n | FTS 3.1 | FTS 3.1.2 | local 3.1 | local 3.1.2 |
|---|---:|---:|---:|---:|---:|
| knowledge-update | 72 | 1.000 | 1.000 | 1.000 | 1.000 |
| multi-session | 121 | 0.967 | 0.967 | 0.975 | 0.975 |
| temporal-reasoning | 127 | 0.921 | 0.921 | 0.898 | 0.921 |
| single-session-assistant | 56 | 1.000 | 1.000 | 0.893 | 0.893 |
| single-session-preference | 30 | 0.700 | 0.700 | 0.900 | 0.900 |
| single-session-user | 64 | 1.000 | 1.000 | 0.953 | 0.953 |

All FTS slices are exact. Five local slices are also exact; temporal reasoning
gained three questions, moving from 0.898 to 0.921. The +0.023 change is
within the pre-registered +/-0.02 to 0.03 slice band and agrees with the
overall result.

## Ingest

| mode | items | requests | throughput | wall clock | fallback answers |
|---|---:|---:|---:|---:|---:|
| FTS | 278,946 | 1,403 | 12 items/s per question stream | 3,837.0 s | 0/470 |
| local | 278,946 | 1,403 | 10 items/s per question stream | 4,899.8 s | 0/470 |

No document exceeded the 16 KiB capture bound. The raw-observation fallback
was not needed, so both results measure indexed retrieval.
