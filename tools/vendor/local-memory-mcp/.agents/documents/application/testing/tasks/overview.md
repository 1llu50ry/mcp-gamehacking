# Tasks Module — Testing Overview

> Scope: `src/mcp/tools/task*.ts`, `src/mcp/tools/claim*.ts`, task FSM + claims + handoffs interaction · Canonical: [.agents/documents/testing.md](../../../testing.md)

## Strategy

Tasks model a finite-state machine (`backlog` → `pending` → `in_progress` → `completed` or `canceled` or `blocked`) with exclusive claim ownership and dependency edges. Testing focuses on three concerns:

1. **FSM guard correctness** — every state multiplied by valid and invalid edges in the transition table. Transitions via `task-write{status}`; `completed` auto-releases claims and expires handoffs. Phases, priority (1–5), dependencies, comments, and `suggested_skills` are validated alongside status.
2. **Claim atomicity** — one active claim per `task_id` enforced by DB unique constraint; no double-claim race; auto-release on completion; release is idempotent.
3. **Side-effects on completion** — `task-write{status:"completed"}` releases claims and expires linked handoffs; soft-delete (`task-delete` → `canceled`) also releases claims and removes vectors.

Dashboard rendering is out of scope here; this module tests the MCP tool surface and store invariants. The FSM is the system-of-record for delivery orchestration (S0 → Synthesize → S1 → S2 → Execute → Close), so guard tests are highest priority.

Primary risks: illegal transitions accepted without guard error, claim race producing duplicate `code`, orphaned claims or handoffs after completion, and dependency cycles blocking forever. Each risk has a direct matrix row in [test-task-lifecycle.md](test-task-lifecycle.md).

## Pyramid

| Layer       | Marker                  | Focus                                                                                                    | Example                                  | Share |
| :---------- | :---------------------- | :------------------------------------------------------------------------------------------------------- | :--------------------------------------- | :---- |
| Unit        | `*.test.ts`             | FSM guards, transition validation, `sql-builder` predicate, claim-manager pure logic                     | `src/mcp/tests/tasks-transition.test.ts` | 65%   |
| Integration | `*.integration.test.ts` | Tool route → store: `task-write` → `claim-manage` → `task-read` via `createTestStore()`                  | Create, claim, and complete round-trip   | 25%   |
| E2E         | `*.e2e.test.ts`         | Full agent workflow: create → claim → work → comment → complete (auto-releases claims, expires handoffs) | `src/mcp/tests/tasks.e2e.test.ts`        | 8%    |
| Perf        | `*.perf.test.ts`        | Bulk list pagination under load, dependency fan-out                                                      | `task-read` `limit` and `offset` stress  | 2%    |

End-to-end tests set `vi.setConfig({ testTimeout: 90_000 })` where full-toolchain flows are involved (see [.agents/documents/testing.md](../../../testing.md) §1.1). Every function and route has at least one positive and one negative case (review-blocking per `development-quality.md`). Perf asserts bounded timing, not exact milliseconds.

## Fixtures

- **Store**: `createTestStore()` in-memory SQLite; migrations auto-run in `SQLiteStore` constructor (no `migrate` script). No real `storage/` access on disk.
- **Seeding**: `task-write{phase,title,description}` to create (`code` auto-generated, for example `TASK-001`); `claim-manage{task_code,agent}` to claim. Use short `owner` and `repo` pairs matching `git remote -v` (`vheins/local-memory-mcp`).
- **Isolation**: One fresh store per test file (`beforeAll`); per-test rows are fresh inserts or transaction-rolled-back. Pool is `forks` (required for `better-sqlite3` ESM). No shared mutable state across files.
- **Temp file system**: If a test needs file output, use `fs.mkdtemp(os.tmpdir())` and clean in `afterAll`. Never write into `src/` or repository tree (verified pattern: `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`).
- **Routing note**: Only two real aliases in `src/mcp/router.ts` (`claim-release` → `claim-manage`, `task-update` → `task-write`) plus `dot→hyphen` normalization. Do not test legacy alias names (`index_repository`, `trace_symbol`, etc.) — they are historical notes, not resolvable aliases.
- **Lifecycle helper**: Prefer a small helper `createAndClaimTask({phase, title, agent})` that wraps `task-write` + `claim-manage`; reuse across integration and end-to-end files to keep seeding deterministic.

