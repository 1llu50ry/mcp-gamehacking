# Context Module — Testing Overview

> Scope: `src/mcp/tools/context*.ts` plus `src/mcp/tools/observation*.ts` plus `src/mcp/services/context*`, observations plus `agent-context` plus `synthesize` (MCP sampling) plus `repo-summarize` (`task_archive`, `importance=3`) · Canonical: [../../../testing.md](../../../testing.md)

## Strategy

Context compiles a queryable agent memory window from three sources: observations (`observation-read` and `observation-write`), durable recall (`agent-context` — memories plus tasks for an agent), and cross-agent synthesis (`synthesize` via MCP sampling). `repo-summarize` archives session signals as a `task_archive` memory (type `task_archive`, `importance=3`, `maxLength 200` per signal). Testing focuses on four concerns:

1. **Compilation correctness** — `agent-context` recall scoped by `agent`, `owner`, and `repo` plus `type_filter` plus `limit` (1–100, default 5) merges the right subset from `memories` plus `tasks` plus `coding_standards` plus `entities`.
2. **Token and entity budgeting** — `KG_CONTEXT_TEXT_TOKENS=40`, `KG_MAX_CONTEXT_ENTITIES=50`, `KG_MAX_GRAPH_EDGES=4000` bound the payload; overflow is truncated, not errored.
3. **Sampling fallbacks** — `synthesize` requires client sampling support (MCP sampling capability from the client handshake); without it, the tool returns `CAPABILITY_UNAVAILABLE` or degrades gracefully (no hang, no crash).
4. **Freshness and caps** — `repo-summarize` `signals` `minItems 1`, each `maxLength 200`; reuse telemetry retention `REUSE_TELEMETRY_RETENTION_DAYS=30` (1–365 bounded), `REUSE_TELEMETRY_MAX_ROWS=20000` when `ENABLE_REUSE_TELEMETRY=true`.

Key risks: unbounded context growth when observation volume is high, stale `repo-summarize` signals after merge, `synthesize` hang when sampling is unsupported or aborted mid-flight, and cross-repo leakage of observations. This is an aggregation module — its pyramid emphasizes unit budgeting logic with a thin but mandatory sampling integration layer.

## Risk Register

| Risk                               | Likelihood | Impact   | Mitigation in tests                                      |
| :--------------------------------- | :--------- | :------- | :------------------------------------------------------- |
| Unbounded context growth           | Medium     | High     | CTX-C-15: 200 observations plus `limit:100` → truncation |
| `synthesize` hang without sampling | Low        | High     | CTX-C-10, CTX-C-16: `CAPABILITY_UNAVAILABLE` or abort    |
| Stale `repo-summarize` signals     | Medium     | Medium   | CTX-C-03, CTX-C-07, CTX-C-08: archive and validation     |
| Cross-repo observation leakage     | Medium     | Critical | CTX-C-14: scoped query returns only matching repo        |
| Telemetry retention unbounded      | Low        | Medium   | `REUSE_TELEMETRY_MAX_ROWS=20000` cap                     |

## Pyramid

| Layer       | Marker                  | Focus                                                                                                                                | Example                                                         | Share |
| :---------- | :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- | :---- |
| Unit        | `*.test.ts`             | Token budgeting (`KG_CONTEXT_TEXT_TOKENS=40`), observation filter parsing, `repo-summarize` `signals` caps, telemetry retention math | `KG_CONTEXT_TEXT_TOKENS` limit helper, signal length guard      | 65%   |
| Integration | `*.integration.test.ts` | Tool route → store: `observation-write` → `observation-read` and `agent-context` → `repo-summarize` via `createTestStore()`          | `observation-write` → `agent-context` recall round-trip         | 25%   |
| E2E         | `*.e2e.test.ts`         | Full agent loop: write observations → `agent-context` → `synthesize` (sampling) → act                                                | Sampling-dependent synthesize end-to-end with graceful fallback | 8%    |
| Perf        | `*.perf.test.ts`        | Context compilation under many observations (hundreds) plus token budget eviction                                                    | `KG_MAX_CONTEXT_ENTITIES=50` plus token budget stress           | 2%    |

End-to-end tests prove the agent loop end-to-end; they mock MCP sampling for the positive path and assert `CAPABILITY_UNAVAILABLE` for the negative path. Perf asserts truncation under `KG_MAX_CONTEXT_ENTITIES` plus `KG_CONTEXT_TEXT_TOKENS`, not exact throughput. Unit layer covers guard logic; integration covers store recall.

## Fixtures

