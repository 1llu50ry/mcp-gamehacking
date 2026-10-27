# Testing Standardization — Gap Analysis

- **Status**: Ready for execution
- **Date**: 2026-08-08
- **Author**: orchestrator (file-based fallback — MCP task tools unavailable)
- **Related tasks**: see `../_tasks/testing-standardization.md`

> **Historical snapshot (2026-08-08).** Findings **F-5** and **F-6** (documentation drift in
> `CONTRIBUTING.md` and `codebase-index/specs/tdd.md`) have since been repaired, and the
> legacy test layout was consolidated — the paths quoted below are retained as the original
> audit record only. See [.agents/documents/testing.md](../../../testing.md) for the current
> testing standard.

---

## 1. Executive Summary

The repository (TypeScript MCP server, Vitest 4.x) has **103 test files** with strong
coverage of the MCP core (83 tests) and dashboard UI (17 tests). However, test
management is inconsistent along **5 dimensions**:

1. **3 location conventions mixed** — centralized `tests/` dirs, colocated `*.test.ts`,
   and `__tests__/` dirs.
2. **4 naming variants** — plain `X.test.ts`, `*.integration.test.ts`, `e2e.test.ts`,
   `*.perf.test.ts`, plus a legacy snake_case file `spec_compliance.test.ts`.
3. **No CI test gate** — neither GitHub workflow runs `vitest`; tests run locally only.
4. **Documentation drift** — `CONTRIBUTING.md` and `codebase-index/tdd.md` reference
   test paths that no longer exist.
5. **Coverage gaps in non-core modules** — `src/dashboard/routes/`,
   `src/dashboard/services/`, `src/mcp/interfaces/`, 16 of 28 `src/mcp/utils/` files,
   and `src/dashboard/lib/{context,jsonApi}.ts` have **no direct tests**.

The standardization initiative is decomposed into **13 executable tasks** in
`../_tasks/testing-standardization.md`, organized as: Foundation (standards + config) →
Structural consolidation (locations + naming) → Coverage gaps → CI gate → Docs.

---

## 2. Current State

### 2.1 Framework & Tooling

| Item           | Value                                                                       |
| :------------- | :-------------------------------------------------------------------------- |
| Test runner    | **Vitest** `^4.1.7` (script: `npm run test` = `vitest --run`)               |
| Coverage       | `@vitest/coverage-v8` `^4.1.7` installed, **no thresholds configured**      |
| Property-based | `@fast-check/vitest` `^0.3.0` + `fast-check` `^4.6.0`                       |
| UI test stack  | `jsdom` `^30` + `@testing-library/svelte` + `@testing-library/jest-dom`     |
| Config files   | `vitest.config.ts` (pool `forks` for better-sqlite3 ESM; `testTimeout` 30s) |
| Type-check     | `tsc --noEmit && tsc -p tsconfig.test.json && svelte-check`                 |

### 2.2 Test Inventory (103 files)

| Location                                         | Count | Notes                                                                                           |
| :----------------------------------------------- | :---- | :---------------------------------------------------------------------------------------------- |
| `src/mcp/tests/`                                 | 62    | Server core (memory, tasks, standard, handoff, router, migrations, sqlite, soul-maintenance, …) |
| `src/mcp/tests/codebase-index/`                  | 21    | Indexing, parser, search, trace, tools                                                          |
| `src/dashboard/tests/`                           | 2     | `controllers.integration.test.ts` (1705 lines — god test), `codebase-api.integration.test.ts`   |
| `src/dashboard/lib/`                             | 1     | `helpers.test.ts` (colocated)                                                                   |
| `src/dashboard/ui/src/**/__tests__/` + colocated | 17    | Components, arena, kg, composables                                                              |

### 2.3 Naming & Location Conventions (current, mixed)

