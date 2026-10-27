# Concurrent Workload Benchmark — TASK-480

- Task: TASK-480
- Seed: 0x480
- Commit: fa636be515836f3036dd68a0891a2ec24718edb2 · bench manifest 0a1d325ada24 (barrier.mjs:3a2971ab, constants.mjs:3b79c310, lifecycle.mjs:dd6d1f79, report.mjs:755252e2, mixed.mjs:e34a560a, multi-client.mjs:020216b0, readers-only.mjs:e2a8414d, writers-only.mjs:2290d652, schema.mjs:4d791584, concurrent-reader.worker.mjs:ea6bb489, concurrent-writer-concurrent.worker.mjs:2d0e7554, concurrent-workload-bench.mjs:c5b407ef, corpus.mjs:a92b0fdf, metrics.mjs:a92c12e1, queries.mjs:273d5a81, report.mjs:85cdd97e) · branch main (dirty)
- Node: v24.18.0 · better-sqlite3 12.9.0 · sqlite 3.53.0 · page 4096B
- Owner/Repo: bench / bench-concurrent · epoch 2026-01-01T00:00:00.000Z · rows 2000
- WAL: journal_mode WAL · synchronous NORMAL · busy_timeout 2000ms · wal_autocheckpoint 1000
- Isolated temp DB: yes · deterministic corpus: yes (seed 0x480)
- Scenarios: readers_only, writers_only, mixed, multi_client
- Date: 2026-08-22T16:15:52.104Z
- Bench manifest:
```
3a2971aba10a7df81845a48932b545950451cca3  scripts/bench/concurrent-eval/barrier.mjs
3b79c3105eb569a5a0fefcbbc886d157aa75ab5d  scripts/bench/concurrent-eval/constants.mjs
dd6d1f795cae5fda16b9a30faf6619b3340f8729  scripts/bench/concurrent-eval/lifecycle.mjs
755252e2815878de7db7ae5cd0757ff8062c0c05  scripts/bench/concurrent-eval/report.mjs
e34a560a8cc9f4fc21fdb60b8559c6f0760001f5  scripts/bench/concurrent-eval/scenarios/mixed.mjs
020216b0a58a3bc02f8d36f66744817f5e466cea  scripts/bench/concurrent-eval/scenarios/multi-client.mjs
e2a8414dd6a081c1f0ff6b309ac4c4f006a2fc14  scripts/bench/concurrent-eval/scenarios/readers-only.mjs
2290d652b7a0988154fcdb5d052b096855ed33f7  scripts/bench/concurrent-eval/scenarios/writers-only.mjs
4d791584669e12c8b8583f7e37990d73f2740533  scripts/bench/concurrent-eval/schema.mjs
ea6bb489e58cbb35430a3beb511b4b14bf3dbec3  scripts/bench/concurrent-eval/workers/concurrent-reader.worker.mjs
2d0e7554c8bbda1661451ffa93caaf21d5219f77  scripts/bench/concurrent-eval/workers/concurrent-writer-concurrent.worker.mjs
c5b407ef956349ed56ca38edf60ffa639bea8978  scripts/bench/concurrent-workload-bench.mjs
a92b0fdf1422e3d20d2bdb7fc35bd6dc39981026  scripts/bench/memory-eval/corpus.mjs
a92c12e16cf83f83b46c27f4047a6b5e07e2ee0e  scripts/bench/memory-eval/metrics.mjs
273d5a8172df9fc39080727cd04e5f4ce5721e90  scripts/bench/memory-eval/queries.mjs
85cdd97e3b082e72955e7856fde2b21caeac8eec  scripts/bench/memory-eval/report.mjs
```

## Summary

| Metric | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | n | Throughput |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Read latency | 0.397 | 6.462 | 30.218 | 1.664 | 400 | 601.0 ops/s |
| Write latency | 0.233 | 4.142 | 48.056 | 1.373 | 200 | 728.4 ops/s |
| Mixed latency | 0.269 | 4.670 | 17.722 | 1.115 | 540 | 897.0 ops/s |

- Total ops: 1140 · total errors: 0 (busy 0 timeout 0 other 0)
- Max heapUsed: 8945 KiB · max dbBytes: 6321 KiB

## Per-Scenario Breakdown

| Scenario | Ops | p50/p95/p99 (ms) | Throughput | Errors (busy/timeout/other) | Contention | Concurrency |
| --- | ---: | --- | ---: | --- | --- | --- |
| readers_only | 400 | 0.397/6.462/30.218 | 440.6 ops/s | 0 (0/0/0) | 0.0% | 4R/0W · 4 clients |
| writers_only | 200 | 0.233/4.142/48.056 | 363.2 ops/s | 0 (0/0/0) | 0.0% | 0R/4W · 4 clients |
| mixed | 240 | 0.296/4.754/14.304 | 537.0 ops/s | 0 (0/0/0) | 0.0% | 2R/2W · 4 clients |
| multi_client | 300 | 0.247/4.670/38.554 | 2668.0 ops/s | 0 (0/0/0) | — | 2R/4W · 6 clients |

## Scenario Details

### readers_only

