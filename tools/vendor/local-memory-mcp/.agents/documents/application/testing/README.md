# Testing Catalog

> Canonical standard: [.agents/documents/testing.md](../../testing.md) (Vitest 4, `forks` pool, 4-concern rule, file naming, fixtures) · This directory holds **per-module test plans** (Part B).

## Coverage Floors

Global floors via `vitest.config.ts` (`provider: v8`, `include: ["src/**/*.{ts,tsx}"]`): `lines 70 / statements 70 / functions 70 / branches 60`. Flag-gated (`coverage.enabled=false` until REFACTOR-TST-013) — evaluate with `npm run test -- --coverage` (exits 1 below floor by design; artifacts in `coverage/` still written).

Every function/route requires ≥1 positive + ≥1 negative case (review-blocking). See [testing.md §4.2](../../testing.md).

## Tooling

| Item     | Value                                                                        |
| :------- | :--------------------------------------------------------------------------- |
| Runner   | Vitest 4.1.7 (`forks` pool for `better-sqlite3` ESM)                         |
| Coverage | `@vitest/coverage-v8` 4.1.7 (`lines/statements/functions 70`, `branches 60`) |
| Property | `fast-check` 4.6.0 via `@fast-check/vitest`                                  |
| DOM      | `jsdom` 30 for UI (`// @vitest-environment jsdom` first line)                |

`pool: "forks"` is REQUIRED; `testTimeout: 30_000` (90_000 for end-to-end). Projects `unit`/`integration`/`e2e`/`perf` partition by suffix with positive-only `include` + `exclude` (no `!` negations in `include`). See [testing.md §1.1](../../testing.md) for root config facts.

## Execution

```bash
bash scripts/copy-grammar-wasm.sh        # dist/grammars/*.wasm pre-req
npm run type-check          # tsc + tsconfig.test.json + svelte-check
npm run lint                # eslint . --ext .ts,.svelte
npm run test                # all 157 files (unit 141 / integration 13 / e2e 2 / perf 1)
npm run test:unit | :integration | :e2e | :perf   # --project <name>
npx vitest run src/mcp/tests/memory.write.test.ts  # one file
npm run test -- --coverage  # V8 report → coverage/coverage-final.json
```

Fixtures: `createTestStore()` in-memory SQLite (WAL, migrations auto-run); shared under `src/mcp/tests/fixtures/`; temp FS via `fs.mkdtemp(os.tmpdir())` cleaned in `afterAll`; pool `forks` required for `better-sqlite3` ESM. Never write into `src/` or repository tree.

## Catalog (7 modules)

