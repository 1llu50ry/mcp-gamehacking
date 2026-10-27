# Analysis — Bench Results

Bench results: `*.md` + `*-results.json` pairs (codebase-index, concurrent-workload, daemon-lightness, embedding-queue, fts5-trigram, memory-write-search, midword-fallback). Raw `*-results.json` are git-tracked bench outputs; see `optimization/` for shipped designs.

- `codebase-index-bench.md` + `-results.json` — indexing throughput and incremental re-index
- `concurrent-workload-bench.md` + `-results.json` — concurrent write/search contention
- `daemon-lightness-bench.md` + `-results.json` — daemon CPU/threads/VmRSS/VmHWM + backfill across clean-startup, repeated-restart, write/read burst, idle, idle-eager (PERF-005 A/B) and engines-active (PERF-008)
- `embedding-queue-availability-bench.md` + `-results.json` — embedding queue availability
- `fts5-trigram-eval.md` + `-results.json` — FTS5 vs trigram evaluation
- `memory-write-search-bench.md` + `-results.json` — memory write → search latency
- `midword-fallback-bench.md` + `-results.json` — mid-word fallback search
- `context-reuse-telemetry.md` — context-reuse telemetry analysis
- `testing-gap-analysis.md` — testing coverage gaps

The PERF-008 deterministic gate (backfill idempotency, recall regression, DB accounting) lives in `src/mcp/tests/lightness.perf.test.ts` (project `perf`); the harness that produces the `daemon-lightness-bench.*` pair lives in `src/mcp/bench/` with the CLI at `scripts/bench/daemon-lightness-bench.ts` (`npm run bench:lightness`).

Also see `../optimization/` for optimization designs derived from these benches.
