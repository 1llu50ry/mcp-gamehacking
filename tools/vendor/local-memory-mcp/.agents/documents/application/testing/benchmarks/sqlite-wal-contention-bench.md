# SQLite WAL Write-Contention Load Test: TASK-424

- Task: TASK-424 "SQLite WAL write-contention load test"
- Test: `src/mcp/tests/sqlite.wal-contention.perf.test.ts` (Vitest 4, project `perf`, pure TS / node env)
- Commit: 37cbc1493f115f60851215de9c3ad523fcc3a956 · branch main (test file untracked/new)
- Node: v24.16.0 · better-sqlite3 12.9.0 · sqlite 3.53.0 · page 4096B
- WAL: journal_mode WAL · synchronous NORMAL · busy_timeout 30000ms · wal_autocheckpoint 1000
- Isolated temp DB: yes (one `fs.mkdtemp` dir per run, never touches `storage/`)
- Writers: N=10 default (100 ops) · N=50 opt-in via `WAL_CONTENTION_LARGE=1` (500 ops)
- Purpose: measure write contention across N concurrent SQLiteStore instances on ONE file-backed temp DB and validate that the busy_timeout + BEGIN IMMEDIATE + bounded retry wrapper keeps locked/SQLITE_BUSY errors at zero
- Date: 2026-09-20

## Summary

| Scenario   | Writers | Ops | Busy | Other | Wall (ms) | p50 (ms) | p95 (ms) | Max (ms) |
| ---------- | ------: | --: | ---: | ----: | --------: | -------: | -------: | -------: |
| N=10 run 1 |      10 | 100 |    0 |     0 |      2829 |    1.070 |  148.502 |    346.0 |
| N=10 run 2 |      10 | 100 |    0 |     0 |      3006 |    1.168 |  137.412 |    196.6 |
| N=10 run 3 |      10 | 100 |    0 |     0 |      2893 |    1.183 |   91.784 |    249.3 |
| N=10 run 4 |      10 | 100 |    0 |     0 |      2728 |    0.872 |   89.816 |    161.2 |
| N=50 run 1 |      50 | 500 |    0 |     0 |     15149 |    1.795 |  542.978 |   1678.7 |
| N=50 run 2 |      50 | 500 |    0 |     0 |     14062 |    1.239 |  750.719 |   1873.5 |

- Total errors: 0 (busy 0, other 0) in EVERY run at both N=10 and N=50.
- Latency (p50/p95) is recorded only, never hard-asserted; timing is host-dependent.
- Runtime: default ~4s (well under the 20s budget) · N=50 ~16s.
- An earlier exploratory run in scratch space: wall 2947ms, p50 1.206, p95 84.993, max 190.6.

## Per-Scenario Breakdown

### N=10 writers (default)

| Run | Ops | Busy | Other | Wall (ms) | p50 (ms) | p95 (ms) | Max (ms) | Assert                            |
| --- | --: | ---: | ----: | --------: | -------: | -------: | -------: | --------------------------------- |
| 1   | 100 |    0 |     0 |      2829 |    1.070 |  148.502 |    346.0 | busy==0, other==0, latencies==100 |
| 2   | 100 |    0 |     0 |      3006 |    1.168 |  137.412 |    196.6 | busy==0, other==0, latencies==100 |
| 3   | 100 |    0 |     0 |      2893 |    1.183 |   91.784 |    249.3 | busy==0, other==0, latencies==100 |
| 4   | 100 |    0 |     0 |      2728 |    0.872 |   89.816 |    161.2 | busy==0, other==0, latencies==100 |

### N=50 writers (opt-in, `WAL_CONTENTION_LARGE=1`)

| Run | Ops | Busy | Other | Wall (ms) | p50 (ms) | p95 (ms) | Max (ms) | Assert                            |
| --- | --: | ---: | ----: | --------: | -------: | -------: | -------: | --------------------------------- |
| 1   | 500 |    0 |     0 |     15149 |    1.795 |  542.978 |   1678.7 | busy==0, other==0, latencies==500 |
| 2   | 500 |    0 |     0 |     14062 |    1.239 |  750.719 |   1873.5 | busy==0, other==0, latencies==500 |

### Key observations

- Zero SQLITE_BUSY / locked / other errors at both N=10 and N=50: the busy_timeout (30s) absorbs the contention and the bounded retry wrapper never had to surface a failure.
- p50 stays flat (~0.9 to 1.8 ms) from N=10 to N=50: uncontended single-write latency is essentially unchanged.
- p95 and max grow sharply with N (p95 ~90-150ms at N=10 to ~540-750ms at N=50; max ~200-350ms to ~1.7-1.9s). This is the single-writer queueing tail, not failure: 50 writers serialize through one WAL write lock, so the last writer in each round waits behind the others.
- WAL still permits concurrent readers; only writers serialize, which is why no error surfaces and latency (not errors) is the observable cost.

## Method

