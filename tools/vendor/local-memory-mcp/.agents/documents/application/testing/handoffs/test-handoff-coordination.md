# Handoff Coordination — Test Scenarios

> Module: `handoffs/claims` · Tools: `handoff-read`, `handoff-write`, `claim-manage` · Tables: `handoffs` + `claims` (unique `task_id`) + `task_comments` · Link: `task-write(status=completed)` auto-expires linked handoffs plus releases claims

## Preconditions

- Store: `createTestStore()` in-memory SQLite; migrations auto-run in `SQLiteStore` constructor (no `migrate` script). Never touch `storage/memory.db`.
- Pool: `forks` (required for `better-sqlite3` ESM). One fresh store per test file (`beforeAll`); per-test rows are fresh inserts.
- Auto-infer: `handoff-write` CREATE (`summary` plus `from_agent` with `owner` and `repo`, no `id`) vs UPDATE (`id` plus `status`). Test both modes explicitly.
- Completion side-effect: `task-write(status=completed)` → claim released plus all linked handoffs `expired`; `task-delete` (to `canceled`) does the same. HND-C-06 is the critical side-effect gate.
- Clock: for expiry tests, use `vi.useFakeTimers()` plus `vi.setSystemTime()` to advance deterministically past `expires_at`; avoid real wall-clock sleeps.
- Owner and repo: derived from `git remote -v` (`vheins/local-memory-mcp`); match session defaults used by MCP tools.

## Matrix

| ID       | Scenario                                                         | Input                                                                                                                       | Expected                                                                                                                                          | Type     |
| :------- | :--------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ | :------- |
| HND-C-01 | Create handoff for unfinished work                               | `handoff-write{task_code:"TASK-001",from_agent:"backend",to_agent:"frontend",summary:"Need UI for auth screen",owner,repo}` | Handoff row with `status:"pending"`, `expires_at` set (bounded TTL), persisted                                                                    | positive |
| HND-C-02 | Recipient accepts handoff                                        | `handoff-write{id:"<id>",status:"accepted"}` (UPDATE mode)                                                                  | `status:"accepted"`; `updated_at` bumped; `accepted_at` recorded                                                                                  | positive |
| HND-C-03 | Recipient rejects handoff                                        | `handoff-write{id:"<id>",status:"rejected"}`                                                                                | `status:"rejected"`; task remains claimable by others; no claim created implicitly                                                                | positive |
| HND-C-04 | `handoff-read` filtered by `to_agent`                            | `handoff-read{to_agent:"frontend",owner,repo}`                                                                              | Returns only handoffs addressed to `frontend`; broadcast handoffs (`to_agent` null) handled per contract                                          | positive |
| HND-C-05 | Claim after handoff accepted                                     | Create handoff → recipient `claim-manage{task_code:"TASK-001",agent:"frontend"}`                                            | Task `in_progress` with `agent:"frontend"`; handoff can be marked `accepted`                                                                      | positive |
| HND-C-06 | Task completion auto-expires linked handoffs plus releases claim | `task-write{code:"TASK-001",status:"completed"}` after handoff created plus claim held                                      | Linked handoffs `expired`; claim released (inactive); no orphan                                                                                   | positive |
| HND-C-07 | List pending handoffs with pagination                            | Seed 15 pending handoffs; `handoff-read{status:"pending",limit:5,offset:5,owner,repo}`                                      | Exactly 5 rows at offset 5; `total` reflects full count                                                                                           | positive |
| HND-C-08 | Explicit expired-by-time filtered by `active_only`               | Handoff with `expires_at` in the past; list with default `active_only:true` vs `active_only:false`                          | Pending view excludes expired; `status:"expired"` includes it; `active_only:false` includes all                                                   | positive |
| HND-C-09 | Create handoff without `summary` rejected                        | `handoff-write{task_code:"TASK-001",from_agent:"a",to_agent:"b"}` (no `summary`)                                            | `VALIDATION_ERROR`; `details` cites `summary` minLength 1                                                                                         | negative |
| HND-C-10 | Create handoff without `from_agent` rejected                     | `handoff-write{task_code:"TASK-001",to_agent:"b",summary:"Need help"}` (no `from_agent`)                                    | `VALIDATION_ERROR`; `details` cites `from_agent` required                                                                                         | negative |
| HND-C-11 | Accept non-existent handoff rejected                             | `handoff-write{id:"00000000-0000-0000-0000-000000000000",status:"accepted"}`                                                | `NOT_FOUND` envelope (`code:"NOT_FOUND"`)                                                                                                         | negative |
| HND-C-12 | Double-accept idempotency or conflict                            | Two concurrent `handoff-write{id,status:"accepted"}` for same handoff                                                       | One succeeds; second is idempotent or `CONFLICT`; no duplicate accept row                                                                         | negative |
| HND-C-13 | Injection in `summary` stored safely                             | `summary:"\"; DROP TABLE handoffs; --"`                                                                                     | Stored verbatim; no SQL error; table intact; `handoff-read` returns verbatim                                                                      | security |
| HND-C-14 | Scope tampering: handoff not visible cross-owner                 | Handoff in `(vheins, app)` queried via `handoff-read{owner:"other",repo:"app"}`                                             | Not returned; `total:0` (no leakage; handoffs are always repo-scoped, no `is_global`)                                                             | security |
| HND-C-15 | Chaos: many concurrent handoffs for same task                    | 20 parallel `handoff-write` for same `task_code` with different `to_agent`                                                  | All 20 inserted with unique `id`; no duplicate-id race; list consistent                                                                           | chaos    |
| HND-C-16 | Chaos: complete races with handoff accept                        | Parallel `task-write{code:"TASK-001",status:"completed"}` plus `handoff-write{id,status:"accepted"}`                        | No WAL deadlock; completion wins and handoffs end `expired` (or accept-then-expire); store consistent; `WAL_CHECKPOINT_INTERVAL_MS=10000` honored | chaos    |

