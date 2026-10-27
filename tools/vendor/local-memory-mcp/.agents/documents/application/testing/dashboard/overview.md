# Dashboard Module — Testing Overview

> Scope: `src/dashboard/` (Express on port `3456`) plus `src/dashboard/ui/` (Svelte 5 plus Vite → `dist/dashboard/public/`) · Canonical: [../../../testing.md](../../../testing.md)

## Strategy

Dashboard has two runtimes sharing the primary SQLite DB `memory.db` (WAL), alongside the optional `cold-archive.db` cold tier (enabled by default via `COLD_ARCHIVE_ENABLED`; `src/mcp/utils/constants.ts:547`):

- **Express API** (`src/dashboard/server.ts`, REST `/api/*` on `PORT=3456`, bind `DASHBOARD_HOST=127.0.0.1`, JSON limit `DASHBOARD_JSON_LIMIT=50mb` via `src/mcp/utils/constants.ts`).
- **Svelte 5 UI** (`src/dashboard/ui/`, workspace with own `node_modules`, Vite build to `dist/dashboard/public/` via `npm run build` or `npm run dashboard:build`).

Testing splits along that boundary: API via integration tests driving real Express against `createTestStore()`, UI via `jsdom` plus `@testing-library/svelte` (wired via `server.deps.inline` plus Svelte plugin in `vitest.config.ts`). The UI bin (`bin/mcp-memory-dashboard.js` and `mcp-memory-server dashboard`) calls `ensureDashboardBuild()` which rebuilds `dist/dashboard/public/` if UI source is newer — in a fresh checkout this is a no-op; after checkout-without-build it throws until rebuilt.

Key risks: repo-only aggregation (`owner=""` merging short `repo` across owners for ops visibility — intentional, ADR-008), stale-cache serving (`DASHBOARD_STATS_TTL_MS=30000`, `DASHBOARD_KG_TTL_MS=30000`, `ARENA_OVERVIEW_TTL_MS=5000`), graph caps (`CODE_GRAPH_MAX_EDGES=400`, `KG_MAX_GRAPH_EDGES=4000`, `KG_MAX_CONTEXT_ENTITIES=50`, `KG_CONTEXT_TEXT_TOKENS=40`), and Vite build drift (`ensureDashboardBuild()` staleness check).

Every change ships its test in the same commit (review-blocking per `development-quality.md`). UI tests enforce repository standard **STD-002** (dashboard accessibility, focus, and polling baseline).

## Risk Register

| Risk                        | Likelihood | Impact   | Mitigation in tests                                |
| :-------------------------- | :--------- | :------- | :------------------------------------------------- |
| Repo-only leakage confusion | Medium     | High     | DSH-S-01, DSH-S-02: merged view vs MCP isolation   |
| Stale cache after TTL       | Medium     | Medium   | DSH-S-03: fake timers past TTL → recompute         |
| Build drift (stale bundle)  | Medium     | Medium   | DSH-S-16: deleted bundle → rebuild or throw        |
| XSS in memory content       | Low        | High     | DSH-S-14: escaped render; same payload as MEM-S-13 |
| Token leak in logs          | Low        | Critical | DSH-S-13: no token in `action_log` or stdout       |

## Pyramid

| Layer         | Marker                             | Focus                                                                                                                 | Example                                                                                                            | Share |
| :------------ | :--------------------------------- | :-------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------- | :---- |
| Unit          | `*.test.ts`                        | Pure helpers, stats cache TTL math, arena transforms (`arenaTransformLayout.test.ts` under `node`), JSON limit helper | `src/dashboard/tests/helpers.test.ts`, `src/dashboard/ui/src/lib/arena/__tests__/arenaTransformLayout.test.ts`     | 50%   |
| Integration   | `*.integration.test.ts`            | Express routes → services → store: `GET /api/memories?repo=X`, stats, code-graph, KG graph                            | `src/dashboard/tests/routes/*.integration.test.ts` (10 route groups), `controllers.integration.test.ts`            | 30%   |
| UI            | `*.test.ts` under `__tests__/`     | Svelte components (jsdom): TopBar, ArenaLegend, focus trap, useKanban, KG renderers                                   | `src/dashboard/ui/src/components/__tests__/TopBar.test.ts`, `src/dashboard/ui/src/lib/__tests__/focusTrap.test.ts` | 12%   |
| E2E plus Perf | `*.e2e.test.ts` / `*.perf.test.ts` | Bin launch: `ensureDashboardBuild()` plus port 3456 smoke; KG frame-constant reuse, `CODE_GRAPH_MAX_EDGES` cap        | `KGNeuralRenderer.perf.test.ts` (frame-constant) in `src/dashboard/ui/src/lib/kg/__tests__/`                       | 8%    |

UI composition: dashboard UI has 18 test files total (see [../../../testing.md](../../../testing.md) §6.1; `npx vitest run src/dashboard/ui` covers all). API integration lives in `src/dashboard/tests/` (centralized, not colocated) with 10 route groups plus services plus `lib/` helpers.

## Fixtures

