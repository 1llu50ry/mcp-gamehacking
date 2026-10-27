# Handoffs Module — Testing Overview

> Scope: `src/mcp/tools/handoff*.ts`, `src/mcp/tools/claim*.ts`, claims + handoffs + `task_comments` audit · Canonical: [../../../testing.md](../../../testing.md)

## Strategy

Handoffs coordinate unfinished work between agents (`from_agent` → `to_agent` with `task_code` plus `summary` plus `expires_at`). Claims gate task ownership (exclusive — one active claim per `task_id`, unique constraint on `claims.task_id`). Testing emphasizes four invariants:

1. **Handoff lifecycle** — `pending` → `accepted` or `rejected` or `expired` with `expires_at` bounded TTL and sweeper expiry; `active_only:true` default filters expired rows.
2. **Claim fencing** — single active claim per `task_id`; duplicate claim returns `CONFLICT`; release (`release:true`) is idempotent; completion auto-releases via `released_at`.
3. **Auto-expiry on completion** — `task-write{status:"completed"}` releases claims and expires all linked handoffs regardless of status; `task-delete` (to `canceled`) does the same; no orphan survives completion.
4. **Scope isolation** — no `is_global` for handoffs or claims (always repo-scoped); no cross-owner leakage; `owner` and `repo` from `git remote -v` bound every row.

This module is the coordination fabric for multi-agent execution (S0 → Execute → Close, see `AGENTS.md`). Tasks define _what_, handoffs and claims define _who_ and _what remains_. Handoffs are created ONLY for unfinished work with concrete next owner and steps — completion summaries belong in task comments (`task-write(comment)`), not handoffs.

Primary risks: lost handoffs (orphaned on completion when auto-expiry fails), double-accept causing state corruption, expired handoff acted upon, and `owner` and `repo` leakage across agent pools. Each risk maps to a chaos or security row in [test-handoff-coordination.md](test-handoff-coordination.md).

## Risk Register

| Risk                           | Likelihood | Impact   | Mitigation in tests                                        |
| :----------------------------- | :--------- | :------- | :--------------------------------------------------------- |
| Orphaned handoff on completion | Low        | High     | HND-C-06: completion expires linked handoffs               |
| Double-accept race             | Low        | High     | HND-C-12: concurrent accept → idempotent or `CONFLICT`     |
| Expired handoff acted upon     | Medium     | Medium   | HND-C-08: `active_only` filtering plus status enum         |
| Cross-owner leakage            | Medium     | Critical | HND-C-14: cross-owner query returns empty                  |
| Claim fencing bypass           | Low        | Critical | `claims.task_id` unique constraint; duplicate → `CONFLICT` |

## Pyramid

| Layer       | Marker                  | Focus                                                                                                        | Example                                                          | Share |
| :---------- | :---------------------- | :----------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------- | :---- |
| Unit        | `*.test.ts`             | Expiry calculation, status guards, `to_agent` resolution, `task_comments` audit shape                        | Handoff status transition helpers in `src/mcp/tools/handoff*.ts` | 60%   |
| Integration | `*.integration.test.ts` | Tool route → store: `handoff-write` → `handoff-read` → `claim-manage` via `createTestStore()`                | Round-trip with claim interaction                                | 25%   |
| E2E         | `*.e2e.test.ts`         | Full coordination: agent A creates handoff → agent B `accepted` → claims task → completes (expires siblings) | Cross-agent task handoff flow across `S0` to `Close`             | 13%   |
| Perf        | `*.perf.test.ts`        | List and search over many handoffs with pagination (`limit` and `offset`)                                    | `handoff-read` pagination stress with hundreds of rows           | 2%    |

End-to-end tests prove the orchestrator delegation protocol end-to-end. Perf asserts pagination stability under load, not exact throughput. Unit layer covers guard logic; integration covers store invariants.

## Fixtures