## Helpers

- `createHandoff({task_code, from_agent, to_agent, summary})` — wraps `handoff-write` with deterministic owner and repo; reuse across tests to keep seeding uniform.
- `createTestStore()` — in-memory SQLite factory from `src/mcp/storage/sqlite.ts`; call in `beforeAll`, close in `afterAll`; pool `forks` required.
- Use `vi.useFakeTimers()` plus `vi.setSystemTime()` to deterministically advance past `expires_at` for HND-C-08; avoid wall-clock sleeps.
- Keep helpers co-located with test file; shared fixtures live under `src/mcp/tests/fixtures/` and are used by at least two tests.
- Keep helper names stable so future suites can reuse `createHandoff` without duplication.

## Environment

| Variable                     | Default | Relevance                                                                          |
| :--------------------------- | :------ | :--------------------------------------------------------------------------------- |
| `WAL_CHECKPOINT_INTERVAL_MS` | `10000` | WAL checkpoint cadence; HND-C-16 concurrent complete plus accept must not deadlock |
| `ACTION_LOG_MAX_ROWS`        | `10000` | Audit log cap; handoff status transitions may emit log rows                        |
| `MCP_RUNTIME_PROFILE`        | `full`  | Handoffs behave identically across all profiles; no profile-gated logic            |
| `DEFAULT_BATCH_SIZE`         | `100`   | Rows per DB transaction for bulk handoff seeding                                   |

## Notes

- **Harness**: `createTestStore()` WAL plus `forks` pool. Temp file system via `fs.mkdtemp(os.tmpdir())` cleaned in `afterAll`; never write into `src/` or repository tree.
- **Handoff discipline**: Only for unfinished work with concrete next steps and owner. No handoff for completion summaries — those belong in task comments (`task-write(comment)`).
- **One-claim-per-task invariant**: `claims.task_id` unique constraint; duplicate `claim-manage` returns `CONFLICT`. Completion auto-releases via `released_at`; see [../tasks/test-task-lifecycle.md](../tasks/test-task-lifecycle.md) for claim-side tests.
- **Status enum**: `pending`, `accepted`, `rejected`, `expired`. `expired` is terminal; `accepted` or `rejected` only from `pending`.
- **Dashboard view**: Dashboard coordination view aggregates by short `repo` only (`owner=""`) for ops visibility; MCP tools enforce per-owner isolation. Do not test `is_global` for handoffs (no such flag exists).
- **Security**: HND-C-13 validates `summary` is stored verbatim; HND-C-14 validates scope isolation is not bypassed by `owner` tampering.

## Execution

```bash
bash scripts/copy-grammar-wasm.sh
npx vitest run src/mcp/tests/handoff*.test.ts
npx vitest run src/mcp/tests/claim-manage.test.ts
npm run test:integration
npm run test -- --coverage
npm run type-check
```

## Links

- Overview: [overview.md](overview.md)
- Standard: [../../../testing.md](../../../testing.md) §1–9
- API: [../../api/tasks/api-tasks.md](../../api/tasks/api-tasks.md) · Database: `src/mcp/storage/sqlite.ts`
- Module: [../../modules/handoffs/overview.md](../../modules/handoffs/overview.md)
- Tasks: [../tasks/test-task-lifecycle.md](../tasks/test-task-lifecycle.md)

## Changelog

| Date | Change |
| :--- | :----- |
| 2026-09-07 | Initial handoff coordination scenarios (lifecycle + fencing + chaos) |
