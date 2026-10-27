# Memory Write+Search Benchmark — TASK-478

- Task: TASK-478
- Seed: 0x478
- Commit: 335c5857c0eef95ac1b94166f57f5443cb5862f8
- Bench revision: 30e44ec98d920334a3737ea294794d1414ce3f96
a92b0fdf1422e3d20d2bdb7fc35bd6dc39981026
273d5a8172df9fc39080727cd04e5f4ce5721e90
a92c12e16cf83f83b46c27f4047a6b5e07e2ee0e
d0fdffd353cc518a4a840dbcbb847981b07cdd19
- Branch: main (dirty)
- Node: v24.18.0
- better-sqlite3: 12.9.0
- SQLite: 3.53.0
- Page size: 4096
- Owner/Repo: bench / bench-repo
- Bench epoch: 2026-01-01T00:00:00.000Z
- Scales: 1000, 10000, 100000
- Iterations: 30
- Vector backend: persisted TF cosine (memory_vectors, no ONNX)
- Vector candidate cap: 100 (min 10)
- Date: 2026-08-22T11:47:04.269Z

## Write Latency (per insert)

| Scale | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Throughput | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | 0.119 | 0.568 | 13.938 | 0.465 | 2068.2 ops/s | 0/1000 |
| 10000 | 0.104 | 0.298 | 0.645 | 0.160 | 5875.6 ops/s | 0/10000 |
| 100000 | 0.153 | 0.393 | 0.805 | 0.210 | 4501.7 ops/s | 0/100000 |

## Search Latency (per query)

| Scale | Mode | p50 (ms) | p95 (ms) | p99 (ms) | Throughput | Errors | Zero | Avg results |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | fts | 0.923 | 6.655 | 22.962 | 533.5 ops/s | 0/720 | 210 | 7.1 |
| 1000 | semantic | 1.023 | 2.870 | 7.108 | 703.6 ops/s | 0/720 | 360 | 1.8 |
| 1000 | hybrid | 9.606 | 25.750 | 45.665 | 84.6 ops/s | 0/720 | 240 | 3.9 |
| 10000 | fts | 4.324 | 19.656 | 34.510 | 169.3 ops/s | 0/720 | 210 | 7.1 |
| 10000 | semantic | 6.471 | 8.829 | 15.558 | 145.8 ops/s | 0/720 | 360 | 2.5 |
| 10000 | hybrid | 24.165 | 61.233 | 74.648 | 36.6 ops/s | 0/720 | 210 | 4.6 |
| 100000 | fts | 51.924 | 199.691 | 289.413 | 16.2 ops/s | 0/720 | 210 | 7.1 |
| 100000 | semantic | 63.829 | 88.819 | 126.023 | 14.8 ops/s | 0/720 | 360 | 2.3 |
| 100000 | hybrid | 181.364 | 492.304 | 624.950 | 5.0 ops/s | 0/720 | 210 | 5.9 |

## Query Breakdown (hybrid, per-kind)

