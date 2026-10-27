# Codebase-Index Module — Testing Overview

> Scope: `src/mcp/codebase-index/`, `src/mcp/tools/codebase*.ts`, tree-sitter WASM (`dist/grammars/*.wasm`) plus process-shared content-grep cache · Canonical: [../../../testing.md](../../../testing.md)

## Strategy

Codebase-index is a tree-sitter scan over a repository working tree into SQLite tables `codebase_*` (inside the main DB, WAL mode) plus a process-shared content-grep cache (`CODE_SEARCH_CACHE_MAX_BYTES=16777216`, `MAX_FILES=256`, `MAX_REGEX_LENGTH=200`). After indexing, `codebase-read` exposes 5 mutually exclusive modes: `query` (natural-language and symbol hybrid), `name` (trace definition plus references), `filePath` (file symbols), `content` (grep indexed file contents), and architecture (no params or `depth` 1–5), plus `codebase-index` status mode (freshness plus count).

The index lifecycle uses two entry points: `codebase-index{repoPath,repo}` triggers a scan (tree-sitter, `DEFAULT_BATCH_SIZE=100` rows per transaction, `CODEBASE_INDEX_PARSE_TIMEOUT_MS=10000` per file, `CODEBASE_INDEX_WORKERS=4`), while `codebase-index{repo}` alone returns status (freshness, symbol count, staleness with `INDEX_STALENESS_TTL_MS=30000`). File watcher (`ENABLE_FILE_WATCHER`, `FILE_WATCH_INTERVAL_MS=30000`, `FILE_WATCH_TTL_MS=300000` debounce) and auto-index TTL (`CODEBASE_AUTO_INDEX_TTL=86400000`) govern freshness outside tests.

Key risks: WASM load failure when `dist/grammars/*.wasm` is absent, per-file parse timeout, worker concurrency exhaustion, cache bounds (`FILE_CONTENT_MAX_LINES=2000`, `CODE_GRAPH_MAX_EDGES=400`) bypass, and stale-index serving when the file watcher is disabled. `MCP_RUNTIME_PROFILE` (`full` eager / `balanced` on-demand / `minimal` lexical-core only) controls startup; `CODEBASE_REPOS_DIR` is dashboard-only and MCP server indexes only its CWD.

Testing focuses on parse correctness, language detection, cache bounds, staleness and index-status logic, and exclusion and inclusion glob handling — not on grammar completeness (grammars are prebuilt WASM).

## Risk Register

| Risk                       | Likelihood | Impact   | Mitigation in tests                                      |
| :------------------------- | :--------- | :------- | :------------------------------------------------------- |
| WASM missing, scan crashes | Medium     | High     | Precondition: `copy-grammar-wasm.sh`; CBS-S-09 staleness |
| Per-file parse hang        | Low        | High     | `PARSE_TIMEOUT_MS=10000` guard; CBS-S-14 ReDoS path      |
| Stale index served         | Medium     | Medium   | Status mode `stale` flag; CBS-S-07 vs CBS-S-09           |
| Cache bound bypass         | Low        | Medium   | CBS-S-11 `MAX_REGEX_LENGTH=200`; caps table              |
| Path traversal read        | Low        | Critical | CBS-S-13 traversal blocked within `repoPath`             |

## Pyramid

| Layer       | Marker                  | Focus                                                                                                                                       | Example                                                         | Share |
| :---------- | :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------- | :---- |
| Unit        | `*.test.ts`             | Query-tag extraction (`src/mcp/utils/query-tags.ts`), glob filtering, pagination helper, timeout guard, `depth` validation                  | `src/mcp/tests/utils/query-tags.test.ts`                        | 60%   |
| Integration | `*.integration.test.ts` | `codebase-index(repoPath+repo)` scan → `codebase-read{query, name, filePath, content}` plus architecture and status via `createTestStore()` | `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`    | 28%   |
| E2E         | `*.e2e.test.ts`         | Full repository scan → trace symbol across files → grep content → architecture `depth` traversal                                            | Multi-file trace plus content-grep plus architecture end-to-end | 8%    |
| Perf        | `*.perf.test.ts`        | Parse concurrency (`CODEBASE_INDEX_WORKERS=4`), cache bytes and files caps, `CODE_GRAPH_MAX_EDGES=400`                                      | Worker slot plus `CODE_SEARCH_CACHE` eviction timing            | 4%    |

Perf asserts eviction and truncation correctness and bounded timing, not exact milliseconds. End-to-end sets `vi.setConfig({ testTimeout: 90_000 })` for full-toolchain flows. Ratio target weights unit coverage for cache bounds and guard logic with a thin but mandatory scan-plus-mode integration layer.

## Fixtures