- Latency: p50 0.397 ms · p95 6.462 ms · p99 30.218 ms · mean 1.664 ms · n 400 · throughput 440.6 ops/s
- Errors: total 0 · busy 0 · timeout 0 · other 0 · errorRate 0.00%
- Resource: heap 8726 KiB · db 1812 KiB · wal 0 KiB · elapsed 907.9 ms
- Contention: rate 0.0% · busyRetries 0 · lockWait 0 ms
- WAL before checkpoint: —
- Operation overlap: —
- Integrity: —
- Concurrency: {"readers":4,"writers":0,"clients":4,"overlap":"worker_threads+SharedArrayBuffer barrier","genuineOverlap":true}
- Extra: `{}`

### writers_only

- Latency: p50 0.233 ms · p95 4.142 ms · p99 48.056 ms · mean 1.373 ms · n 200 · throughput 363.2 ops/s
- Errors: total 0 · busy 0 · timeout 0 · other 0 · errorRate 0.00%
- Resource: heap 8945 KiB · db 6096 KiB · wal 4068 KiB · elapsed 550.6 ms
- Contention: rate 0.0% · busyRetries 0 · lockWait 0 ms
- WAL before checkpoint: —
- Operation overlap: —
- Integrity: —
- Concurrency: {"readers":0,"writers":4,"clients":4,"overlap":"worker_threads+SharedArrayBuffer barrier","genuineOverlap":true}
- Extra: `{}`

### mixed

- Latency: p50 0.296 ms · p95 4.754 ms · p99 14.304 ms · mean 0.911 ms · n 240 · throughput 537.0 ops/s
- Errors: total 0 · busy 0 · timeout 0 · other 0 · errorRate 0.00%
- Resource: heap 6115 KiB · db 6321 KiB · wal 4293 KiB · elapsed 447.0 ms
- Contention: rate 0.0% · busyRetries 0 · lockWait 0 ms
- WAL before checkpoint: —
- Operation overlap: —
- Integrity: —
- Concurrency: {"readers":2,"writers":2,"clients":4,"overlap":"worker_threads+SharedArrayBuffer barrier (reads+writes concurrent)","genuineOverlap":true}
- Extra: `{}`

### multi_client

- Latency: p50 0.247 ms · p95 4.670 ms · p99 38.554 ms · mean 1.278 ms · n 300 · throughput 2668.0 ops/s
- Errors: total 0 · busy 0 · timeout 0 · other 0 · errorRate 0.00%
- Resource: —
- Contention: rate — · busyRetries 0 · lockWait 0 ms
- WAL before checkpoint: —
- Operation overlap: 47.876 ms (proof yes)
- Integrity: {"expectedCount":200,"actualCount":200,"expectedIdsPresent":true,"uniqueIds":200,"insertedIds":200,"ok":true}
- Concurrency: {"readers":2,"writers":4,"clients":6,"overlap":"worker_threads + child_process shared file barrier","genuineOverlap":true,"childProcess":true}
- Extra: `{}`


## Environment

| Key | Value |
| --- | --- |
| commitSha | fa636be515836f3036dd68a0891a2ec24718edb2 |
| benchRevision.manifestHash | 0a1d325ada24cedf7c3620254cdedc56032f9667980c46c3c9b008be813449b8 |
| benchRevision.perFile | {"scripts/bench/concurrent-eval/barrier.mjs":"3a2971aba10a7df81845a48932b545950451cca3","scripts/bench/concurrent-eval/constants.mjs":"3b79c3105eb569a5a0fefcbbc886d157aa75ab5d","scripts/bench/concurrent-eval/lifecycle.mjs":"dd6d1f795cae5fda16b9a30faf6619b3340f8729","scripts/bench/concurrent-eval/report.mjs":"755252e2815878de7db7ae5cd0757ff8062c0c05","scripts/bench/concurrent-eval/scenarios/mixed.mjs":"e34a560a8cc9f4fc21fdb60b8559c6f0760001f5","scripts/bench/concurrent-eval/scenarios/multi-client.mjs":"020216b0a58a3bc02f8d36f66744817f5e466cea","scripts/bench/concurrent-eval/scenarios/readers-only.mjs":"e2a8414dd6a081c1f0ff6b309ac4c4f006a2fc14","scripts/bench/concurrent-eval/scenarios/writers-only.mjs":"2290d652b7a0988154fcdb5d052b096855ed33f7","scripts/bench/concurrent-eval/schema.mjs":"4d791584669e12c8b8583f7e37990d73f2740533","scripts/bench/concurrent-eval/workers/concurrent-reader.worker.mjs":"ea6bb489e58cbb35430a3beb511b4b14bf3dbec3","scripts/bench/concurrent-eval/workers/concurrent-writer-concurrent.worker.mjs":"2d0e7554c8bbda1661451ffa93caaf21d5219f77","scripts/bench/concurrent-workload-bench.mjs":"c5b407ef956349ed56ca38edf60ffa639bea8978","scripts/bench/memory-eval/corpus.mjs":"a92b0fdf1422e3d20d2bdb7fc35bd6dc39981026","scripts/bench/memory-eval/metrics.mjs":"a92c12e16cf83f83b46c27f4047a6b5e07e2ee0e","scripts/bench/memory-eval/queries.mjs":"273d5a8172df9fc39080727cd04e5f4ce5721e90","scripts/bench/memory-eval/report.mjs":"85cdd97e3b082e72955e7856fde2b21caeac8eec"} |
| node | v24.18.0 |
| betterSqlite3 | 12.9.0 |
| sqliteVersion | 3.53.0 |
| pageSize | 4096 |
| busyTimeoutMs | 2000 |
| benchRows | 2000 |
| seed | 0x480 |