| Scale | Kind | Query | p50 (ms) | p95 (ms) | Avg results | Errors | Zero |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1000 | empty | `(empty)` | 5.326 | 13.167 | 0.0 | 0 | 20 |
| 1000 | empty | `   ` | 4.488 | 8.225 | 0.0 | 0 | 20 |
| 1000 | short | `go` | 8.337 | 20.803 | 10.0 | 0 | 0 |
| 1000 | short | `ui` | 10.866 | 19.051 | 10.0 | 0 | 0 |
| 1000 | short | `id` | 8.601 | 15.972 | 6.0 | 0 | 0 |
| 1000 | short | `e` | 9.543 | 17.736 | 2.0 | 0 | 0 |
| 1000 | short | `AI` | 6.073 | 7.946 | 0.0 | 0 | 20 |
| 1000 | normal | `vector` | 16.743 | 35.371 | 10.0 | 0 | 0 |
| 1000 | normal | `memory` | 19.733 | 39.604 | 5.0 | 0 | 0 |
| 1000 | normal | `sqlite` | 11.122 | 45.500 | 3.0 | 0 | 0 |
| 1000 | normal | `cache` | 12.020 | 177.291 | 7.0 | 0 | 0 |
| 1000 | normal | `search index` | 9.559 | 20.936 | 5.0 | 0 | 0 |
| 1000 | long | `vector embedding semantic search hybrid scoring ` | 9.182 | 15.787 | 0.0 | 0 | 20 |
| 1000 | long | `workspace memory is indexed for fast semantic se` | 14.564 | 28.745 | 5.0 | 0 | 0 |
| 1000 | high-result | `memory` | 18.238 | 81.597 | 5.0 | 0 | 0 |
| 1000 | high-result | `vector` | 12.859 | 23.321 | 10.0 | 0 | 0 |
| 1000 | high-result | `search` | 9.625 | 22.006 | 1.0 | 0 | 0 |
| 1000 | no-result | `zz_nonexistent_token_xyz_999` | 4.889 | 9.284 | 0.0 | 0 | 20 |
| 1000 | no-result | `qqq_zzz_no_match_12345` | 6.989 | 7.608 | 0.0 | 0 | 20 |
| 1000 | phrase | `"semantic search"` | 8.735 | 26.955 | 7.0 | 0 | 0 |
| 1000 | cjk | `记忆` | 7.321 | 12.476 | 3.0 | 0 | 0 |
| 1000 | cjk | `向量` | 4.940 | 11.219 | 0.0 | 0 | 20 |
| 1000 | special | `data-pipeline` | 8.745 | 19.569 | 0.0 | 0 | 20 |
| 1000 | special | `better-sqlite3` | 7.283 | 21.934 | 5.0 | 0 | 0 |
| 10000 | empty | `(empty)` | 11.446 | 18.221 | 0.0 | 0 | 20 |
| 10000 | empty | `   ` | 10.475 | 18.857 | 0.0 | 0 | 20 |
| 10000 | short | `go` | 25.308 | 149.941 | 10.0 | 0 | 0 |
| 10000 | short | `ui` | 34.962 | 77.300 | 10.0 | 0 | 0 |
| 10000 | short | `id` | 23.974 | 44.197 | 10.0 | 0 | 0 |
| 10000 | short | `e` | 27.193 | 36.965 | 4.0 | 0 | 0 |
| 10000 | short | `AI` | 10.800 | 31.427 | 0.0 | 0 | 20 |
| 10000 | normal | `vector` | 36.238 | 68.465 | 10.0 | 0 | 0 |
| 10000 | normal | `memory` | 66.390 | 116.999 | 3.0 | 0 | 0 |
| 10000 | normal | `sqlite` | 29.824 | 42.344 | 4.0 | 0 | 0 |
| 10000 | normal | `cache` | 34.156 | 50.085 | 10.0 | 0 | 0 |
| 10000 | normal | `search index` | 25.008 | 82.274 | 2.0 | 0 | 0 |
| 10000 | long | `vector embedding semantic search hybrid scoring ` | 15.183 | 43.209 | 0.0 | 0 | 20 |
| 10000 | long | `workspace memory is indexed for fast semantic se` | 33.939 | 57.453 | 6.0 | 0 | 0 |
| 10000 | high-result | `memory` | 60.227 | 208.878 | 3.0 | 0 | 0 |
| 10000 | high-result | `vector` | 38.033 | 70.653 | 10.0 | 0 | 0 |
| 10000 | high-result | `search` | 27.372 | 38.990 | 6.0 | 0 | 0 |
| 10000 | no-result | `zz_nonexistent_token_xyz_999` | 10.781 | 20.282 | 0.0 | 0 | 20 |
| 10000 | no-result | `qqq_zzz_no_match_12345` | 10.918 | 15.615 | 0.0 | 0 | 20 |
| 10000 | phrase | `"semantic search"` | 17.679 | 74.827 | 10.0 | 0 | 0 |
| 10000 | cjk | `记忆` | 28.727 | 122.127 | 10.0 | 0 | 0 |
| 10000 | cjk | `向量` | 14.833 | 212.900 | 0.0 | 0 | 20 |
| 10000 | special | `data-pipeline` | 23.200 | 58.876 | 1.0 | 0 | 0 |
| 10000 | special | `better-sqlite3` | 15.511 | 37.862 | 1.0 | 0 | 0 |
| 100000 | empty | `(empty)` | 74.919 | 90.533 | 0.0 | 0 | 20 |
| 100000 | empty | `   ` | 75.062 | 190.248 | 0.0 | 0 | 20 |
| 100000 | short | `go` | 221.320 | 284.963 | 10.0 | 0 | 0 |
| 100000 | short | `ui` | 225.926 | 406.615 | 10.0 | 0 | 0 |
| 100000 | short | `id` | 198.830 | 248.146 | 10.0 | 0 | 0 |
| 100000 | short | `e` | 274.596 | 404.687 | 10.0 | 0 | 0 |
| 100000 | short | `AI` | 75.521 | 161.454 | 0.0 | 0 | 20 |
| 100000 | normal | `vector` | 301.702 | 372.951 | 10.0 | 0 | 0 |
| 100000 | normal | `memory` | 507.147 | 1538.695 | 8.0 | 0 | 0 |
| 100000 | normal | `sqlite` | 265.993 | 365.687 | 6.0 | 0 | 0 |
| 100000 | normal | `cache` | 260.624 | 297.797 | 10.0 | 0 | 0 |
| 100000 | normal | `search index` | 190.153 | 343.498 | 2.0 | 0 | 0 |
| 100000 | long | `vector embedding semantic search hybrid scoring ` | 86.009 | 113.132 | 0.0 | 0 | 20 |
| 100000 | long | `workspace memory is indexed for fast semantic se` | 204.168 | 323.846 | 4.0 | 0 | 0 |
| 100000 | high-result | `memory` | 466.079 | 623.738 | 8.0 | 0 | 0 |
| 100000 | high-result | `vector` | 294.144 | 387.434 | 10.0 | 0 | 0 |
| 100000 | high-result | `search` | 243.996 | 304.440 | 10.0 | 0 | 0 |
| 100000 | no-result | `zz_nonexistent_token_xyz_999` | 77.837 | 90.855 | 0.0 | 0 | 20 |
| 100000 | no-result | `qqq_zzz_no_match_12345` | 76.491 | 100.000 | 0.0 | 0 | 20 |
| 100000 | phrase | `"semantic search"` | 101.511 | 158.938 | 10.0 | 0 | 0 |
| 100000 | cjk | `记忆` | 193.621 | 231.768 | 10.0 | 0 | 0 |
| 100000 | cjk | `向量` | 76.932 | 104.188 | 0.0 | 0 | 20 |
| 100000 | special | `data-pipeline` | 117.291 | 161.754 | 3.0 | 0 | 0 |
| 100000 | special | `better-sqlite3` | 112.508 | 163.354 | 10.0 | 0 | 0 |