- One `fs.mkdtemp` temp dir per run; DB file `wal-contention.db` + `codebase.db` inside it. Never touches the real `storage/` DB.
- `src/mcp/storage/sqlite.ts` is bundled once with esbuild (`bundle:true, format:esm, platform:node, target:node22`, externals `better-sqlite3`, `proper-lockfile`) into the temp dir; each worker imports that bundle. Reason: worker threads do not inherit vitest's TS transform, so the REAL store source (not a reimplementation) is what each worker opens.
- N writer `worker_threads` each open their OWN SQLiteStore connection to the SAME file, then wait on a message barrier; the main thread releases all writers at once so transactions genuinely overlap.
- Each writer performs `OPS_PER_WRITER = 10` writes via `await store.withWrite(() => store.memories.bulkInsertMemories([entry]))`.
- Asserted: busy/locked error count == 0, other error count == 0, and every writer op succeeds (`latencies.length == N*10`). Latency (p50/p95) is RECORDED ONLY, never hard-asserted (timing is host-dependent).
- Default N=10; N=50 is opt-in via env `WAL_CONTENTION_LARGE=1`. Runtime: default ~4s (well under the 20s budget); N=50 ~16s.
- Stores are opened SERIALLY because concurrent first-opens race the non-atomic DROP+CREATE of derived FTS triggers in `src/mcp/storage/derived-db.ts:232` (`createDerivedTriggers`). This is a schema-init concern, not write contention, and is a documented pre-existing limitation (see below).

## Constants

| Constant                                   | Value                                                                       | Source                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `MEMORY_DB_BUSY_TIMEOUT_MS` (busy_timeout) | 30000 ms (env `MEMORY_DB_BUSY_TIMEOUT_MS`)                                  | `src/mcp/utils/constants.ts:593`, applied at `src/mcp/storage/sqlite.ts:122` |
| `SQLITE_WRITE_RETRY_ATTEMPTS`              | 3                                                                           | `src/mcp/utils/constants.ts:604`                                             |
| `SQLITE_WRITE_RETRY_BASE_MS`               | 25 ms                                                                       | `src/mcp/utils/constants.ts:608`                                             |
| `SQLITE_WRITE_RETRY_MAX_MS`                | 1000 ms                                                                     | `src/mcp/utils/constants.ts:610`                                             |
| Retry backoff formula                      | exponential `base * 2^(N-1)` capped, plus half-range jitter                 | `src/mcp/storage/base.ts:54-58` (`computeRetryBackoffMs`)                    |
| Retry wrapper                              | `runWithSqliteWriteRetry`                                                   | `src/mcp/storage/base.ts:79`                                                 |
| Transaction discipline                     | `BEGIN IMMEDIATE` via `this.db.transaction(fn).immediate`                   | `src/mcp/storage/base.ts:138-139`                                            |
| `journal_mode`                             | WAL                                                                         | `src/mcp/storage/sqlite.ts:104`                                              |
| `synchronous`                              | NORMAL                                                                      | `src/mcp/storage/sqlite.ts:112`                                              |
| `wal_autocheckpoint`                       | 1000                                                                        | `src/mcp/storage/sqlite.ts:127`                                              |
| Transient error set retried                | SQLITE_BUSY, SQLITE_BUSY_SNAPSHOT, SQLITE_LOCKED, SQLITE_LOCKED_SHAREDCACHE | `src/mcp/storage/base.ts:30-35`                                              |

## Tuning Recommendations

1. Keep `busy_timeout` at 30s for multi-process deployments (daemon + dashboard + client). At N=50 the worst observed single write was ~1.9s, well inside the window, so contention resolves invisibly. Lowering it (the old TASK-064 5s) risks surfacing SQLITE_BUSY at high fan-in for no gain.
2. The retry wrapper (3 attempts, 25ms base, 1s cap) is effectively a safety net: it never fired in any run because busy_timeout absorbed the contention first. No tuning needed at tested N; it is insurance against a writer that holds the lock past busy_timeout.
3. `wal_autocheckpoint = 1000` is appropriate: no checkpoint thrash was observed. If p95 at high N is a concern, the lever is reducing concurrent writer count per process (or consolidating writers into the HTTP daemon), not raising busy_timeout.
4. Run the perf test with `WAL_CONTENTION_LARGE=1` only on a quiet host; the N=50 p95/max are host-load sensitive and must not be used as a CI pass/fail gate (latency is recorded, not asserted).

## Pre-existing Limitation (not fixed here)

Concurrent FIRST-opens of the store on the same file can fail with `SqliteError: trigger codebase_symbols_ai already exists` (also `_au`) because `createDerivedTriggers` in `src/mcp/storage/derived-db.ts:232-236` does `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` as separate statements (not atomic). Reproduced ~2-3 failures per 50 concurrent opens across repeated trials; 0/20 in other trials. The perf test avoids it by opening stores serially. It is orthogonal to write contention and is tracked separately.

## How to run

```
npx vitest run src/mcp/tests/sqlite.wal-contention.perf.test.ts --project perf
WAL_CONTENTION_LARGE=1 npx vitest run src/mcp/tests/sqlite.wal-contention.perf.test.ts --project perf
```

## Environment

| Key               | Value                                    |
| ----------------- | ---------------------------------------- |
| commitSha         | 37cbc1493f115f60851215de9c3ad523fcc3a956 |
| branch            | main (test file untracked/new)           |
| node              | v24.16.0                                 |
| betterSqlite3     | 12.9.0                                   |
| sqliteVersion     | 3.53.0                                   |
| pageSize          | 4096                                     |
| journal_mode      | WAL                                      |
| synchronous       | NORMAL                                   |
| busyTimeoutMs     | 30000                                    |
| walAutocheckpoint | 1000                                     |
| isolatedTempDb    | yes                                      |
| date              | 2026-09-20                               |
