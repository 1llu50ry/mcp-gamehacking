# Memory Search — Test Scenarios

> Module: `memory` · Tools: `memory-read`, `memory-write`, `memory-delete`, `repo-summarize` · Store: `src/mcp/storage/sqlite.ts` (WAL) + FTS5 (`unicode61`) + 384-dim vectors + KG · Contract: `src/mcp/prompts/server/instructions.md`

## Preconditions

- Run `bash scripts/copy-grammar-wasm.sh` before any suite requiring `dist/grammars/*.wasm` (harmless for memory but required for full `npm run test`).
- Store: `createTestStore()` in-memory SQLite (migrations auto-run in constructor; no `migrate` script). Never touch `storage/memory.db` on disk.
- Queue: embedding offload via async outbox (migration v9, `MCP_RUNTIME_PROFILE` `full`/`balanced`/`minimal`). Assert semantic scores only after lease drain (`EMBEDDING_QUEUE_POLL_INTERVAL_MS=500` + poll helper or `vi.useFakeTimers()`).
- FTS: `unicode61` + `*` prefix; mid-word substring NOT guaranteed (trigram deferred) — test via prefix cases, not substring cases.
- Caps: `VECTOR_CANDIDATE_CAP=100`, `VECTOR_MIN_CANDIDATES=10`, `ACTION_LOG_MAX_ROWS=10000`, `WAL_CHECKPOINT_INTERVAL_MS=10000` (all via `src/mcp/utils/constants.ts`).
- Owner and repo: derived from `git remote -v` (`vheins/local-memory-mcp`); session defaults `MCP_CLIENT_NAME` / `MCP_MODEL` populate `agent`/`model` when omitted.

## Matrix

| ID       | Scenario                                                      | Input                                                                                                                          | Expected                                                                                                                   | Type     |
| :------- | :------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- | :------- |
| MEM-S-01 | Exact title match returns top-ranked                          | `query: "auth JWT expiry 1h"` after `memory-write{title:"Auth uses JWT",content:"JWT tokens with 1h expiry",type:"code_fact"}` | Result array contains seeded row at rank 0; hybrid `score` greater than threshold                                          | positive |
| MEM-S-02 | FTS prefix match via `*` tokenizer                            | `query: "authent"` (prefix of "authentication")                                                                                | FTS5 returns row; lexical score greater than 0                                                                             | positive |
| MEM-S-03 | Inline `key:value` tags extracted, residual stripped          | `query: "tag:backend language:php auth flow"`                                                                                  | `tag:backend` + `language:php` extracted to filters; residual `"auth flow"` searched; FTS does not tokenize `language:php` | positive |
| MEM-S-04 | Vector semantic match after queue drain                       | `query: "user login token"` matching content `"JWT authentication with bearer tokens"`                                         | After embedding drain (within 1s), `semantic_score` converges and row surfaces in hybrid ranking                           | positive |
| MEM-S-05 | Owner and repo scoping isolates results                       | Write to `(vheins, app-a)` and `(other, app-a)`; `memory-read{query:"test",owner:"vheins",repo:"app-a"}`                       | Only `vheins/app-a` rows returned; no cross-owner leakage (`((owner,repo) OR is_global)` predicate)                        | positive |
| MEM-S-06 | Pagination `limit` and `offset` honored                       | Seed 20 rows; `query:"test", limit:5, offset:5`                                                                                | Returns exactly 5 rows starting at offset 5; `total` reflects full count, unchanged                                        | positive |
| MEM-S-07 | Empty query returns recap and stats                           | `memory-read` with no `query`/`id`/`code`                                                                                      | Returns recap object (counts by `type`/`importance`), not empty array                                                      | positive |
| MEM-S-08 | Unknown `key:value` stays as free-text                        | `query: "label:ddd auth"`                                                                                                      | `label:ddd` not extracted (unknown key); residual query contains it verbatim                                               | positive |
| MEM-S-09 | No match returns empty, not error                             | `query: "zzz-nonexistent-token-xyz-999"`                                                                                       | `{results:[], total:0}`, HTTP 200 with no throw                                                                            | negative |
| MEM-S-10 | Invalid `limit` rejected                                      | `limit: 0` or `limit: 101` (cap 100)                                                                                           | `VALIDATION_ERROR`; `details` cites `limit` bounds 1–100                                                                   | negative |
| MEM-S-11 | Missing `repo` with `owner` returns validation or empty scope | `owner:"vheins"` without `repo` where required                                                                                 | `VALIDATION_ERROR` or empty scoped to caller per tool contract; never leaks other owners                                   | negative |
| MEM-S-12 | FTS injection neutralized                                     | `query: "\" OR 1=1 --"`                                                                                                        | Treated as literal tokens; no SQLite error; no row leakage; no table dump                                                  | security |
| MEM-S-13 | Cross-site scripting payload stored safely, not executed      | `content: "<script>alert(1)</script>"`                                                                                         | Stored verbatim; `memory-read` returns verbatim or escaped; dashboard renders escaped; no execution                        | security |
| MEM-S-14 | Very large query handled without out-of-memory                | `query: "a".repeat(5000)`                                                                                                      | `VALIDATION_ERROR` or server-side truncation; no process out-of-memory; no `SQLITE_TOOBIG`                                 | security |
| MEM-S-15 | Chaos: concurrent writes plus simultaneous reads              | 10 parallel `memory-write` plus `memory-read` loop                                                                             | No `SQLITE_BUSY` or WAL deadlock; all reads eventually converge; `WAL_CHECKPOINT_INTERVAL_MS` honored                      | chaos    |
| MEM-S-16 | Chaos: semantic worker in minimal profile degrades to lexical | `MCP_RUNTIME_PROFILE=minimal` (semantic unavailable)                                                                           | Lexical FTS results still returned; `semantic_score` is null or absent; no `CAPABILITY_UNAVAILABLE` for lexical path       | chaos    |
| MEM-S-17 | Chaos: restart backfill respects cap                          | Kill worker mid-queue with 3000 pending; restart with `EMBEDDING_QUEUE_BACKFILL_CAP=2000`                                      | At most 2000 backfilled; `EMBEDDING_QUEUE_BACKFILL_MIN_QUEUE=500` gate honored; no duplicate embeddings                    | chaos    |