- **Shared fixture tree**: `src/mcp/tests/fixtures/codebase-index/search-test-fixture/` — subject-mirrored, checked-in, used by at least two tests (two-or-more-fixture rule). This is the canonical repository-indexer fixture (see [../../../testing.md](../../../testing.md) §5).
- **Temp repos**: For scan tests that need writes, create with `fs.mkdtemp(os.tmpdir())`; write files into the temp dir, run `codebase-index{repoPath,repo}`, assert. Clean the temp dir in `afterAll`. Never write into `src/` or the repository working tree.
- **Store**: `createTestStore()` in-memory SQLite; `codebase_*` tables live inside the same DB as tasks and memories (no separate file). Migrations auto-run in constructor; no `migrate` script.
- **WASM pre-requisite**: `bash scripts/copy-grammar-wasm.sh` before any scan test so `dist/grammars/*.wasm` exists (dart, kotlin, and swift need network to compile; vue needs `npm pack`). Without this step, every parse test fails at WASM load.
- **Environment**: `MCP_RUNTIME_PROFILE` controls index and watcher startup: `full` eager, `balanced` on-demand, `minimal` lexical-core only. Legacy flags `CODEBASE_AUTO_INDEX` and `ENABLE_FILE_WATCHER` still override the `full` profile.
- **Isolation**: Fresh store per test file; `forks` pool required for `better-sqlite3` ESM; no shared mutable state across files; close store in `afterAll`.

## Coverage

- **Floors**: `lines 70 / statements 70 / functions 70 / branches 60` via `provider: v8` plus `include: ["src/**/*.{ts,tsx}"]` (`vitest.config.ts`). Floors apply to every matched file regardless of scoped run shape.
- **Gated**: `coverage.enabled=false` until REFACTOR-TST-013; evaluate with `npm run test -- --coverage` (exits 1 below floor by design; artifacts still written to `coverage/coverage-final.json` + html and text reports). Until then, coverage failures are non-blocking.
- **Priority**: (1) Scan (`codebase-index` with `repoPath` plus `repo`, batch size 100). (2) 5 search modes (`query`, `name`, `filePath`, `content`, architecture) plus status and staleness (`INDEX_STALENESS_TTL_MS=30000`). (3) Cache bounds (`MAX_BYTES=16777216`, `MAX_FILES=256`, `MAX_REGEX_LENGTH=200`, `FILE_CONTENT_MAX_LINES=2000`, `CODE_GRAPH_MAX_EDGES=400`). (4) Timeout plus watcher TTL.
- **Running**: `bash scripts/copy-grammar-wasm.sh` → `npx vitest run src/mcp/tests/codebase-index` · `npx vitest run src/mcp/tests/codebase-index/mcp-tools.integration.test.ts` · `npm run test:integration` · `npm run test -- --coverage`.
- **Inventory**: Server suites in `src/mcp/tests/` mirroring `src/mcp/tools/`; 157 files total (unit 141 / integration 13 / end-to-end 2 / perf 1). See [../../../testing.md](../../../testing.md) §6–7 for partition and run recipes.

## Conventions

- Paths: `src/mcp/tests/codebase-index/**` mirroring `src/mcp/codebase-index/**` and `src/mcp/tools/codebase*.ts`. One subject maps to one file unless split by marker (unit and integration are separate files).
- Every function and route has at least one positive and one negative case (review-blocking per `development-quality.md` §1).
- Filenames: `kebab-case` suffix taxonomy only; no `snake_case`, no `_test.ts` or `_spec.ts`. `// @vitest-environment jsdom` only when DOM is touched — not for codebase-index.
- Type-check gate: `npm run type-check` (`tsc` + `tsconfig.test.json` + `svelte-check`) must pass — green tests do not imply type correctness after file splits (see [../../../testing.md](../../../testing.md) §8).
- Formatting: tabs, double quotes, `printWidth: 120` (Prettier). `allowScripts` allowlist is load-bearing.

## Execution

```bash
bash scripts/copy-grammar-wasm.sh
npx vitest run src/mcp/tests/codebase-index
npx vitest run src/mcp/tests/codebase-index/mcp-tools.integration.test.ts
npm run test:integration
npm run test -- --coverage
npm run type-check
```

## Links

- Standard: [../../../testing.md](../../../testing.md) §1–9 · Global rules: `~/.agents/rules/test-architecture.md` + `development-quality.md`
- API: [../../api/codebase-index/api-codebase.md](../../api/codebase-index/api-codebase.md) · Tool definitions: `src/mcp/types/tool-definitions/` (codebase-index)
- Module: [../../modules/codebase-index/overview.md](../../modules/codebase-index/overview.md) · Manifest: [../../modules/manifest.md](../../modules/manifest.md)
- Operations: `operations/codebase-index.md` · Constants: `src/mcp/utils/constants.ts`
- Grammars: `scripts/copy-grammar-wasm.sh` → `dist/grammars/*.wasm`

## Changelog

| Date | Change |
| :--- | :----- |
| 2026-09-07 | Initial testing overview for codebase-index (WASM + cache + modes) |