| Convention                      | Example                                                               | Count   |
| :------------------------------ | :-------------------------------------------------------------------- | :------ |
| Plain `X.test.ts` (centralized) | `src/mcp/tests/memory.write.test.ts`                                  | ~97     |
| `*.integration.test.ts`         | `src/dashboard/tests/controllers.integration.test.ts`                 | 3       |
| `e2e.test.ts`                   | `src/mcp/tests/e2e.test.ts`                                           | 2       |
| `*.perf.test.ts`                | `src/dashboard/ui/src/lib/kg/__tests__/KGNeuralRenderer.perf.test.ts` | 1       |
| snake_case legacy               | `src/mcp/tests/spec_compliance.test.ts`                               | 1       |
| Colocated                       | `src/dashboard/lib/helpers.test.ts`                                   | 2       |
| `__tests__/` dirs               | `src/dashboard/ui/src/components/__tests__/`                          | UI only |

---

## 3. Findings

### 3.1 Structure & Naming (High impact, low effort)

- **F-1** Three location conventions coexist: `tests/` (centralized), colocated, `__tests__/`.
  No documented rule says which applies where.
- **F-2** Four naming markers without a documented vocabulary: plain, `integration`,
  `e2e`, `perf`. A reader cannot infer scope (unit/integration/e2e) from the filename.
- **F-3** `spec_compliance.test.ts` violates the kebab/Pascal convention used everywhere else.
- **F-4** `controllers.integration.test.ts` is a 1700-line god-test — maintainability risk.

### 3.2 Documentation Drift — High impact, trivial effort

- **F-5** `CONTRIBUTING.md:15-16` — "Add unit tests in `src/` or update `src/e2e.test.ts`" —
  that path is stale; actual is `src/mcp/tests/e2e.test.ts`.
- **F-6** `application/modules/codebase-index/specs/tdd.md:607-612` — test strategy references
  `src/codebase-index/__tests__/*.test.ts`; actual is `src/mcp/tests/codebase-index/`.

### 3.3 CI — High impact

- **F-7** No workflow runs tests: `release.yml` (npm publish on tag) and `publish.yml`
  (deprecated no-op) contain zero `npm test` / `vitest` steps. Regressions ship silently
  on release tags.
- **F-8** No coverage threshold enforcement anywhere (`@vitest/coverage-v8` installed
  but unused thresholds).

### 3.4 Coverage Gaps — Medium/High impact by risk

| Module                         | Files without direct tests                                                                                                                                                                                                        | Risk                                                                               |
| :----------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| `src/mcp/utils/`               | `auto-infer`, `chunk`, `code-generator`, `constants`, `entity-ref`, `mcp-response`, `memory-utils`, `next-steps`, `normalize-args`, `pagination`, `purge-entity-cleanup`, `sql-builder`, `stopwords`, `summary`, `uuid`, `vector` | **High** (`uuid`, `sql-builder`, `pagination`, `vector` are used across the stack) |
| `src/mcp/interfaces/`          | `express.ts`, `index.ts`, `prompt.ts`                                                                                                                                                                                             | Low                                                                                |
| `src/dashboard/routes/` (10)   | all — covered only transitively via express integration tests                                                                                                                                                                     | Medium                                                                             |
| `src/dashboard/services/` (10) | no standalone suites                                                                                                                                                                                                              | Medium                                                                             |
| `src/dashboard/lib/`           | `context.ts`, `jsonApi.ts`, `interfaces.ts`                                                                                                                                                                                       | Medium                                                                             |
| `src/mcp/prompts/`             | `loader.ts`, `registry.ts` (only 2 md definitions tested)                                                                                                                                                                         | Low                                                                                |

---

## 4. Root Causes

1. **No written test standard** — the repo has no `docs/testing*.md` and no standards doc;
   test conventions evolved per-feature (F-1, F-2).
2. **Local-only testing culture** — CI never ran tests (F-7), so nothing enforced
   conventions or coverage.
3. **Feature-speed bias** — coverage followed the aging of hot paths (MCP core) while
   auxiliary modules (utils, routes, services) accumulated no unit tests (F-10…F-13).
4. **Docs not kept in sync** when the test tree was reorganized (F-5, F-6).

