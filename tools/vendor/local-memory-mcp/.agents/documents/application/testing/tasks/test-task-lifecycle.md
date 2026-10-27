# Task Lifecycle — Test Scenarios

> Module: `tasks` · Tools: `task-read`, `task-write`, `task-delete`, `claim-manage` · FSM: `backlog` → `pending` → `in_progress` → `completed` or `canceled` or `blocked` · Store: `src/mcp/storage/sqlite.ts` (WAL)

## Preconditions

- Store: `createTestStore()` in-memory SQLite; migrations auto-run in `SQLiteStore` constructor (no `migrate` script). Never touch `storage/memory.db`.
- Pool: `forks` (required for `better-sqlite3` ESM). One fresh store per test file (`beforeAll`); per-test rows are fresh inserts.
- Routing: only two real aliases in `src/mcp/router.ts` (`claim-release` → `claim-manage`, `task-update` → `task-write`) plus `dot→hyphen` normalization (for example `task.write` → `task-write`). Legacy names (`task-claim`, `index_repository`) are historical, not resolvable.
- Completion side-effect: `task-write(status=completed)` auto-releases claims plus expires linked handoffs (critical gate: TSK-L-03, TSK-L-16). `task-delete` soft-deletes to `canceled` and also releases claims.
- Owner and repo: derived from `git remote -v` (`vheins/local-memory-mcp`); match session defaults used by MCP tools.

## Matrix

| ID       | Scenario                                           | Input                                                                                        | Expected                                                                                          | Type     |
| :------- | :------------------------------------------------- | :------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------ | :------- |
| TSK-L-01 | Create task in `pending`                           | `task-write{phase:"build",title:"Add auth",description:"Implement JWT"}`                     | Task created with `code` (for example `TASK-001`), `status:"pending"`, persisted in `tasks` table | positive |
| TSK-L-02 | Claim transitions to `in_progress`                 | `claim-manage{task_code:"TASK-001",agent:"backend"}`                                         | Task `status:"in_progress"`, claim row with `agent:"backend"`, `active:true`                      | positive |
| TSK-L-03 | Complete auto-releases claim plus expires handoffs | `task-write{code:"TASK-001",status:"completed"}` after claim plus pending handoff            | `status:"completed"`; claim released (inactive); linked handoffs `expired`                        | positive |
| TSK-L-04 | `task-read` filtered by status plus pagination     | `task-read{status:"in_progress",owner,repo,limit:5,offset:0}`                                | Only matching tasks returned; `limit` and `offset` honored; stale reads not required              | positive |
| TSK-L-05 | Comment persists and appears in detail             | `task-write{code:"TASK-001",comment:"Root cause auth.ts:12"}`                                | Comment appended to `task_comments`; visible in `task-read` detail (`id` or `code` mode)          | positive |
| TSK-L-06 | List with `status=all` returns every state         | Seed tasks in 4 states; `task-read{status:"all",owner,repo}`                                 | All rows returned regardless of status                                                            | positive |
| TSK-L-07 | Illegal transition rejected                        | `status:"pending"` directly to `status:"completed"` without `in_progress` (if guard forbids) | `VALIDATION_ERROR` or `CONFLICT`; task row unchanged                                              | negative |
| TSK-L-08 | Double-claim same task rejected                    | Two agents `claim-manage` same `task_code` concurrently                                      | Second claim gets `CONFLICT`; first claim remains active                                          | negative |
| TSK-L-09 | Claim without task identifier rejected             | `claim-manage{agent:"backend"}` (no `task_code` or `task_id`)                                | `VALIDATION_ERROR`; `details` cites missing `task_code` or `task_id`                              | negative |
| TSK-L-10 | Read non-existent task returns not found           | `task-read{code:"TASK-9999"}`                                                                | `NOT_FOUND` envelope (`code:"NOT_FOUND"`, `retryable:false`)                                      | negative |
| TSK-L-11 | `task-delete` soft-deletes to `canceled`           | `task-delete{code:"TASK-001"}`                                                               | `status:"canceled"`; vectors removed; claims released; handoffs expired                           | negative |
| TSK-L-12 | Owner and repo isolation enforced                  | Task in `(vheins, repo-a)` queried with `(other, repo-a)`                                    | Not returned; `total:0` (no leakage across owners)                                                | security |
| TSK-L-13 | Injection in `title` stored safely                 | `title:"\"; DROP TABLE tasks; --"`                                                           | Stored verbatim; no SQL error; table intact; read returns verbatim                                | security |
| TSK-L-14 | Dashboard `DASHBOARD_TOKEN` gate (REST only)       | `GET /api/tasks` without `Authorization: Bearer <token>` when `DASHBOARD_TOKEN` set          | `401 Unauthorized` (Express layer; MCP stdio has no Bearer)                                       | security |
| TSK-L-15 | Chaos: concurrent creates under same scope         | 20 parallel `task-write` creates under same `owner` and `repo`                               | All 20 inserted with unique `code`; no duplicate-code race; no `SQLITE_BUSY`                      | chaos    |
| TSK-L-16 | Chaos: complete races with concurrent reads        | Parallel `task-write{status:"completed"}` plus 50 `task-read` loops                          | No WAL deadlock; readers eventually see `completed`; claims and handoffs consistently expired     | chaos    |

