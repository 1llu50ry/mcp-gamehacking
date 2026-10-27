# Daemon Lightness Benchmark: PERF-008

- Task: PERF-008 "Harness benchmark & verifikasi ringan + regression recall"
- Harness: `src/mcp/bench/` (launch + sampling + scenarios)
- CLI: `scripts/bench/daemon-lightness-bench.ts` (`npm run bench:lightness`)
- Perf test: `src/mcp/tests/lightness.perf.test.ts` (project `perf`)
- Node: v24.16.0 · linux/x64
- Lazy warmup (PERF-005): enabled
- Isolated temp DB per boot: yes (never touches `~/.config/local-memory-mcp/memory.db`)
- Date: 2026-09-21

## Summary

| Scenario | Boots | Peak CPU | Avg CPU | Peak threads | Peak VmRSS | Peak VmHWM | Peak VmSize | Backfilled | DB size | Freelist |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| clean-startup | 1 | 146.7% | 16.4% | 11 | 265.1 MiB | 265.1 MiB | 1758.5 MiB | 0 | 0.7 MiB | 30 |
| repeated-restart | 3 | 318.7% | 95.0% | 14 | 469.7 MiB | 469.7 MiB | 2080.7 MiB | 200 | 1.3 MiB | 0 |
| write-read-burst | 1 | 181.8% | 24.8% | 11 | 269.2 MiB | 269.2 MiB | 1760.7 MiB | 0 | 0.7 MiB | 13 |
| idle | 1 | 145.6% | 1.2% | 11 | 266.6 MiB | 267.4 MiB | 1759.5 MiB | 0 | 0.7 MiB | 30 |
| idle-eager | 1 | 148.0% | 1.7% | 14 | 371.6 MiB | 373.0 MiB | 2044.7 MiB | 0 | 0.7 MiB | 30 |
| engines-active | 1 | 170.0% | 20.4% | 11 | 300.8 MiB | 300.8 MiB | 10096.8 MiB | 0 | 0.7 MiB | 30 |

## Baseline distinction (read this before quoting a number)

The original PERF-001 claim of "2.6 GB RSS" was a **VmSize (virtual address space) misread**. VmSize counts
reserved-but-untouched mappings (the ONNX/ORT arena, the tree-sitter dylink linear memory) and runs an order
of magnitude above the resident set. The harness reports **VmRSS** and **VmHWM** as separate columns for exactly
this reason. Quote VmRSS/VmHWM, never VmSize, when describing daemon memory.

Recorded pre-optimization baseline (PERF-005, isolated temp DB, 12s settle):

- eager ONNX warmup: ~316.3 MB VmRSS idle
- lazy ONNX warmup: ~176.5 MB VmRSS idle (≈140 MB / 44% saved)
- live daemon plateau: ~550 MB VmRSS, ~612 MB VmHWM (VmSize 2.16 → 10.97 GB)
- startup backfill before PERF-003: thousands of rows re-embedded after any metadata `updated_at` bump
- startup backfill after PERF-003: 0 rows on an unchanged corpus

## PERF-005 A/B: lazy vs eager warmup (same idle window)

| Metric | idle (lazy) | idle-eager | Delta |
| --- | ---: | ---: | ---: |
| Peak VmRSS | 266.6 MiB | 371.6 MiB | +105.0 MiB (39%) |
| Peak VmHWM | 267.4 MiB | 373.0 MiB | 105.6 MiB |
| Peak threads | 11 | 14 | — |
| Average CPU | 1.2% | 1.7% | — |

The eager column is the pre-PERF-005 behavior (model loaded at startup); the lazy column is the shipped default. The RSS gap is the retainer PERF-005 removed.

## Function still active (capability states)

`GET /api/capabilities` exposes `RuntimeCapabilityRegistry.snapshot()`. A `ready` state means the engine actually loaded; a `degraded`/`failed` state after a PERF change means a feature was silently disabled. The harness reads it while each daemon is still alive.

- **clean-startup**: semantic=idle, indexing=idle, watcher=unavailable, maintenance=ready, dashboard=ready
- **repeated-restart**: semantic=idle, indexing=idle, watcher=unavailable, maintenance=ready, dashboard=ready
- **write-read-burst**: semantic=idle, indexing=idle, watcher=unavailable, maintenance=ready, dashboard=ready
- **idle**: semantic=idle, indexing=idle, watcher=unavailable, maintenance=ready, dashboard=ready
- **idle-eager**: semantic=ready, indexing=idle, watcher=unavailable, maintenance=ready, dashboard=ready
- **engines-active**: semantic=idle, indexing=ready, watcher=ready, maintenance=ready, dashboard=ready

## Scenario detail

### clean-startup

- Duration: 21483 ms · Boots: 1
- CPU: peak 146.7% · average 16.4% (one-core-relative)
- Threads: peak 11 · final 11 (PERF-002 caps the ORT pool)
- Memory: peak VmRSS 265.1 MiB · final VmRSS 265.1 MiB · peak VmHWM 265.1 MiB · peak VmSize 1758.5 MiB
- Backfilled rows: 0 (per boot: 0)
- DB: 0.7 MiB · pages 179 · freelist 30 (0.1 MiB)
- Capabilities: semantic=idle, indexing=idle, watcher=unavailable, maintenance=ready, dashboard=ready

