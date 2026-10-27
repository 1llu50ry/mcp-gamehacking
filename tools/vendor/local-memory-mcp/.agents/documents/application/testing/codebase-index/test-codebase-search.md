# Codebase Search — Test Scenarios

> Module: `codebase-index` · Tools: `codebase-index` (index plus status), `codebase-read` (5 modes plus status) · Store: `src/mcp/storage/sqlite.ts` tables `codebase_*` · WASM: `dist/grammars/*.wasm` · Contract: `src/mcp/prompts/server/instructions.md`

## Preconditions

- `bash scripts/copy-grammar-wasm.sh` before any scan test so `dist/grammars/*.wasm` exists (required — without it every parse test fails at WASM load). Fixture: `src/mcp/tests/fixtures/codebase-index/search-test-fixture/` (shared, checked-in, subject-mirrored).
- Store: `createTestStore()` in-memory SQLite; `codebase_*` tables live inside the same DB as tasks and memories. Temp repos via `fs.mkdtemp(os.tmpdir())` cleaned in `afterAll`; never write into `src/`.
- Pool: `forks` (required for `better-sqlite3` ESM). Auto-infer: `codebase-read` modes are mutually exclusive (`query` vs `name` vs `filePath` vs `content` vs none → architecture). `depth` only applies inside architecture mode (1–5). `codebase-index{repoPath,repo}` is index (tree-sitter scan); `{repo}` alone is status (freshness plus count).
- Cache: process-shared content-grep cache `CODE_SEARCH_CACHE_MAX_BYTES=16777216`, `MAX_FILES=256`, `MAX_REGEX_LENGTH=200`; `FILE_CONTENT_MAX_LINES=2000`; `CODE_GRAPH_MAX_EDGES=400`.
- Timeouts: `CODEBASE_INDEX_PARSE_TIMEOUT_MS=10000` per file; workers `CODEBASE_INDEX_WORKERS=4` (legacy alias `CODEBASE_INDEX_PARSE_CONCURRENCY`); staleness cache `INDEX_STALENESS_TTL_MS=30000`.

## Matrix

| ID       | Scenario                                 | Input                                                                                                   | Expected                                                                                                                            | Type     |
| :------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------- | :------- |
| CBS-S-01 | Index repo then search symbols           | `codebase-index{repoPath:"/tmp/repo-a",repo:"repo-a"}` then `codebase-read{query:"auth",repo:"repo-a"}` | Scan returns `{files, symbols}` counts; search returns symbols with `filePath`, `kind`, `language`, `exportedOnly` honored          | positive |
| CBS-S-02 | Trace symbol definition plus references  | `codebase-read{name:"authenticate",repo:"repo-a"}`                                                      | Returns definition (file plus line and column) plus cross-file references; `includeReferences:true` default                         | positive |
| CBS-S-03 | File symbols mode lists symbols in file  | `codebase-read{filePath:"src/auth.ts",repo:"repo-a"}`                                                   | Returns all symbols in that file (exported plus internal) with `kind` and `language`                                                | positive |
| CBS-S-04 | Content grep via indexed file cache      | `codebase-read{content:"MARKER_AUTH",repo:"repo-a"}`                                                    | Returns files with matching content lines; respects `CODE_SEARCH_MAX_REGEX_LENGTH=200`; `regex` flag honored                        | positive |
| CBS-S-05 | Inline `key:value` tags auto-extracted   | `codebase-read{query:"language:php kind:function auth"}`                                                | `language:php` plus `kind:function` extracted to filters; residual `"auth"` searched; FTS does not tokenize tags                    | positive |
| CBS-S-06 | Architecture mode returns tree           | `codebase-read{repo:"repo-a",depth:2}` (no `query` or `name` or `filePath` or `content`)                | Returns architecture tree up to `depth:2`; `includeSymbolCounts:true` includes counts                                               | positive |
| CBS-S-07 | Index status when fresh                  | `codebase-index{repo:"repo-a"}` (status mode, no `repoPath`) within `INDEX_STALENESS_TTL_MS=30000`      | Returns `{freshness, count, stale:false}`                                                                                           | positive |
| CBS-S-08 | Pagination on search results             | `codebase-read{query:"test",repo:"repo-a",limit:5,offset:0}` then `offset:5`                            | Exactly 5 results per page; offset 5 returns next page; stable ordering                                                             | positive |
| CBS-S-09 | Search before index returns staleness    | `codebase-read{query:"auth",repo:"unindexed-repo"}` without prior `codebase-index`                      | `CAPABILITY_UNAVAILABLE` or empty with `stale:true` per contract; no crash; no `SQLITE_ERROR`                                       | negative |
| CBS-S-10 | Invalid `depth` rejected                 | `codebase-read{repo:"repo-a",depth:99}` (max 5 per schema)                                              | `VALIDATION_ERROR`; `details` cites `depth` bounds 1–5; `depth` ignored outside architecture mode                                   | negative |
| CBS-S-11 | Regex too long rejected                  | `codebase-read{content:"a".repeat(201),repo:"repo-a"}` (more than 200)                                  | `VALIDATION_ERROR`; `details` cites `CODE_SEARCH_MAX_REGEX_LENGTH=200`                                                              | negative |
| CBS-S-12 | Non-existent file path returns not found | `codebase-read{filePath:"src/does-not-exist.ts",repo:"repo-a"}`                                         | `NOT_FOUND` or empty with no throw; no file system traversal outside `repoPath`                                                     | negative |
| CBS-S-13 | Path traversal blocked                   | `codebase-read{filePath:"../../etc/passwd",repo:"repo-a"}`                                              | Rejected or normalized within `repoPath`; no file outside the indexed repo read                                                     | security |
| CBS-S-14 | ReDoS regex rejected or timeout-guarded  | `codebase-read{content:"(a+)+$",repo:"repo-a"}` with catastrophic backtracking input                    | Rejected, timed out, or bounded; no event-loop hang; `CODEBASE_INDEX_PARSE_TIMEOUT_MS=10000` pattern applies                        | security |
| CBS-S-15 | Chaos: concurrent scans for same repo    | 5 parallel `codebase-index{repoPath:"/tmp/repo-a",repo:"repo-a"}`                                       | One wins, others serialized or idempotent; no `SQLITE_BUSY`; final symbol count consistent                                          | chaos    |
| CBS-S-16 | Chaos: file mutated during scan          | Modify (append 10k lines) a file mid-`codebase-index` run                                               | Scan completes without crash; staleness eventually `true` (`FILE_WATCH_TTL_MS=300000` debounce); next scan converges on new content | chaos    |