## Helpers

- `createAndClaimTask({phase, title, agent})` — wraps `task-write` + `claim-manage` for deterministic seeding; reuse across integration and end-to-end files to keep seeding uniform.
- `createTestStore()` — in-memory SQLite factory from `src/mcp/storage/sqlite.ts`; call in `beforeAll`, close in `afterAll`; pool `forks` required.
- Use short `owner` and `repo` matching `git remote -v` so default session scoping does not confuse assertions.
- Fences: balanced code fences in every file; run `npx markdownlint-cli2` with project config before ship if available.
- Keep helper names stable so future suites can reuse `createAndClaimTask` without duplication across suites.

## Environment

| Variable                     | Default | Relevance                                                                 |
| :--------------------------- | :------ | :------------------------------------------------------------------------ |
| `MCP_RUNTIME_PROFILE`        | `full`  | Tasks FSM is available in all profiles; no profile-gated behavior         |
| `ACTION_LOG_MAX_ROWS`        | `10000` | Audit log cap; task status transitions emit `task_comments` rows          |
| `WAL_CHECKPOINT_INTERVAL_MS` | `10000` | WAL checkpoint cadence; concurrent read and write chaos must not deadlock |
| `DEFAULT_BATCH_SIZE`         | `100`   | Rows per DB transaction for bulk task seeding                             |

## Notes

- **Harness**: `createTestStore()` WAL plus `forks` pool. Temp file system via `fs.mkdtemp(os.tmpdir())` cleaned in `afterAll`; never write into `src/` or repository tree.
- **FSM**: States `backlog`, `pending`, `in_progress`, `completed`, `canceled`, `blocked`. Never skip `in_progress` — `claim-manage` is the gate from `pending` or `backlog`. See Transition Table in [overview.md](overview.md).
- **Detail modes**: `task-read` auto-infers SEARCH (`query`) versus DETAIL (`id` or `code` or bulk) versus LIST (none). TSK-L-05 exercises DETAIL; TSK-L-04 exercises LIST with `status` filter.
- **Commit contract**: `type(scope): [TASK-xxx] message` verified in end-to-end tests, not unit (see `AGENTS.md` Commits).
- **Isolation**: Fresh store per file; `owner` and `repo` derived from `git remote -v` (`vheins/local-memory-mcp`).
- **Links**: All relative Links in this file resolve to files that exist in the repository tree; verify with `ls` before adding cross-references.

## Execution

```bash
bash scripts/copy-grammar-wasm.sh
npx vitest run src/mcp/tests/tasks.e2e.test.ts
npx vitest run src/mcp/tests/tasks-transition.test.ts
npm run test:integration
npm run test -- --coverage
npm run type-check
```

## Links

- Overview: [overview.md](overview.md)
- Standard: [../../../testing.md](../../../testing.md) §1–9
- API: [../../api/tasks/api-tasks.md](../../api/tasks/api-tasks.md)
- Database: `src/mcp/storage/sqlite.ts` · Router: `src/mcp/router.ts`
- Handoffs: [../handoffs/test-handoff-coordination.md](../handoffs/test-handoff-coordination.md)

## Changelog

| Date | Change |
| :--- | :----- |
| 2026-09-07 | Initial task lifecycle scenarios (FSM + claims + isolation + chaos) |