| Module           | Feature                              | Test File                      | Coverage                                                                                  | Path                                                                                     |
| :--------------- | :----------------------------------- | :----------------------------- | :---------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| `memory`         | Memory search (FTS5 + vector hybrid) | `test-memory-search.md`        | FTS5 unicode61 + `*` prefix, vector candidate cap 100, owner/repo scoping                 | [testing/memory/test-memory-search.md](memory/test-memory-search.md)                     |
| `memory`         | Module overview                      | `overview.md`                  | Strategy, pyramid (70/20/8/2), fixtures (`createTestStore`), floors                       | [testing/memory/overview.md](memory/overview.md)                                         |
| `tasks`          | Task lifecycle (FSM + claims)        | `test-task-lifecycle.md`       | FSM guards (6 states), claim atomicity, handoff expiry on completion                      | [testing/tasks/test-task-lifecycle.md](tasks/test-task-lifecycle.md)                     |
| `tasks`          | Module overview                      | `overview.md`                  | Strategy, pyramid (65/25/8/2), fixtures, floors                                           | [testing/tasks/overview.md](tasks/overview.md)                                           |
| `standards`      | Standards catalog (global vs scoped) | `test-standard-catalog.md`     | `is_global` predicate, tag/language filters, CRUD validation                              | [testing/standards/test-standard-catalog.md](standards/test-standard-catalog.md)         |
| `standards`      | Module overview                      | `overview.md`                  | Strategy, pyramid (70/22/6/2), fixtures, floors                                           | [testing/standards/overview.md](standards/overview.md)                                   |
| `handoffs`       | Handoff coordination                 | `test-handoff-coordination.md` | Handoff lifecycle (pending→accepted/rejected/expired), claim interaction, auto-expire     | [testing/handoffs/test-handoff-coordination.md](handoffs/test-handoff-coordination.md)   |
| `handoffs`       | Module overview                      | `overview.md`                  | Strategy, pyramid (60/25/13/2), fixtures, floors                                          | [testing/handoffs/overview.md](handoffs/overview.md)                                     |
| `codebase-index` | Codebase search (tree-sitter + grep) | `test-codebase-search.md`      | Index/scan, 5 read modes (`query`/`name`/`filePath`/`content`/architecture), cache caps   | [testing/codebase-index/test-codebase-search.md](codebase-index/test-codebase-search.md) |
| `codebase-index` | Module overview                      | `overview.md`                  | Strategy, pyramid (60/28/8/4), WASM pre-req, fixtures, floors                             | [testing/codebase-index/overview.md](codebase-index/overview.md)                         |
| `dashboard`      | Dashboard shell (Express + Svelte 5) | `test-dashboard-shell.md`      | Repo-only aggregation (`owner=""`), TTL caches, `DASHBOARD_TOKEN` gate, STD-002           | [testing/dashboard/test-dashboard-shell.md](dashboard/test-dashboard-shell.md)           |
| `dashboard`      | Module overview                      | `overview.md`                  | Strategy, pyramid (50/30/12/8), store + jsdom + build fixtures, floors                    | [testing/dashboard/overview.md](dashboard/overview.md)                                   |
| `context`        | Context compilation                  | `test-context-compilation.md`  | `agent-context`, `synthesize` (sampling), `repo-summarize` (`task_archive`), observations | [testing/context/test-context-compilation.md](context/test-context-compilation.md)       |
| `context`        | Module overview                      | `overview.md`                  | Strategy, pyramid (65/25/8/2), token budgets, sampling fallback, floors                   | [testing/context/overview.md](context/overview.md)                                       |

Each `test-*.md` contains a matrix `ID | Scenario | Input | Expected | Type` with ≥8 rows covering **positive, negative, security, chaos**. Each `overview.md` and `test-*.md` is 80–150 lines.

## Layout

```
application/testing/
├── README.md                          # this catalog
├── memory/overview.md + test-memory-search.md
├── tasks/overview.md + test-task-lifecycle.md
├── standards/overview.md + test-standard-catalog.md
├── handoffs/overview.md + test-handoff-coordination.md
├── codebase-index/overview.md + test-codebase-search.md
├── dashboard/overview.md + test-dashboard-shell.md
└── context/overview.md + test-context-compilation.md
```

Server tests: `src/**/tests/` (mirrored) · UI tests: `src/dashboard/ui/src/**/__tests__/` (colocated). Suffix taxonomy: `*.test.ts` / `*.integration.test.ts` / `*.e2e.test.ts` / `*.perf.test.ts`. No `snake_case`. See [testing.md §2](../../testing.md) for location policy and §3 for naming taxonomy.

## Links

- Standard: [testing.md](../../testing.md) §1–9
- API: [api/README.md](../api/README.md)
- Modules: [modules/manifest.md](../modules/manifest.md) + [modules/README.md](../modules/README.md)
- Global rules: `~/.agents/rules/test-architecture.md` + `development-quality.md`

## Change Log (Testing Part B)

| Date       | Change                                                                         |
| :--------- | :----------------------------------------------------------------------------- |
| 2026-09-07 | Part B testing docs: 7 module overviews + 7 scenario matrices + module catalog |

## Quality Gates (per file)

Each overview: 80–150 lines, strategy + pyramid + fixtures + coverage + links. Each scenario matrix: table `ID | Scenario | Input | Expected | Type` with at least 8 rows across positive, negative, security, chaos. No placeholder content, fences balanced, links resolve, spell-checked, h1 present. See [.agents/documents/testing.md](../../testing.md) for canonical standard.