## Isolation & Relevance

| Scale | Isolation | No-result violations | Empty positive |
| --- | --- | ---: | ---: |
| 1000 | PASS | 0 | 0 |
| 10000 | PASS | 0 | 0 |
| 100000 | PASS | 0 | 0 |

### Isolation probes

| Scale | Query | Probe tenant | FTS isolated | Semantic isolated |
| --- | --- | --- | --- | --- |
| 1000 | `vector` | bench-foreign/bench-foreign-repo | yes | yes |
| 1000 | `memory` | bench-foreign/bench-foreign-repo | yes | yes |
| 1000 | `cache` | bench-foreign/bench-foreign-repo | yes | yes |
| 10000 | `vector` | bench-foreign/bench-foreign-repo | yes | yes |
| 10000 | `memory` | bench-foreign/bench-foreign-repo | yes | yes |
| 10000 | `cache` | bench-foreign/bench-foreign-repo | yes | yes |
| 100000 | `vector` | bench-foreign/bench-foreign-repo | yes | yes |
| 100000 | `memory` | bench-foreign/bench-foreign-repo | yes | yes |
| 100000 | `cache` | bench-foreign/bench-foreign-repo | yes | yes |

### Vector / determinism metadata

| Scale | Candidate cap | Persisted | Zero fallback | Hybrid threshold | Epoch |
| --- | ---: | --- | --- | ---: | --- |
| 1000 | 100 | yes | null | 0.4 | 2026-01-01T00:00:00.000Z |
| 10000 | 100 | yes | null | 0.4 | 2026-01-01T00:00:00.000Z |
| 100000 | 100 | yes | null | 0.4 | 2026-01-01T00:00:00.000Z |

## Environment

| Key | Value |
| --- | --- |
| commitSha | 335c5857c0eef95ac1b94166f57f5443cb5862f8 |
| node | v24.18.0 |
| better-sqlite3 | 12.9.0 |
| sqliteVersion | 3.53.0 |
| pageSize | 4096 |
| heapUsed (last scale) | 245714528 |
| dbBytes (last scale) | 117231616 |

