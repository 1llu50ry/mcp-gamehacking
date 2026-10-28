# LongMemEval-S release benchmark: 3.0.0

The release benchmark for 3.0.0: the full LongMemEval-S set (470 answerable
questions) through the shipped hook capture pipeline, for zero-LLM FTS and for
the default local embeddings. Each run compares the observation stream off
(the 2.6 ranking) with on (the 3.0 default) on one build.

## Provenance

- code: release candidate `db92a459` (`release/3.0` after the release audit
  fixes). The server and harness binaries were built from that commit; the
  `commit` line inside each run's `report.md` names the checkout the harness
  was launched from (`fe7f7c45`), not the code under test. Later commits up
  to the tag change no retrieval code (Muse Code support, CI fixes, docs and
  version metadata).
- dataset: `longmemeval_s`, sha256 `08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894`
- hardware: AMD Ryzen 9 7950X3D (32 threads); the FTS run shared the machine
  with a full test gate for part of its run, so its latency is pessimistic.
- commands (from a checkout holding `evals/datasets` and `evals/models`):

  ```bash
  AB="--server-env AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=false
      --candidate-server-env AI_MEMORY_RETRIEVAL__OBSERVATION_STREAM=true"
  ai-memory-eval retrieval --server-bin target/release/ai-memory --concurrency 6 --http-timeout-secs 900 $AB
  ai-memory-eval retrieval --server-bin target/release/ai-memory --concurrency 6 --http-timeout-secs 900 --embeddings local $AB
  ```

- run dirs: `evals/runs/2026-10-13T17-14-10-307179783Z-retrieval` (FTS) and
  `evals/runs/2026-10-13T20-08-59-925168508Z-retrieval` (local).

## Results (hit@5, all 470)

| mode | 2.6 published | 3.0, stream off | 3.0 (shipped default) |
|---|---|---|---|
| zero-LLM FTS | 0.666 | 0.662 | **0.951** |
| local embeddings | 0.815 | 0.800 | **0.945** |

Per slice, shipped 3.0 against the 2.6 published local numbers:

| slice | n | 2.6 local | 3.0 local | 3.0 FTS |
|---|---|---|---|---|
| knowledge-update | 72 | 0.875 | 1.000 | 1.000 |
| multi-session | 121 | 0.868 | 0.975 | 0.967 |
| temporal-reasoning | 127 | 0.780 | 0.913 | 0.921 |
| single-session-assistant | 56 | 0.821 | 0.893 | 1.000 |
| single-session-preference | 30 | 0.767 | 0.900 | 0.700 |
| single-session-user | 64 | 0.734 | 0.953 | 1.000 |

Every slice improved. Stream off → on on this build: FTS hit@1 0.511 → 0.857
and hit@10 0.687 → 0.972 (139 questions gained, 3 lost); local hit@1 0.543 →
0.766 and hit@10 0.883 → 0.974 (72 gained, 4 lost). The earlier
measurement of the same ranking
([decomposition report](longmemeval-s-decomposition-2026-10-12.md)) gave
0.951 FTS and 0.936 local; the 0.009 local difference is run-to-run variance
in local embedding ingestion.

## Latency, context and ingest

| | FTS off → on | local off → on |
|---|---|---|
| query p50 | 10 → 13 ms | 90 → 99 ms |
| query p95 | 83 → 112 ms | 243 → 232 ms |
| context tokens, mean per query | 367 → 528 | 451 → 529 |
| ingest | 9 items/s per question stream, both arms | 8–9 items/s, both arms |

The context-token rise is the documented trade: with the stream on, the hit
list fills toward ten entries instead of about five, and at an equal hit count
the cost was measured at +3.8% (FTS) and +17% (local) for the top five hits.

## Open question for 3.1

With the stream off, the local path scores 0.800 against 2.6's published
0.815, outside the ±0.005 noise band. 2.6's figure predates the harness fix
that replays each question under its own session id, so the comparison is not
clean. [#1263](https://github.com/akitaonrails/ai-memory/issues/1263) tracks
separating harness from code; it does not affect the shipped default.
