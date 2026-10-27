# Context Compilation — Test Scenarios

> Module: `context` · Tools: `agent-context` (memories plus tasks per agent), `synthesize` (MCP sampling), `repo-summarize` (`task_archive`, `importance=3`), `observation-read` and `observation-write` · Caps: `KG_CONTEXT_TEXT_TOKENS=40`, `KG_MAX_CONTEXT_ENTITIES=50` · Signals: `maxLength 200`, `minItems 1`

## Preconditions

- Store: `createTestStore()` in-memory SQLite; migrations auto-run. Never touch `storage/memory.db` on disk.
- Pool: `forks` (required for `better-sqlite3` ESM). One fresh store per test file (`beforeAll`); per-test rows are fresh inserts.
- Sampling: `synthesize` is the only tool requiring client sampling (MCP sampling capability). Mock the MCP sampling interface for the positive path; the negative path asserts graceful `CAPABILITY_UNAVAILABLE` or fallback without hang.
- Limits: `agent-context limit` 1–100 (default 5); `repo-summarize signals` items `maxLength 200`, `minItems 1`; `KG_CONTEXT_TEXT_TOKENS=40`, `KG_MAX_CONTEXT_ENTITIES=50`, `KG_MAX_GRAPH_EDGES=4000` bound compilation payloads.
- Scoping: all observations plus context scoped by `owner` and `repo`; no cross-repo leakage (same predicate as memory: `((owner,repo) OR is_global)`).
- Owner and repo: derived from `git remote -v` (`vheins/local-memory-mcp`); match session defaults.

## Matrix

| ID       | Scenario                                                 | Input                                                                                                                                           | Expected                                                                                                                                | Type     |
| :------- | :------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- | :------- |
| CTX-C-01 | `agent-context` recalls memories plus tasks for agent    | Seed memories plus tasks for `agent:"backend"`; `agent-context{agent:"backend",owner,repo,limit:5}`                                             | Returns `{memories[], tasks[]}` scoped to `agent:"backend"`; `limit` capped at 100, default 5                                           | positive |
| CTX-C-02 | `observation-write` then `observation-read` round-trip   | `observation-write{content:"Saw auth flow in src/auth.ts", type:"code_fact", agent:"backend"}` then `observation-read{query:"auth",owner,repo}` | Written observation returned by FTS or hybrid search                                                                                    | positive |
| CTX-C-03 | `repo-summarize` archives signals as `task_archive`      | `repo-summarize{owner:"vheins",repo:"app",signals:["JWT auth added","Rate limiting added"]}`                                                    | `task_archive` memory created (`importance=3`); signals stored with `maxLength 200` each; visible in `memory-read`                      | positive |
| CTX-C-04 | `synthesize` with client sampling support                | Client has sampling; `synthesize{query:"auth decisions",owner,repo}`                                                                            | Composite synthesis returned (memories plus tasks plus standards merged via MCP sampling)                                               | positive |
| CTX-C-05 | `agent-context` with `type_filter`                       | `agent-context{type_filter:"decision",agent:"backend",owner,repo}`                                                                              | Only `type=decision` memories returned; other types excluded                                                                            | positive |
| CTX-C-06 | `agent-context` query narrows results                    | `agent-context{query:"auth",agent:"backend",owner,repo}`                                                                                        | Vector or hybrid search scoped to agent; empty when no match (no error)                                                                 | positive |
| CTX-C-07 | `repo-summarize` rejects empty signals                   | `repo-summarize{owner:"vheins",repo:"app",signals:[]}` (violates `minItems 1`)                                                                  | `VALIDATION_ERROR`; `details` cites `signals` minItems                                                                                  | negative |
| CTX-C-08 | Signal too long rejected                                 | `repo-summarize{owner:"vheins",repo:"app",signals:["a".repeat(201)]}` (`maxLength 200`)                                                         | `VALIDATION_ERROR`; `details` cites signal `maxLength 200`                                                                              | negative |
| CTX-C-09 | `observation-read` no match returns empty                | `observation-read{query:"zzz-nonexistent-observation-xyz",owner,repo}`                                                                          | `[]` or `{results:[], total:0}`; no error, no throw                                                                                     | negative |
| CTX-C-10 | `synthesize` without sampling degrades gracefully        | Client without sampling support; `synthesize{query:"auth decisions"}`                                                                           | `CAPABILITY_UNAVAILABLE` or fallback synthesis without sampling (per contract); no crash, no hang                                       | negative |
| CTX-C-11 | Invalid `limit` rejected                                 | `agent-context{agent:"backend",limit:0}` or `limit:101` (cap 100)                                                                               | `VALIDATION_ERROR`; `details` cites `limit` bounds 1–100                                                                                | negative |
| CTX-C-12 | Injection in `observation` content neutralized           | `observation-write{content:"\"; DROP TABLE observations; --"}`                                                                                  | Stored verbatim; no SQLite error; table intact; `observation-read` returns verbatim                                                     | security |
| CTX-C-13 | Cross-site scripting payload in observation not executed | `content:"<img onerror=alert(1)>"` via `observation-write`                                                                                      | Stored verbatim; `observation-read` and `agent-context` return escaped or verbatim; dashboard renders escaped; no execution             | security |
| CTX-C-14 | Scope isolation: context not leaked cross-repo           | Seed `agent:"backend"` data in `(vheins, app-a)` vs `(vheins, app-b)`; query `repo:"app-a"`                                                     | Only `app-a` rows returned; `app-b` not leaked                                                                                          | security |
| CTX-C-15 | Chaos: high observation volume compilation               | 200 `observation-write` plus `agent-context{agent:"backend",limit:100}`                                                                         | No out-of-memory; respects `KG_MAX_CONTEXT_ENTITIES=50`, `KG_CONTEXT_TEXT_TOKENS=40`, `limit` cap; stable latency; truncation not error | chaos    |
| CTX-C-16 | Chaos: `synthesize` aborted mid-sampling                 | Sampling in-flight; client disconnect and `AbortSignal`                                                                                         | No orphaned promise hang; no `SQLITE_BUSY` on retry; returns `INTERNAL_ERROR` or partial result; retryable                              | chaos    |