---

## 5. Target State (Definition of Standard)

1. **One documented standard** — `docs/testing.md` + machine-readable rules in
   `vitest.config.ts` (enforced, not aspirational).
2. **One location convention** — server/dashboard non-UI: centralized `src/**/tests/`;
   dashboard UI: colocated `__tests__/` next to components. No third pattern.
3. **One naming taxonomy** — `*.test.ts` (unit), `*.integration.test.ts`,
   `*.e2e.test.ts`, `*.perf.test.ts`. No snake_case, no out-of-taxonomy names.
4. **Coverage floor** — global % threshold with per-module focus on the 16 `utils/` files,
   dashboard routes/services, interfaces, prompts loader.
5. **CI gate** — every PR runs `type-check → lint → test --coverage`; release workflow
   blocks on test/coverage failure.
6. **Docs true** — `CONTRIBUTING.md` + all `tdd.md`/`prd.md` references point at real paths.

---

## 6. Task Map (execution plan)

| Task     | Title                                                | Phase          | Priority | Agent         | depends_on       |
| :------- | :--------------------------------------------------- | :------------- | :------- | :------------ | :--------------- |
| TST-001  | Define testing standards doc                         | Implementation | 5        | documentation | —                |
| TST-002  | Fix stale doc paths (CONTRIBUTING, tdd.md)           | Implementation | 2        | documentation | —                |
| TST-003  | Vitest coverage + grouping config                    | Implementation | 4        | backend       | TST-001          |
| TST-004a | Unify server test location (→ `src/**/tests/`)       | Implementation | 4        | backend       | TST-001          |
| TST-004b | Unify UI test location (`__tests__`)                 | Implementation | 4        | frontend      | TST-001          |
| TST-005  | Normalize integration/e2e/perf naming (server)       | Implementation | 3        | backend       | TST-001          |
| TST-006  | Unit tests: `src/mcp/utils/` (16 files)              | Implementation | 4        | backend       | TST-001          |
| TST-007  | Unit tests: `src/mcp/interfaces/`                    | Implementation | 2        | backend       | TST-001          |
| TST-008  | Tests: `src/dashboard/routes/`                       | Implementation | 3        | backend       | TST-001          |
| TST-009  | Tests: `src/dashboard/services/`                     | Implementation | 3        | backend       | TST-001          |
| TST-010  | Tests: `src/dashboard/lib/context.ts` + `jsonApi.ts` | Implementation | 3        | backend       | TST-001          |
| TST-011  | Tests: `src/mcp/prompts/` loader + registry          | Implementation | 2        | backend       | TST-001          |
| TST-012  | Full-suite green gate (post-consolidation)           | Testing        | 5        | tester        | TST-003..TST-011 |
| TST-013  | CI test+coverage gate (GitHub Actions)               | Implementation | 4        | devops        | TST-003          |
| TST-014  | `docs/testing.md` authoring                          | Implementation | 2        | documentation | TST-001, TST-012 |

Full task cards with acceptance criteria: **`../_tasks/testing-standardization.md`**

---

## 7. Risks & Assumptions

- **R1 (rename risk)**: TST-004/TST-005 renames may break imports — mitigated by
  `type-check` + `vitest --run` after each migration; TST-012 is the global gate.
- **R2 (god test)**: `controllers.integration.test.ts` (1700 lines) flagged but **not**
  split in this initiative (separate refactor task) — documented for follow-up.
- **R3 (coverage threshold)**: enforcing a strict global threshold before gap-closing
  tasks (TST-006…TST-011) would block CI — thresholds are configured in TST-003 but
  only made **blocking** after TST-012/TST-013.
- **R4**: The legacy `spec_compliance.test.ts` rename must keep its `eslint` rule match
  (`**/*.test.ts` pattern) intact.
- **R5**: `@fast-check/vitest` property tests already exist; new unit tests must follow
  the existing import/assert patterns (Vitest `describe/it/expect`), no style wars.