### repeated-restart

- Duration: 55180 ms · Boots: 3
- CPU: peak 318.7% · average 95.0% (one-core-relative)
- Threads: peak 14 · final 7 (PERF-002 caps the ORT pool)
- Memory: peak VmRSS 469.7 MiB · final VmRSS 267.5 MiB · peak VmHWM 469.7 MiB · peak VmSize 2080.7 MiB
- Backfilled rows: 200 (per boot: 200, 0, 0)
- DB: 1.3 MiB · pages 340 · freelist 0 (0)
- Capabilities: semantic=idle, indexing=idle, watcher=unavailable, maintenance=ready, dashboard=ready
- Note: pre-seeded corpus: 200 memories (first boot backfills, later boots must enqueue 0)

### write-read-burst

- Duration: 14004 ms · Boots: 1
- CPU: peak 181.8% · average 24.8% (one-core-relative)
- Threads: peak 11 · final 11 (PERF-002 caps the ORT pool)
- Memory: peak VmRSS 269.2 MiB · final VmRSS 269.2 MiB · peak VmHWM 269.2 MiB · peak VmSize 1760.7 MiB
- Backfilled rows: 0 (per boot: 0)
- DB: 0.7 MiB · pages 179 · freelist 13 (0.1 MiB)
- Burst: 100 writes · 100 reads · 872 ms
- Capabilities: semantic=idle, indexing=idle, watcher=unavailable, maintenance=ready, dashboard=ready

### idle

- Duration: 305373 ms · Boots: 1
- CPU: peak 145.6% · average 1.2% (one-core-relative)
- Threads: peak 11 · final 11 (PERF-002 caps the ORT pool)
- Memory: peak VmRSS 266.6 MiB · final VmRSS 115.2 MiB · peak VmHWM 267.4 MiB · peak VmSize 1759.5 MiB
- Backfilled rows: 0 (per boot: 0)
- DB: 0.7 MiB · pages 179 · freelist 30 (0.1 MiB)
- Capabilities: semantic=idle, indexing=idle, watcher=unavailable, maintenance=ready, dashboard=ready

### idle-eager

- Duration: 307226 ms · Boots: 1
- CPU: peak 148.0% · average 1.7% (one-core-relative)
- Threads: peak 14 · final 14 (PERF-002 caps the ORT pool)
- Memory: peak VmRSS 371.6 MiB · final VmRSS 124.2 MiB · peak VmHWM 373.0 MiB · peak VmSize 2044.7 MiB
- Backfilled rows: 0 (per boot: 0)
- DB: 0.7 MiB · pages 179 · freelist 30 (0.1 MiB)
- Capabilities: semantic=ready, indexing=idle, watcher=unavailable, maintenance=ready, dashboard=ready

### engines-active

- Duration: 21409 ms · Boots: 1
- CPU: peak 170.0% · average 20.4% (one-core-relative)
- Threads: peak 11 · final 11 (PERF-002 caps the ORT pool)
- Memory: peak VmRSS 300.8 MiB · final VmRSS 300.8 MiB · peak VmHWM 300.8 MiB · peak VmSize 10096.8 MiB
- Backfilled rows: 0 (per boot: 0)
- DB: 0.7 MiB · pages 179 · freelist 30 (0.1 MiB)
- Capabilities: semantic=idle, indexing=ready, watcher=ready, maintenance=ready, dashboard=ready
- Note: proactive engines enabled against a fixture project; capability states are the evidence

## Method

- The combined daemon is bundled from source with esbuild (the same `createRequire` banner `tsup.config.ts` uses) and launched on an ephemeral port; `dist/` is not required.
- Each boot runs with `MEMORY_DB_PATH` + `LOCAL_MEMORY_DAEMON_DIR` pointing at a fresh `fs.mkdtemp` dir, `MCP_RUNTIME_PROFILE=full`, `CODEBASE_AUTO_INDEX=false`, `ENABLE_FILE_WATCHER=false` (the `engines-active` scenario boots them against a fixture project instead).
- CPU is derived from `/proc/<pid>/stat` (utime+stime deltas, `USER_HZ=100`); threads from `/proc/<pid>/task`; memory from `/proc/<pid>/status`.
- Wall-clock, CPU and RSS are RECORDED, not asserted. The deterministic gates live in `src/mcp/tests/lightness.perf.test.ts`.

## How to run

```bash
npm run bench:lightness                      # full pass (5-minute idle)
LIGHTNESS_CI=1 npm run bench:lightness       # short CI pass
LIGHTNESS_SCENARIOS=idle,idle-eager npm run bench:lightness   # PERF-005 A/B only
LIGHTNESS_SCENARIOS=engines-active npm run bench:lightness   # prove indexing/watcher activate
npm run test:perf                            # the deterministic perf gates
```
