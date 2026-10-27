# Embedding Queue Availability Benchmark — TASK-479

- Task: TASK-479
- Seed: 0x479
- Commit: f8708ec508f402211b1a31d48d2947d49cada99d · bench 87c406f4c19c · branch main (dirty)
- Node: v24.18.0 · better-sqlite3 12.9.0 · sqlite 3.53.0 · page 4096B
- Owner/Repo: bench / bench-queue · batch 32 · lease 60000ms · poison 5
- Vector backend: stub embed (deterministic, no ONNX)
- Isolated temp DB: yes · deterministic fixtures: yes
- Date: 2026-08-22T12:35:21.516Z · epoch 2026-01-01T00:00:00.000Z

## Summary

| Metric | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | n |
| --- | ---: | ---: | ---: | ---: | ---: |
| Write latency (enqueue) | 0.253 | 0.471 | 1.073 | 0.312 | 290 |
| Queue delay (write → visibility) | 1.596 | 85.261 | 85.261 | 9.557 | 120 |

- Total failures: 10
- Write throughput: 3201.9 ops/s

## Per-Scenario Breakdown

| Scenario | Write p50/p95/p99 (ms) | Queue delay p50/p95/p99 (ms) | Failures | n |
| --- | --- | --- | ---: | ---: |
| empty_queue | 0.439/2.459/2.459 | 2.436/35.332/35.332 | 0 | 20 |
| full_queue | 0.248/0.371/0.371 | 7.564/7.564/7.564 | 0 | 20 |
| concurrent_writes | 0.238/0.387/0.705 | 1.596/1.596/1.596 | 0 | 200 |
| worker_restart | 0.271/0.752/8.613 | 0.269/0.269/0.269 | 0 | 30 |
| failed_jobs | 0.269/0.471/0.471 | 0.408/0.408/0.408 | 10 | 20 |
| lease_expiry | — | 85.261/85.261/85.261 | 0 | 10 |

## Scenario Details

### empty_queue

- Write latency: p50 0.439 ms · p95 2.459 ms · p99 2.459 ms · mean 0.557 ms · n 20
- Queue delay: p50 2.436 ms · p95 35.332 ms · p99 35.332 ms · mean 4.148 ms · n 20
- Failures: 0 · n 20
- Extra: `{
  "counts": {
    "pending": 0,
    "claimed": 0,
    "done": 20,
    "poison": 0,
    "total": 20
  }
}`

### full_queue

- Write latency: p50 0.248 ms · p95 0.371 ms · p99 0.371 ms · mean 0.255 ms · n 20
- Queue delay: p50 7.564 ms · p95 7.564 ms · p99 7.564 ms · mean 7.564 ms · n 20
- Failures: 0 · n 20
- Extra: `{
  "pendingBefore": 600
}`

### concurrent_writes

- Write latency: p50 0.238 ms · p95 0.387 ms · p99 0.705 ms · mean 0.258 ms · n 200
- Queue delay: p50 1.596 ms · p95 1.596 ms · p99 1.596 ms · mean 1.596 ms · n 30
- Failures: 0 · n 200
- Extra: `{
  "writeErrors": 0,
  "visibilityFailures": 0,
  "pendingAfterWrites": 200,
  "sampled": 30,
  "totalDrainMs": 47.87517500000001
}`

### worker_restart

- Write latency: p50 0.271 ms · p95 0.752 ms · p99 8.613 ms · mean 0.570 ms · n 30
- Queue delay: p50 0.269 ms · p95 0.269 ms · p99 0.269 ms · mean 0.269 ms · n 30
- Failures: 0 · n 30
- Extra: `{
  "restartQueueDelay": 8.055330000000026,
  "pendingMid": 20,
  "doneMid": 10
}`

### failed_jobs

- Write latency: p50 0.269 ms · p95 0.471 ms · p99 0.471 ms · mean 0.281 ms · n 20
- Queue delay: p50 0.408 ms · p95 0.408 ms · p99 0.408 ms · mean 0.408 ms · n 10
- Failures: 10 · n 20
- Extra: `{
  "poisoned": 10,
  "pendingAfter": 0,
  "doneAfter": 10,
  "retryDone": 20,
  "attemptCycles": 5,
  "halfPoisoned": 10,
  "retryMs": 4.080598000000009
}`

### lease_expiry

- Write latency: p50 — ms · p95 — ms · p99 — ms · mean — ms · n —
- Queue delay: p50 85.261 ms · p95 85.261 ms · p99 85.261 ms · mean 85.261 ms · n 10
- Failures: 0 · n 10
- Extra: `{
  "leaseWaitMs": 84.60421899999994,
  "reconcileMs": 1.6655399999999645,
  "drainMs": 6.571238999999991,
  "reconciled": 10,
  "claimed": 10,
  "visible": 10,
  "shortLeaseMs": 50
}`


## Environment

| Key | Value |
| --- | --- |
| commitSha | f8708ec508f402211b1a31d48d2947d49cada99d |
| benchRevision | 87c406f4c19c5d780055505b067ff7d81b6727c0
a92c12e16cf83f83b46c27f4047a6b5e07e2ee0e |
| node | v24.18.0 |
| betterSqlite3 | 12.9.0 |
| sqliteVersion | 3.53.0 |
| pageSize | 4096 |
| batchSize | 32 |
| leaseMs | 60000 |
| poisonThreshold | 5 |
