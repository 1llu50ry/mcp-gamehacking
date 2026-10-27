# Memory Module — Testing Overview

> Scope: `src/mcp/tools/memory.*.ts`, `src/mcp/storage/`, `src/mcp/services/memory*` · Storage: SQLite WAL + FTS5 (`unicode61`) + 384-dim vectors + KG · Canonical: [../../../testing.md](../../../testing.md)

## Strategy

Memory is the core persistence module — durable local-first storage combining FTS5 lexical search, an async embedding outbox queue (migration v9), and a knowledge-graph outbox. Testing prioritizes three invariants over UI rendering:

1. **Scoping correctness** — `((owner=? AND repo=?) OR is_global=1)` never leaks across owners. Every write is tagged with `(owner, repo)` from session context (`git remote`) and every read applies the scoping predicate. Global rows (`is_global=1`) in `coding_standards` are visible cross-repo; memories are strictly scoped.
2. **Search ranking** — hybrid 40/30/15/15 (FTS / vector / recency / importance) is deterministic under `VECTOR_CANDIDATE_CAP=100` / `VECTOR_MIN_CANDIDATES=10`. Ranking must be stable and explainable; candidate pool size is capped to bound latency.
3. **Eventual consistency** — embedding queue lease (`EMBEDDING_QUEUE_LEASE_MS=60000`), poll interval (`500ms`, backoff to `10000ms`), backfill caps (`2000` per start, `BACKFILL_MIN_QUEUE=500` skip), and non-empty backoff streak (`5`) interact without deadlock or silent loss. `MCP_RUNTIME_PROFILE` (`full` eager / `balanced` on-demand / `minimal` lexical-only) degrades gracefully.

Key risks: cross-owner leakage, FTS tokenization edge cases (`unicode61` + `*` prefix, mid-word substring NOT guaranteed — trigram deferred), embedding race conditions, migration-order data loss, unbounded candidate pools, and `action_log` WAL checkpoint stalls (`WAL_CHECKPOINT_INTERVAL_MS=10000`).

Objectives: (1) Prove owner isolation holds under concurrent writes. (2) Prove FTS + vector hybrid scoring converges after one poll interval. (3) Prove queue backfill respects caps under restart. (4) Prove WAL checkpoints do not deadlock readers. Every change ships its test in the same commit (review-blocking per `development-quality.md`).

## Pyramid

| Layer       | Marker                  | Focus                                                                                                          | Example                              | Share |
| :---------- | :---------------------- | :------------------------------------------------------------------------------------------------------------- | :----------------------------------- | :---- |
| Unit        | `*.test.ts`             | Pure logic: tokenization, query-tags (`src/mcp/utils/query-tags.ts`), vector scoring, backfill cap, pagination | `src/mcp/tests/memory.write.test.ts` | 70%   |
| Integration | `*.integration.test.ts` | Tool route → SQLite + FTS5 + queue: `memory-write` → `memory-read` via `createTestStore()`                     | FTS search round-trip                | 20%   |
| E2E         | `*.e2e.test.ts`         | Full agent flow: write → queue drain → hybrid search converges → acknowledge                                   | `src/mcp/tests/e2e.e2e.test.ts`      | 8%    |
| Perf        | `*.perf.test.ts`        | Candidate cap 100, FTS prefix scan, KG caps (`KG_MAX_GRAPH_EDGES=4000`)                                        | Vector pool timing                   | 2%    |

End-to-end tests set `vi.setConfig({ testTimeout: 90_000 })` for full-toolchain flows (see [../../../testing.md](../../../testing.md) §1.1). Perf asserts bounded timing or frame-constant reuse, not exact milliseconds. Ratio target emphasizes fast lexical unit coverage with a thin but mandatory convergence end-to-end layer — embeddings are offloaded and async, so at least one end-to-end test must poll until convergence before asserting semantic scores.

## Risk Register

| Risk                         | Likelihood | Impact   | Mitigation in tests                                                      |
| :--------------------------- | :--------- | :------- | :----------------------------------------------------------------------- |
| Cross-owner leakage          | Medium     | Critical | Matrix MEM-S-05: concurrent cross-owner writes, scoped reads             |
| FTS substring false positive | Medium     | Medium   | Prefix-only assertions (MEM-S-02), no mid-word guarantee                 |
| Embedding queue deadlock     | Low        | High     | Chaos MEM-S-15/16/17: concurrent writes, minimal profile, restart cap    |
| Migration data loss          | Low        | Critical | Store created via `createTestStore()` runs migrations; verify row counts |
| Unbounded candidate pool     | Low        | Medium   | Perf: assert `VECTOR_CANDIDATE_CAP=100` truncation                       |

## Fixtures