## Coverage

- **Floors**: `lines 70 / statements 70 / functions 70 / branches 60` — global across `src/**/*.{ts,tsx}` via `provider: v8` + `include` in `vitest.config.ts`. `thresholds.all` is not a Vitest option; all-files semantics come from `coverage.include` array.
- **Gated**: `coverage.enabled=false` until REFACTOR-TST-013; evaluate with `npm run test -- --coverage` (exits 1 below floor by design; artifacts still emitted to `coverage/coverage-final.json` + html and text reports). Agent env sets `skipFull:true` so 100 percent covered files are omitted from console — use `coverage/` html for full list.
- **Priority**: FSM guard table first (all 6 states multiplied by valid and invalid edges), then claim fencing (unique `task_id`), then `status=all` listing plus pagination, then `task-delete` soft-delete to `canceled`.
- **Running**: `npx vitest run src/mcp/tests/tasks.e2e.test.ts` · `npx vitest run src/mcp/tests/tasks-transition.test.ts` · `npm run test:integration` (`--project integration`) · `npm run test -- --coverage`.
- **Commit contract**: `type(scope): [TASK-xxx] message` with task title and summary — verified in end-to-end (see `AGENTS.md` Commits).
- **Inventory**: Server suites live in `src/mcp/tests/` mirroring `src/mcp/tools/`; 157 files total (unit 141 / integration 13 / end-to-end 2 / perf 1). See [.agents/documents/testing.md](../../../testing.md) §6–7 for partition.

## Transition Table

| From          | To `pending` |  To `in_progress`  |          To `completed`          | To `canceled` | To `blocked` |
| :------------ | :----------: | :----------------: | :------------------------------: | :-----------: | :----------: |
| `backlog`     |     Yes      |     Via claim      |                No                |      Yes      |     Yes      |
| `pending`     |      —       | Via `claim-manage` | No (must be `in_progress` first) |      Yes      |     Yes      |
| `in_progress` |      No      |         —          |               Yes                |      Yes      |     Yes      |
| `blocked`     |     Yes      |        Yes         |                No                |      Yes      |      —       |
| `completed`   |      No      |         No         |                —                 |      No       |      No      |
| `canceled`    |      No      |         No         |                No                |       —       |      No      |

Every Yes and No in this table should have a corresponding test row (positive vs negative). See matrix TSK-L-07 for the illegal `pending` → `completed` negative case.

## Conventions

- Paths: `src/mcp/tests/task*.test.ts`, `src/mcp/tests/claim*.test.ts` mirroring `src/mcp/tools/`. One subject maps to one file unless split by marker (unit and integration are separate files).
- Filenames: `kebab-case` plus suffix markers only (`*.test.ts` / `*.integration.test.ts` / `*.e2e.test.ts`). No `snake_case`, no `_test.ts` or `_spec.ts` (see [.agents/documents/testing.md](../../../testing.md) §3.1).
- Environment: default `node`; pool `forks` is fixed (do not change without ADR).
- Type gate: `npm run type-check` (`tsc` + `tsconfig.test.json` + `svelte-check`) must pass — green tests do not imply type correctness after file splits.

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

- Standard: [.agents/documents/testing.md](../../../testing.md) §1–9
- API: [api-tasks.md](../../api/tasks/api-tasks.md) · Tool definitions: `src/mcp/types/tool-definitions/task.ts` + `handoff.ts`
- Module: [modules/tasks/overview.md](../../modules/tasks/overview.md) · Manifest: [modules/manifest.md](../../modules/manifest.md)
- Handoff interaction: [../handoffs/test-handoff-coordination.md](../handoffs/test-handoff-coordination.md)
- Database: `src/mcp/storage/sqlite.ts` · Router: `src/mcp/router.ts`