- **Store**: `createTestStore()` in-memory SQLite for API tests (dashboard services use the same DB as MCP). No real `storage/memory.db` access on disk. Dashboard `CODEBASE_REPOS_DIR` is dashboard-only (parent dir default); MCP server ignores it and indexes only its CWD.
- **UI**: `@testing-library/svelte` (wired via `server.deps.inline` plus Svelte plugin). Require `// @vitest-environment jsdom` as FIRST line for DOM tests (verified 10 of 18 UI files); pure TypeScript tests (for example `arenaTransformLayout.test.ts`) run under `node` and MUST NOT declare jsdom (see [../../../testing.md](../../../testing.md) §1.2).
- **Workspace**: `src/dashboard/ui/vitest.config.ts` (jsdom default, `globals:true`, `$lib` alias) exists ONLY for runs launched from inside the UI workspace. Contributors MUST NOT rely on it for repo-root runs — root `vitest.config.ts` is the source of truth.
- **Build**: Tests run against source (`npm run dashboard:dev` on `:5173` proxies `/api` → `:3456`). `npm run dashboard:build` and `npm run build` produce `dist/dashboard/public/` plus `tsup` plus `dist/grammars/*.wasm` plus `bin/*.js` (via `scripts/gen-bins.mjs` plus `copy-grammar-wasm.sh`). `ensureDashboardBuild()` is skipped in installed package (no `src/`).
- **Temp file system**: If disk is needed, use `fs.mkdtemp(os.tmpdir())` and clean in `afterAll`; never write into `src/` or repository tree.
- **Pool**: `forks` fixed (required for `better-sqlite3` ESM). Default environment is `node` at root.
- **Embedded MCP opt-in**: `DASHBOARD_ENABLE_MCP=false` by default; when `true`, dashboard starts an embedded MCP client in-process (not relevant to most dashboard tests).

## Coverage

- **Floors**: `lines 70 / statements 70 / functions 70 / branches 60` via `provider: v8` plus `include: ["src/**/*.{ts,tsx}"]`. Floors apply to every matched file regardless of scoped run shape.
- **Gated**: `coverage.enabled=false` until REFACTOR-TST-013; evaluate with `npm run test -- --coverage` (exits 1 below floor by design; artifacts still written to `coverage/coverage-final.json` plus html and text reports). Until then, coverage failures are non-blocking.
- **Priority**: (1) 10 dashboard route groups (`src/dashboard/routes/`) — the highest API risk. (2) 12 services including `statsCache` (TTL plus aggregation). (3) `src/dashboard/lib/` (`context.ts`, `jsonApi.ts`). (4) UI accessibility, focus, and polling (STD-002) plus KG caps.
- **Running**: `bash scripts/copy-grammar-wasm.sh` → `npx vitest run src/dashboard/tests` · `npx vitest run src/dashboard/ui` (all 18 UI files) · `npm run test:integration` (`--project integration`) · `npm run test -- --coverage` · `npm run type-check` (`tsc` + `tsconfig.test.json` + `svelte-check`).
- **Inventory**: Shipped dashboard suites (REFACTOR-TST-008…011, commit `d5a94d7`): 10 route groups plus 12 services plus 2 `lib/` files (see [../../../testing.md](../../../testing.md) §7.1). 157 files total (unit 141 / integration 13 / end-to-end 2 / perf 1).

## Conventions

- API tests: `src/dashboard/tests/` — centralized (NOT colocated), mirroring server module path (for example `routes/*.integration.test.ts`, `services/*`, `lib/`). Forbidden: `*.test.ts` colocated beside server or non-UI source (migrated by REFACTOR-TST-004a).
- UI tests: `src/dashboard/ui/src/**/__tests__/` — colocated beside subject as a direct child `__tests__/` dir (for example `components/__tests__/TopBar.test.ts`, `lib/__tests__/focusTrap.test.ts`). Forbidden: UI test beside subject without `__tests__/` (migrated by REFACTOR-TST-004b).
- Every function, route, and component behavior: at least one positive and one negative case (review-blocking per `development-quality.md` §1).
- Filenames: `kebab-case` suffix taxonomy; `PascalCase` follows class subject (for example `KGNeuralRenderer.perf.test.ts`). No `snake_case`, no `_test.ts` (see [../../../testing.md](../../../testing.md) §3.1).
- Formatting: tabs, double quotes, `printWidth: 120`, `trailingComma: none`, semicolons on (via Prettier); `allowScripts` allowlist is load-bearing for native modules `better-sqlite3` and `tree-sitter`.

## Execution

```bash
bash scripts/copy-grammar-wasm.sh
npx vitest run src/dashboard/tests
npx vitest run src/dashboard/ui
npm run test:integration
npm run test -- --coverage
npm run type-check
```

Live UI work: `npm run dashboard:dev` (`:5173`, proxies `/api` → `:3456`) alongside `npm run dashboard` (`:3456` built bundle).

## Links

- Standard: [../../../testing.md](../../../testing.md) §1–9 · Global rules: `~/.agents/rules/test-architecture.md` plus `development-quality.md`
- API catalog: [../../api/README.md](../../api/README.md) (dashboard REST is separate from MCP `tools/call` transport) · Legacy API detail: `../../api/` → [api/codebase-index/api-codebase.md](../../api/codebase-index/api-codebase.md)
- Module: [../../modules/dashboard/overview.md](../../modules/dashboard/overview.md) · Manifest: [../../modules/manifest.md](../../modules/manifest.md)
- Server: `src/dashboard/server.ts` · Constants: `src/mcp/utils/constants.ts` · Bins: `bin/mcp-memory-dashboard.js`
- Compliance: `STD-002` (accessibility, focus, and polling baseline) — enforced in UI tests