- **Store**: `createTestStore()` in-memory SQLite; tables `observations`, `memories`, `repo_summaries` (via `task_archive` memories), and reuse telemetry tables. No real `storage/memory.db` touch on disk. Migrations auto-run in constructor.
- **Seeding**: `observation-write{content, type, agent, owner, repo}` plus `memory-write` plus `repo-summarize{owner,repo,signals}`. Signals capped at `maxLength 200` each per Zod schema; `minItems 1` — empty array is rejected.
- **Sampling**: `synthesize` requires client sampling support (MCP sampling capability from the client handshake). Tests mock the MCP sampling interface for the positive path; the negative path asserts graceful `CAPABILITY_UNAVAILABLE` or fallback without crash.
- **Telemetry**: `ENABLE_REUSE_TELEMETRY` (default `true`), `REUSE_TELEMETRY_RETENTION_DAYS=30` (1–365 bounded), `REUSE_TELEMETRY_MAX_ROWS=20000` — tested via time-bounded hourly aggregates; use `vi.useFakeTimers()` for retention expiry.
- **Isolation**: Fresh store per test file (`beforeAll`); per-test rows are fresh inserts. Pool `forks` required for `better-sqlite3` ESM; default environment `node`. Temp file system via `fs.mkdtemp(os.tmpdir())` if disk needed, cleaned in `afterAll`.
- **Helpers**: Small helpers `seedObservation()`, `compileContext({agent, limit})` keep seeding deterministic and reuse safe.

## Coverage

- **Floors**: `lines 70 / statements 70 / functions 70 / branches 60` via `provider: v8` plus `include: ["src/**/*.{ts,tsx}"]` (`vitest.config.ts`). Floors apply to every matched file regardless of scoped run shape.
- **Gated**: `coverage.enabled=false` until REFACTOR-TST-013; evaluate with `npm run test -- --coverage` (exits 1 below floor by design; artifacts still written to `coverage/coverage-final.json` plus html and text reports). Until then, coverage failures are non-blocking.
- **Priority**: (1) Observation CRUD (`observation-write` → `observation-read`). (2) `agent-context` recall (`agent` plus `query` plus `type_filter` plus `limit`). (3) `repo-summarize` archive (`task_archive`, `importance=3`, signal caps). (4) `synthesize` sampling path with fallback.
- **Running**: `npx vitest run src/mcp/tests/context*.test.ts` · `npx vitest run src/mcp/tests/observation*.test.ts` · `npm run test:integration` (`--project integration`) · `npm run test -- --coverage`.
- **Inventory**: Server suites in `src/mcp/tests/` mirroring `src/mcp/tools/`; 157 files total (unit 141 / integration 13 / end-to-end 2 / perf 1). See [../../../testing.md](../../../testing.md) §6–7 for partition and run recipes.

## Conventions

- Paths: `src/mcp/tests/context*.test.ts` and `src/mcp/tests/observation*.test.ts` mirroring `src/mcp/tools/`. One subject maps to one file unless split by marker (unit and integration are separate files).
- Every function and route has at least one positive and one negative case (review-blocking per `development-quality.md` §1 and [../../../testing.md](../../../testing.md) §4.2).
- Filenames: `kebab-case` suffix taxonomy only (`*.test.ts` and `*.integration.test.ts` and `*.e2e.test.ts`). No `snake_case`, no `_test.ts`.
- Type gate: `npm run type-check` (`tsc` + `tsconfig.test.json` + `svelte-check`) before push — green tests do not imply type correctness after file splits.
- Formatting: tabs, double quotes, `printWidth: 120` (Prettier). `allowScripts` allowlist is load-bearing for native modules.

## Execution

```bash
bash scripts/copy-grammar-wasm.sh
npx vitest run src/mcp/tests/context*.test.ts
npx vitest run src/mcp/tests/observation*.test.ts
npm run test:integration
npm run test -- --coverage
npm run type-check
```

## Links

- Standard: [../../../testing.md](../../../testing.md) §1–9 · Global rules: `~/.agents/rules/test-architecture.md` plus `development-quality.md`
- API: [../../api/context/api-context.md](../../api/context/api-context.md) · Tool definitions: `src/mcp/types/tool-definitions/` (context)
- Module: [../../modules/context/context-compilation.md](../../modules/context/context-compilation.md) · Manifest: [../../modules/manifest.md](../../modules/manifest.md)
- Constants: `src/mcp/utils/constants.ts` (`KG_CONTEXT_*`, telemetry retention) · Store: `src/mcp/storage/sqlite.ts`
- Telemetry: `ENABLE_REUSE_TELEMETRY` plus `REUSE_TELEMETRY_RETENTION_DAYS=30` plus `REUSE_TELEMETRY_MAX_ROWS=20000`

## Changelog

| Date | Change |
| :--- | :----- |
| 2026-09-07 | Initial testing overview for context (compilation + sampling + caps) |
