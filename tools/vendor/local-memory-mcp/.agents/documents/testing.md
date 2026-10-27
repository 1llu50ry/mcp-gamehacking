# Testing Standard

**Scope:** repository-wide (`src/`). Applies to every test file, new or existing.
**Status:** single authoritative standard (REFACTOR-TST-001). Supersedes all
per-feature conventions (centralized `tests/` vs colocated `*.test.ts` vs
`__tests__/`; plain/integration/e2e/perf markers).
**Enforcement:** code review + CI gate (REFACTOR-TST-013, pending). Sibling
tasks (REFACTOR-TST-003…012) migrated the existing tree to this standard —
the tree is fully conformant (verified 2026-08-10).

This document is the **rule**; test files are the **evidence**. A test file that
violates this standard fails review. It reflects, and does not duplicate, the
global rules in `~/.agents/rules/test-architecture.md` (4-concern rule,
domain-entity naming) and `~/.agents/rules/development-quality.md` (minimum
1 positive + 1 negative test per function/route) — see
[Relationships](#9-relationships) for the wiring.

---

## 1. Tooling & Configuration

| Item                     | Value                                                                                                                            |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| Runner                   | **Vitest** `^4.1.7`                                                                                                              |
| Coverage                 | `@vitest/coverage-v8` `^4.1.7` (evaluated on `--coverage` runs; not yet a blocking CI gate — see [Coverage](#7-coverage-policy)) |
| Property-based           | `@fast-check/vitest` `^0.3.0` + `fast-check` `^4.6.0`                                                                            |
| UI DOM                   | `jsdom` `^30.0.0`                                                                                                                |
| Type-check (tests incl.) | `npm run type-check` (`tsc --noEmit && tsc -p tsconfig.test.json && svelte-check`)                                               |

### 1.1 Root config — `vitest.config.ts`

Fixed facts (do not change without an ADR):

- `pool: "forks"` — REQUIRED for `better-sqlite3` ESM compatibility.
- `environment: "node"` default for the whole suite. DOM-dependent tests opt in
  per file (see 1.2).
- `testTimeout: 30_000` / `hookTimeout: 30_000`. Heavy suites override per file
  via `vi.setConfig({ testTimeout })` — `src/mcp/tests/e2e.e2e.test.ts` sets
  `90_000` (REQUIRED for its full-toolchain flows).
- Excludes: `dist/**`, `node_modules/**`, `src/dashboard/ui/node_modules/**`.
- Suite groups: `test.projects` (Vitest 4) defines five named projects —
  `unit` / `integration` / `e2e` / `perf` / `onnx` — each `extends: true`
  (inherits pool/environment/excludes/timeouts) with `include` patterns that
  PARTITION the taxonomy (no file runs twice). Each project uses a
  **positive-only** `include` + `exclude` split — no `!` negations inside
  `include` (FIX-381, see §6.2/§7.0). The root config is NOT a project itself;
  only global options (`reporters`, `coverage`) apply at root. Run one group
  with `--project <name>` (see §6). The `onnx` project (REL-051) holds the
  real-ONNX tests, runs them one file at a time (`fileParallelism: false`) and
  in a later `sequence.groupOrder` bucket so its forks never overlap any other
  test process — a native ORT abort under concurrent load broke the Release
  gate (see §6.2).
- Coverage: `provider: "v8"` with `reporter: text / text-summary / json / html`,
  `include: ["src/**/*.{ts,tsx}"]`, global floors
  `lines/statements/functions 70, branches 60`. Flag-gated (`--coverage`) until
  the suite reaches the floor (see §7) — `coverage.enabled` stays `false` until
  REFACTOR-TST-013.
- Svelte plugin + `resolve.conditions: ["browser"]` are present so UI
  components can be mounted under the root runner.

### 1.2 Environment selection

- Default environment is `node`.
- A test that touches DOM MUST declare `// @vitest-environment jsdom` as its
  FIRST line (verified pattern: 10 of the 18 UI test files).
- Pure-TypeScript tests (no DOM) MUST NOT declare jsdom — e.g.
  `src/dashboard/ui/src/lib/arena/__tests__/arenaTransformLayout.test.ts` runs
  under `node`.
- The app workspace `src/dashboard/ui/vitest.config.ts` exists SOLELY for runs
  launched from inside the UI workspace (jsdom default, `globals: true`,
  `$lib` alias). Contributors MUST NOT rely on it for repo-root runs.

---

## 2. Location Policy

Exactly two allowed patterns. There is NO third pattern.

### 2.1 Server / dashboard non-UI → centralized `src/**/tests/`

Every non-UI test file lives in a `tests/` directory that **mirrors the module
path** of the subject under test:

| Subject module                         | Test location                                      |
| :------------------------------------- | :------------------------------------------------- |
| `src/mcp/tools/memory.write.ts`        | `src/mcp/tests/memory.write.test.ts`               |
| `src/mcp/codebase-index/services/*.ts` | `src/mcp/tests/codebase-index/services/*.test.ts`  |
| `src/dashboard/controllers/*.ts`       | `src/dashboard/tests/*.integration.test.ts`        |
| `src/dashboard/routes/*.ts`            | `src/dashboard/tests/routes/*.integration.test.ts` |
| `src/mcp/utils/sql-builder.ts`         | `src/mcp/tests/utils/sql-builder.test.ts`          |

Real, verified examples: `src/mcp/tests/memory.write.test.ts`,
`src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`,
`src/dashboard/tests/controllers.integration.test.ts`.

The last two rows are shipped suites (REFACTOR-TST-006/008, committed
`d5a94d7`) — see the full inventory in §7.1.

Shared fixtures for the server scope live in `src/mcp/tests/fixtures/`
(see §5).

### 2.2 Dashboard UI → colocated `__tests__/` beside the subject

Every UI test file sits in an `__tests__/` directory that is a direct child of
the directory containing its subject:

| Subject file                                           | Test path                                                             |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| `src/dashboard/ui/src/components/ArenaLegend.svelte`   | `src/dashboard/ui/src/components/__tests__/ArenaLegend.test.ts`       |
| `src/dashboard/ui/src/lib/focusTrap.ts`                | `src/dashboard/ui/src/lib/__tests__/focusTrap.test.ts`                |
| `src/dashboard/ui/src/lib/arena/ArenaLayoutManager.ts` | `src/dashboard/ui/src/lib/arena/__tests__/ArenaLayoutManager.test.ts` |

### 2.3 Banned locations

- FORBIDDEN: a `*.test.ts` file colocated beside server/non-UI source.
  ✅ Migrated by REFACTOR-TST-004a: `src/dashboard/lib/helpers.test.ts`
  → `src/dashboard/tests/helpers.test.ts` (verified 2026-08-10).
- FORBIDDEN: a UI test file directly beside its subject (no `__tests__/`).
  ✅ Migrated by REFACTOR-TST-004b: `src/dashboard/ui/src/lib/kg/KGForceLayout.test.ts`
  → `src/dashboard/ui/src/lib/kg/__tests__/KGForceLayout.test.ts`;
  `src/dashboard/ui/src/lib/kg/graphLoader.test.ts`
  → `src/dashboard/ui/src/lib/kg/__tests__/graphLoader.test.ts`;
  `src/dashboard/ui/src/lib/kg/KGNeuralRenderer.perf.test.ts`
  → `src/dashboard/ui/src/lib/kg/__tests__/KGNeuralRenderer.perf.test.ts`;
  `src/dashboard/ui/src/lib/composables/useKanban.test.ts`
  → `src/dashboard/ui/src/lib/composables/__tests__/useKanban.test.ts`
  (verified 2026-08-10).
- FORBIDDEN: tests under `dist/`, `bin/`, `storage/`, `node_modules/` (lint
  ignores already enforce this).

---

## 3. Naming Taxonomy

Exactly four file suffixes exist. The suffix IS the scope declaration — a
reader MUST be able to infer what the file does from the name alone.

| Marker      | Suffix                  | Scope                                                                                                  | Verified examples                                                                                |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Unit        | `*.test.ts`             | One module, one layer, no live server, no network                                                      | `src/mcp/tests/memory.write.test.ts`, `src/dashboard/ui/src/components/__tests__/TopBar.test.ts` |
| Integration | `*.integration.test.ts` | Crosses component boundaries (router → DB, express → store); uses in-memory SQLite (`createTestStore`) | `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`                                     |
| E2E         | `*.e2e.test.ts`         | Full toolchain / high-complexity flows                                                                 | `src/mcp/tests/tasks.e2e.test.ts`                                                                |
| Perf        | `*.perf.test.ts`        | Performance characteristics (frame-constant reuse, allocation, timing bounds)                          | `src/dashboard/ui/src/lib/kg/__tests__/KGNeuralRenderer.perf.test.ts`                            |

### 3.1 Hard rules

Subject name: `kebab-case` words joined by `.`/`-`, mirroring the module name —
`mcp-tools.integration.test.ts`, `tasks.e2e.test.ts`,
`KGNeuralRenderer.perf.test.ts` (PascalCase follows the class subject name).

- BANNED: `snake_case` in any test filename (last server-scope violation
  migrated by REFACTOR-TST-005: `src/mcp/tests/spec_compliance.test.ts` →
  `spec-compliance.test.ts`). `snake_case` test names fail review.
- BANNED: `_test.ts` / `_spec.ts` surrogate markers.
- BANNED: out-of-taxonomy suffixes (`*.spec.test.ts`, `*.test.integration.ts`,
  `*.e2e.ts`). If a test belongs to a marker, the marker MUST be
  `<subject>.integration.test.ts` / `<subject>.e2e.test.ts` /
  `<subject>.perf.test.ts` — never elsewhere in the name.
- The legacy `src/mcp/tests/e2e.test.ts` was renamed by REFACTOR-TST-005 to
  `e2e.e2e.test.ts` — the `e2e` project include (`**/*.e2e.test.ts`) captures
  it, and it no longer runs in the `unit` project. New E2E suites MUST use
  `*.e2e.test.ts`, never a bare `e2e` prefix.
- One subject → one test file, unless split by marker (unit + integration are
  separate files). Do NOT bundle unit inside an `integration` file.

---

## 4. Scope & Layer Rules (4-Concern)

Reflects the global 4-concern rule (`~/.agents/rules/test-architecture.md`)
with repo-specific binding below. Every assertion is placed in **exactly ONE**
layer. There is no duplication permission — a rule asserted at the Service
layer MUST NOT repeat in the State layer.

| Layer   | Where it lives in this repo                                           | MUST assert                                        | MUST NOT assert                            |
| ------- | --------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| DB      | `src/mcp/tests/*.test.ts` (sqlite, migrations, FTS)                   | Integrity, FKs, unique indexes, cascades, defaults | Business rules, UI logic                   |
| Service | `src/mcp/tests/` + `src/dashboard/tests/services/`                    | Domain calcs, business rules, action outcomes      | DB constraints, UI validation              |
| State   | `src/mcp/tests/tasks-transition.test.ts` (status transitions, guards) | Status transitions, guards, workflow rules         | DB integrity, UI rendering                 |
| UI      | `src/dashboard/ui/src/**/__tests__/`                                  | Rendering, events, a11y, focus/modal behaviour     | Business calcs, DB logic, domain decisions |

### 4.1 Hard rules

- A UI test MUST NOT assert business logic (scoring math, TTL expiry, status
  rules). UI tests assert **presentation** only — e.g. `ArenaLegend.test.ts`
  asserts label/colour rendering, not arena-ranking math.
- A Service test MUST NOT open a real HTTP server or drive the express app.
- A State test MUST NOT install DB constraints to pass; guards are code rules.
- Tests that cross DB: Service/Integration. Tests that cross modules:
  Integration. Everything else: Unit.

### 4.2 Minimum per function/route (global rule, enforced)

Every test target (function, handler, route, component behaviour) MUST have:

1. ≥ 1 **positive** case — happy path, expected success.
2. ≥ 1 **negative** case — error, validation failure, forbidden state.

These land in the SAME file; empty it or drop either → review fail.

---

## 5. Fixture Conventions

- All SHARED fixtures MUST live under
  `src/mcp/tests/fixtures/` — real tree:
  `src/mcp/tests/fixtures/codebase-index/search-test-fixture/`.
  Subject mirror sub-paths (e.g. `fixtures/codebase-index/`) NOT flat piles.
- A fixture is a checked-in file set used by ≥ 2 tests. Single-test fixtures
  sit next to the test (same dir) or are generated inline.
- FORBIDDEN: writing files into the repo working tree
  (`src/`, `docs/`, root). Any test that must write to disk creates a
  directory via `fs.mkdtemp(os.tmpdir())` and cleans it AFTER `afterAll`.
  Verified pattern: `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`.
- FORBIDDEN: committing fixture files written by tests (they are temp).
- For in-memory DB state, use `createTestStore()` — an in-memory SQLite factory
  exported from `src/mcp/storage/sqlite.ts` (production module), used by
  `src/mcp/tests/e2e.e2e.test.ts` and
  `src/mcp/tests/codebase-index/mcp-tools.integration.test.ts`. Tests NEVER
  touch the real `storage/` directory.

---

## 6. Running Tests

| Command                           | Effect                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `npm run test`                    | Full suite (all projects), run once (`vitest --run`)                             |
| `npm run test:watch`              | Watch mode (`vitest`)                                                            |
| `npm run test:unit`               | `vitest --run --project unit` — only `*.test.ts` (non-integration/e2e/perf)      |
| `npm run test:integration`        | `vitest --run --project integration` — only `*.integration.test.ts`              |
| `npm run test:e2e`                | `vitest --run --project e2e` — only `*.e2e.test.ts`                              |
| `npm run test:perf`               | `vitest --run --project perf` — only `*.perf.test.ts`                            |
| `npx vitest --run --project onnx` | `onnx` project — the real-ONNX tests, serialized (REL-051, see §6.2)             |
| `npx vitest run <file-or-dir>`    | Scoped run (any path from §2)                                                    |
| `npm run test -- --coverage`      | Full suite with V8 coverage report (reporter: text / text-summary / json / html) |
| `npm run type-check`              | `tsc` (src + `tsconfig.test.json` incl. `src/**/*.test.ts`) + `svelte-check`     |

### 6.1 Scoped-run recipes (all verified to resolve)

```bash
npm run test                                        # whole suite
npm run test:watch                                # watch
npx vitest run src/mcp/tests/memory.write.test.ts # one file
npx vitest run src/mcp/tests/codebase-index       # one dir (25 files)
npx vitest run src/dashboard/tests                # dashboard integration
npx vitest run src/dashboard/ui                    # all 18 UI files
npm run test -- --coverage                        # +V8 coverage
```

E2E / perf are part of the full suite — run them deliberately:
`npx vitest run src/mcp/tests/tasks.e2e.test.ts`,
`npx vitest run src/dashboard/tests/controllers.integration.test.ts`,
`npx vitest run src/dashboard/ui/src/lib/kg/__tests__/KGNeuralRenderer.perf.test.ts`.

### 6.2 Project-scoped runs (live since REFACTOR-TST-003)

`test.projects` partitions the suite into `unit` / `integration` / `e2e` /
`perf`; the scripts in §6 run one group each. Partitioning is exhaustive and
disjoint — no file runs twice (the legacy `e2e.test.ts` moved to the `e2e`
project as `e2e.e2e.test.ts` by REFACTOR-TST-005). Current suite (verified
2026-08-10, clean tree): **157 files** — `unit` 141 / `integration` 13 /
`e2e` 2 / `perf` 1 (see §7.1 for the module-level inventory). FIX-381: each
project uses a **positive-only `test.include` + `test.exclude`** split — the
old unit `include` embedded `!`-negated patterns (e.g.
`"!**/*.integration.test.ts"`), and ANY `!` pattern inside a project `include`
silently broke coverage collection (empty `coverage-final.json`; see §7).
Caveats:

- Coverage is NOT included in project-scoped runs (flag-gated, see §7);
  thresholds are evaluated only under `--coverage`, after the full suite runs.
- Scoped coverage runs (e.g. `npx vitest run <file> --coverage`) still emit
  the full `src/**` skeleton + fire the global thresholds (correct — the
  floors apply to all-files semantics regardless of scope).
- The root `exclude` does NOT cover gitignored scratch under `.tmp/` — a
  stray `*.test.ts` there (e.g. the leftover FIX-381 probe
  `.tmp/cov-probe.test.ts`) is picked up by discovery and adds +1 file to
  local runs. Keep `.tmp/` free of test files; it is not part of the suite.
  (Early FIX-381 reports of "165 files" included several such probes that
  have since been cleaned — the reproducible suite size is 157.)

#### 6.2.1 `onnx` project — real-ONNX isolation + serialization (REL-051)

The GitHub Release gate failed at `npm run test` with a vitest fork worker
aborting via SIGABRT (a native ONNX/ORT abort, not a JS throw) while running
`src/mcp/tests/vectors.worker-parity.test.ts`; the same suite passed on a
parallel CI run, i.e. a memory/native flake. Four files load REAL ONNX and are
partitioned into the `onnx` project (excluded from `unit`/`perf` so each runs
exactly once):

| File                               | Why real ONNX                                                 |
| ---------------------------------- | ------------------------------------------------------------- |
| `vectors.worker-parity.test.ts`    | `createFeatureExtractor` + worker `RealVectorStore.embed`     |
| `embedding-smoke.test.ts`          | `RealVectorStore.initialize` / `upsert`                       |
| `lightness.perf.test.ts`           | `RealVectorStore.initialize` / `embed`                        |
| `daemon-init-latency.perf.test.ts` | boots a daemon whose embedding worker backfills via real ONNX |

Files that MOCK `@xenova/transformers` or inject a fake extractor do NOT load
ONNX and stay in `unit`: `vectors.threads.test.ts`,
`embedding-model.version.test.ts`, `vectors.blob-format.test.ts`.

Serialization mechanism (Vitest 5.0.1):

- `test.poolOptions` / `forks.singleFork` were REMOVED in Vitest 4 (they now
  log a deprecation and are ignored). The supported equivalent is the
  **top-level `fileParallelism: false`**, which resolves to `maxWorkers: 1`.
- Projects run in PARALLEL with each other by default, so `fileParallelism:
false` alone only serializes files WITHIN the project. The `onnx` project
  therefore also sets `sequence: { groupOrder: 1 }` while `unit`/`integration`/
  `e2e`/`perf` stay at the default `0`. Groups run lowest→highest and each
  group fully settles before the next starts, so the single `onnx` worker
  begins only AFTER every other project has finished.

Guarantee: no real-ONNX fork ever overlaps another test process, under a single
`npm run test` (no workflow edit, no separate gate step). `--project onnx`
still works standalone. The parity test keeps its "ONNX unavailable →
`ctx.skip()`" behavior and adds a REL-051 memory safety valve (skip when free
memory is critically low).

## 7. Coverage Policy

`@vitest/coverage-v8` is installed; `npm run test -- --coverage` reports
**real, non-empty coverage since FIX-381**. Verified 2026-08-10 on node
v24.18.0 + vitest 4.1.7 (full suite green — 157 files / 2287 tests; the
primary run source is `coverage/coverage-final.json`, 386 per-file entries):
the report shows per-file rows and the global floors are evaluated.

Current totals (all-of-src baseline, `include: ["src/**/*.{ts,tsx}"]`,
re-read from `coverage/coverage-final.json` on 2026-08-10 — identical to the
FIX-381 console summary): `Statements 57.31%` (11648/20322),
`Branches 54.34%` (6986/12856), `Functions 63.22%` (1984/3138),
`Lines 58.41%` (10659/18248). Below the floor — see "Non-blocking today"
below.

### 7.0 FIX-381 root cause (do not reintroduce)

The EMPTY v8 coverage reports (empty `coverage-final.json` + degenerate
totals) were a **config-level bug, NOT a node/vitest version problem**:
`!`-negated patterns inside a project's `test.include` broke coverage
collection entirely (reproduced with any negation, even a harmless one; on
vitest 4.1.7 AND 4.1.10 × node 24, both `v8` and `istanbul` providers, via
minimal-config bisection — see FIX-381 comment). Fix: partition with
positive-only `test.include` + `test.exclude` (identical disjoint split).
Do NOT reintroduce `!` patterns in project `include` arrays.

The config (REFACTOR-TST-003, live) is:

- provider `v8`, coverage `reporter`: `text` + `text-summary` + `json` + `html`,
  `include: ["src/**/*.{ts,tsx}"]`, exclude `dist`/`node_modules`/
  `src/dashboard/ui/node_modules`.
- Global floors: `lines: 70`, `statements: 70`, `functions: 70`, `branches: 60`.
  NOTE: `thresholds.all` is a jest/nyc option with NO Vitest equivalent (Vitest
  would parse `all` as a file-glob key). The all-files semantics come from
  `coverage.include` — including the pattern pulls untested files into the
  report, and the global floors apply to every matched file.
- Non-blocking today: `coverage.enabled` is `false`, so thresholds are only
  evaluated when coverage runs (`--coverage`). The v8 provider has no warn-only
  mode — a missed threshold fails the run (exit 1). Since FIX-381 the suite is
  BELOW the floor, so `npm run test -- --coverage` exits 1 with
  `ERROR: Coverage for ... does not meet global threshold` — this is the
  enforcement working as designed (artifacts are still written before the
  threshold check: `coverage/coverage-final.json` + html/text reports).
- Agent environments: vitest auto-sets the `text` reporter's `skipFull: true`,
  so 100%-covered files are omitted from the console table (token saving);
  use `coverage/` html or `coverage-final.json` for the complete file list.
- Thresholds become BLOCKING in CI (REFACTOR-TST-013: `npm run test -- --coverage`
  gate on PR + before publish, `enabled: true`); until the suite reaches the
  floor, coverage failures are non-blocking (REFACTOR-TST-012 is the green gate).

### 7.1 Suite inventory (all shipped — REFACTOR-TST-006…011, commit `d5a94d7`)

The modules targeted by the standardization initiative now have direct
suites (committed, conformant, part of the 157-file suite in §6.2):

| Module                                                              | Suite location                                     | Files | Task    |
| ------------------------------------------------------------------- | -------------------------------------------------- | ----- | ------- |
| `src/mcp/utils/` (`uuid`, `sql-builder`, `pagination`, `vector`, …) | `src/mcp/tests/utils/`                             | 16    | TST-006 |
| `src/mcp/interfaces/` (`express`, `index`, `prompt`)                | `src/mcp/tests/interfaces/`                        | 3     | TST-007 |
| `src/dashboard/routes/` (10 route groups)                           | `src/dashboard/tests/routes/*.integration.test.ts` | 10    | TST-008 |
| `src/dashboard/services/` (12 services incl. `statsCache`)          | `src/dashboard/tests/services/`                    | 12    | TST-009 |
| `src/dashboard/lib/` (`context.ts`, `jsonApi.ts`)                   | `src/dashboard/tests/lib/`                         | 2     | TST-010 |
| `src/mcp/prompts/` (`loader`, `registry`)                           | `src/mcp/tests/prompts/`                           | 2     | TST-011 |

The pre-initiative suites (legacy `src/mcp/tests/` tree,
`src/dashboard/tests/controllers.integration.test.ts` +
`codebase-api.integration.test.ts` + `helpers.test.ts`, and the 18 UI files
under `src/dashboard/ui/src/**/__tests__/`) are conformant and covered by the
same partition. Beyond this inventory, coverage priority is judged per-module
at the REFACTOR-TST-013 CI gate.

### 7.2 Same-commit with new code

Every change ships its tests in the same commit. Adding a function or
route WITHOUT a matching `*.test.ts` / `*.integration.test.ts` diff is a
REVIEW-BLOCKING defect (enforced at code review), not a follow-up.

---

## 8. Environment & CI (REFACTOR-TST-013)

- No GitHub workflow currently runs tests (`release.yml` publishes on tag
  without `npm test`); this is a known risk (F-7). A `ci.yml` (REFACTOR-TST-013,
  pending) will run `type-check → lint → npm run test -- --coverage` on every
  PR; `release.yml` will require CI success before publish.
- While CI is absent, `npm run type-check && npm run test` is the LOCAL
  pre-push gate.
- Server-scope test names are conformant since REFACTOR-TST-005 (legacy
  `spec_compliance.test.ts` → `spec-compliance.test.ts` and
  `e2e.test.ts` → `e2e.e2e.test.ts`); UI colocation was completed by
  REFACTOR-TST-004b (all UI tests now sit in `__tests__/` beside their
  subjects) — the tree is fully conformant.

---

## 9. Relationships

- Global rules reflected (not duplicated): `~/.agents/rules/test-architecture.md`
  (4-concern rule, domain-entity naming) and
  `~/.agents/rules/development-quality.md` (min 1 positive + 1 negative test).
- Repo standard for dashboard UI baseline (a11y/focus/polling) enforced in UI
  tests: MCP standard **STD-002** (repository-level).
- Parent initiative: `REFACTOR-TST-000` (13-task standardization); this doc is
  the input to TST-002..TST-014.

---

_Repository-level standard. Last reviewed 2026-08-10 (REFACTOR-TST-014)._

---

## 10. Change Log

| Date       | Task             | Change                                                                                                                                            |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-09 | REFACTOR-TST-001 | Authored this standard.                                                                                                                           |
| 2026-08-09 | REFACTOR-TST-002 | Fixed stale test-path references (paths, counts).                                                                                                 |
| 2026-08-09 | REFACTOR-TST-003 | §1.1/§6/§7: projects partition + flag-gated coverage config.                                                                                      |
| 2026-08-09 | REFACTOR-TST-005 | §3.1: `spec_compliance` → `spec-compliance`, legacy `e2e.test.ts` → `e2e.e2e.test.ts`.                                                            |
| 2026-08-10 | FIX-381          | §6.2/§7/§7.0: positive-only include partition; real coverage numbers; root cause note.                                                            |
| 2026-08-10 | REFACTOR-TST-014 | Final pass: shipped-suite inventory (§7.1), suite counts 157 files / 2287 tests, coverage totals re-verified from `coverage/coverage-final.json`. |