## Helpers

- `seedObservation({content, type, agent, owner, repo})` — wraps `observation-write` with deterministic scoping.
- `compileContext({agent, limit, query})` — wraps `agent-context` for deterministic recall assertions.
- `createTestStore()` — in-memory SQLite factory from `src/mcp/storage/sqlite.ts`; call in `beforeAll`, close in `afterAll`; pool `forks` required.
- Use `vi.useFakeTimers()` plus `vi.setSystemTime()` for telemetry retention expiry (`REUSE_TELEMETRY_RETENTION_DAYS=30`) if testing hourly aggregates.
- Keep helpers co-located with test file; shared fixtures live under `src/mcp/tests/fixtures/`.

## Environment

| Variable                         | Default | Relevance                                                            |
| :------------------------------- | :------ | :------------------------------------------------------------------- |
| `ENABLE_REUSE_TELEMETRY`         | `true`  | When true, hourly aggregate telemetry is written; CTX-C-15 retention |
| `REUSE_TELEMETRY_RETENTION_DAYS` | `30`    | Bounded 1–365; hourly aggregate retention in days                    |
| `REUSE_TELEMETRY_MAX_ROWS`       | `20000` | Global cap for aggregate telemetry rows                              |
| `KG_CONTEXT_TEXT_TOKENS`         | `40`    | Max search-text tokens for KG entity FTS                             |
| `KG_MAX_CONTEXT_ENTITIES`        | `50`    | Max entities fed into context enrichment                             |
| `KG_MAX_GRAPH_EDGES`             | `4000`  | Graph edge cap bound on compilation payload                          |
| `MCP_RUNTIME_PROFILE`            | `full`  | `minimal` may disable synthesis worker; fallback path in CTX-C-10    |

## Notes

- **Harness**: `createTestStore()` WAL plus `forks` pool. Temp file system via `fs.mkdtemp(os.tmpdir())` if disk needed; use fake timers for retention expiry. Never write into `src/` or repository tree.
- **Sampling mock**: `synthesize` calls MCP sampling (LLM completion). For the positive path, mock the client sampling capability and assert the composite context merges memories plus tasks plus standards. For the negative path, omit the capability and assert `CAPABILITY_UNAVAILABLE`.
- **Token budget**: `KG_CONTEXT_TEXT_TOKENS=40` is the max search-text tokens for KG entity FTS; `KG_MAX_CONTEXT_ENTITIES=50` bounds entities fed into context enrichment. CTX-C-15 proves overflow truncates gracefully.
- **Telemetry**: `ENABLE_REUSE_TELEMETRY=true` (default) writes hourly aggregates with retention `REUSE_TELEMETRY_RETENTION_DAYS=30` and cap `REUSE_TELEMETRY_MAX_ROWS=20000`; tested via `vi.setSystemTime()` advance — not required in every context test but documented here for completeness.
- **FTS**: Observations use the same FTS5 `unicode61` tokenizer as memories; mid-word substring not guaranteed — test via prefix queries; see MEM-S-02 for pattern.

## Execution

```bash
bash scripts/copy-grammar-wasm.sh
npx vitest run src/mcp/tests/context*.test.ts
npx vitest run src/mcp/tests/observation*.test.ts
npm run test:integration   # --project integration
npm run test -- --coverage
npm run type-check
```

## Links

- Overview: [overview.md](overview.md)
- Standard: [../../../testing.md](../../../testing.md) §1–9
- API: [../../api/context/api-context.md](../../api/context/api-context.md) · Database: `src/mcp/storage/sqlite.ts`
- Module: [../../modules/context/context-compilation.md](../../modules/context/context-compilation.md) · Constants: `src/mcp/utils/constants.ts`

## Changelog

| Date | Change |
| :--- | :----- |
| 2026-09-07 | Initial context compilation scenarios (agent-context + synthesize + repo-summarize) |