## Helpers

- `createTempRepo(files)` — writes 2–3 source files under `fs.mkdtemp(os.tmpdir())`, returns `repoPath`; used in CBS-S-01 through CBS-S-06, CBS-S-15, CBS-S-16.
- `createTestStore()` — in-memory SQLite factory from `src/mcp/storage/sqlite.ts`; call in `beforeAll`, close in `afterAll`; pool `forks` required.
- `seedFromFixture("search-test-fixture")` — loads `src/mcp/tests/fixtures/codebase-index/search-test-fixture/` without mutation for read-only mode tests.
- Use `vi.useFakeTimers()` plus `vi.setSystemTime()` to advance past `INDEX_STALENESS_TTL_MS=30000` for staleness assertions.
- Keep helpers co-located with test file; shared fixtures live under `src/mcp/tests/fixtures/`.

## Environment

| Variable                          | Default    | Relevance                                                |
| :-------------------------------- | :--------- | :------------------------------------------------------- |
| `CODEBASE_INDEX_PARSE_TIMEOUT_MS` | `10000`    | Per-file parse deadline; CBS-S-14 guards event-loop hang |
| `CODEBASE_INDEX_WORKERS`          | `4`        | Worker concurrency; CBS-S-15 asserts no slot leak        |
| `CODE_SEARCH_CACHE_MAX_BYTES`     | `16777216` | Process-shared content cache byte cap                    |
| `CODE_SEARCH_CACHE_MAX_FILES`     | `256`      | Content cache file-count cap                             |
| `CODE_SEARCH_MAX_REGEX_LENGTH`    | `200`      | CBS-S-11 upper bound for `content` regex                 |
| `INDEX_STALENESS_TTL_MS`          | `30000`    | Staleness cache TTL for `index_status`                   |
| `MCP_RUNTIME_PROFILE`             | `full`     | `minimal` disables index worker; fallback to staleness   |

## Notes

- **Temp repos**: For CBS-S-01 through CBS-S-03, CBS-S-04, CBS-S-06, CBS-S-15, CBS-S-16, create a minimal temp repo (2–3 source files) under `fs.mkdtemp(os.tmpdir())`, index it, then assert modes. For fixture-based tests, use `search-test-fixture/` without mutation.
- **Status**: `codebase-index{repo}` without `repoPath` is status-only (no scan). Assert `stale` flips to `true` after `INDEX_STALENESS_TTL_MS=30000` or when `FILE_WATCH_INTERVAL_MS=30000` sweep detects changes.
- **Harness**: `forks` pool plus WAL. Temp dirs cleaned in `afterAll`. Never write into `src/` or repository tree.
- **Worker concurrency**: `CODEBASE_INDEX_WORKERS=4` (legacy alias `CODEBASE_INDEX_PARSE_CONCURRENCY`); tests assert no worker-slot leak under concurrent scans.
- **Limits**: All caps from `src/mcp/utils/constants.ts`; see Environment table for defaults used when env is unset.
- **Security**: CBS-S-13 validates traversal is normalized within `repoPath`; CBS-S-14 validates catastrophic regex is bounded by timeout.

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

- Overview: [overview.md](overview.md)
- Standard: [../../../testing.md](../../../testing.md) §1–9
- API: [../../api/codebase-index/api-codebase.md](../../api/codebase-index/api-codebase.md)
- Constants: `src/mcp/utils/constants.ts` · Query tags: `src/mcp/utils/query-tags.ts`
- Module: [../../modules/codebase-index/overview.md](../../modules/codebase-index/overview.md) · Operations: `operations/codebase-index.md`
