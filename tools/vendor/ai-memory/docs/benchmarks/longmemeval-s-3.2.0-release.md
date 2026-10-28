# LongMemEval-S release benchmark: 3.2.0

The 3.2.0 release benchmark runs all 470 answerable LongMemEval-S questions
through the shipped hook capture pipeline. It measures the supported default
retrieval paths: zero-LLM FTS and the in-process local embedder, both with the
production-default observation stream enabled.

## Provenance

- code: both modes used `1c86aebc14addccc7ac875913d565c681bfa4a50`, the
  `v3.2.0` tag. The benchmark ran after the release was published, and this
  report is the only change since.
- dataset: `longmemeval_s`, sha256
  `08d8dad4be43ee2049a22ff5674eb86725d0ce5ff434cde2627e5e8e7e117894`.
- hardware: AMD Ryzen 9 7950X3D (32 threads). No build or test workload ran
  during either measurement. Static code review and a few single-threaded
  shell timings in throwaway containers overlapped the FTS run and the first
  minutes of the local run; the FTS result matches 3.1.2 exactly and the local
  slowdown below lasts the whole run, so that work does not explain either.
- commands, after `cargo clean` and building `ai-memory` and `ai-memory-eval`
  in release mode:

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

- run dirs: `evals/runs/2026-10-22T02-00-49-545842361Z-retrieval` (FTS)
  and `evals/runs/2026-10-22T03-05-33-423353129Z-retrieval` (local).

## Results

FTS is identical to 3.1.2 on every question at every cutoff. Local embeddings
lost five questions at `hit@5` and gained one, moving from 0.947 to 0.938, and
query latency and ingest time rose. That change is outside the
pre-registered +/-0.005 overall noise band and is tracked as a possible
regression for the next release.

| mode | hit@1 | hit@5 | hit@10 | p50 | p95 | mean context tokens |
|---|---:|---:|---:|---:|---:|---:|
| FTS 3.1.2 | 0.857 | 0.951 | 0.972 | 12 ms | 103 ms | 528 |
| **FTS 3.2.0** | **0.857** | **0.951** | **0.972** | **12 ms** | **97 ms** | **528** |
| local 3.1.2 | 0.768 | 0.947 | 0.977 | 98 ms | 225 ms | 528 |
| **local 3.2.0** | **0.757** | **0.938** | **0.974** | **118 ms** | **295 ms** | **528** |

Recall moved with hit rate: local `recall@5` went from 0.879 to 0.873 and
`recall@10` from 0.947 to 0.945. FTS recall is unchanged at every cutoff.

Per-slice `hit@5`:

| slice | n | FTS 3.1.2 | FTS 3.2.0 | local 3.1.2 | local 3.2.0 |
|---|---:|---:|---:|---:|---:|
| knowledge-update | 72 | 1.000 | 1.000 | 1.000 | 1.000 |
| multi-session | 121 | 0.967 | 0.967 | 0.975 | 0.975 |
| temporal-reasoning | 127 | 0.921 | 0.921 | 0.921 | 0.890 |
| single-session-assistant | 56 | 1.000 | 1.000 | 0.893 | 0.875 |
| single-session-preference | 30 | 0.700 | 0.700 | 0.900 | 0.900 |
| single-session-user | 64 | 1.000 | 1.000 | 0.953 | 0.969 |

The local losses are four temporal-reasoning questions (`71017276`,
`gpt4_68e94288`, `gpt4_b5700ca0`, `gpt4_e061b84f`) and one
single-session-assistant question (`5809eb10`); `001be529`
(single-session-user) was gained. The temporal-reasoning drop of 0.031 sits at
the upper edge of the +/-0.02 to 0.03 small-slice band, and the other two
slice moves are one question each.

Local query latency rose on every slice, from 98 to 118 ms at p50 and from
225 to 295 ms at p95. Returned context is unchanged.

## Ingest

| mode | items | requests | throughput | wall clock | median ingest per question | fallback answers |
|---|---:|---:|---:|---:|---:|---:|
| FTS 3.1.2 | 278,946 | 1,403 | 12 items/s per question stream | 3,837.0 s | 48.7 s | 0/470 |
| FTS 3.2.0 | 278,946 | 1,403 | 12 items/s per question stream | 3,882.6 s | 48.5 s | 0/470 |
| local 3.1.2 | 278,946 | 1,403 | 10 items/s per question stream | 4,899.8 s | 60.1 s | 0/470 |
| local 3.2.0 | 278,946 | 1,403 | 5 items/s per question stream | 8,590.6 s | 101.3 s | 0/470 |

FTS ingest is unchanged, so the CJK search index added in 3.2.0 does not
account for the local slowdown. Local ingest took 75% longer end to end.

No document exceeded the 16 KiB capture bound. The raw-observation fallback
was not needed, so both results measure indexed retrieval.

## Suspected cause

3.2.0 reserved local-embedding capacity for interactive queries (`107ada8d`,
"Reserved local-embedding capacity for interactive search queries" in the
3.2.0 changelog). The local embedder is now wrapped in a two-slot limit: one
slot for background document embedding and one held back for queries. Page
writes therefore embed one document at a time per server, which matches the
halved ingest throughput. Whether the slower embedding also explains the
accuracy loss, for example by leaving some pages without a vector when their
question is asked, has not been measured. The follow-up issue for the next
release ([#1580](https://github.com/akitaonrails/ai-memory/issues/1580)) records the deltas, run dirs and this commit so the trade can be
measured and decided there.
