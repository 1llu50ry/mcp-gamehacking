# Mid-Word Fallback Benchmark — TASK-483

- Task: TASK-483
- Seed: 1155
- Commit: 0c7d4e832eaad95a2119109107ecfdc1d7502263
- Branch: main (dirty=true)
- Date: 2026-08-22T18:49:08.327Z
- Node: v24.18.0
- SQLite: 3.53.0 (page 4096B)
- better-sqlite3: 12.9.0
- Corpus rows: 8000
- Iterations (latency): 200
- Revision manifest sha256: `21669902d2d780d3a82b8cb43745306c9754ea7a9e6712905a8c8d0998e7f577`

## Configuration (safety bounds)

| Bound | Value |
| --- | ---: |
| maxRows (rows scanned cap) | 3000 |
| timeoutMs (hard timeout) | 25 |
| maxResults (result set cap) | 50 |
| minQueryLen | 2 |
| fallbackMinResults (gate) | 1 |

## Recall by class

| Class | Queries | Oracle rows | Baseline @50 | Combined @50 | Improvement @50 | Recovery (full) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| short | 10 | 29032 | 100.0% | 100.0% | 0.0% | 8.9% |
| midword | 10 | 41471 | 20.0% | 100.0% | 80.0% | 2.2% |
| OVERALL | 20 | 70503 | 60.0% | 100.0% | 40.0% | 5.5% |

## Added latency (fallback, triggered queries only)

- p50 / p95 / p99 (ms): 0.045 / 0.115 / 0.380
- mean: 0.097 ms · samples: 1600 · triggeredQueries: 8

## Safety bounds

| Metric | Observed max | Cap | Held |
| --- | ---: | ---: | --- |
| rows scanned | 294 | 3000 | true |
| elapsed (ms) | 25.000 | 25 | true |
| result count | 50 | 50 | true |

- Violations: 0
- All bounds held: true
- Row cap exercised: true · Result cap exercised: true · Timeout exercised: true

## Per-query detail

| Class | Query | Oracle | Base@50 | Comb@50 | Triggered | Scanned | Elapsed(ms) | Results | Bounds |
| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| short | vec | 3379 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| short | mem | 8000 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| short | tok | 2541 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| short | ind | 3792 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| short | cac | 2476 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| short | sql | 2379 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| short | opt | 1366 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| short | ser | 1359 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| short | nor | 1887 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| short | sea | 1853 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| midword | tor | 3845 | 0.0% | 100.0% | true | 94 | 1.015 | 50 | true |
| midword | ory | 8000 | 0.0% | 100.0% | true | 50 | 0.313 | 50 | true |
| midword | dex | 3792 | 0.0% | 100.0% | true | 86 | 25.000 | 50 | true |
| midword | zer | 1320 | 0.0% | 100.0% | true | 294 | 3.058 | 50 | true |
| midword | lit | 2462 | 0.0% | 100.0% | true | 124 | 9.431 | 50 | true |
| midword | ize | 1846 | 0.0% | 100.0% | true | 212 | 0.307 | 50 | true |
| midword | ken | 3459 | 0.0% | 100.0% | true | 107 | 1.369 | 50 | true |
| midword | to | 5226 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| midword | ex | 5307 | 100.0% | 100.0% | false | 0 | 0.000 | 0 | true |
| midword | iz | 6214 | 0.0% | 100.0% | true | 70 | 0.093 | 50 | true |

## Revision manifest

```
05d365ba431cafa9ed926abd387f7d3aaf62f0be  scripts/bench/midword-eval/corpus.mjs
096995b03ea26b2c1c50ed45fd9ef213fcaeb3eb  scripts/bench/midword-eval/fallback.mjs
361ffe1cbd66bc9553497126d63f046e5e83e50c  scripts/bench/midword-eval/lifecycle.mjs
364c60baa26a5c4ec70685c326b17cb4a5531109  scripts/bench/midword-eval/metrics.mjs
dd565c526c719e42ebb4d9c67520620ade252a3b  scripts/bench/midword-eval/queries.mjs
9a13cf5aa09343752a1590ecd555e7fe5b52b060  scripts/bench/midword-eval/report.mjs
2cd4135b3d496d7b0a43784a8564e829d88e5751  scripts/bench/midword-fallback-bench.mjs
```