- **In-memory DB**: `createTestStore()` from `src/mcp/storage/sqlite.ts` — WAL mode, migrations auto-run in the `SQLiteStore` constructor (no `migrate` script). Tests NEVER touch `storage/memory.db` on disk. Migrations include FTS5 tables (`memories_fts`) and vector outbox tables.
- **Shared fixtures**: `src/mcp/tests/fixtures/` — subject-mirrored sub-paths (for example `fixtures/codebase-index/`). A fixture is checked-in and used by at least two tests; single-test fixtures are inline or adjacent to the test file.
- **Seeding**: Insert via `memory-write` tool helper; wait for queue drain before asserting semantic scores. Use fake timers (`vi.useFakeTimers()` + `vi.setSystemTime()`) or a poll helper — do not use arbitrary `sleep`. Respect `EMBEDDING_QUEUE_POLL_INTERVAL_MS=500` and lease expiry (`60000ms`).
- **Isolation**: Each test file gets a fresh store (`beforeAll` creates store; `afterAll` closes it). Per-test rows are fresh inserts or transaction-rolled-back. Pool is `forks` (required for `better-sqlite3` ESM compatibility). No shared mutable state across files.
- **Temp file system**: If disk is needed, use `fs.mkdtemp(os.tmpdir())` and clean in `afterAll`. Never write into `src/` or the repository working tree (verified pattern: `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`).
- **Runtime profiles**: `MCP_RUNTIME_PROFILE` (`full` eager / `balanced` on-demand / `minimal` lexical-only) controls semantic and index availability. Assert graceful lexical fallback when `minimal` — `memory-read` still returns FTS results even when vector worker is disabled.
- **Harness helpers**: Prefer small helpers `seedMemory()`, `drainEmbeddingQueue()` co-located with tests; keep them deterministic and reuse across files.

## Coverage

- **Floors**: `lines 70 / statements 70 / functions 70 / branches 60` — global, via `include: ["src/**/*.{ts,tsx}"]` with `provider: v8` (`vitest.config.ts`). Floors apply to every matched file regardless of scoped run shape.
- **Gated**: `coverage.enabled=false` until REFACTOR-TST-013; evaluate with `npm run test -- --coverage` (exits 1 below floor by design; artifacts still written to `coverage/coverage-final.json` + html and text reports). Until then, coverage failures are non-blocking.
- **Priority order**: (1) Search path (`memory-read` FTS + vector hybrid + `VECTOR_MIN_CANDIDATES` floor). (2) Scoping predicate (`((owner,repo) OR is_global)`). (3) Queue leases (lease expiry, `EMBEDDING_QUEUE_BACKFILL_CAP=2000`, `BACKFILL_MIN_QUEUE=500`, non-empty backoff streak `5`). (4) Pagination and recap mode (no `query`/`id`/`code`).
- **Running**: `bash scripts/copy-grammar-wasm.sh` → `npx vitest run src/mcp/tests/memory.write.test.ts` · `npm run test:unit` (`--project unit`) · `npm run test -- --coverage` · `npm run type-check` (`tsc` + `tsconfig.test.json` + `svelte-check`).
- **Inventory**: Server suites live in `src/mcp/tests/` mirroring `src/mcp/tools/`; 157 files total (unit 141 / integration 13 / end-to-end 2 / perf 1). See [../../../testing.md](../../../testing.md) §6–7 for partition and run recipes.

## Conventions

- Location: `src/mcp/tests/memory.*.test.ts` mirroring `src/mcp/tools/memory.*.ts`. One subject maps to one test file unless split by marker (unit and integration are separate files).
- Every function and route has at least one positive and one negative case (review-blocking per `development-quality.md` §1).
- No `snake_case` filenames; markers are suffixes (`*.integration.test.ts` etc.); `// @vitest-environment jsdom` only when DOM is touched — never for memory.
- Type-check gate: `npm run type-check` includes `tsconfig.test.json` + `svelte-check` — green tests do not imply type correctness after file splits (see [../../../testing.md](../../../testing.md) §8).
- Formatting: tabs, double quotes, `printWidth: 120` (Prettier). `allowScripts` allowlist is load-bearing for native modules `better-sqlite3` and `tree-sitter`.

## Execution

```bash
bash scripts/copy-grammar-wasm.sh
npx vitest run src/mcp/tests/memory.write.test.ts
npx vitest run src/mcp/tests/memory.read.test.ts
npm run test:unit
npm run test -- --coverage
npm run type-check
```

## Links

- Standard: [../../../testing.md](../../../testing.md) §1–9
- API: [../../api/memory/api-memory.md](../../api/memory/api-memory.md) · Tool definitions: `src/mcp/types/tool-definitions/memory.ts`
- Module: [../../modules/memory/overview.md](../../modules/memory/overview.md) · Manifest: [../../modules/manifest.md](../../modules/manifest.md)
- Database: `src/mcp/storage/sqlite.ts` · Constants: `src/mcp/utils/constants.ts`
- Query tags: `src/mcp/utils/query-tags.ts` · Operations: `src/mcp/services/memory*`