## Helpers

- `seedMemory({title, content, type, owner, repo})` — wraps `memory-write` with deterministic owner and repo.
- `drainEmbeddingQueue(store)` — polls `embedding_queue` until `pending` plus `claimed` is zero or lease expires; used in MEM-S-04.
- `createTestStore()` — in-memory SQLite factory from `src/mcp/storage/sqlite.ts`; call in `beforeAll`, close in `afterAll`.
- Use `vi.useFakeTimers()` plus `vi.setSystemTime()` for lease-expiry tests; avoid real `setTimeout` sleeps.
- Temp helpers stay co-located with the test file; shared fixtures live under `src/mcp/tests/fixtures/`.
- Keep helper names stable so future tests can reuse `seedMemory` without duplication.

## Environment

| Variable                           | Default | Relevance                                                            |
| :--------------------------------- | :------ | :------------------------------------------------------------------- |
| `MCP_RUNTIME_PROFILE`              | `full`  | `minimal` disables semantic queue; MEM-S-16 asserts lexical fallback |
| `EMBEDDING_QUEUE_POLL_INTERVAL_MS` | `500`   | Poll cadence for lease worker; controls MEM-S-04 drain timing        |
| `EMBEDDING_QUEUE_BACKFILL_CAP`     | `2000`  | Max rows backfilled per restart; MEM-S-17                            |
| `VECTOR_CANDIDATE_CAP`             | `100`   | Hybrid search candidate ceiling; ranking must truncate above cap     |
| `VECTOR_MIN_CANDIDATES`            | `10`    | Floor for candidate pool on small or sparse sets                     |
| `WAL_CHECKPOINT_INTERVAL_MS`       | `10000` | WAL checkpoint cadence; concurrent read and write must not deadlock  |

## Notes

- **Harness**: `createTestStore()` provides isolated WAL DB per file. Pool `forks` is REQUIRED for `better-sqlite3` ESM. Temp file system via `fs.mkdtemp(os.tmpdir())` cleaned in `afterAll`.
- **Queue timing**: Use a drain helper (`await drainEmbeddingQueue(store)`) or fake timers — do not use arbitrary `setTimeout`.
- **Global vs scoped**: Seeded `is_global=1` rows are visible cross-repo; MEM-S-05 proves the non-leakage predicate for scoped rows.
- **Scoring**: Hybrid 40/30/15/15 (FTS/vector/recency/importance) under `VECTOR_CANDIDATE_CAP=100`; assert ranking order, not exact float equality.
- **Key-value tags**: Extraction lives in `src/mcp/utils/query-tags.ts`; verify tags are stripped before FTS tokenization so `language:php` does not split into two tokens.
- **Security**: MEM-S-12 validates FTS tokenizer treats injection as literal; MEM-S-13 validates storage is verbatim without execution.

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

- Overview: [overview.md](overview.md) · Standard: [../../../testing.md](../../../testing.md) §1–9
- API: [../../api/memory/api-memory.md](../../api/memory/api-memory.md) · Database: `src/mcp/storage/sqlite.ts`
- Constants: `src/mcp/utils/constants.ts` (queue caps, candidate caps, checkpoint interval)
- Module: [../../modules/memory/overview.md](../../modules/memory/overview.md)