- **Store**: `createTestStore()` in-memory SQLite; migrations auto-run. No real `storage/` access on disk. Tables: `handoffs` (transient), `claims` (ownership, unique `task_id` per active row), `task_comments` (audit trail for every status transition).
- **Seeding**: `handoff-write{task_code,from_agent,to_agent,summary,owner,repo,expires_at}` plus `claim-manage{task_code,agent}`. Use deterministic `expires_at` (ISO string) for expiry tests; control clock via `vi.useFakeTimers()` plus `vi.setSystemTime()`.
- **Shared fixtures**: `src/mcp/tests/fixtures/` subject-mirrored. Disk writes via `fs.mkdtemp(os.tmpdir())` cleaned in `afterAll`; never write into `src/` or repository tree (verified pattern: `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`).
- **Isolation**: Fresh store per test file (`beforeAll`); per-test rows are fresh inserts. Pool `forks` required for `better-sqlite3` ESM. No shared mutable state across files; each file closes its store.
- **Lifecycle**: `handoff-write` auto-infers CREATE (`summary` plus `from_agent` with `owner` and `repo`, no `id`) vs UPDATE (`id` plus `status`). Tests must exercise both modes (HND-C-01 vs HND-C-02).
- **Helpers**: Small helper `createHandoff({task_code, from_agent, to_agent, summary})` keeps seeding deterministic and reuse safe.

## Coverage

- **Floors**: `lines 70 / statements 70 / functions 70 / branches 60` via `provider: v8` plus `include: ["src/**/*.{ts,tsx}"]` (`vitest.config.ts`). `thresholds.all` is not a Vitest option; all-files semantics come from `coverage.include`.
- **Gated**: `coverage.enabled=false` until REFACTOR-TST-013; evaluate with `npm run test -- --coverage` (exits 1 below floor by design; artifacts still written to `coverage/coverage-final.json` + html and text reports). Until then, coverage failures are non-blocking.
- **Priority**: (1) Handoff create → accept, reject, or expire transitions. (2) Claim fencing (one-active-per-`task_id` unique constraint). (3) Auto-expire on `task-write(status=completed)` and `task-delete`. (4) `active_only` filtering plus pagination.
- **Running**: `npx vitest run src/mcp/tests/handoff*.test.ts` · `npx vitest run src/mcp/tests/claim-manage.test.ts` · `npm run test:integration` (`--project integration`) · `npm run test -- --coverage`.
- **Inventory**: Server suites in `src/mcp/tests/` mirroring `src/mcp/tools/`; 157 files total (unit 141 / integration 13 / end-to-end 2 / perf 1). See [../../../testing.md](../../../testing.md) §6–7 for partition and run recipes.

## Conventions

- Paths: `src/mcp/tests/handoff*.test.ts` plus `src/mcp/tests/claim*.test.ts` mirroring `src/mcp/tools/`. One subject maps to one file unless split by marker (unit and integration are separate files).
- Every function and route has at least one positive and one negative case (review-blocking per `development-quality.md` §1).
- Filenames: `kebab-case` plus suffix markers only (`*.test.ts` / `*.integration.test.ts` / `*.e2e.test.ts`). No `snake_case`, no `_test.ts`.
- Type gate: `npm run type-check` (`tsc` + `tsconfig.test.json` + `svelte-check`) before push — green tests do not imply type correctness after file splits (see [../../../testing.md](../../../testing.md) §8).
- Formatting: tabs, double quotes, `printWidth: 120` (Prettier). `allowScripts` allowlist is load-bearing for native modules.

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

- Standard: [../../../testing.md](../../../testing.md) §1–9
- API: [../../api/tasks/api-tasks.md](../../api/tasks/api-tasks.md) (handoffs share task coordination surface) · Tool definitions: `src/mcp/types/tool-definitions/handoff.ts`
- Module: [../../modules/handoffs/overview.md](../../modules/handoffs/overview.md) · Manifest: [../../modules/manifest.md](../../modules/manifest.md)
- Decisions: `decisions/ADR-008-global-vs-scoped-ownership-and-dashboard-repo-view.md`
- Operations: `src/mcp/tools/handoff*.ts` · `src/mcp/tools/claim*.ts` · `src/mcp/storage/sqlite.ts`
